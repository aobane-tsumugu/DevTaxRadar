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

type ClaudeFileState = {
  hasRecognizedRecord: boolean
  hasInvalidUsageRecord: boolean
}

export async function readClaudeHistory(
  rootDirectory: string,
  options: AdapterOptions,
): Promise<AdapterResult> {
  const diagnostics = createDiagnostics()
  const events: NormalizedUsage[] = []
  const seenMessages = new Set<string>()

  for await (const filePath of discoverJsonlFiles(rootDirectory, diagnostics)) {
    options.onFileScanned?.()
    const before = readFileSnapshot(filePath)
    // The Transform inside readJsonlObjects hashes every byte as it streams
    // past on its way to the line splitter, so the file is read exactly once
    // even though both the parsed rows and the digest are needed. The digest
    // only finishes once every row from this file has been consumed, but a
    // Claude transcript can hold several messages (several events), so the
    // real contentHash/byteSize/fileMtime are patched onto every event from
    // this file below -- not built inline while rows are still streaming.
    const hash = options.includeLocalReferences ? createHash('sha256') : undefined
    const ioErrorsBefore = diagnostics.ioErrors
    const fileState: ClaudeFileState = {
      hasRecognizedRecord: false,
      hasInvalidUsageRecord: false,
    }
    const fileEvents: NormalizedUsage[] = []
    for await (const row of readJsonlObjects(filePath, diagnostics, hash)) {
      const event = normalizeClaudeRow(row, filePath, options, seenMessages, diagnostics, fileState)
      if (event) fileEvents.push(event)
    }
    // A read that failed part way through leaves the hash covering only the
    // bytes that arrived. Recording that as the file's hash would make the next
    // scan report a change that never happened, so leave it empty -- which the
    // change detection already treats as "not recorded".
    const after = readFileSnapshot(filePath)
    const readCompletely = diagnostics.ioErrors === ioErrorsBefore
    const stable = readCompletely && sameFileSnapshot(before, after)
    if (!stable) {
      diagnostics.unstableFiles += 1
      continue
    }
    // A recognized transcript can legitimately contain no billable assistant
    // response: for example, a user-only or aborted session. Conversely, an
    // assistant record that claims usage but no longer has the required token
    // counters is unsafe to import, even if another row in this file parsed.
    if (!fileState.hasRecognizedRecord || fileState.hasInvalidUsageRecord) {
      diagnostics.incompatibleFiles += 1
      continue
    }
    if (hash && after) {
      const summary = fileContentSummary(hash, after)
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
  fileState: ClaudeFileState,
): NormalizedUsage | undefined {
  const message = childRecord(row, 'message')
  if (!message || !isKnownClaudeMessageRecord(row, message)) {
    if (isKnownClaudeMetadataRecord(row)) fileState.hasRecognizedRecord = true
    diagnostics.unsupportedLines += 1
    return undefined
  }

  fileState.hasRecognizedRecord = true
  const usageValue = message.usage
  // Claude leaves usage out of user-only and interrupted assistant messages.
  // Those rows establish the transcript format, but have no billable usage to
  // normalize. A present object, on the other hand, is a claim about usage and
  // must remain strict so renamed counters cannot silently erase a session.
  if (usageValue === undefined || usageValue === null) {
    diagnostics.unsupportedLines += 1
    return undefined
  }
  if (!isClaudeAssistantRecord(row) || !isRecord(usageValue)) {
    fileState.hasInvalidUsageRecord = true
    diagnostics.invalidRecords += 1
    return undefined
  }
  const usage = usageValue

  const timestamp = stringValue(row.timestamp)
  const month = localMonthFromTimestamp(timestamp)
  const cwd = stringValue(row.cwd)
  const sessionId = stringValue(row.sessionId) ?? stringValue(row.session_id)
  const messageId = stringValue(message.id)

  if (!timestamp || !month || !cwd || !sessionId || !messageId) {
    fileState.hasInvalidUsageRecord = true
    diagnostics.invalidRecords += 1
    return undefined
  }
  if (!validRequiredTokenCounters(usage)) {
    fileState.hasInvalidUsageRecord = true
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
    projectKey: options.portableProjectPaths
      ? portableProjectKey(cwd, options.identifierSalt)
      : privateKey('project', cwd, options.identifierSalt),
    projectLabel: options.includeLocalProjectLabel
      ? options.portableProjectPaths
        ? portableProjectLabel(cwd)
        : localProjectLabel(cwd)
      : undefined,
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

function isKnownClaudeMessageRecord(
  row: Record<string, unknown>,
  message: Record<string, unknown>,
): boolean {
  const rowType = stringValue(row.type)
  const role = stringValue(message.role)
  // Restrict compatibility to the two stable Claude message envelopes. The
  // role is optional in older transcripts, but when present it must agree
  // with that envelope so an arbitrary future `type` cannot pass as history.
  return (
    (rowType === 'assistant' && (role === undefined || role === 'assistant')) ||
    (rowType === 'user' && (role === undefined || role === 'user'))
  )
}

function isClaudeAssistantRecord(row: Record<string, unknown>): boolean {
  return stringValue(row.type) === 'assistant'
}

function isKnownClaudeMetadataRecord(row: Record<string, unknown>): boolean {
  const recordType = stringValue(row.type)
  if (recordType === 'file-history-snapshot') {
    return Boolean(
      isRecord(row.snapshot) && hasOwnKeys(row, 'messageId', 'snapshot', 'isSnapshotUpdate'),
    )
  }
  if (recordType === 'started') {
    return hasOwnKeys(row, 'agentId', 'key')
  }
  if (recordType === 'result') {
    return hasOwnKeys(row, 'agentId', 'key', 'result')
  }

  const sessionId = stringValue(row.sessionId) ?? stringValue(row.session_id)
  if (!sessionId) return false

  // Metadata-only records use a stable envelope plus a companion field, not
  // merely an arbitrary `type` string. They can be the complete on-disk form
  // of an aborted or title-only Claude session and carry no token claim.
  switch (recordType) {
    case 'agent-name':
      return typeof row.agentName === 'string'
    case 'ai-title':
      return typeof row.aiTitle === 'string'
    case 'attachment':
      return hasOwnKeys(row, 'attachment', 'cwd', 'isSidechain', 'timestamp', 'uuid')
    case 'bridge-session':
      return hasOwnKeys(row, 'bridgeSessionId', 'lastSequenceNum')
    case 'custom-title':
      return typeof row.customTitle === 'string'
    case 'last-prompt':
      return hasOwnKeys(row, 'leafUuid')
    case 'mode':
      return typeof row.mode === 'string'
    case 'permission-mode':
      return typeof row.permissionMode === 'string' || typeof row.mode === 'string'
    case 'progress':
      return hasOwnKeys(row, 'cwd', 'data', 'timestamp', 'toolUseID', 'uuid')
    case 'queue-operation':
      return typeof row.operation === 'string'
    case 'system':
      return typeof row.subtype === 'string'
    default:
      return false
  }
}

function hasOwnKeys(row: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.every((key) => Object.prototype.hasOwnProperty.call(row, key))
}

function validRequiredTokenCounters(usage: Record<string, unknown>): boolean {
  return [usage.input_tokens, usage.output_tokens].every(
    (value) => typeof value === 'number' && Number.isInteger(value) && value >= 0,
  )
}
