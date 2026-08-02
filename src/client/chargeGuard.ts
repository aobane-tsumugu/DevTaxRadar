import type { ProviderContract, ProviderKey } from './types.js'

const PROVIDER_ORDER: ProviderKey[] = ['claude', 'codex']

export const providerDisplayName = (provider: ProviderKey): string =>
  provider === 'claude' ? 'Claude Code' : 'Codex'

/**
 * Providers the user is scanning but has not priced yet. A provider whose
 * history is not being read does not need a charge.
 */
export function missingChargeProviders(
  selectedProviders: ProviderKey[],
  charges: Record<ProviderKey, number | undefined>,
): ProviderKey[] {
  return PROVIDER_ORDER.filter(
    (provider) => selectedProviders.includes(provider) && charges[provider] === undefined,
  )
}

/**
 * Identifies WHICH providers a confirmation covered. A bare boolean goes stale:
 * confirm an empty Claude charge, then re-select Codex on an earlier step, and
 * a boolean would let Codex save as 0 yen without ever being named.
 */
export function chargeConfirmationKey(missingProviders: ProviderKey[]): string {
  return missingProviders.join(',')
}

export function needsChargeConfirmation(
  missingProviders: ProviderKey[],
  confirmedKey: string | null,
): boolean {
  if (missingProviders.length === 0) return false
  return confirmedKey !== chargeConfirmationKey(missingProviders)
}

export function missingChargeMessage(missingProviders: ProviderKey[]): string {
  return `${missingProviders
    .map(providerDisplayName)
    .join(
      'と',
    )}の月額が未入力のため、配賦額は0円になります。このまま進める場合は、もう一度「保存する」を押してください。`
}

/**
 * The first provider whose contract ends before it starts, or undefined when
 * every contract is consistent. Dates are 'YYYY-MM-DD', so a string comparison
 * is a chronological comparison.
 */
export function providerWithInvertedContract(
  contracts: Record<ProviderKey, ProviderContract>,
): ProviderKey | undefined {
  return PROVIDER_ORDER.find((provider) => {
    const contract = contracts[provider]
    return Boolean(contract.startedOn && contract.endedOn && contract.startedOn > contract.endedOn)
  })
}

export function invertedContractMessage(provider: ProviderKey): string {
  return `${providerDisplayName(provider)}の契約終了日は、開始日以降にしてください。`
}
