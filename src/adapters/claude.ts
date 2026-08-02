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
} from './jsonl.ts'
import { localMonthFromTimestamp } from './localTime.ts'
import {
  createDiagnostics,
  type AdapterOptions,
  type AdapterResult,
  type NormalizedUsage,
} from './types.ts'

const ADAPTER = 'claude-code-local-jsonl'
const SCHEMA_VERSION = 'claude-local-v1'

export async function readClaudeHistory(
  rootDirectory: string,
  options: AdapterOptions,
): Promise<AdapterResult> {
  const diagnostics = createDiagnostics()
  const events: NormalizedUsage[] = []
  const seenMessages = new Set<string>()

  for await (const filePath of discoverJsonlFiles(rootDirectory, diagnostics)) {
    options.onFileScanned?.()
    // The Transform inside readJsonlObjects hashes every byte as it streams
    // past on its way to the line splitter, so the file is read exactly once
    // even though both the parsed rows and the digest are needed. The digest
    // only finishes once every row from this file has been consumed, but a
    // Claude transcript can hold several messages (several events), so the
    // real contentHash/byteSize/fileMtime are patched onto every event from
    // this file below -- not built inline while rows are still streaming.
    const hash = options.includeLocalReferences ? createHash('sha256') : undefined
    const fileEvents: NormalizedUsage[] = []
    for await (const row of readJsonlObjects(filePath, diagnostics, hash)) {
      const event = normalizeClaudeRow(row, filePath, options, seenMessages, diagnostics)
      if (event) fileEvents.push(event)
    }
    if (hash) {
      const summary = fileContentSummary(filePath, hash)
      for (const event of fileEvents) {
        if (event.localReference) {
          event.localReference = { ...event.localReference, ...summary }
        }
      }
    }
    events.push(...fileEvents)
  }

  return { events, diagnostics }
}

function normalizeClaudeRow(
  row: Record<string, unknown>,
  filePath: string,
  options: AdapterOptions,
  seenMessages: Set<string>,
  diagnostics: AdapterResult['diagnostics'],
): NormalizedUsage | undefined {
  const message = childRecord(row, 'message')
  const usage = message && childRecord(message, 'usage')
  if (!message || !usage) {
    diagnostics.unsupportedLines += 1
    return undefined
  }

  const timestamp = stringValue(row.timestamp)
  const month = localMonthFromTimestamp(timestamp)
  const cwd = stringValue(row.cwd)
  const sessionId = stringValue(row.sessionId) ?? stringValue(row.session_id)
  const messageId = stringValue(message.id)

  if (!timestamp || !month || !cwd || !sessionId || !messageId) {
    diagnostics.invalidRecords += 1
    return undefined
  }

  const messageKey = privateKey('message', messageId, options.identifierSalt)
  if (seenMessages.has(messageKey)) {
    diagnostics.duplicateRecords += 1
    return undefined
  }
  seenMessages.add(messageKey)

  return {
    provider: 'claude',
    month,
    observedAt: timestamp,
    sessionKey: privateKey('session', sessionId, options.identifierSalt),
    projectKey: privateKey('project', cwd, options.identifierSalt),
    projectLabel: options.includeLocalProjectLabel ? localProjectLabel(cwd) : undefined,
    // contentHash/byteSize/fileMtime start as placeholders: the whole-file
    // digest is not final until this file's rows have all streamed through
    // readJsonlObjects. readClaudeHistory overwrites them once it is.
    localReference: options.includeLocalReferences
      ? {
          nativeSessionId: sessionId,
          sourcePath: filePath,
          workingDirectory: cwd,
          contentHash: '',
          byteSize: 0,
          fileMtime: '',
        }
      : undefined,
    model: stringValue(message.model) ?? 'unknown',
    inputTokens: nonNegativeInteger(usage.input_tokens),
    cacheReadTokens: nonNegativeInteger(usage.cache_read_input_tokens),
    cacheWriteTokens: nonNegativeInteger(usage.cache_creation_input_tokens),
    outputTokens: nonNegativeInteger(usage.output_tokens),
    reasoningTokens: 0,
    captureMethod: 'local transcript compatibility adapter',
    adapter: ADAPTER,
    schemaVersion: SCHEMA_VERSION,
    confidence: 'B',
  }
}
