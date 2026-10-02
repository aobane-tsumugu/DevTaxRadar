import type { PlanningSnapshot } from '../planning/types.js'
import type { AnnualCostProjection } from '../accounting/costs.js'
import type { BalanceSnapshot } from '../accounting/types.js'
import {
  activeUnitLinks,
  activityKindLabels,
  activityPurposeLabels,
  activityStateLabels,
  activityOverlaps,
  activityTimeLabel,
  type ActivityFact,
} from '../planning/activityFacts.js'

const legacyKinds: Record<string, string> = {
  'development-started': '開発開始',
  'evaluation-started': '評価開始',
  'internal-use-started': '内部利用開始',
  'external-released': '外部公開',
  'first-sale': '初回販売',
  'improvement-started': '改良開始',
  retired: '利用終了',
  abandoned: '開発中止',
}
export type TimelineEntry = {
  id: string
  taxUnitId?: string
  title: string
  time: string
  sortOn: string
  state: string
  scope: string
  reason: string
  evidenceIds: string[]
  recordedAt?: string
  correctsId?: string
  correctedById?: string
  correctionReason?: string
  costs: Array<{
    year: number
    basisId: string
    contributionId: string
    amountJpy: number | null
    sourceIds: string[]
  }>
}
export function projectProductTimeline(
  planning: PlanningSnapshot,
  projections: AnnualCostProjection[] = [],
  balances?: BalanceSnapshot,
) {
  const ledger = planning.activityLedger
  const explicit = ledger?.products ?? []
  const linked = new Set((ledger ? activeUnitLinks(ledger) : []).map((row) => row.taxUnitId))
  const products = [
    ...explicit.map((product) => ({
      ...product,
      legacy: false,
      unitIds: activeUnitLinks(ledger!)
        .filter((row) => row.productId === product.id)
        .map((row) => row.taxUnitId),
    })),
    ...planning.taxUnits
      .filter((unit) => !linked.has(unit.id))
      .map((unit) => ({
        id: `legacy:${unit.id}`,
        name: unit.name,
        legacy: true,
        unitIds: [unit.id],
      })),
  ]
  return products.map((product) => {
    const entries: TimelineEntry[] = []
    const costsFor = (unitIds: string[], fact?: ActivityFact) =>
      projections.flatMap((costs) =>
        costs.contributions.flatMap((row) => {
          const basis = costs.bases.find((basis) => basis.id === row.basisId)
          return row.target.kind === 'tax-unit' &&
            unitIds.includes(row.target.taxUnitId) &&
            !row.consumedByBasisId &&
            basis &&
            (!fact || activityOverlaps(fact, basis.period.startedOn, basis.period.endedOn))
            ? [
                {
                  year: costs.year,
                  basisId: row.basisId,
                  contributionId: row.id,
                  amountJpy: row.amountJpy,
                  sourceIds: row.sourceIds,
                },
              ]
            : []
        }),
      )
    for (const fact of ledger?.facts.filter((row) => row.productId === product.id) ?? [])
      entries.push({
        id: fact.id,
        taxUnitId: fact.taxUnitId,
        title: `${activityKindLabels[fact.kind]} / ${activityPurposeLabels[fact.purpose]}`,
        time: activityTimeLabel(fact),
        sortOn:
          fact.time.kind === 'date'
            ? fact.time.occurredOn
            : fact.time.kind === 'period'
              ? fact.time.startedOn
              : '',
        state: activityStateLabels[fact.state],
        scope: fact.scope,
        reason: fact.reason,
        evidenceIds: fact.evidenceIds,
        recordedAt: fact.recordedAt,
        correctsId: fact.correctsId,
        correctionReason: fact.correctionReason,
        correctedById: ledger?.facts.find((row) => row.correctsId === fact.id)?.id,
        costs: costsFor(fact.taxUnitId ? [fact.taxUnitId] : product.unitIds, fact),
      })
    for (const event of planning.lifecycleEvents.filter((row) =>
      product.unitIds.includes(row.taxUnitId),
    ))
      entries.push({
        id: `legacy-event:${event.id}`,
        taxUnitId: event.taxUnitId,
        title: legacyKinds[event.eventType] ?? event.eventType,
        time: event.occurredOn,
        sortOn: event.occurredOn,
        state: '旧記録（確認状態なし）',
        scope: '従来の出来事',
        reason: event.note ?? '',
        evidenceIds: event.evidenceIds,
        recordedAt: event.recordedAt,
        costs: [],
      })
    for (const rule of planning.projectRules.filter(
      (row) => row.taxUnitId && product.unitIds.includes(row.taxUnitId),
    ))
      entries.push({
        id: `legacy-rule:${rule.id}`,
        taxUnitId: rule.taxUnitId,
        title: `履歴の期間分類：${activityPurposeLabels[rule.classification as keyof typeof activityPurposeLabels] ?? rule.classification}`,
        time: `${rule.effectiveFrom} ～ ${rule.effectiveTo ?? '終了未指定'}`,
        sortOn: rule.effectiveFrom,
        state: '旧分類（事実確認なし）',
        scope: '利用履歴の割当期間',
        reason: rule.reason ?? '',
        evidenceIds: [],
        costs: [],
      })
    for (const condition of planning.costTreatmentFacts ?? []) {
      try {
        const basis = JSON.parse(condition.costBasis) as { unit?: { id?: string } }
        if (basis.unit?.id && product.unitIds.includes(basis.unit.id))
          entries.push({
            id: `legacy-treatment:${condition.id}`,
            taxUnitId: basis.unit.id,
            title: '費用の処理条件（独立した活動確認ではありません）',
            time: `${condition.costYear}年`,
            sortOn: `${condition.costYear}-01-01`,
            state: '条件の入力記録',
            scope: condition.workPurpose,
            reason: condition.reason,
            evidenceIds: condition.evidenceIds,
            recordedAt: condition.recordedAt,
            costs: [],
          })
      } catch {
        /* A corrupt cost basis remains invalid in its own validator. */
      }
    }
    return {
      ...product,
      costYears: projections.map((cost) => cost.year),
      units: planning.taxUnits.filter((unit) => product.unitIds.includes(unit.id)),
      entries: entries.sort((a, b) => a.sortOn.localeCompare(b.sortOn) || a.id.localeCompare(b.id)),
      costs: costsFor(product.unitIds),
      unknownCosts: projections.flatMap((costs) =>
        costs.bases
          .filter(
            (basis) =>
              basis.amount.status === 'unknown' &&
              basis.affectedTaxUnitIds.some((id) => product.unitIds.includes(id)),
          )
          .map((basis) => ({
            year: costs.year,
            basisId: basis.id,
            reasons: basis.amount.status === 'unknown' ? basis.amount.reasons : [],
          })),
      ),
      movements:
        balances?.movements.filter((row) => {
          const ids =
            row.kind === 'transfer' ? [row.fromAccountId, row.toAccountId] : [row.accountId]
          return balances.accounts.some(
            (account) => ids.includes(account.id) && product.unitIds.includes(account.taxUnitId),
          )
        }) ?? [],
      decisions: planning.decisions.filter((row) => product.unitIds.includes(row.taxUnitId)),
      accounts: balances?.accounts.filter((row) => product.unitIds.includes(row.taxUnitId)) ?? [],
      pending:
        balances?.pendingDecisions.filter((row) => product.unitIds.includes(row.taxUnitId)) ?? [],
    }
  })
}
export type ProductTimeline = ReturnType<typeof projectProductTimeline>
