import { describe, expect, it } from 'vitest'
import {
  invertedContractMessage,
  providerWithInvertedContract,
} from '../../src/client/chargeGuard.ts'

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
