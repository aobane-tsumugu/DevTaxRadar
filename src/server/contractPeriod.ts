import type { ProviderContract } from './database.js'

// 'YYYY-MM-DD' is fixed width, so lexicographic order equals chronological
// order. No Date object is constructed here: parsing would reintroduce the
// timezone shift that section 5.1 of the design removed.
export function contractCoversDate(contract: ProviderContract | undefined, date: string): boolean {
  if (contract?.startedOn && date < contract.startedOn) return false
  if (contract?.endedOn && date > contract.endedOn) return false
  return true
}

export function contractCoversMonth(
  contract: ProviderContract | undefined,
  month: string,
): boolean {
  // Any real date inside `month` sorts between these two bounds, so the month
  // overlaps the contract unless it falls entirely outside it.
  const firstPossibleDay = `${month}-01`
  const lastPossibleDay = `${month}-31`
  if (contract?.startedOn && contract.startedOn > lastPossibleDay) return false
  if (contract?.endedOn && contract.endedOn < firstPossibleDay) return false
  return true
}

export function hasAnyContractPeriod(
  contracts: Record<'claude' | 'codex', ProviderContract>,
): boolean {
  return (['claude', 'codex'] as const).some(
    (provider) => Boolean(contracts[provider]?.startedOn) || Boolean(contracts[provider]?.endedOn),
  )
}
