import type { DashboardData } from './types.js'
import type { PlanningSnapshot, ProjectRuleRecord, TaxUnitRecord } from '../planning/types.js'
import { ruleId } from './pages/shared.js'

type ExistingCandidateTarget = { existingTaxUnitId?: string }

export type CandidateDestination = ExistingCandidateTarget &
  ({ kind: 'product'; group: string } | { kind: 'private' | 'learning' | 'later' })

export type CandidateDestinations = Record<string, CandidateDestination>

export type HistoryCandidate = DashboardData['products'][number]

export function candidateGroupByTaxUnit(taxUnits: TaxUnitRecord[]): Map<string, string> {
  const result = new Map<string, string>()
  const reserved = new Set<string>()
  for (const unit of taxUnits) {
    const savedGroup = unit.id.match(/^tax-unit-history-group-(\d+)$/)?.[1]
    if (!savedGroup) continue
    result.set(unit.id, savedGroup)
    reserved.add(savedGroup)
  }

  let nextGroup = 1
  for (const unit of taxUnits) {
    if (result.has(unit.id)) continue
    while (reserved.has(String(nextGroup))) nextGroup += 1
    const group = String(nextGroup)
    result.set(unit.id, group)
    reserved.add(group)
    nextGroup += 1
  }
  return result
}

export function normalizedProductGroup(value: string): string | undefined {
  const normalized = value.trim().replace(/^0+/, '')
  if (!/^\d+$/.test(normalized) || normalized === '0') return undefined
  return normalized
}

function firstObservedOn(candidate: HistoryCandidate, taxYear: number): string {
  return (
    candidate.firstObservedAt?.slice(0, 10) ??
    (candidate.firstObservedMonth ? `${candidate.firstObservedMonth}-01` : `${taxYear}-01-01`)
  )
}

function historyUnitId(group: string): string {
  return `tax-unit-history-group-${group}`
}

function destinationRule(
  candidate: HistoryCandidate,
  destination: CandidateDestination,
  taxYear: number,
  taxUnitIdByGroup: Map<string, string>,
): ProjectRuleRecord | undefined {
  if (!candidate.projectKey) return undefined
  const effectiveFrom = firstObservedOn(candidate, taxYear)
  if (destination.kind === 'product') {
    const group = normalizedProductGroup(destination.group)
    if (!group) return undefined
    return {
      id: ruleId(candidate.projectKey, effectiveFrom),
      projectKey: candidate.projectKey,
      effectiveFrom,
      taxUnitId: taxUnitIdByGroup.get(group) ?? historyUnitId(group),
      classification: 'new-development',
      reason: `履歴候補のグループ${group}として登録`,
    }
  }
  if (destination.kind === 'later') return undefined
  return {
    id: ruleId(candidate.projectKey, effectiveFrom),
    projectKey: candidate.projectKey,
    effectiveFrom,
    classification: destination.kind === 'private' ? 'private' : 'general-learning',
    reason:
      destination.kind === 'private'
        ? '履歴候補を私用として登録'
        : '履歴候補を一般的な学習として登録',
  }
}

function newHistoryUnit(group: string, representative: HistoryCandidate): TaxUnitRecord {
  return {
    id: historyUnitId(group),
    name: representative.name,
    unitType: 'new-software',
    usageMode: 'undecided',
    revenueModel: 'undecided',
    lifecycleStatus: 'developing',
    journeyMode: 'retrospective',
    monetizationStatus: 'none',
    sameAsExternalVersion: 'undecided',
    notes: `履歴候補のグループ${group}から作成。正式名称・用途・状態は利用者確認が必要。`,
  }
}

/**
 * Materializes gesture-independent candidate destinations. A future drag-and-drop
 * UI can produce the same structure without changing saved tax units or rules.
 * The default rule starts at the first observed day; later effective-dated rules
 * are preserved so an existing accounting-phase split is never flattened here.
 */
export function applyCandidateDestinations(
  snapshot: PlanningSnapshot,
  candidates: HistoryCandidate[],
  destinations: CandidateDestinations,
): PlanningSnapshot {
  const grouped = new Map<string, HistoryCandidate[]>()
  const taxUnitIdByGroup = new Map<string, string>()
  for (const candidate of candidates) {
    if (!candidate.projectKey) continue
    const destination = destinations[candidate.projectKey]
    if (!destination || destination.kind !== 'product') continue
    const group = normalizedProductGroup(destination.group)
    if (!group) continue
    grouped.set(group, [...(grouped.get(group) ?? []), candidate])
    if (destination.existingTaxUnitId && !taxUnitIdByGroup.has(group)) {
      taxUnitIdByGroup.set(group, destination.existingTaxUnitId)
    }
  }

  const taxUnits = [...snapshot.taxUnits]
  for (const [group, members] of grouped) {
    const id = taxUnitIdByGroup.get(group) ?? historyUnitId(group)
    if (taxUnits.some((unit) => unit.id === id)) continue
    const representative = [...members].sort((left, right) => right.sessions - left.sessions)[0]
    if (representative) taxUnits.push(newHistoryUnit(group, representative))
  }

  const nextRules = new Map(snapshot.projectRules.map((rule) => [rule.id, rule]))
  for (const candidate of candidates) {
    if (!candidate.projectKey) continue
    const destination = destinations[candidate.projectKey]
    if (!destination) continue
    if (destination.kind === 'later') {
      const firstEffectiveFrom = [...nextRules.values()]
        .filter((rule) => rule.projectKey === candidate.projectKey)
        .sort((left, right) =>
          left.effectiveFrom.localeCompare(right.effectiveFrom),
        )[0]?.effectiveFrom
      for (const [id, rule] of nextRules) {
        if (rule.projectKey === candidate.projectKey && rule.effectiveFrom === firstEffectiveFrom) {
          nextRules.delete(id)
        }
      }
      continue
    }
    const next = destinationRule(candidate, destination, snapshot.profile.taxYear, taxUnitIdByGroup)
    if (next) {
      for (const [id, rule] of nextRules) {
        if (rule.projectKey === next.projectKey && rule.effectiveFrom === next.effectiveFrom) {
          nextRules.delete(id)
        }
      }
      nextRules.set(next.id, next)
    }
  }

  return { ...snapshot, taxUnits, projectRules: [...nextRules.values()] }
}

export function destinationSummary(destinations: CandidateDestinations): {
  products: number
  privateItems: number
  learningItems: number
  laterItems: number
} {
  const productGroups = new Set<string>()
  let privateItems = 0
  let learningItems = 0
  let laterItems = 0
  for (const destination of Object.values(destinations)) {
    if (destination.kind === 'product') {
      const group = normalizedProductGroup(destination.group)
      if (group) productGroups.add(group)
    } else if (destination.kind === 'private') privateItems += 1
    else if (destination.kind === 'learning') learningItems += 1
    else laterItems += 1
  }
  return { products: productGroups.size, privateItems, learningItems, laterItems }
}
