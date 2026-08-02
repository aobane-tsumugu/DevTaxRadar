import { describe, expect, it } from 'vitest'
import { displayMonth } from '../../src/client/monthLabel.ts'

describe('displayMonth', () => {
  it('formats an internal month key as Japanese text', () => {
    expect(displayMonth('2026-01')).toBe('2026年1月')
    expect(displayMonth('2026-12')).toBe('2026年12月')
  })

  it('returns an empty string for missing input', () => {
    expect(displayMonth(undefined)).toBe('')
  })

  it('returns unexpected input unchanged instead of inventing a month', () => {
    expect(displayMonth('2026')).toBe('2026')
  })
})
