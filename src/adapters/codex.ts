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
export const CODEX_HISTORY_SCHEMA_VERSION = 'codex-local-v2'
export const CODEX_COARSE_SCHEMA_VERSION = 'codex-local-v2-coarse'

type Counters = {
  input: number
  cached: number
  cacheWrite: number
  output: number
  reasoning: number
}
const emptyCounters = (): Counters => ({
  input: 0,
  cached: 0,
  cacheWrite: 0,
  output: 0,
  reasoning: 0,
})
const counterKeys = ['input', 'cached', 'cacheWrite', 'output', 'reasoning'] as const

type SessionContext = { id?: string; startedAt?: string; cwd?: string; model?: string }
type UsagePoint = {
  context: SessionContext
  timestamp: string
  counters: Counters
  cumulative: Counters
  coarse: boolean
}

/** An offset is mandatory: a zone-less wall clock is not a portable instant. */
function instant(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/i.test(value)) return undefined
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

function counters(value: unknown): Counters | undefined {
  if (!isRecord(value)) return undefined
  const input = value.input_tokens,
    output = value.output_tokens
  const cached = value.cached_input_tokens ?? 0
  const cacheWrite = value.cache_write_input_tokens ?? 0
  const reasoning = value.reasoning_output_tokens ?? 0
  const values = [input, output, cached, cacheWrite, reasoning]
  if (
    !values.every(
      (number) => typeof number === 'number' && Number.isSafeInteger(number) && number >= 0,
    )
  )
    return undefined
  const result = { input, cached, cacheWrite, output, reasoning } as Counters
  if (result.cached + result.cacheWrite > result.input || result.reasoning > result.output)
    return undefined
  return result
}

function difference(current: Counters, previous: Counters): Counters | undefined {
  const result = Object.fromEntries(
    counterKeys.map((key) => [key, current[key] - previous[key]]),
  ) as Counters
  if (
    counterKeys.some((key) => result[key] < 0) ||
    result.cached + result.cacheWrite > result.input ||
    result.reasoning > result.output
  )
    return undefined
  return result
}

function tokenUsageClaims(container: Record<string, unknown>): unknown[] {
  const claims: unknown[] = []
  const info = childRecord(container, 'info')
  if (info && Object.hasOwn(info, 'total_token_usage')) claims.push(info.total_token_usage)
  if (Object.hasOwn(container, 'total_token_usage')) claims.push(container.total_token_usage)
  return claims
}

export async function readCodexHistory(
  rootDirectory: string,
  options: AdapterOptions,
): Promise<AdapterResult> {
  const diagnostics = createDiagnostics(),
    events: NormalizedUsage[] = []
  const seen = new Set<string>()
  for await (const filePath of discoverJsonlFiles(rootDirectory, diagnostics)) {
    options.onFileScanned?.()
    const result = await readCodexHistoryFile(filePath, options)
    addDiagnostics(diagnostics, result.diagnostics)
    for (const event of result.events) {
      if (event.eventKey && seen.has(event.eventKey)) {
        diagnostics.duplicateRecords++
        continue
      }
      if (event.eventKey) seen.add(event.eventKey)
      events.push(event)
    }
  }
  return { events, diagnostics }
}

