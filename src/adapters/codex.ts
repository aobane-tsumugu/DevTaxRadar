/// <reference types="node" />

import { createHash } from 'node:crypto'

import {
  localProjectLabel,
  portableProjectKey,
  portableProjectLabel,
  privateKey,
} from './identifiers.ts'
import {
  childRecord,
  discoverJsonlFiles,
  fileContentSummary,
  isRecord,
  nonNegativeInteger,
  readFileSnapshot,
  readJsonlObjects,
  sameFileSnapshot,
  stringValue,
  type FileContentSummary,
} from './jsonl.ts'
import { localMonthFromTimestamp } from './localTime.ts'
import {
  createDiagnostics,
  type AdapterFileReadResult,
  type AdapterOptions,
  type AdapterResult,
  type NormalizedUsage,
} from './types.ts'

export const CODEX_HISTORY_ADAPTER = 'codex-local-jsonl'
export const CODEX_HISTORY_SCHEMA_VERSION = 'codex-local-v1'

type CodexSession = {
  sessionId?: string
  timestamp?: string
  cwd?: string
  model?: string
  usage?: Record<string, unknown>
  sourcePath: string
  hasRecognizedRecord: boolean
  hasTokenSnapshot: boolean
  hasInvalidTokenSnapshot: boolean
}

type CodexNormalization =
  { kind: 'event'; event: NormalizedUsage } | { kind: 'empty' } | { kind: 'invalid' }

export async function readCodexHistory(
  rootDirectory: string,
  options: AdapterOptions,
): Promise<AdapterResult> {
  const diagnostics = createDiagnostics()
  const events: NormalizedUsage[] = []

  for await (const filePath of discoverJsonlFiles(rootDirectory, diagnostics)) {
    options.onFileScanned?.()
    const fileResult = await readCodexHistoryFile(filePath, options)
    addDiagnostics(diagnostics, fileResult.diagnostics)
    events.push(...fileResult.events)
  }

  return { events, diagnostics }
}

/** Parses one already-discovered Codex transcript for the incremental scanner. */
export async function readCodexHistoryFile(
  filePath: string,
  options: AdapterOptions,
): Promise<AdapterFileReadResult> {
  const diagnostics = createDiagnostics()
  const before = readFileSnapshot(filePath)
  const session: CodexSession = {
    sourcePath: filePath,
    hasRecognizedRecord: false,
    hasTokenSnapshot: false,
    hasInvalidTokenSnapshot: false,
  }
  // The Transform inside readJsonlObjects hashes every byte as it streams past
  // on its way to the line splitter, so the file is read exactly once even
  // though both the parsed rows and the digest are needed.
  const hash = options.includeLocalReferences ? createHash('sha256') : undefined

  for await (const row of readJsonlObjects(filePath, diagnostics, hash)) {
    if (consumeSessionMetadata(row, session) || consumeModel(row, session)) {
      continue
    }
    if (consumeTokenSnapshot(row, session)) {
      continue
    }
    diagnostics.unsupportedLines += 1
  }

  // A read that failed part way through leaves the hash covering only the
  // bytes that arrived. Recording that as the file's hash would make the next
  // scan report a change that never happened, so leave it out.
  const after = readFileSnapshot(filePath)
  if (diagnostics.ioErrors > 0) {
    diagnostics.unstableFiles += 1
    return { events: [], diagnostics, state: 'io_error' }
  }
  if (!sameFileSnapshot(before, after)) {
    diagnostics.unstableFiles += 1
    return { events: [], diagnostics, state: 'unstable' }
  }
  const fileSummary = hash && after ? fileContentSummary(hash, after) : undefined
  const normalized = normalizeCodexSession(session, options, fileSummary)
  if (normalized.kind === 'event') {
    return {
      events: [normalized.event],
      diagnostics,
      state: 'accepted',
      snapshot: after ? { byteSize: after.byteSize, fileMtime: after.fileMtime } : undefined,
    }
  }
  if (normalized.kind === 'invalid') {
    diagnostics.invalidRecords += 1
    diagnostics.incompatibleFiles += 1
    return { events: [], diagnostics, state: 'incompatible' }
  }
  if (!session.hasRecognizedRecord) {
    diagnostics.incompatibleFiles += 1
    return { events: [], diagnostics, state: 'incompatible' }
  }
  return {
    events: [],
    diagnostics,
    state: 'accepted',
    snapshot: after ? { byteSize: after.byteSize, fileMtime: after.fileMtime } : undefined,
  }
}

function addDiagnostics(
  target: AdapterResult['diagnostics'],
  source: AdapterResult['diagnostics'],
): void {
  for (const [key, value] of Object.entries(source) as Array<
    [keyof AdapterResult['diagnostics'], number]
  >) {
    target[key] += value
  }
}

