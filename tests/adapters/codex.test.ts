import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readCodexHistory, CODEX_HISTORY_SCHEMA_VERSION } from '../../src/adapters/codex.ts'

const SALT = 'synthetic-test-salt-at-least-16'
const directories: string[] = []
afterEach(() => {
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})
function history(rows: unknown[]): string {
  const path = mkdtempSync(join(tmpdir(), 'devtax-codex-adapter-'))
  directories.push(path)
  writeFileSync(
    join(path, 'session.jsonl'),
    rows.map((row) => (typeof row === 'string' ? row : JSON.stringify(row))).join('\n') + '\n',
  )
  return path
}
function metadata() {
  return {
    type: 'session_meta',
    timestamp: '2026-07-01T10:00:00Z',
    payload: {
      id: 'PRIVATE_SESSION_ID',
      cwd: 'C:\\Synthetic\\Product',
      private_prompt: 'PRIVATE_BODY',
    },
  }
}
function point(
  timestamp: string | undefined,
  input: number,
  output: number,
  cached = 0,
  reasoning = 0,
) {
  return {
    type: 'event_msg',
    timestamp,
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: input,
          cached_input_tokens: cached,
          output_tokens: output,
          reasoning_output_tokens: reasoning,
        },
      },
    },
  }
}

describe('Codex cumulative history adapter', () => {
  it('differences actual snapshots without counting cache or reasoning twice', async () => {
    const result = await readCodexHistory(resolve('fixtures/codex'), { identifierSalt: SALT })
    expect(result.events).toHaveLength(2)
    const total = (
      field:
        'inputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'outputTokens' | 'reasoningTokens',
    ) => result.events.reduce((sum, event) => sum + event[field], 0)
    expect(total('inputTokens')).toBe(72)
    expect(total('cacheReadTokens')).toBe(70)
    expect(total('cacheWriteTokens')).toBe(8)
    expect(total('outputTokens')).toBe(28)
    expect(total('reasoningTokens')).toBe(12)
    expect(total('inputTokens') + total('cacheReadTokens') + total('cacheWriteTokens')).toBe(150)
    expect(total('outputTokens') + total('reasoningTokens')).toBe(40)
    for (const event of result.events) {
      expect(event).toMatchObject({
        provider: 'codex',
        month: '2026-04',
        model: 'gpt-synthetic',
        adapter: 'codex-local-jsonl',
        schemaVersion: CODEX_HISTORY_SCHEMA_VERSION,
      })
      expect(event.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(event.localReference).toBeUndefined()
    }
    expect(result.diagnostics).toMatchObject({ malformedJsonLines: 1, unsupportedLines: 1 })
    for (const marker of [
      'Product-B',
      'synthetic-codex-session-1',
      'SYNTHETIC_PRIVATE_PROMPT_MUST_NOT_ESCAPE',
    ])
      expect(JSON.stringify(result)).not.toContain(marker)
  })

  it('uses stable opaque identities, independent of opt-in private references', async () => {
    const root = resolve('fixtures/codex')
    const first = await readCodexHistory(root, { identifierSalt: SALT })
    const again = await readCodexHistory(root, { identifierSalt: SALT })
    const other = await readCodexHistory(root, { identifierSalt: 'different-install-salt-1234' })
    expect(first.events.map((row) => [row.sessionKey, row.projectKey, row.eventKey])).toEqual(
      again.events.map((row) => [row.sessionKey, row.projectKey, row.eventKey]),
    )
    expect(first.events[0]!.sessionKey).not.toBe(other.events[0]!.sessionKey)
    const privateResult = await readCodexHistory(root, {
      identifierSalt: SALT,
      includeLocalReferences: true,
    })
    const reference = privateResult.events[0]!.localReference!
    expect(reference.nativeSessionId).toBeTruthy()
    expect(reference.workingDirectory).toBeTruthy()
    expect(reference.sourcePath).toContain('.jsonl')
    expect(reference.contentHash).toBe(
      createHash('sha256').update(readFileSync(reference.sourcePath)).digest('hex'),
    )
    expect(reference.byteSize).toBe(statSync(reference.sourcePath).size)
    expect(reference.fileMtime).toBe(statSync(reference.sourcePath).mtime.toISOString())
  })

  it('keeps month and purpose boundaries at recorded snapshots, not session start', async () => {
    const result = await readCodexHistory(
      history([
        metadata(),
        point('2026-07-10T10:00:00Z', 100, 20),
        { type: 'turn_context', payload: { cwd: 'C:\\Synthetic\\Second', model: 'second-model' } },
        point('2026-08-10T10:00:00Z', 250, 50),
      ]),
      { identifierSalt: SALT },
    )
    expect(result.events).toHaveLength(2)
    expect(result.events.map((row) => row.month)).toEqual(['2026-07', '2026-08'])
    expect(result.events.map((row) => row.inputTokens)).toEqual([100, 150])
    expect(result.events[0]!.projectKey).not.toBe(result.events[1]!.projectKey)
    expect(result.events[1]!.model).toBe('second-model')
  })

  it('does not add repeated cumulative counters or last_token_usage notices again', async () => {
    const repeated = point('2026-07-10T10:00:00Z', 100, 20)
    const result = await readCodexHistory(
      history([
        metadata(),
        repeated,
        repeated,
        {
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: { last_token_usage: { input_tokens: 100, output_tokens: 20 } },
          },
        },
      ]),
      { identifierSalt: SALT },
    )
    expect(result.events).toHaveLength(1)
    expect(result.events[0]!.inputTokens).toBe(100)
    expect(result.diagnostics.duplicateRecords).toBeGreaterThan(0)
  })

  it('rejects counter resets instead of guessing whether they are new usage or a copy', async () => {
    const result = await readCodexHistory(
      history([
        metadata(),
        point('2026-07-10T10:00:00Z', 100, 20),
        point('2026-07-11T10:00:00Z', 50, 10),
      ]),
      { identifierSalt: SALT },
    )
    expect(result.events).toEqual([])
    expect(result.diagnostics.incompatibleFiles).toBe(1)
  })

  it('marks untimed numeric claims as coarse without pretending the start is their exact use time', async () => {
    const result = await readCodexHistory(history([metadata(), point(undefined, 100, 20)]), {
      identifierSalt: SALT,
    })
    expect(result.events).toHaveLength(1)
    expect(result.events[0]!.schemaVersion).toContain('coarse')
    expect(result.events[0]!.inputTokens).toBe(100)
  })

  it('accepts metadata-only and neutral placeholders without inventing usage', async () => {
    const result = await readCodexHistory(
      history([
        metadata(),
        { type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: {} } },
        { type: 'event_msg', payload: { type: 'token_count', rate_limits: {} } },
      ]),
      { identifierSalt: SALT },
    )
    expect(result.events).toEqual([])
    expect(result.diagnostics).toMatchObject({ invalidRecords: 0, incompatibleFiles: 0 })
  })

  it('allows neutral placeholders before a valid numeric snapshot', async () => {
    const result = await readCodexHistory(
      history([
        metadata(),
        { type: 'event_msg', payload: { type: 'token_count', info: null } },
        point('2026-07-10T10:00:00Z', 150, 40, 70, 12),
      ]),
      { identifierSalt: SALT },
    )
    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toMatchObject({
      inputTokens: 80,
      cacheReadTokens: 70,
      outputTokens: 28,
      reasoningTokens: 12,
    })
  })

  it('counts malformed lines without discarding a recognized metadata-only file', async () => {
    const result = await readCodexHistory(history([metadata(), '{broken']), {
      identifierSalt: SALT,
    })
    expect(result.events).toEqual([])
    expect(result.diagnostics).toMatchObject({
      malformedJsonLines: 1,
      invalidRecords: 0,
      incompatibleFiles: 0,
    })
  })

  it.each([
    null,
    { input_units: 100, output_units: 25 },
    { input_tokens: 10, cached_input_tokens: 11, output_tokens: 2 },
    { input_tokens: 10, output_tokens: 2, reasoning_output_tokens: 3 },
  ])('rejects invalid or renamed numeric claims: %j', async (total) => {
    const result = await readCodexHistory(
      history([
        metadata(),
        { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: total } } },
      ]),
      { identifierSalt: SALT },
    )
    expect(result.events).toEqual([])
    expect(result.diagnostics).toMatchObject({ invalidRecords: 1, incompatibleFiles: 1 })
  })

  it('does not treat an unknown file format as a successful zero-usage import', async () => {
    const result = await readCodexHistory(
      history([{ type: 'future-provider-record', payload: { opaque: true } }]),
      { identifierSalt: SALT },
    )
    expect(result.events).toEqual([])
    expect(result.diagnostics.incompatibleFiles).toBe(1)
  })
})
