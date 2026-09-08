import { expect, it } from 'vitest'
import { chargeContractBasis, chargeContractStatus, distinctChargeContracts, type ProviderChargePeriod } from '../../src/core/chargePeriods.js'
import { configurationSchema } from '../../src/server/configurationSchema.js'
const invoice: ProviderChargePeriod = { id: 'a', provider: 'claude', planName: '合成プラン', serviceStartedOn: '2026-01-01', serviceEndedOn: '2026-01-31', amountJpy: 1000, evidenceIds: ['e2', 'e1'] }
function confirmed(id: string, reference: string): ProviderChargePeriod {
  const period = { ...invoice, id }
  return { ...period, contractConfirmation: { reference, reason: '各契約の明細を照合', confirmedAt: '2026-09-09T00:00:00Z', basis: chargeContractBasis(period) } }
}
it('requires confirmed distinct references and reopens on invoice or evidence changes', () => {
  const a = confirmed('a', '業務契約'), b = confirmed('b', '検証契約')
  expect(distinctChargeContracts([a,b])).toBe(true)
  expect(distinctChargeContracts([a,confirmed('b','業務契約')])).toBe(false)
  expect(distinctChargeContracts([a,{...invoice,id:'b'}])).toBe(false)
  for (const patch of [{ amountJpy: 2000 }, { planName: '改訂プラン' }, { serviceEndedOn: '2026-02-01' }, { evidenceIds: ['e1'] }, { billedOn: '2026-02-01' }, { note: '明細訂正' }]) {
    expect(chargeContractStatus({...a,...patch})).toBe('changed')
    expect(distinctChargeContracts([{...a,...patch},b])).toBe(false)
  }
  expect(chargeContractStatus({...a,evidenceIds:['e1','e2']})).toBe('confirmed')
  expect(a.contractConfirmation!.basis.amountJpy).toBe(1000)
})
it('allows recoverable drafts but requires a reason and a valid independent snapshot for confirmation', () => {
  const config = { charges:{claude:0,codex:0}, monthlyCharges:[], contracts:{claude:{},codex:{}}, unobservedRatio:null, chargePeriods:[confirmed('a','業務契約')] }
  expect(configurationSchema.safeParse(config).success).toBe(true)
  const record = config.chargePeriods[0]!.contractConfirmation!
  record.reason = ''
  expect(configurationSchema.safeParse(config).success).toBe(false)
  delete record.confirmedAt
  expect(configurationSchema.safeParse(config).success).toBe(true)
  expect(chargeContractStatus(config.chargePeriods[0]!)).toBe('draft')
  record.basis.serviceEndedOn = '2026-02-30'
  expect(configurationSchema.safeParse(config).success).toBe(false)
})
