import { archiveCurrentObservation, recordSourceCapture } from './observationRecordService.js'
import { readSourceCapture } from './observationRecords.js'
import type { FileCapture } from '../accounting/observationRecord.js'
import { createHmac } from 'node:crypto'
import { applyRestoreSources } from './restoreSources.js'
import { getAppDataDirectory } from './paths.js'
import { opendir, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { selectCodexFileContributions } from '../core/codexFileSelection.js'

import {
  CLAUDE_HISTORY_ADAPTER,
  CLAUDE_HISTORY_SCHEMA_VERSION,
  readClaudeHistoryFile,
} from '../adapters/claude.js'
import {
  CODEX_HISTORY_ADAPTER,
  CODEX_HISTORY_SCHEMA_VERSION,
  readCodexHistoryFile,
} from '../adapters/codex.js'
import { sourceIdentifierSalt } from '../adapters/identifiers.js'
import {
  createDiagnostics,
  type AdapterDiagnostics,
  type AdapterFileReadResult,
  type AdapterOptions,
  type NormalizedUsage,
  type UsageProvider,
} from '../adapters/types.js'
import { discoverJsonlFiles, readFileSnapshot } from '../adapters/jsonl.js'
import {
  createHistorySource,
  getDatabase,
  getHistoryFileCacheEntries,
  getHistorySourceScanStatuses,
  getSessionReference,
  getUsageSessions,
  getHistorySources,
  recordHistorySourceScanFailure,
  removeHistorySource,
  replaceHistorySourceSessions,
  updateHistorySource,
  type CachedNormalizedUsage,
  type HistoryFileCacheMutation,
  type HistorySource,
  type HistorySourceInput,
} from './database.js'
import { getIdentifierSalt, normalizeHistoryRoot, restoreRequiresReconnect } from './paths.js'
import { aggregateSessions, type AggregationDiagnostics } from './sessionAggregation.js'
import { beginScan, finishScan, reportScannedFile } from './scanProgress.js'

export type HistorySourceAvailability = 'available' | 'unavailable'
export type HistorySourceReason = 'not_found' | 'not_readable' | 'scan_failed'

export type HistorySourceView = Omit<HistorySource, 'createdAt' | 'updatedAt'> & {
  availability: HistorySourceAvailability
  lastScan: {
    status: 'never' | 'complete' | 'unavailable' | 'failed'
    completedAt?: string
    filesSeen?: number
    eventsWritten?: number
    reason?: HistorySourceReason
  }
}

export type HistorySourceTestResult = {
  availability: HistorySourceAvailability
  filesDiscovered: number
  reason?: 'not_found' | 'not_readable'
}

export type SourceScanOutcome = {
  sourceId: string
  sourceName: string
  provider: UsageProvider
  status: 'complete' | 'unavailable' | 'failed'
  events: number
  diagnostics?: Record<string, number>
}

export type HistoryScanResult = {
  completedAt: string
  providers: Partial<Record<UsageProvider, { events: number; diagnostics: Record<string, number> }>>
  sources: SourceScanOutcome[]
}

export type HistoryScanMode = 'incremental' | 'full'

function reasonForFileError(error: unknown): 'not_found' | 'not_readable' {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
    ? 'not_found'
    : 'not_readable'
}

export async function probeHistoryRoot(
  root: string,
  timeoutMilliseconds = 3_000,
): Promise<{ availability: HistorySourceAvailability; reason?: 'not_found' | 'not_readable' }> {
  let timer: NodeJS.Timeout | undefined
  const probe = opendir(root)
    .then(async (directory) => {
      await directory.close()
      return { availability: 'available' as const }
    })
    .catch((error: unknown) => ({
      availability: 'unavailable' as const,
      reason: reasonForFileError(error),
    }))
  const timeout = new Promise<{ availability: 'unavailable'; reason: 'not_readable' }>(
    (resolve) => {
      timer = setTimeout(
        () => resolve({ availability: 'unavailable', reason: 'not_readable' }),
        timeoutMilliseconds,
      )
    },
  )
  try {
    return await Promise.race([probe, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Only the built-in Codex source owns its sibling archive directory. */
function sourceRoots(source: HistorySource): Array<{ root: string; prefix: string; rank: number }> {
  const roots = [{ root: source.root, prefix: '', rank: 0 }]
  if (
    source.provider === 'codex' &&
    source.kind === 'default' &&
    basename(source.root) === 'sessions'
  ) {
    roots.push({
      root: join(dirname(source.root), 'archived_sessions'),
      prefix: '\0archived_sessions\0',
      rank: 1,
    })
  }
  return roots
}

async function availableSourceRoots(source: HistorySource) {
  const roots = await Promise.all(
    sourceRoots(source).map(async (root) => ({
      ...root,
      ...(await probeHistoryRoot(root.root)),
    })),
  )
  // Missing optional directories are normal. Permission/timeout failures are
  // not evidence of absence and must protect the complete last-good snapshot.
  if (roots.some((root) => root.reason === 'not_readable'))
    return { availability: 'unavailable' as const, reason: 'not_readable' as const, roots: [] }
  const available = roots.filter((root) => root.availability === 'available')
  return available.length
    ? { availability: 'available' as const, roots: available }
    : { availability: 'unavailable' as const, reason: 'not_found' as const, roots: [] }
}

export async function testHistorySource(
  input: HistorySourceInput,
): Promise<HistorySourceTestResult> {
  const root = normalizeHistoryRoot(input.root)
  const availability = await probeHistoryRoot(root)
  if (availability.availability === 'unavailable') {
    return { availability: 'unavailable', filesDiscovered: 0, reason: availability.reason }
  }

  const diagnostics = createDiagnostics()
  for await (const _filePath of discoverJsonlFiles(root, diagnostics)) {
    // discoverJsonlFiles keeps the path inside this process. Only the count is
    // returned to the explicit local settings surface.
  }
  if (diagnostics.ioErrors > 0) {
    return { availability: 'unavailable', filesDiscovered: 0, reason: 'not_readable' }
  }
  return { availability: 'available', filesDiscovered: diagnostics.filesDiscovered }
}

export async function listHistorySourceViews(): Promise<HistorySourceView[]> {
  const sources = getHistorySources()
  const statuses = new Map(
    getHistorySourceScanStatuses().map((status) => [
      `${status.sourceId}:${status.provider}`,
      status,
    ]),
  )
  return await Promise.all(
    sources.map(async (source) => {
      const availability = source.enabled
        ? await availableSourceRoots(source)
        : ({ availability: 'unavailable', reason: 'not_readable' } as const)
      const status = statuses.get(`${source.id}:${source.provider}`)
      const lastScan: HistorySourceView['lastScan'] = status
        ? {
            status:
              status.status === 'running'
                ? 'failed'
                : status.status === 'complete'
                  ? 'complete'
                  : status.status,
            ...(status.completedAt ? { completedAt: status.completedAt } : {}),
            filesSeen: status.filesSeen,
            eventsWritten: status.eventsWritten,
            ...(status.errorCode ? { reason: status.errorCode } : {}),
          }
        : { status: 'never' }
      return {
        id: source.id,
        provider: source.provider,
        kind: source.kind,
        name: source.name,
        root: source.root,
        enabled: source.enabled,
        availability: availability.availability,
        lastScan,
      }
    }),
  )
}

function addDiagnostics(
  target: Record<string, number>,
  source: Record<string, number>,
): Record<string, number> {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + value
  }
  return target
}

type DiscoveredHistoryFile = {
  path: string
  fileKey: string
  byteSize: number
  fileMtime: string
  canonicalRelativeIdentity: string
  sourceRank: number
}

type AdapterSignature = { adapter: string; schemaVersion: string }

function adapterSignature(provider: UsageProvider): AdapterSignature {
  return provider === 'claude'
    ? { adapter: CLAUDE_HISTORY_ADAPTER, schemaVersion: CLAUDE_HISTORY_SCHEMA_VERSION }
    : { adapter: CODEX_HISTORY_ADAPTER, schemaVersion: CODEX_HISTORY_SCHEMA_VERSION }
}

function pathIsWithin(canonicalRoot: string, candidate: string): boolean {
  const child = relative(canonicalRoot, candidate)
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`))
}

function canonicalRelativeIdentity(
  canonicalRoot: string,
  canonicalFile: string,
): string | undefined {
  if (!pathIsWithin(canonicalRoot, canonicalFile)) return undefined
  const relativePath = relative(canonicalRoot, canonicalFile)
  if (!relativePath || isAbsolute(relativePath)) return undefined
  const slashSeparated = relativePath.split(sep).join('/')
  return process.platform === 'win32' ? slashSeparated.toLocaleLowerCase('en-US') : slashSeparated
}

function opaqueFileKey(cacheSalt: string, relativeIdentity: string): string {
  return createHmac('sha256', cacheSalt).update(`history-file\0${relativeIdentity}`).digest('hex')
}

/**
 * Discovery still uses the shared canonical-root and cycle-safe walker. This
 * layer adds a canonical relative identity plus a stat fingerprint without
 * persisting either the root or a real path.
 */
async function discoverSourceFiles(
  root: string,
  cacheSalt: string,
  diagnostics: AdapterDiagnostics,
  identityPrefix = '',
  sourceRank = 0,
): Promise<DiscoveredHistoryFile[] | undefined> {
  let canonicalRoot: string
  try {
    canonicalRoot = await realpath(root)
  } catch {
    diagnostics.ioErrors += 1
    return undefined
  }

  const files: DiscoveredHistoryFile[] = []
  for await (const filePath of discoverJsonlFiles(root, diagnostics)) {
    reportScannedFile()
    let canonicalFile: string
    try {
      canonicalFile = await realpath(filePath)
    } catch {
      diagnostics.ioErrors += 1
      continue
    }
    const relativeIdentity = canonicalRelativeIdentity(canonicalRoot, canonicalFile)
    const snapshot = readFileSnapshot(filePath)
    if (!relativeIdentity || !snapshot) {
      // The walk has already shown this entry to be a JSONL file. If it cannot
      // now be canonicalized or stat'ed, committing deletions would risk
      // replacing a good source snapshot with a partial one.
      diagnostics.ioErrors += 1
      continue
    }
    files.push({
      path: filePath,
      fileKey: opaqueFileKey(cacheSalt, identityPrefix + relativeIdentity),
      sourceRank,
      byteSize: snapshot.byteSize,
      fileMtime: snapshot.fileMtime,
      canonicalRelativeIdentity: relativeIdentity,
    })
  }

  if (diagnostics.ioErrors > 0) return undefined
  // A stable order makes duplicate Claude message handling deterministic even
  // when a subset of files comes from cache rather than the parser.
  return files.sort((left, right) =>
    left.canonicalRelativeIdentity.localeCompare(right.canonicalRelativeIdentity),
  )
}
function cacheMatches(
  cached: ReturnType<typeof getHistoryFileCacheEntries>[number] | undefined,
  file: DiscoveredHistoryFile,
  signature: AdapterSignature,
): boolean {
  return Boolean(
    cached &&
    cached.valid &&
    cached.sourceState !== 'missing' &&
    cached.byteSize === file.byteSize &&
    cached.fileMtime === file.fileMtime &&
    cached.adapter === signature.adapter &&
    cached.schemaVersion === signature.schemaVersion,
  )
}

function cachedEvent(event: NormalizedUsage): CachedNormalizedUsage {
  // Do not spread `event`: localReference contains real source paths and
  // native IDs for local preview/resume, all of which are forbidden from the
  // file cache.
  return {
    provider: event.provider,
    ...(event.eventKey === undefined ? {} : { eventKey: event.eventKey }),
    month: event.month,
    observedAt: event.observedAt,
    sessionKey: event.sessionKey,
    projectKey: event.projectKey,
    ...(event.projectLabel === undefined ? {} : { projectLabel: event.projectLabel }),
    model: event.model,
    inputTokens: event.inputTokens,
    cacheReadTokens: event.cacheReadTokens,
    cacheWriteTokens: event.cacheWriteTokens,
    outputTokens: event.outputTokens,
    reasoningTokens: event.reasoningTokens,
    ...(event.activeSeconds === undefined ? {} : { activeSeconds: event.activeSeconds }),
    captureMethod: event.captureMethod,
    adapter: event.adapter,
    schemaVersion: event.schemaVersion,
    confidence: event.confidence,
  }
}

function captureReferences(events: readonly NormalizedUsage[]) {
  const refs = new Map<string, { sessionKey: string; projectKey: string; month: string }>()
  for (const { sessionKey, projectKey, month } of events)
    refs.set(JSON.stringify([sessionKey, projectKey, month]), { sessionKey, projectKey, month })
  return [...refs.values()]
}

function restoredCachedEvents(events: CachedNormalizedUsage[]): NormalizedUsage[] {
  // Cache rows have been explicitly decoded in database.ts and contain no
  // localReference. A copy keeps aggregation from ever mutating an object that
  // will be reused on a later scan.
  return events.map((event) => ({ ...event }))
}

async function readOneHistoryFile(
  provider: UsageProvider,
  path: string,
  options: AdapterOptions,
): Promise<AdapterFileReadResult> {
  return provider === 'claude'
    ? await readClaudeHistoryFile(path, options, new Set<string>())
    : await readCodexHistoryFile(path, options)
}

type IncrementalSourceRead = {
  events: NormalizedUsage[]
  diagnostics: AdapterDiagnostics
  fileCache: HistoryFileCacheMutation
  captures: FileCapture[]
  failed: boolean
  knownSessionKeys?: string[]
}

async function readSourceIncrementally(
  source: HistorySource,
  identifierSalt: string,
  mode: HistoryScanMode,
): Promise<IncrementalSourceRead> {
  const diagnostics = createDiagnostics()
  const signature = adapterSignature(source.provider)
  // Use a source namespace even for default sources, whose session/project
  // identifiers intentionally retain their legacy salt for compatibility.
  const cacheSalt = sourceIdentifierSalt(identifierSalt, source.id)
  const availability = await availableSourceRoots(source)
  const discovered = await Promise.all(
    availability.roots.map((root) =>
      discoverSourceFiles(root.root, cacheSalt, diagnostics, root.prefix, root.rank),
    ),
  )
  const files = discovered.flatMap((files) => files ?? [])
  if (availability.availability !== 'available' || discovered.some((files) => !files)) {
    return {
      events: [],
      diagnostics,
      fileCache: { upsert: [], deleteFileKeys: [] },
      captures: [],
      failed: true,
    }
  }

  const captures: FileCapture[] = []
  const previousFiles = new Map(
    (readSourceCapture(getDatabase(), source.id, source.provider)?.files ?? []).map((file) => [
      file.fileKey,
      file,
    ]),
  )
  const cacheEntries = getHistoryFileCacheEntries(source.id, source.provider)
  const cachedByFileKey = new Map(cacheEntries.map((entry) => [entry.fileKey, entry]))
  const seenFileKeys = new Set<string>()
  const events: NormalizedUsage[] = []
  const upsert: HistoryFileCacheMutation['upsert'] = []
  const seenClaudeMessages = new Set<string>()
  const contributions: Array<{
    fileKey: string
    fileMtime: string
    sourceState: 'present' | 'missing'
    sourceRank: number
    sessionKeys?: string[]
    events: NormalizedUsage[]
  }> = []
  const scanSalt =
    source.kind === 'default' ? identifierSalt : sourceIdentifierSalt(identifierSalt, source.id)
  const adapterOptions: AdapterOptions = {
    identifierSalt: scanSalt,
    includeLocalProjectLabel: true,
    includeLocalReferences: source.kind === 'default',
    portableProjectPaths: source.kind === 'configured',
  }

  function appendContribution(contribution: NormalizedUsage[]): void {
    for (const event of contribution) {
      if (source.provider === 'claude' && event.eventKey) {
        if (seenClaudeMessages.has(event.eventKey)) {
          diagnostics.duplicateRecords += 1
          continue
        }
        seenClaudeMessages.add(event.eventKey)
      }
      events.push(event)
    }
  }

  function appendCachedContribution(cached: CachedNormalizedUsage[]): void {
    appendContribution(restoredCachedEvents(cached))
  }

  for (const file of files) {
    seenFileKeys.add(file.fileKey)
    const cached = cachedByFileKey.get(file.fileKey)
    const referenceMoved =
      source.kind === 'default' &&
      cached?.events.some(
        (event) =>
          getSessionReference(source.provider, event.sessionKey, source.id)?.sourcePath !==
          file.path,
      )
    if (mode === 'incremental' && !referenceMoved && cacheMatches(cached, file, signature)) {
      diagnostics.filesReused += 1
      if (source.provider === 'codex')
        contributions.push({
          ...file,
          sourceState: 'present',
          sessionKeys: cached!.sessionKeys,
          events: restoredCachedEvents(cached!.events),
        })
      else appendCachedContribution(cached!.events)
      captures.push({
        fileKey: file.fileKey,
        state: 'reused',
        adapter: cached!.adapter,
        schemaVersion: cached!.schemaVersion,
        eventCount: cached!.events.length,
        observationRefs: captureReferences(cached!.events),
        ...(previousFiles.get(file.fileKey)?.acceptedAt
          ? { acceptedAt: previousFiles.get(file.fileKey)!.acceptedAt }
          : {}),
      })
      continue
    }

    const parsed = await readOneHistoryFile(source.provider, file.path, adapterOptions)
    addDiagnostics(
      diagnostics as unknown as Record<string, number>,
      parsed.diagnostics as unknown as Record<string, number>,
    )
    if (parsed.state === 'io_error') {
      return {
        events: [],
        diagnostics,
        fileCache: { upsert: [], deleteFileKeys: [] },
        captures: [],
        failed: true,
      }
    }
    if (parsed.state === 'accepted' && parsed.snapshot) {
      if (source.provider === 'codex')
        contributions.push({
          ...file,
          sourceState: 'present',
          sessionKeys: parsed.sessionKeys,
          fileMtime: parsed.snapshot.fileMtime,
          events: parsed.events,
        })
      else appendContribution(parsed.events)
      captures.push({
        fileKey: file.fileKey,
        state: 'read',
        adapter: signature.adapter,
        schemaVersion: signature.schemaVersion,
        eventCount: parsed.events.length,
        observationRefs: captureReferences(parsed.events),
        acceptedAt: new Date().toISOString(),
      })
      upsert.push({
        fileKey: file.fileKey,
        byteSize: parsed.snapshot.byteSize,
        fileMtime: parsed.snapshot.fileMtime,
        sourceState: 'present',
        sourceRank: file.sourceRank,
        sessionKeys: parsed.sessionKeys,
        adapter: signature.adapter,
        schemaVersion: signature.schemaVersion,
        events: parsed.events.map(cachedEvent),
      })
      continue
    }

    // An unstable or incompatible changed file is deliberately local to that
    // file. Its last accepted contribution survives if present; a new bad file
    // contributes zero and can be retried next incremental scan.
    diagnostics.filesDeferred += 1
    if (cached?.valid) {
      if (source.provider === 'codex')
        contributions.push({
          ...file,
          sourceState: 'present',
          sessionKeys: cached.sessionKeys,
          fileMtime: cached.fileMtime,
          events: restoredCachedEvents(cached.events),
        })
      else appendCachedContribution(cached.events)
      // A restored but not yet readable file is not a newly verified import.
      if (cached.sourceState === 'missing')
        upsert.push({ ...cached, sourceState: 'present', sourceRank: file.sourceRank })
    }
    captures.push({
      fileKey: file.fileKey,
      state: cached?.valid ? 'deferred-previous' : 'deferred-missing',
      adapter: cached?.valid ? cached.adapter : signature.adapter,
      schemaVersion: cached?.valid ? cached.schemaVersion : signature.schemaVersion,
      eventCount: cached?.valid ? cached.events.length : 0,
      observationRefs: captureReferences(cached?.valid ? cached.events : []),
      ...(cached?.valid && previousFiles.get(file.fileKey)?.acceptedAt
        ? { acceptedAt: previousFiles.get(file.fileKey)!.acceptedAt }
        : {}),
    })
  }

  const deleteFileKeys: string[] = []
  const presentSessions = new Set(
    contributions.flatMap((file) => [
      ...(file.sessionKeys ?? []),
      ...file.events.map((event) => event.sessionKey),
    ]),
  )
  for (const cached of cacheEntries.filter((entry) => !seenFileKeys.has(entry.fileKey))) {
    // Retire superseded paths after a move. A returning file must be read again;
    // old copies can never resurrect an obsolete cumulative series.
    const retained =
      source.provider === 'codex' && cached.valid
        ? cached.events.filter((event) => !presentSessions.has(event.sessionKey))
        : []
    const retainedKeys =
      source.provider === 'codex' && cached.valid
        ? (cached.sessionKeys ?? cached.events.map((event) => event.sessionKey)).filter(
            (key) => !presentSessions.has(key),
          )
        : []
    if (!retainedKeys.length) {
      deleteFileKeys.push(cached.fileKey)
      continue
    }
    upsert.push({
      ...cached,
      events: retained,
      sessionKeys: [...new Set(retainedKeys)],
      sourceState: 'missing',
    })
    contributions.push({
      ...cached,
      events: restoredCachedEvents(retained),
      sessionKeys: [...new Set(retainedKeys)],
      sourceState: 'missing',
      sourceRank: cached.sourceRank ?? 0,
    })
    captures.push({
      fileKey: cached.fileKey,
      state: 'missing-retained',
      adapter: cached.adapter,
      schemaVersion: cached.schemaVersion,
      eventCount: retained.length,
      observationRefs: captureReferences(retained),
      ...(previousFiles.get(cached.fileKey)?.acceptedAt
        ? { acceptedAt: previousFiles.get(cached.fileKey)!.acceptedAt }
        : {}),
    })
  }
  if (source.provider === 'codex') {
    const selected = selectCodexFileContributions(contributions)
    events.push(...selected.flatMap((file) => file.events))
    const selectedByKey = new Map(selected.map((file) => [file.fileKey, file.events]))
    // Provenance refers to the selected numerical series, not redundant copies.
    for (const capture of captures) {
      const selectedEvents = selectedByKey.get(capture.fileKey) ?? []
      capture.observationRefs = captureReferences(selectedEvents)
      capture.eventCount = selectedEvents.length
    }
  }
  return {
    events,
    diagnostics,
    fileCache: { upsert, deleteFileKeys },
    captures,
    failed: false,
    knownSessionKeys: [
      ...cacheEntries
        .filter((entry) => entry.valid)
        .flatMap((entry) => entry.sessionKeys ?? entry.events.map((event) => event.sessionKey)),
      ...contributions.flatMap((file) => file.sessionKeys ?? []),
    ],
  }
}

async function executeHistoryScan(
  providers: UsageProvider[],
  sourceIds?: string[],
  mode: HistoryScanMode = 'incremental',
): Promise<HistoryScanResult> {
  const selectedProviders = new Set(providers)
  const selectedSources = sourceIds ? new Set(sourceIds) : undefined
  const sources = getHistorySources().filter(
    (source) =>
      source.enabled &&
      selectedProviders.has(source.provider) &&
      (!selectedSources || selectedSources.has(source.id)),
  )
  const identifierSalt = getIdentifierSalt()
  const outcomes: SourceScanOutcome[] = []
  const providerResults: HistoryScanResult['providers'] = {}

  try {
    for (const source of sources) {
      beginScan(source.provider, source.id, source.name)
      const providerResult = (providerResults[source.provider] ??= { events: 0, diagnostics: {} })
      const availability = await availableSourceRoots(source)
      if (availability.availability === 'unavailable') {
        recordHistorySourceScanFailure(
          source.id,
          source.provider,
          'unavailable',
          availability.reason ?? 'not_readable',
        )
        recordSourceCapture(source.id, source.provider, mode, 'unavailable')
        outcomes.push({
          sourceId: source.id,
          sourceName: source.name,
          provider: source.provider,
          status: 'unavailable',
          events: 0,
        })
        continue
      }

      try {
        const result = await readSourceIncrementally(source, identifierSalt, mode)
        addDiagnostics(
          providerResult.diagnostics,
          result.diagnostics as unknown as Record<string, number>,
        )

        // Root/traversal/read I/O failures still protect the entire source's
        // last-good snapshot. Stable parsing incompatibilities and files that
        // change during their own read are handled per file by the incremental
        // cache and do not block unrelated files in the same source.
        if (result.failed || result.diagnostics.ioErrors > 0) {
          recordHistorySourceScanFailure(source.id, source.provider, 'failed', 'scan_failed')
          recordSourceCapture(source.id, source.provider, mode, 'failed')
          outcomes.push({
            sourceId: source.id,
            sourceName: source.name,
            provider: source.provider,
            status: 'failed',
            events: 0,
            diagnostics: result.diagnostics as unknown as Record<string, number>,
          })
          continue
        }

        const aggregationDiagnostics: AggregationDiagnostics = { nonUtcTimestamps: 0 }
        const sessions = aggregateSessions(result.events, aggregationDiagnostics)
        if (source.provider === 'codex') {
          const represented = new Set([
            ...(result.knownSessionKeys ?? []),
            ...sessions.map((row) => row.sessionKey),
          ])
          const legacy = getUsageSessions().filter(
            (row) =>
              row.sourceId === source.id &&
              row.provider === 'codex' &&
              !represented.has(row.sessionKey),
          )
          for (const row of legacy)
            sessions.push({
              ...row,
              projectLabel: row.projectLabel ?? undefined,
              model: row.model ?? undefined,
              schemaVersion: 'codex-retained-summary',
              confidence: 'low',
            })
          const legacySessions = new Set(legacy.map((row) => row.sessionKey))
          for (const sessionKey of legacySessions) {
            const rows = legacy.filter((row) => row.sessionKey === sessionKey)
            result.captures.push({
              fileKey: opaqueFileKey(
                sourceIdentifierSalt(identifierSalt, source.id),
                'unverified-session/' + sessionKey,
              ),
              state: 'unverified-retained',
              adapter: 'stored-summary',
              schemaVersion: 'codex-retained-summary',
              eventCount: rows.reduce((count, row) => count + row.messageCount, 0),
              observationRefs: rows.map(({ sessionKey, projectKey, month }) => ({
                sessionKey,
                projectKey,
                month,
              })),
            })
          }
          Object.assign(result.diagnostics, {
            filesMissingRetained: result.captures.filter(
              (file) => file.state === 'missing-retained' && file.eventCount > 0,
            ).length,
            sessionsUnverifiedRetained: legacySessions.size,
          })
        }
        // Reads above await filesystem I/O. Capture again here so changes saved
        // during that wait are paired with the values about to be replaced.
        archiveCurrentObservation('before-scan')
        const { changedReferences } = replaceHistorySourceSessions(
          source.id,
          source.provider,
          sessions,
          {
            filesSeen: result.diagnostics.filesDiscovered,
            malformedLines: result.diagnostics.malformedJsonLines,
            ...(result.captures.some((file) => file.state === 'unverified-retained')
              ? { timeZone: 'unknown' }
              : {}),
          },
          result.fileCache,
        )
        recordSourceCapture(source.id, source.provider, mode, 'complete', result.captures)
        addDiagnostics(providerResult.diagnostics, {
          filesMissingRetained: result.captures.filter(
            (file) => file.state === 'missing-retained' && file.eventCount > 0,
          ).length,
          sessionsUnverifiedRetained: result.captures.filter(
            (file) => file.state === 'unverified-retained',
          ).length,
          nonUtcTimestamps: aggregationDiagnostics.nonUtcTimestamps,
          changedSinceLastScan: changedReferences.length,
        })
        providerResult.events += sessions.length
        outcomes.push({
          sourceId: source.id,
          sourceName: source.name,
          provider: source.provider,
          status: 'complete',
          events: sessions.length,
          diagnostics: {
            ...(result.diagnostics as unknown as Record<string, number>),
            nonUtcTimestamps: aggregationDiagnostics.nonUtcTimestamps,
            changedSinceLastScan: changedReferences.length,
          },
        })
      } catch {
        recordHistorySourceScanFailure(source.id, source.provider, 'failed', 'scan_failed')
        recordSourceCapture(source.id, source.provider, mode, 'failed')
        outcomes.push({
          sourceId: source.id,
          sourceName: source.name,
          provider: source.provider,
          status: 'failed',
          events: 0,
        })
      }
    }
  } finally {
    finishScan()
  }

  return { completedAt: new Date().toISOString(), providers: providerResults, sources: outcomes }
}

let sourceOperationTail: Promise<void> = Promise.resolve()

function enqueueSourceOperation<T>(operation: () => Promise<T> | T): Promise<T> {
  const pending = sourceOperationTail.then(operation, operation)
  sourceOperationTail = pending.then(
    () => undefined,
    () => undefined,
  )
  return pending
}

export function scanHistorySources(
  providers: UsageProvider[] = ['claude', 'codex'],
  sourceIds?: string[],
  mode: HistoryScanMode = 'incremental',
): Promise<HistoryScanResult> {
  return enqueueSourceOperation(async () => {
    if (restoreRequiresReconnect())
      throw new Error(
        '復元した資料の読み取り元を再接続するまで走査できません。保存済みの記録は保持しています。',
      )
    archiveCurrentObservation('before-scan')
    const result = await executeHistoryScan(providers, sourceIds, mode)
    archiveCurrentObservation('after-scan')
    return result
  })
}

export function createConfiguredHistorySource(input: HistorySourceInput): Promise<HistorySource> {
  return enqueueSourceOperation(() => createHistorySource(input))
}

export function updateConfiguredHistorySource(
  id: string,
  input: HistorySourceInput,
): Promise<HistorySource> {
  return enqueueSourceOperation(() => {
    archiveCurrentObservation('before-source-change')
    return updateHistorySource(id, input)
  })
}

export function removeConfiguredHistorySource(id: string): Promise<void> {
  return enqueueSourceOperation(() => {
    archiveCurrentObservation('before-source-change')
    return removeHistorySource(id)
  })
}

export function automaticSourceScanEnabled(): boolean {
  return process.env.DEVTAX_RADAR_AUTO_SCAN !== '0' && !restoreRequiresReconnect()
}

export function reconnectRestoredSources(input: unknown) {
  return enqueueSourceOperation(() =>
    applyRestoreSources(getDatabase(), getAppDataDirectory(), input),
  )
}
