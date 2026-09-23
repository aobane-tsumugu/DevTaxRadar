import { chargeContractStatus, type ProviderChargePeriod } from './chargePeriods.js'

export type ChargeUsageSelector = {
  sourceId: string
  projectKey?: string
  sessionKey?: string
  startedOn?: string
  endedOn?: string
}

/** Attached to the existing invoice correspondence, not a second cost ledger. */
export type ChargeUsageScope = {
  kind: 'all' | 'selected'
  selectors: ChargeUsageSelector[]
  unobservedRatio: number | null
  reason: string
  /** Explicitly distinguish independent, numerically identical records from copies. */
  independentSourceIds?: string[]
}

export type ContractObservation = {
  sourceId: string
  provider: 'claude' | 'codex'
  projectKey: string
  sessionKey: string
  month: string
  startedAt: string
  endedAt: string
  timePrecision?: 'instant' | 'interval' | 'unknown'
  projectLabel?: string | null
  model?: string | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export type ContractUsage<T> = {
  observations: T[]
  unobservedRatio: number | null
  status: 'selected' | 'pending'
  warnings: string[]
}

type Interval = { start: string; end: string }

function overlap(a: Interval, b: Interval): boolean {
  return a.start <= b.end && b.start <= a.end
}

function contains(outer: Interval, inner: Interval): boolean {
  return outer.start <= inner.start && inner.end <= outer.end
}

function interval(period: ProviderChargePeriod): Interval {
  return { start: period.serviceStartedOn, end: period.serviceEndedOn }
}

function contractKey(period: ProviderChargePeriod): string {
  const reference = period.contractConfirmation?.reference.trim()
  return reference && chargeContractStatus(period) === 'confirmed'
    ? JSON.stringify([period.provider, reference])
    : `unknown:${period.id}`
}

function selectionIntervals(
  observation: ContractObservation,
  period: ProviderChargePeriod,
): Interval[] {
  if (observation.provider !== period.provider) return []
  const scope = period.contractConfirmation?.usageScope
  if (!scope || scope.kind === 'all') return [interval(period)]
  return scope.selectors
    .filter(
      (selector) =>
        selector.sourceId === observation.sourceId &&
        (!selector.projectKey || selector.projectKey === observation.projectKey) &&
        (!selector.sessionKey || selector.sessionKey === observation.sessionKey),
    )
    .map((selector) => ({
      start:
        selector.startedOn && selector.startedOn > period.serviceStartedOn
          ? selector.startedOn
          : period.serviceStartedOn,
      end:
        selector.endedOn && selector.endedOn < period.serviceEndedOn
          ? selector.endedOn
          : period.serviceEndedOn,
    }))
    .filter((value) => value.start <= value.end)
}

/** Exact numerical matches are candidates only: never silently deduplicate another PC. */
export function similarSourceGroups<T extends ContractObservation>(
  observations: readonly T[],
): string[][] {
  const candidates = new Map<string, Set<string>>()
  for (const row of observations) {
    if (row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheWriteTokens === 0)
      continue
    const key = JSON.stringify([
      row.provider,
      row.startedAt,
      row.endedAt,
      row.projectLabel ?? null,
      row.model ?? null,
      row.inputTokens,
      row.outputTokens,
      row.cacheReadTokens,
      row.cacheWriteTokens,
    ])
    const sources = candidates.get(key) ?? new Set<string>()
    sources.add(row.sourceId)
    candidates.set(key, sources)
  }
  const unique = new Map<string, string[]>()
  for (const sources of candidates.values()) {
    if (sources.size < 2) continue
    const ids = [...sources].sort()
    unique.set(JSON.stringify(ids), ids)
  }
  return [...unique.values()]
}

/**
 * Select a real contract's denominator without changing any charge amount.
 * A session aggregate crossing a selected date boundary is not a timestamped
 * usage delta. Retain the invoice as pending rather than inventing a split.
 */
export function selectContractUsage<T extends ContractObservation>(
  period: ProviderChargePeriod,
  periods: readonly ProviderChargePeriod[],
  observations: readonly T[],
  month: string,
  legacyRatio: number | null,
  localDate: (timestamp: string) => string | undefined,
): ContractUsage<T> {
  const warnings: string[] = []
  const scope = period.contractConfirmation?.usageScope
  const peers = periods.filter(
    (other) =>
      other.id !== period.id &&
      other.provider === period.provider &&
      overlap(interval(period), interval(other)) &&
      other.serviceStartedOn.slice(0, 7) <= month &&
      other.serviceEndedOn.slice(0, 7) >= month,
  )
  const pending = (message: string): ContractUsage<T> => ({
    observations: [],
    unobservedRatio: null,
    status: 'pending',
    warnings: [...warnings, message],
  })
  if (scope && chargeContractStatus(period) === 'changed') {
    return pending(
      '請求の期間・金額が契約対応の確認時から変わっています。履歴範囲と対応を再確認するまで原額を配分未算定として保持します。',
    )
  }
  if (!scope && peers.some((other) => contractKey(other) !== contractKey(period))) {
    return pending(
      '期間が重なる契約の履歴範囲が未指定です。別契約と確認しただけでは分母を共有せず、この請求の原額を配分未算定として保持します。',
    )
  }
  if (scope?.kind === 'selected' && scope.selectors.length === 0) {
    return pending('この契約に対応する取得元・フォルダ・会話が未選択です。原額を保持しています。')
  }
  const selected: T[] = []
  let ambiguous = false
  for (const row of observations) {
    if (row.provider !== period.provider) continue
    const choices = selectionIntervals(row, period)
    if (choices.length === 0) continue
    const start = localDate(row.startedAt)
    const end = localDate(row.endedAt)
    // Unknown timing is not made precise by a stored month derived from a
    // session start. It can affect later invoices for this same selected use.
    if (row.timePrecision === 'unknown') {
      const nonzero =
        row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheWriteTokens > 0
      if (nonzero && (!start || choices.some((range) => range.end >= start)))
        return pending(
          '選択した履歴に利用時点が不明な数値があります。会話開始月を利用月とみなさず、原額を配分未算定として保持します。時点付き履歴の再取得または対象会話の対応を確認してください。',
        )
      continue
    }
    if (row.month !== month) continue
    if (!start || !end || end < start) {
      ambiguous = true
      continue
    }
    const span = { start, end }
    if (!choices.some((range) => overlap(range, span))) continue
    if (!choices.some((range) => contains(range, span))) {
      ambiguous = true
      continue
    }
    const conflicts = peers.filter((other) => {
      if (contractKey(other) === contractKey(period)) return false
      // An unspecified peer stays pending on its own; do not erase an
      // independently specified contract because another one is incomplete.
      if (!other.contractConfirmation?.usageScope) return false
      return selectionIntervals(row, other).some((range) => overlap(range, span))
    })
    if (conflicts.length > 0) {
      return pending(
        '同じ取得記録が異なる契約の履歴範囲に重複しています。原額は除外せず、各契約の対応が分かるまで配分を保留します。',
      )
    }
    selected.push(row)
  }
  if (ambiguous) {
    return pending(
      '履歴の集計期間が契約・選択期間の境界をまたいでいます。時点別利用量がない部分を開始日や日数へ推測配分せず、原額を配分未算定として保持します。',
    )
  }
  if (
    similarSourceGroups(selected).some((group) =>
      group.some((id) => !scope?.independentSourceIds?.includes(id)),
    )
  ) {
    return pending(
      '複数取得元に日時・利用量が一致する記録があります。コピーなら正本の取得元だけを選び、独立した利用なら契約の履歴範囲でその旨を確認してください。自動で削除・合算していません。',
    )
  }
  if (scope) {
    warnings.push(
      `契約別の履歴範囲：${scope.kind === 'all' ? 'このサービスの全取得記録' : '選択した取得元・フォルダ・会話'}。捕捉外割合：${scope.unobservedRatio === null ? '不明' : `${scope.unobservedRatio * 100}%`}。根拠：${scope.reason.trim() || '未記入'}。`,
    )
    if (scope.independentSourceIds?.length)
      warnings.push(
        '日時・利用量が一致する別取得元の記録を、本人が独立した利用として扱っています。',
      )
  } else {
    warnings.push(
      '単一契約として既存の取得範囲・捕捉外割合を使用しています。既存割合を、この期間について確認済みの事実と断定していません。',
    )
  }
  return {
    observations: selected,
    unobservedRatio: scope ? scope.unobservedRatio : legacyRatio,
    status: 'selected',
    warnings,
  }
}
