import { describe, expect, it } from 'vitest'
import {
  contractCoversDate,
  contractCoversMonth,
  hasAnyContractPeriod,
} from '../../src/server/contractPeriod.ts'

describe('contractCoversMonth', () => {
  it('covers every month when no dates are set', () => {
    expect(contractCoversMonth({}, '2026-01')).toBe(true)
    expect(contractCoversMonth(undefined, '2026-01')).toBe(true)
  })

  it('excludes months entirely before the start date', () => {
    expect(contractCoversMonth({ startedOn: '2026-07-18' }, '2026-06')).toBe(false)
    expect(contractCoversMonth({ startedOn: '2026-07-18' }, '2026-07')).toBe(true)
    expect(contractCoversMonth({ startedOn: '2026-07-18' }, '2026-08')).toBe(true)
  })

  it('excludes months entirely after the end date', () => {
    expect(contractCoversMonth({ endedOn: '2026-05-02' }, '2026-05')).toBe(true)
    expect(contractCoversMonth({ endedOn: '2026-05-02' }, '2026-06')).toBe(false)
  })

  it('handles the last day of a month at both edges', () => {
    expect(contractCoversMonth({ startedOn: '2026-02-28' }, '2026-02')).toBe(true)
    expect(contractCoversMonth({ endedOn: '2026-02-01' }, '2026-02')).toBe(true)
  })
})

describe('contractCoversDate', () => {
  it('covers every date when no dates are set', () => {
    expect(contractCoversDate({}, '2026-07-01')).toBe(true)
  })

  it('excludes dates before the start and after the end', () => {
    const contract = { startedOn: '2026-07-18', endedOn: '2026-09-30' }
    expect(contractCoversDate(contract, '2026-07-17')).toBe(false)
    expect(contractCoversDate(contract, '2026-07-18')).toBe(true)
    expect(contractCoversDate(contract, '2026-09-30')).toBe(true)
    expect(contractCoversDate(contract, '2026-10-01')).toBe(false)
  })
})

describe('hasAnyContractPeriod', () => {
  it('is false only when both providers are empty', () => {
    expect(hasAnyContractPeriod({ claude: {}, codex: {} })).toBe(false)
    expect(hasAnyContractPeriod({ claude: { startedOn: '2026-01-01' }, codex: {} })).toBe(true)
    expect(hasAnyContractPeriod({ claude: {}, codex: { endedOn: '2026-01-01' } })).toBe(true)
  })
})