/** Difference cumulative snapshots; repeated last_token_usage is never added again. */
export async function readCodexHistoryFile(
  filePath: string,
  options: AdapterOptions,
): Promise<AdapterFileReadResult> {
  const diagnostics = createDiagnostics()
  const before = readFileSnapshot(filePath)
  const hash = options.includeLocalReferences ? createHash('sha256') : undefined
  const context: SessionContext = {}
  const points: UsagePoint[] = []
  let last = emptyCounters(),
    recognized = false,
    claimed = false,
    invalid = false
  let previousInstant: string | undefined

  for await (const row of readJsonlObjects(filePath, diagnostics, hash)) {
    if (row.type === 'session_meta') {
      recognized = true
      const payload = childRecord(row, 'payload')
      if (!payload) continue
      const id = stringValue(payload.session_id) ?? stringValue(payload.id)
      if (id && context.id && id !== context.id && claimed) invalid = true
      context.id = id ?? context.id
      context.startedAt = instant(payload.timestamp) ?? instant(row.timestamp) ?? context.startedAt
      context.cwd = stringValue(payload.cwd) ?? context.cwd
      context.model = stringValue(payload.model) ?? context.model
      continue
    }
    if (row.type === 'turn_context') {
      recognized = true
      const payload = childRecord(row, 'payload')
      context.model = (payload && stringValue(payload.model)) ?? context.model
      context.cwd = (payload && stringValue(payload.cwd)) ?? context.cwd
      continue
    }
    const payload = childRecord(row, 'payload')
    const envelope = row.type === 'event_msg' && payload?.type === 'token_count'
    if (!envelope && row.type !== 'token_count') {
      diagnostics.unsupportedLines++
      continue
    }
    recognized = true
    const claims = tokenUsageClaims(envelope ? payload! : row)
    // Neutral placeholders and context/rate-limit notices do not claim usage.
    if (!claims.length) continue
    claimed = true
    const snapshots = claims.map(counters)
    const current = snapshots[0]
    if (
      !current ||
      snapshots.some((value) => !value || counterKeys.some((key) => value[key] !== current[key]))
    ) {
      invalid = true
      continue
    }
    const delta = difference(current, last)
    if (!delta) {
      invalid = true
      continue
    }
    last = current
    if (counterKeys.every((key) => delta[key] === 0)) {
      diagnostics.duplicateRecords++
      continue
    }
    const timestamp = instant(row.timestamp) ?? instant(payload?.timestamp)
    if (!context.id || !context.cwd) {
      invalid = true
      continue
    }
    const coarse = !timestamp || Boolean(previousInstant && timestamp < previousInstant)
    const retainedAt = coarse ? context.startedAt : timestamp
    if (!retainedAt) {
      invalid = true
      continue
    }
    if (!coarse) previousInstant = timestamp
    points.push({
      context: { ...context },
      timestamp: retainedAt,
      counters: delta,
      cumulative: { ...current },
      coarse,
    })
  }

  const after = readFileSnapshot(filePath)
  if (diagnostics.ioErrors > 0) {
    diagnostics.unstableFiles++
    return { events: [], diagnostics, state: 'io_error' }
  }
  if (!sameFileSnapshot(before, after)) {
    diagnostics.unstableFiles++
    return { events: [], diagnostics, state: 'unstable' }
  }
  const incompatible = (): AdapterFileReadResult => {
    diagnostics.incompatibleFiles++
    if (invalid || claimed) diagnostics.invalidRecords++
    return { events: [], diagnostics, state: 'incompatible' }
  }
  if (invalid || !recognized) return incompatible()
  const summary = hash && after ? fileContentSummary(hash, after) : undefined
  // Preserve known deltas even when one timestamp is missing. Its coarse marker
  // prevents attribution to the session start; other dated deltas stay dated.
  const events = points.map((point) => normalizePoint(point, options, filePath, summary))
  return {
    events,
    diagnostics,
    state: 'accepted',
    snapshot: after,
    sessionKeys: context.id ? [privateKey('session', context.id, options.identifierSalt)] : [],
  }
}

function normalizePoint(
  point: UsagePoint,
  options: AdapterOptions,
  sourcePath: string,
  fileSummary: FileContentSummary | undefined,
): NormalizedUsage {
  const { context, counters: usage, timestamp, coarse } = point
  return {
    provider: 'codex',
    month: localMonthFromTimestamp(timestamp)!,
    observedAt: timestamp,
    eventKey: privateKey(
      'message',
      JSON.stringify([context.id, context.cwd, timestamp, point.cumulative]),
      options.identifierSalt,
    ),
    sessionKey: privateKey('session', context.id!, options.identifierSalt),
    projectKey: options.portableProjectPaths
      ? portableProjectKey(context.cwd!, options.identifierSalt)
      : privateKey('project', context.cwd!, options.identifierSalt),
    ...(options.includeLocalProjectLabel
      ? {
          projectLabel: options.portableProjectPaths
            ? portableProjectLabel(context.cwd!)
            : localProjectLabel(context.cwd!),
        }
      : {}),
    ...(options.includeLocalReferences
      ? {
          localReference: {
            nativeSessionId: context.id!,
            sourcePath,
            workingDirectory: context.cwd!,
            contentHash: fileSummary?.contentHash ?? '',
            byteSize: fileSummary?.byteSize ?? 0,
            fileMtime: fileSummary?.fileMtime ?? '',
          },
        }
      : {}),
    model: context.model ?? 'unknown',
    // Codex input includes cached input; output includes reasoning output.
    // NormalizedUsage's components are exclusive, so aggregation adds each once.
    inputTokens: usage.input - usage.cached - usage.cacheWrite,
    cacheReadTokens: usage.cached,
    cacheWriteTokens: usage.cacheWrite,
    outputTokens: usage.output - usage.reasoning,
    reasoningTokens: usage.reasoning,
    captureMethod: coarse ? 'cumulative-delta/time-unknown' : 'cumulative-delta/report-time',
    adapter: CODEX_HISTORY_ADAPTER,
    schemaVersion: coarse ? CODEX_COARSE_SCHEMA_VERSION : CODEX_HISTORY_SCHEMA_VERSION,
    confidence: coarse ? 'C' : 'B',
  }
}

function addDiagnostics(
  target: AdapterResult['diagnostics'],
  source: AdapterResult['diagnostics'],
): void {
  for (const [key, value] of Object.entries(source) as Array<
    [keyof AdapterResult['diagnostics'], number]
  >)
    target[key] += value
}