function consumeSessionMetadata(row: Record<string, unknown>, session: CodexSession): boolean {
  if (row.type !== 'session_meta') return false
  session.hasRecognizedRecord = true
  const payload = childRecord(row, 'payload')
  if (!payload) return true

  session.sessionId =
    stringValue(payload.session_id) ?? stringValue(payload.id) ?? session.sessionId
  session.timestamp =
    stringValue(payload.timestamp) ?? stringValue(row.timestamp) ?? session.timestamp
  session.cwd = stringValue(payload.cwd) ?? session.cwd
  session.model = stringValue(payload.model) ?? session.model
  return true
}

function consumeModel(row: Record<string, unknown>, session: CodexSession): boolean {
  if (row.type !== 'turn_context') return false
  session.hasRecognizedRecord = true
  const payload = childRecord(row, 'payload')
  session.model = (payload && stringValue(payload.model)) ?? session.model
  return true
}

function consumeTokenSnapshot(row: Record<string, unknown>, session: CodexSession): boolean {
  const payload = childRecord(row, 'payload')
  const isEventEnvelope = row.type === 'event_msg' && payload?.type === 'token_count'
  const isDirectTokenCount = row.type === 'token_count'
  if (!isEventEnvelope && !isDirectTokenCount) return false

  session.hasRecognizedRecord = true
  const container = isEventEnvelope ? payload : row
  const usageClaims = tokenUsageClaims(container)
  // Codex writes neutral token_count placeholders while a turn is starting.
  // They establish a known transcript envelope but do not claim a cumulative
  // usage object, so a later valid snapshot must be allowed to win.
  if (usageClaims.length === 0) return true

  session.hasTokenSnapshot = true
  const usage = usageClaims[0]
  if (!isValidTokenUsage(usage) || usageClaims.some((candidate) => !isValidTokenUsage(candidate))) {
    session.hasInvalidTokenSnapshot = true
    return true
  }
  session.usage = usage
  return true
}

function tokenUsageClaims(container: Record<string, unknown>): unknown[] {
  const claims: unknown[] = []
  const info = childRecord(container, 'info')
  if (info && hasOwnKey(info, 'total_token_usage')) {
    claims.push(info.total_token_usage)
  }
  if (hasOwnKey(container, 'total_token_usage')) {
    claims.push(container.total_token_usage)
  }
  return claims
}

function hasOwnKey(row: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(row, key)
}

function normalizeCodexSession(
  session: CodexSession,
  options: AdapterOptions,
  fileSummary: FileContentSummary | undefined,
): CodexNormalization {
  if (!session.hasTokenSnapshot) return { kind: 'empty' }

  const month = localMonthFromTimestamp(session.timestamp)
  if (
    session.hasInvalidTokenSnapshot ||
    !session.sessionId ||
    !session.cwd ||
    !month ||
    !session.usage ||
    !session.timestamp
  ) {
    return { kind: 'invalid' }
  }

  return {
    kind: 'event',
    event: {
      provider: 'codex',
      month,
      observedAt: session.timestamp,
      sessionKey: privateKey('session', session.sessionId, options.identifierSalt),
      projectKey: options.portableProjectPaths
        ? portableProjectKey(session.cwd, options.identifierSalt)
        : privateKey('project', session.cwd, options.identifierSalt),
      projectLabel: options.includeLocalProjectLabel
        ? options.portableProjectPaths
          ? portableProjectLabel(session.cwd)
          : localProjectLabel(session.cwd)
        : undefined,
      // The reference survives a missing hash: dropping it would cost this
      // session its preview and resume command until the next clean scan, which
      // is a much bigger loss than not recording a digest. An empty hash is
      // already treated as "not recorded" by the change detection.
      localReference: options.includeLocalReferences
        ? {
            nativeSessionId: session.sessionId,
            sourcePath: session.sourcePath,
            workingDirectory: session.cwd,
            contentHash: fileSummary?.contentHash ?? '',
            byteSize: fileSummary?.byteSize ?? 0,
            fileMtime: fileSummary?.fileMtime ?? '',
          }
        : undefined,
      model: session.model ?? 'unknown',
      inputTokens: nonNegativeInteger(session.usage.input_tokens),
      cacheReadTokens: nonNegativeInteger(session.usage.cached_input_tokens),
      cacheWriteTokens: nonNegativeInteger(session.usage.cache_write_input_tokens),
      outputTokens: nonNegativeInteger(session.usage.output_tokens),
      reasoningTokens: nonNegativeInteger(session.usage.reasoning_output_tokens),
      captureMethod: 'local transcript compatibility adapter',
      adapter: CODEX_HISTORY_ADAPTER,
      schemaVersion: CODEX_HISTORY_SCHEMA_VERSION,
      confidence: 'B',
    },
  }
}

function validRequiredTokenCounters(usage: Record<string, unknown>): boolean {
  return [usage.input_tokens, usage.output_tokens].every(
    (value) => typeof value === 'number' && Number.isInteger(value) && value >= 0,
  )
}

function isValidTokenUsage(usage: unknown): usage is Record<string, unknown> {
  return isRecord(usage) && validRequiredTokenCounters(usage)
}
