import { expect, it } from 'vitest'
import { recordedTime } from '../../src/client/recordedTime'

it('renders the same instant across the Japan date boundary with its timezone', () => {
  expect(recordedTime('2026-09-08T15:06:00Z', 'Asia/Tokyo')).toBe(
    '2026/09/09 00:06:00（Asia/Tokyo）',
  )
  expect(recordedTime('2026-09-08T15:06:00Z', 'UTC')).toBe('2026/09/08 15:06:00（UTC）')
  expect(recordedTime('', 'Asia/Tokyo')).toBe('記録日時が不明です')
  expect(recordedTime('invalid', 'Asia/Tokyo')).toBe('記録日時が不明です')
})
