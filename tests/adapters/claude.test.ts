import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { readClaudeHistory } from '../../src/adapters/claude.ts'

const SALT = 'synthetic-test-salt-at-least-16'
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

function claudeHistory(...files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'devtax-claude-adapter-'))
  temporaryDirectories.push(root)
  for (const [index, contents] of files.entries()) {
    writeFileSync(join(root, `session-${index}.jsonl`), contents, 'utf8')
  }
  return root
}

describe('Claude Code local history adapter', () => {
  it('deduplicates message usage and emits metadata-only events', async () => {
    const root = resolve('fixtures/claude')
    const result = await readClaudeHistory(root, { identifierSalt: SALT })

    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toMatchObject({
      provider: 'claude',
      month: '2026-04',
      model: 'claude-synthetic',
      inputTokens: 100,
      cacheReadTokens: 40,
      cacheWriteTokens: 10,
      outputTokens: 25,
      reasoningTokens: 0,
      adapter: 'claude-code-local-jsonl',
      schemaVersion: 'claude-local-v1',
      confidence: 'B',
    })
    expect(result.diagnostics.duplicateRecords).toBe(1)
    expect(result.diagnostics.malformedJsonLines).toBe(1)
    expect(result.diagnostics.unsupportedLines).toBe(1)

    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('Product-A')
    expect(serialized).not.toContain('synthetic-claude-session-1')
    expect(serialized).not.toContain('SYNTHETIC_PRIVATE_PROMPT_MUST_NOT_ESCAPE')
  })

  it('observedAtに元のタイムスタンプを保持する', async () => {
    const root = resolve('fixtures/claude')
    const result = await readClaudeHistory(root, { identifierSalt: SALT })
    expect(result.events[0]?.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('opt-inしない限り生の識別子を返さない', async () => {
    const root = resolve('fixtures/claude')
    const result = await readClaudeHistory(root, { identifierSalt: SALT })
    expect(result.events[0]?.localReference).toBeUndefined()
  })

  it('opt-inすると生のセッションIDと作業フォルダを返す', async () => {
    const root = resolve('fixtures/claude')
    const result = await readClaudeHistory(root, {
      identifierSalt: SALT,
      includeLocalReferences: true,
    })
    const reference = result.events[0]?.localReference
    expect(reference?.nativeSessionId).toBeTruthy()
    expect(reference?.sourcePath).toContain('.jsonl')
    expect(reference?.workingDirectory).toBeTruthy()
  })

  it('opt-inするとファイル全体のSHA-256とサイズと更新日時を返す', async () => {
    const root = resolve('fixtures/claude')
    const result = await readClaudeHistory(root, {
      identifierSalt: SALT,
      includeLocalReferences: true,
    })
    const reference = result.events[0]?.localReference
    const filePath = reference?.sourcePath
    expect(filePath).toBeTruthy()

    const expectedHash = createHash('sha256').update(readFileSync(filePath!)).digest('hex')
    const expectedStats = statSync(filePath!)

    expect(reference?.contentHash).toBe(expectedHash)
    expect(reference?.byteSize).toBe(expectedStats.size)
    expect(reference?.fileMtime).toBe(expectedStats.mtime.toISOString())
  })

  it('known user-only sessions are compatible zero-usage history', async () => {
    const root = claudeHistory(
      `${JSON.stringify({
        type: 'user',
        timestamp: '2026-04-21T02:03:04.000Z',
        cwd: 'C:\\Synthetic\\Aborted-Claude',
        sessionId: 'aborted-claude-session',
        message: { role: 'user', content: 'aborted before a response' },
      })}\n`,
      `${JSON.stringify({
        type: 'assistant',
        timestamp: '2026-04-21T02:03:05.000Z',
        cwd: 'C:\\Synthetic\\Interrupted-Claude',
        sessionId: 'interrupted-claude-session',
        message: { id: 'interrupted-claude-message', role: 'assistant' },
      })}\n`,
    )

    const result = await readClaudeHistory(root, { identifierSalt: SALT })

    expect(result.events).toEqual([])
    expect(result.diagnostics).toMatchObject({ invalidRecords: 0, incompatibleFiles: 0 })
  })

  it('accepts known metadata-only transcript files without token usage', async () => {
    const snapshotId = 'metadata-snapshot-message'
    const root = claudeHistory(
      `${JSON.stringify({
        type: 'ai-title',
        sessionId: 'metadata-title-session',
        aiTitle: 'title only session',
      })}\n`,
      `${JSON.stringify({
        type: 'queue-operation',
        sessionId: 'metadata-queue-session',
        timestamp: '2026-04-21T02:03:04.000Z',
        operation: 'enqueue',
      })}\n`,
      `${JSON.stringify({
        type: 'file-history-snapshot',
        messageId: snapshotId,
        snapshot: {},
        isSnapshotUpdate: false,
      })}\n`,
    )

    const result = await readClaudeHistory(root, { identifierSalt: SALT })

    expect(result.events).toEqual([])
    expect(result.diagnostics).toMatchObject({ invalidRecords: 0, incompatibleFiles: 0 })
  })

  it('accepts known bridge, progress, lifecycle, prompt, and attachment metadata files', async () => {
    const root = claudeHistory(
      `${JSON.stringify({
        type: 'bridge-session',
        sessionId: 'metadata-bridge-session',
        bridgeSessionId: 'bridge-session',
        lastSequenceNum: 3,
      })}\n`,
      `${JSON.stringify({
        type: 'progress',
        sessionId: 'metadata-progress-session',
        cwd: 'C:\\Synthetic\\Progress-Claude',
        data: { opaque: true },
        entrypoint: 'cli',
        gitBranch: 'main',
        isSidechain: false,
        parentToolUseID: null,
        parentUuid: null,
        slug: 'progress',
        timestamp: '2026-04-21T02:03:04.000Z',
        toolUseID: 'tool-use',
        userType: 'external',
        uuid: 'progress-uuid',
        version: 'synthetic',
      })}\n`,
      `${JSON.stringify({ type: 'started', agentId: 'lifecycle-agent', key: 'lifecycle-key' })}\n${JSON.stringify(
        {
          type: 'result',
          agentId: 'lifecycle-agent',
          key: 'lifecycle-key',
          result: { opaque: true },
        },
      )}\n`,
      `${JSON.stringify({
        type: 'last-prompt',
        sessionId: 'metadata-prompt-session',
        leafUuid: 'prompt-leaf',
      })}\n`,
      `${JSON.stringify({
        type: 'attachment',
        attachment: 'opaque attachment payload',
        cwd: 'C:\\Synthetic\\Attachment-Claude',
        entrypoint: 'cli',
        gitBranch: 'main',
        isSidechain: false,
        parentUuid: null,
        sessionId: 'metadata-attachment-session',
        timestamp: '2026-04-21T02:03:04.000Z',
        userType: 'external',
        uuid: 'attachment-uuid',
        version: 'synthetic',
      })}\n`,
    )

    const result = await readClaudeHistory(root, { identifierSalt: SALT })

    expect(result.events).toEqual([])
    expect(result.diagnostics).toMatchObject({ invalidRecords: 0, incompatibleFiles: 0 })
  })

  it('does not classify malformed lines in a recognized transcript as incompatible', async () => {
    const root = claudeHistory(
      `not valid json\n${JSON.stringify({
        type: 'user',
        timestamp: '2026-04-21T02:03:04.000Z',
        cwd: 'C:\\Synthetic\\Incomplete-Claude',
        sessionId: 'incomplete-claude-session',
        message: { role: 'user', content: 'no assistant response yet' },
      })}\n`,
    )

    const result = await readClaudeHistory(root, { identifierSalt: SALT })

    expect(result.events).toEqual([])
    expect(result.diagnostics).toMatchObject({
      malformedJsonLines: 1,
      invalidRecords: 0,
      incompatibleFiles: 0,
    })
  })

  it('keeps a file containing only unknown records incompatible', async () => {
    const root = claudeHistory(
      `${JSON.stringify({
        type: 'future-provider-record',
        sessionId: 'future-session',
        message: { role: 'user', content: 'looks message-like but is not a Claude envelope' },
      })}\n`,
    )

    const result = await readClaudeHistory(root, { identifierSalt: SALT })

    expect(result.events).toEqual([])
    expect(result.diagnostics).toMatchObject({ invalidRecords: 0, incompatibleFiles: 1 })
  })

  it('rejects assistant usage whose required token fields were renamed', async () => {
    const root = claudeHistory(
      `${JSON.stringify({
        type: 'assistant',
        timestamp: '2026-04-21T02:03:04.000Z',
        cwd: 'C:\\Synthetic\\Future-Claude',
        sessionId: 'future-claude-session',
        message: {
          id: 'future-claude-message',
          usage: { input_units: 100, output_units: 25 },
        },
      })}\n`,
    )

    const result = await readClaudeHistory(root, { identifierSalt: SALT })

    expect(result.events).toEqual([])
    expect(result.diagnostics).toMatchObject({ invalidRecords: 1, incompatibleFiles: 1 })
  })

  it('keeps duplicate-only Claude files compatible', async () => {
    const record = `${JSON.stringify({
      type: 'assistant',
      timestamp: '2026-04-21T02:03:04.000Z',
      cwd: 'C:\\Synthetic\\Duplicate-Claude',
      sessionId: 'duplicate-claude-session',
      message: {
        id: 'duplicate-claude-message',
        usage: { input_tokens: 100, output_tokens: 25 },
      },
    })}\n`
    const root = claudeHistory(record, record)

    const result = await readClaudeHistory(root, { identifierSalt: SALT })

    expect(result.events).toHaveLength(1)
    expect(result.diagnostics).toMatchObject({
      duplicateRecords: 1,
      invalidRecords: 0,
      incompatibleFiles: 0,
    })
  })
})
