import { describe, expect, it } from 'vitest'
import {
  utf8Bytes,
  WORKSPACE_BODY_LIMIT,
  WORKSPACE_ATTEMPT_LIMIT,
} from '../../src/planning/workspaceLimits'

describe('shared workspace UTF-8 limits', () => {
  it('counts Japanese text and surrogate pairs as bytes, not code units', () => {
    expect(utf8Bytes('あ😀')).toBe(7)
    expect(utf8Bytes('あ'.repeat(2000 * 12))).toBeGreaterThan(64 * 1024)
  })
  it('retains both a full-size ASCII base and request with the envelope', () => {
    const raw = JSON.stringify({
      base: 'a'.repeat(WORKSPACE_BODY_LIMIT),
      request: 'a'.repeat(WORKSPACE_BODY_LIMIT),
    })
    expect(raw.length).toBeGreaterThan(2_000_000)
    expect(utf8Bytes(raw)).toBeLessThanOrEqual(WORKSPACE_ATTEMPT_LIMIT)
  })
  it('makes the HTTP boundary inclusive at exactly 2 MiB', () => {
    expect(utf8Bytes('a'.repeat(WORKSPACE_BODY_LIMIT))).toBe(WORKSPACE_BODY_LIMIT)
    expect(utf8Bytes('a'.repeat(WORKSPACE_BODY_LIMIT) + 'あ')).toBe(WORKSPACE_BODY_LIMIT + 3)
  })
})
