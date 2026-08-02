import { describe, expect, it } from 'vitest'
import {
  chargeConfirmationKey,
  invertedContractMessage,
  missingChargeMessage,
  missingChargeProviders,
  needsChargeConfirmation,
  providerWithInvertedContract,
} from '../../src/client/chargeGuard.ts'

describe('missingChargeProviders', () => {
  it('lists only selected providers whose charge is still empty', () => {
    expect(
      missingChargeProviders(['claude', 'codex'], { claude: undefined, codex: undefined }),
    ).toEqual(['claude', 'codex'])
    expect(
      missingChargeProviders(['claude', 'codex'], { claude: 30000, codex: undefined }),
    ).toEqual(['codex'])
  })

  it('ignores a provider the user is not scanning', () => {
    expect(missingChargeProviders(['claude'], { claude: undefined, codex: undefined })).toEqual([
      'claude',
    ])
  })

  it('treats a deliberate zero as entered, not missing', () => {
    expect(missingChargeProviders(['claude', 'codex'], { claude: 0, codex: 0 })).toEqual([])
  })
})

describe('needsChargeConfirmation', () => {
  it('asks the first time and stays quiet on the second press', () => {
    const missing = missingChargeProviders(['claude', 'codex'], {
      claude: undefined,
      codex: undefined,
    })
    expect(needsChargeConfirmation(missing, null)).toBe(true)
    expect(needsChargeConfirmation(missing, chargeConfirmationKey(missing))).toBe(false)
  })

  it('never asks when every selected provider has a charge', () => {
    expect(needsChargeConfirmation([], null)).toBe(false)
  })

  // The regression this guard exists for: a boolean "already warned" flag would
  // let a newly re-selected provider save as 0 yen without ever being named.
  it('asks again when a provider joins the missing set after a confirmation', () => {
    const firstRound = missingChargeProviders(['claude'], { claude: undefined, codex: undefined })
    expect(firstRound).toEqual(['claude'])
    const confirmed = chargeConfirmationKey(firstRound)

    const afterReselectingCodex = missingChargeProviders(['claude', 'codex'], {
      claude: undefined,
      codex: undefined,
    })
    expect(afterReselectingCodex).toEqual(['claude', 'codex'])
    expect(needsChargeConfirmation(afterReselectingCodex, confirmed)).toBe(true)
    expect(missingChargeMessage(afterReselectingCodex)).toContain('Claude CodeとCodex')
  })

  it('asks again when the missing set shrinks after a confirmation', () => {
    const confirmed = chargeConfirmationKey(['claude', 'codex'])
    expect(needsChargeConfirmation(['codex'], confirmed)).toBe(true)
  })
})

describe('missingChargeMessage', () => {
  it('names each unpriced provider', () => {
    expect(missingChargeMessage(['codex'])).toBe(
      'Codexの月額が未入力のため、配賦額は0円になります。このまま進める場合は、もう一度「保存する」を押してください。',
    )
  })
})

describe('providerWithInvertedContract', () => {
  it('accepts an open-ended or ordered contract', () => {
    expect(providerWithInvertedContract({ claude: {}, codex: {} })).toBeUndefined()
    expect(
      providerWithInvertedContract({ claude: { startedOn: '2026-07-18' }, codex: {} }),
    ).toBeUndefined()
    expect(
      providerWithInvertedContract({
        claude: { startedOn: '2026-07-18', endedOn: '2026-07-18' },
        codex: {},
      }),
    ).toBeUndefined()
  })

  it('reports the provider whose end date precedes its start date', () => {
    expect(
      providerWithInvertedContract({
        claude: {},
        codex: { startedOn: '2026-07-01', endedOn: '2026-06-30' },
      }),
    ).toBe('codex')
    expect(invertedContractMessage('codex')).toBe('Codexの契約終了日は、開始日以降にしてください。')
  })
})
