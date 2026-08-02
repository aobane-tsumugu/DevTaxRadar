/// <reference types="node" />

import { createHash } from 'node:crypto'

import { localProjectLabel, privateKey } from './identifiers.ts'
import {
  childRecord,
  discoverJsonlFiles,
  fileContentSummary,
  nonNegativeInteger,
  readJsonlObjects,
  stringValue,
  type FileContentSummary,
} from './jsonl.ts'
import { localMonthFromTimestamp } from './localTime.ts'
import {
  createDiagnostics,
  type AdapterOptions,
  type AdapterResult,
  type NormalizedUsage,
} from './types.ts'

const ADAPTER = 'codex-local-jsonl'
const SCHEMA_VERSION = 'codex-local-v1'

type CodexSession = {
  sessionId?: string
  timestamp?: string
  cwd?: string
  model?: string
  usage?: Record<string, unknown>
  sourcePath: string
}

export async function readCodexHistory(
  rootDirectory: string,
  options: AdapterOptions,
): Promise<AdapterResult> {
  const diagnostics = createDiagnostics()
  const events: NormalizedUsage[] = []

  for await (const filePath of discoverJsonlFiles(rootDirectory, diagnostics)) {
    options.onFileScanned?.()
    const session: CodexSession = { sourcePath: filePath }
    // The Transform inside readJsonlObjects hashes every byte as it streams
    // past on its way to the line splitter, so the file is read exactly once
    // even though both the parsed rows and the digest are needed. A Codex
    // session file yields at most one event, so the digest can be finalized
    // right after the loop, before that event is built.
    const hash = options.includeLocalReferences ? createHash('sha256') : undefined
    const ioErrorsBefore = diagnostics.ioErrors

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
    // scan report a change that never happened, so leave it out -- which the
    // change detection already treats as "not recorded".
    const fileSummary =
      hash && diagnostics.ioErrors === ioErrorsBefore
        ? fileContentSummary(filePath, hash)
        : undefined
    const event = normalizeCodexSession(session, options, diagnostics, fileSummary)
    if (event) events.push(event)
  }

  return { events, diagnostics }
}

function consumeSessionMetadata(row: Record<string, unknown>, session: CodexSession): boolean {
  if (row.type !== 'session_meta') return false
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
  const payload = childRecord(row, 'payload')
  session.model = (payload && stringValue(payload.model)) ?? session.model
  return true
}

function consumeTokenSnapshot(row: Record<string, unknown>, session: CodexSession): boolean {
  const payload = childRecord(row, 'payload')
  const isEventEnvelope = row.type === 'event_msg' && payload?.type === 'token_count'
  const isDirectTokenCount = row.type === 'token_count'
  if (!isEventEnvelope && !isDirectTokenCount) return false

  const container = isEventEnvelope ? payload : row
  if (!container) return true
  const info = childRecord(container, 'info')
  const usage =
    (info && childRecord(info, 'total_token_usage')) ?? childRecord(container, 'total_token_usage')
  if (usage) session.usage = usage
  return true
}

function normalizeCodexSession(
  session: CodexSession,
  options: AdapterOptions,
  diagnostics: AdapterResult['diagnostics'],
  fileSummary: FileContentSummary | undefined,
): NormalizedUsage | undefined {
  const month = localMonthFromTimestamp(session.timestamp)
  if (!session.sessionId || !session.cwd || !month || !session.usage || !session.timestamp) {
    diagnostics.invalidRecords += 1
    return undefined
  }

  return {
    provider: 'codex',
    month,
    observedAt: session.timestamp,
    sessionKey: privateKey('session', session.sessionId, options.identifierSalt),
    projectKey: privateKey('project', session.cwd, options.identifierSalt),
    projectLabel: options.includeLocalProjectLabel ? localProjectLabel(session.cwd) : undefined,
    localReference:
      options.includeLocalReferences && fileSummary
        ? {
            nativeSessionId: session.sessionId,
            sourcePath: session.sourcePath,
            workingDirectory: session.cwd,
            contentHash: fileSummary.contentHash,
            byteSize: fileSummary.byteSize,
            fileMtime: fileSummary.fileMtime,
          }
        : undefined,
    model: session.model ?? 'unknown',
    inputTokens: nonNegativeInteger(session.usage.input_tokens),
    cacheReadTokens: nonNegativeInteger(session.usage.cached_input_tokens),
    cacheWriteTokens: nonNegativeInteger(session.usage.cache_write_input_tokens),
    outputTokens: nonNegativeInteger(session.usage.output_tokens),
    reasoningTokens: nonNegativeInteger(session.usage.reasoning_output_tokens),
    captureMethod: 'local transcript compatibility adapter',
    adapter: ADAPTER,
    schemaVersion: SCHEMA_VERSION,
    confidence: 'B',
  }
}
