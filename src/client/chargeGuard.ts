import type { ProviderContract, ProviderKey } from './types.js'

const PROVIDER_ORDER: ProviderKey[] = ['claude', 'codex']

export const providerDisplayName = (provider: ProviderKey): string =>
  provider === 'claude' ? 'Claude Code' : 'Codex'

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
