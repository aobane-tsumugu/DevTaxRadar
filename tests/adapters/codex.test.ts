import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { readCodexHistory } from '../../src/adapters/codex.ts'

const SALT = 'synthetic-test-salt-at-least-16'
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

function codexHistory(contents: string): string {
  const root = mkdtempSync(join(tmpdir(), 'devtax-codex-adapter-'))
  temporaryDirectories.push(root)
  writeFileSync(join(root, 'session.jsonl'), contents, 'utf8')
  return root
}

describe('Codex local history adapter', () => {
  it('uses the final cumulative token snapshot and emits no transcript body', async () => {
    const root = resolve('fixtures/codex')
    const result = await readCodexHistory(root, { identifierSalt: SALT })

    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toMatchObject({
      provider: 'codex',
      month: '2026-04',
      model: 'gpt-synthetic',
      inputTokens: 150,
      cacheReadTokens: 70,
      cacheWriteTokens: 8,
      outputTokens: 40,
      reasoningTokens: 12,
      adapter: 'codex-local-jsonl',
      schemaVersion: 'codex-local-v1',
      confidence: 'B',
    })
    expect(result.diagnostics.malformedJsonLines).toBe(1)
    expect(result.diagnostics.unsupportedLines).toBe(1)

    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('Product-B')
    expect(serialized).not.toContain('synthetic-codex-session-1')
    expect(serialized).not.toContain('SYNTHETIC_PRIVATE_PROMPT_MUST_NOT_ESCAPE')
  })

  it('produces stable local keys without exposing their input', async () => {
    const first = await readCodexHistory(resolve('fixtures/codex'), {
      identifierSalt: SALT,
    })
    const second = await readCodexHistory(resolve('fixtures/codex'), {
      identifierSalt: SALT,
    })
    const differentInstall = await readCodexHistory(resolve('fixtures/codex'), {
      identifierSalt: 'different-install-salt-1234',
    })

    expect(first.events[0]?.sessionKey).toBe(second.events[0]?.sessionKey)
    expect(first.events[0]?.projectKey).toBe(second.events[0]?.projectKey)
    expect(first.events[0]?.sessionKey).not.toBe(differentInstall.events[0]?.sessionKey)
  })

  it('observedAtに元のタイムスタンプを保持する', async () => {
    const root = resolve('fixtures/codex')
    const result = await readCodexHistory(root, { identifierSalt: SALT })
    expect(result.events[0]?.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('opt-inしない限り生の識別子を返さない', async () => {
    const root = resolve('fixtures/codex')
    const result = await readCodexHistory(root, { identifierSalt: SALT })
    expect(result.events[0]?.localReference).toBeUndefined()
  })

  it('opt-inすると生のセッションIDと作業フォルダを返す', async () => {
    const root = resolve('fixtures/codex')
    const result = await readCodexHistory(root, {
      identifierSalt: SALT,
      includeLocalReferences: true,
    })
    const reference = result.events[0]?.localReference
    expect(reference?.nativeSessionId).toBeTruthy()
    expect(reference?.sourcePath).toContain('.jsonl')
    expect(reference?.workingDirectory).toBeTruthy()
  })

  it('opt-inするとファイル全体のSHA-256とサイズと更新日時を返す', async () => {
    const root = resolve('fixtures/codex')
    const result = await readCodexHistory(root, {
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

  it('accepts incomplete metadata-only sessions as compatible zero-usage history', async () => {
    const root = codexHistory(
      `${JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-04-21T02:03:04.000Z',
        payload: { cwd: 'C:\\Synthetic\\Aborted-Codex' },
      })}\n`,
    )

    const result = await readCodexHistory(root, { identifierSalt: SALT })

    expect(result.events).toEqual([])
    expect(result.diagnostics).toMatchObject({ invalidRecords: 0, incompatibleFiles: 0 })
  })

  it('does not classify malformed lines in a recognized transcript as incompatible', async () => {
    const root = codexHistory(
      `${JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-04-21T02:03:04.000Z',
        payload: { cwd: 'C:\\Synthetic\\Incomplete-Codex' },
      })}\nnot valid json\n`,
    )

    const result = await readCodexHistory(root, { identifierSalt: SALT })

    expect(result.events).toEqual([])
    expect(result.diagnostics).toMatchObject({
      malformedJsonLines: 1,
      invalidRecords: 0,
      incompatibleFiles: 0,
    })
  })

  it('keeps a file containing only unknown records incompatible', async () => {
    const root = codexHistory(
      `${JSON.stringify({ type: 'future-provider-record', payload: { opaque: true } })}\n`,
    )

    const result = await readCodexHistory(root, { identifierSalt: SALT })

    expect(result.events).toEqual([])
    expect(result.diagnostics).toMatchObject({ invalidRecords: 0, incompatibleFiles: 1 })
  })

  it('allows a neutral token-count placeholder before a valid cumulative snapshot', async () => {
    const root = codexHistory(
      `${JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-04-21T02:03:04.000Z',
        payload: {
          session_id: 'neutral-before-valid-session',
          timestamp: '2026-04-21T02:03:04.000Z',
          cwd: 'C:\\Synthetic\\Neutral-Before-Valid',
        },
      })}\n${JSON.stringify({
        type: 'event_msg',
        payload: { type: 'token_count', info: null, rate_limits: {} },
      })}\n${JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              input_tokens: 150,
              cached_input_tokens: 70,
              cache_write_input_tokens: 8,
              output_tokens: 40,
              reasoning_output_tokens: 12,
            },
          },
        },
      })}\n`,
    )

    const result = await readCodexHistory(root, { identifierSalt: SALT })

    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toMatchObject({ inputTokens: 150, outputTokens: 40 })
    expect(result.diagnostics).toMatchObject({ invalidRecords: 0, incompatibleFiles: 0 })
  })

  it('treats neutral token-count placeholders as compatible zero-usage history', async () => {
    const root = codexHistory(
      `${JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-04-21T02:03:04.000Z',
        payload: {
          session_id: 'neutral-only-session',
          timestamp: '2026-04-21T02:03:04.000Z',
          cwd: 'C:\\Synthetic\\Neutral-Only',
        },
      })}\n${JSON.stringify({
        type: 'event_msg',
        payload: { type: 'token_count', info: null, rate_limits: {} },
      })}\n${JSON.stringify({
        type: 'event_msg',
        payload: { type: 'token_count', rate_limits: {} },
      })}\n`,
    )

    const result = await readCodexHistory(root, { identifierSalt: SALT })

    expect(result.events).toEqual([])
    expect(result.diagnostics).toMatchObject({ invalidRecords: 0, incompatibleFiles: 0 })
  })

  it('rejects a present non-record total token usage claim', async () => {
    const root = codexHistory(
      `${JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-04-21T02:03:04.000Z',
        payload: {
          session_id: 'invalid-token-usage-session',
          timestamp: '2026-04-21T02:03:04.000Z',
          cwd: 'C:\\Synthetic\\Invalid-Token-Usage',
        },
      })}\n${JSON.stringify({
        type: 'event_msg',
        payload: { type: 'token_count', info: { total_token_usage: null } },
      })}\n`,
    )

    const result = await readCodexHistory(root, { identifierSalt: SALT })

    expect(result.events).toEqual([])
    expect(result.diagnostics).toMatchObject({ invalidRecords: 1, incompatibleFiles: 1 })
  })

  it('rejects token snapshots whose required fields were renamed', async () => {
    const root = codexHistory(
      `${JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-04-21T02:03:04.000Z',
        payload: {
          session_id: 'future-codex-session',
          timestamp: '2026-04-21T02:03:04.000Z',
          cwd: 'C:\\Synthetic\\Future-Codex',
        },
      })}\n${JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_units: 100, output_units: 25 } },
        },
      })}\n`,
    )

    const result = await readCodexHistory(root, { identifierSalt: SALT })

    expect(result.events).toEqual([])
    expect(result.diagnostics).toMatchObject({ invalidRecords: 1, incompatibleFiles: 1 })
  })
})
