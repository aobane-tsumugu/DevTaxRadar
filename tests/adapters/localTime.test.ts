import { describe, expect, it } from 'vitest'
import {
  localDateFromTimestamp,
  localMonthFromTimestamp,
  resolvedTimeZone,
} from '../../src/adapters/localTime.ts'

describe('localDateFromTimestamp', () => {
  it('UTC表記の月末深夜はJSTで翌月1日になる', () => {
    expect(localDateFromTimestamp('2026-07-31T23:50:00.000Z', 'Asia/Tokyo')).toBe('2026-08-01')
    expect(localDateFromTimestamp('2026-07-31T23:50:00.000Z', 'UTC')).toBe('2026-07-31')
  })

  it('JSTの正午は同じ日付になる', () => {
    expect(localDateFromTimestamp('2026-07-15T03:00:00.000Z', 'Asia/Tokyo')).toBe('2026-07-15')
  })

  it('オフセット付き表記も解釈する', () => {
    expect(localDateFromTimestamp('2026-07-31T23:50:00+09:00', 'Asia/Tokyo')).toBe('2026-07-31')
  })

  it('文字列でない値と解釈できない値はundefinedを返す', () => {
    expect(localDateFromTimestamp(undefined, 'UTC')).toBeUndefined()
    expect(localDateFromTimestamp(1234, 'UTC')).toBeUndefined()
    expect(localDateFromTimestamp('not-a-timestamp', 'UTC')).toBeUndefined()
  })
})

describe('localMonthFromTimestamp', () => {
  it('月境界をタイムゾーンで判定する', () => {
    expect(localMonthFromTimestamp('2026-07-31T23:50:00.000Z', 'Asia/Tokyo')).toBe('2026-08')
    expect(localMonthFromTimestamp('2026-07-31T23:50:00.000Z', 'UTC')).toBe('2026-07')
  })

  it('年境界をまたぐ場合も正しい', () => {
    expect(localMonthFromTimestamp('2025-12-31T20:00:00.000Z', 'Asia/Tokyo')).toBe('2026-01')
  })
})

describe('resolvedTimeZone', () => {
  it('IANAタイムゾーン識別子を返す', () => {
    expect(resolvedTimeZone()).toMatch(/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)*$/)
  })
})
