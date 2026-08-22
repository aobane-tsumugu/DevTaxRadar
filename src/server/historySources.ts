import { opendir } from 'node:fs/promises'

import { readClaudeHistory, readCodexHistory } from '../adapters/index.js'
import { sourceIdentifierSalt } from '../adapters/identifiers.js'
import { createDiagnostics, type UsageProvider } from '../adapters/types.js'
import { discoverJsonlFiles } from '../adapters/jsonl.js'
import {
  createHistorySource,
  getHistorySourceScanStatuses,
  getHistorySources,
  recordHistorySourceScanFailure,
  removeHistorySource,
  replaceHistorySourceSessions,
  updateHistorySource,
  type HistorySource,
  type HistorySourceInput,
} from './database.js'
import { getIdentifierSalt, normalizeHistoryRoot } from './paths.js'
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
        ? await probeHistoryRoot(source.root)
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

async function executeHistoryScan(
  providers: UsageProvider[],
  sourceIds?: string[],
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
      const availability = await probeHistoryRoot(source.root)
      if (availability.availability === 'unavailable') {
        recordHistorySourceScanFailure(
          source.id,
          source.provider,
          'unavailable',
          availability.reason ?? 'not_readable',
        )
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
        const scanSalt =
          source.kind === 'default'
            ? identifierSalt
            : sourceIdentifierSalt(identifierSalt, source.id)
        const result =
          source.provider === 'claude'
            ? await readClaudeHistory(source.root, {
                identifierSalt: scanSalt,
                includeLocalProjectLabel: true,
                includeLocalReferences: source.kind === 'default',
                portableProjectPaths: source.kind === 'configured',
                onFileScanned: reportScannedFile,
              })
            : await readCodexHistory(source.root, {
                identifierSalt: scanSalt,
                includeLocalProjectLabel: true,
                includeLocalReferences: source.kind === 'default',
                portableProjectPaths: source.kind === 'configured',
                onFileScanned: reportScannedFile,
              })
        addDiagnostics(
          providerResult.diagnostics,
          result.diagnostics as unknown as Record<string, number>,
        )

        // A stable, recognized transcript can legitimately contain an
        // interrupted trailing JSON line or no billable usage at all. The
        // adapters classify a file as incompatible when it has no recognized
        // provider structure, and classify claimed usage with missing/renamed
        // required fields as invalid. Those structural signals protect the
        // whole-source last-good snapshot without rejecting normal aborted
        // sessions found in real Claude/Codex histories.
        const incompatibleSnapshot =
          result.diagnostics.invalidRecords > 0 || result.diagnostics.incompatibleFiles > 0
        if (
          result.diagnostics.ioErrors > 0 ||
          result.diagnostics.unstableFiles > 0 ||
          incompatibleSnapshot
        ) {
          recordHistorySourceScanFailure(source.id, source.provider, 'failed', 'scan_failed')
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
        const { changedReferences } = replaceHistorySourceSessions(
          source.id,
          source.provider,
          sessions,
          {
            filesSeen: result.diagnostics.filesDiscovered,
            malformedLines: result.diagnostics.malformedJsonLines,
          },
        )
        addDiagnostics(providerResult.diagnostics, {
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
): Promise<HistoryScanResult> {
  return enqueueSourceOperation(() => executeHistoryScan(providers, sourceIds))
}

export function createConfiguredHistorySource(input: HistorySourceInput): Promise<HistorySource> {
  return enqueueSourceOperation(() => createHistorySource(input))
}

export function updateConfiguredHistorySource(
  id: string,
  input: HistorySourceInput,
): Promise<HistorySource> {
  return enqueueSourceOperation(() => updateHistorySource(id, input))
}

export function removeConfiguredHistorySource(id: string): Promise<void> {
  return enqueueSourceOperation(() => removeHistorySource(id))
}

export function automaticSourceScanEnabled(): boolean {
  return process.env.DEVTAX_RADAR_AUTO_SCAN !== '0'
}
