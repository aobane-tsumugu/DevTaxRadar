import type { AnnualCostProjection } from '../accounting/costs.js'
import type { BalanceReview } from '../accounting/balanceWorkspace.js'
import type { BalanceSnapshot } from '../accounting/types.js'
import type { PlanningSnapshot } from '../planning/types.js'
import type { BalanceUseSource } from './balanceUseDraft.js'

export type SoftwareAcquisitionBasis = {
  engineVersion: 'software-acquisition-basis/1'
  occurredOn: string
  constructionAccountId: string
  taxUnitId: string
  status: 'ready' | 'needs-review' | 'empty'
  /** A known balance subtotal is not necessarily a complete acquisition amount. */
  knownSubtotalJpy: number
  amountJpy: number | null
  sources: BalanceUseSource[]
  lots: {
    costYear: number
    contributionId: string
    amountJpy: number
    sourceIds: string[]
    label: string
  }[]
  openingReferences: { kind: 'external' | 'review'; id: string; amountJpy: number }[]
  unresolved: string[]
  unincorporated: { costYear: number; contributionId: string; amountJpy: number }[]
  automaticPosting: false
}

const key = (year: number, id: string) => JSON.stringify([year, id])
const sourceKey = (row: Pick<BalanceUseSource, 'sourceKind' | 'sourceId'>) =>
  JSON.stringify([row.sourceKind, row.sourceId])
function safeAdd(left: number, right: number): number {
  if (!Number.isSafeInteger(right) || right < 0 || !Number.isSafeInteger(left + right))
    throw new Error('ソフトウェア原価の金額が不正か、安全な整数円を超えています。')
  return left + right
}

/**
 * Summarize the existing engine's remaining pools. The production wrapper supplies
 * balanceUseSources, externalOpeningIssues and confirmed decision IDs; this function
 * neither reimplements stock accounting nor accepts an HTTP body's claimed totals.
 */
export function assembleSoftwareAcquisitionBasis(input: {
  snapshot: BalanceSnapshot
  planning: PlanningSnapshot
  costs: AnnualCostProjection[]
  occurredOn: string
  constructionAccountId: string
  remaining: BalanceUseSource[]
  openingProblems: { accountId: string; message: string }[]
  confirmedDecisionIds: string[]
  openingReviews: BalanceReview[]
}): SoftwareAcquisitionBasis {
  const { snapshot, planning, costs, occurredOn, constructionAccountId } = input
  const accounts = snapshot.accounts.filter((row) => row.id === constructionAccountId)
  const account = accounts[0]
  if (accounts.length !== 1 || !account || account.kind !== 'construction')
    throw new Error('ソフトウェアの制作中原価を持つ残高を一つ選んでください。')
  const unit = planning.taxUnits.find((row) => row.id === account.taxUnitId)
  if (!unit || !['new-software', 'improvement-plan'].includes(unit.unitType))
    throw new Error('ソフトウェアまたは改良計画の制作中原価を選んでください。')
  const date = new Date(occurredOn + 'T00:00:00Z')
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(occurredOn) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== occurredOn
  )
    throw new Error('製作完了・振替の日付を確認してください。')
  const year = Number(occurredOn.slice(0, 4))
  const sources = input.remaining.filter(
    (row) => row.accountId === account.id && row.availableOn <= occurredOn && row.amountJpy !== 0,
  )
  if (new Set(sources.map(sourceKey)).size !== sources.length)
    throw new Error('同じ未費用化原価が重複しています。')
  const projections = new Map<number, AnnualCostProjection>()
  for (const projection of costs) {
    if (projections.has(projection.year)) throw new Error('同じ年度の原価資料が重複しています。')
    projections.set(projection.year, projection)
  }
  const report: SoftwareAcquisitionBasis = {
    engineVersion: 'software-acquisition-basis/1',
    occurredOn,
    constructionAccountId,
    taxUnitId: unit.id,
    status: 'empty',
    knownSubtotalJpy: 0,
    amountJpy: null,
    sources: structuredClone(sources),
    lots: [],
    openingReferences: [],
    unresolved: [],
    unincorporated: [],
    automaticPosting: false,
  }
  const unresolved = report.unresolved
  const otherAccounts = new Set(
    snapshot.accounts
      .filter(
        (row) => row.kind === 'construction' && row.taxUnitId === unit.id && row.id !== account.id,
      )
      .map((row) => row.id),
  )
  if (
    input.remaining.some(
      (row) =>
        otherAccounts.has(row.accountId) && row.availableOn <= occurredOn && row.amountJpy !== 0,
    )
  )
    unresolved.push(
      '同じソフトウェアの別の制作中残高にも原価があります。取得価額の一部だけを全体とせず、既存の振替で対象範囲を整理してください。',
    )
  const selectedKeys = new Set(sources.map(sourceKey))
  if (
    snapshot.movements.some(
      (row) =>
        row.kind !== 'addition' &&
        row.occurredOn > occurredOn &&
        (row.balanceAllocations ?? []).some(
          (link) => selectedKeys.has(sourceKey(link)) && link.amountJpy > 0,
        ),
    )
  )
    unresolved.push(
      'この原価の一部が後日付の使用に予約されています。全体の取得原価を確定する前に、既存の後年度移動との対応を確認してください。',
    )
  const lots = new Map<string, SoftwareAcquisitionBasis['lots'][number]>()
  let hasCoveredOpening = false
  for (const source of sources) {
    if (source.amountJpy === null) unresolved.push(`${source.sourceId}: 使用可能額が不明です。`)
    else report.knownSubtotalJpy = safeAdd(report.knownSubtotalJpy, source.amountJpy)
    let traced = 0
    for (const lot of source.lots) {
      if (lot.remainingJpy === null) {
        unresolved.push(`${lot.costYear}年 ${lot.contributionId}: 原価内訳の残額が不明です。`)
        continue
      }
      if (lot.remainingJpy === 0) continue
      traced = safeAdd(traced, lot.remainingJpy)
      const projection = projections.get(lot.costYear)
      const found = projection?.contributions.filter((row) => row.id === lot.contributionId) ?? []
      const cost = found[0]
      if (
        !cost ||
        found.length !== 1 ||
        cost.consumedByBasisId ||
        cost.target.kind !== 'tax-unit'
      ) {
        unresolved.push(
          `${lot.costYear}年 ${lot.contributionId}: 最終原価への参照を確認できません。`,
        )
        continue
      }
      const costBasis = projection!.bases.find((row) => row.id === cost.basisId)
      if (!costBasis || costBasis.period.endedOn > occurredOn)
        unresolved.push(
          `${lot.costYear}年 ${lot.contributionId}: 振替日までの原価期間を確認してください。`,
        )
      const costSources = cost.sourceIds.map((id) =>
        projection!.sources.find((row) => row.id === id),
      )
      if (
        costSources.some((row) => !row) ||
        [...cost.evidenceIds, ...costSources.flatMap((row) => row?.evidenceIds ?? [])].some(
          (id) => !planning.evidence.some((row) => row.id === id),
        )
      )
        unresolved.push(
          `${lot.costYear}年 ${lot.contributionId}: 原価の出典・証拠参照が欠けています。`,
        )
      const id = key(lot.costYear, lot.contributionId)
      const old = lots.get(id)
      const amount = safeAdd(old?.amountJpy ?? 0, lot.remainingJpy)
      if (amount > cost.amountJpy) throw new Error('同じ原価を元の配分額より多く集約できません。')
      lots.set(id, {
        costYear: lot.costYear,
        contributionId: lot.contributionId,
        amountJpy: amount,
        sourceIds: [...cost.sourceIds],
        label: cost.sourceIds
          .map(
            (sourceId) => projection!.sources.find((row) => row.id === sourceId)?.label ?? sourceId,
          )
          .join(' / '),
      })
    }
    if (source.amountJpy !== null && traced > source.amountJpy)
      throw new Error('原価内訳が対応元の残高を超えています。')
    if (source.untracedJpy === 0) {
      if (source.amountJpy !== null && traced !== source.amountJpy)
        unresolved.push(`${source.sourceId}: 残高と原価内訳の合計が一致しません。`)
      continue
    }
    if (
      source.sourceKind !== 'opening' ||
      source.sourceId !== account.id ||
      source.amountJpy === null
    ) {
      unresolved.push(`${source.sourceId}: 原価を追跡できない残額を含みます。`)
      continue
    }
    // Openings stand in place of their old costs; never add those old costs again.
    if (account.openingRevisionId) {
      const reviews = input.openingReviews.filter((row) => row.id === account.openingRevisionId)
      const prior = reviews[0]
      const old = prior?.projection.accounts.filter((row) => row.accountId === account.id) ?? []
      if (
        reviews.length !== 1 ||
        prior?.year !== account.openingYear - 1 ||
        old.length !== 1 ||
        old[0]!.taxUnitId !== unit.id ||
        old[0]!.kind !== 'construction' ||
        old[0]!.closing.status !== 'known' ||
        account.opening.status !== 'known' ||
        old[0]!.closing.amountJpy !== account.opening.amountJpy
      ) {
        unresolved.push('期首が参照する採用版と、その制作中期末額を確認してください。')
        continue
      }
      report.openingReferences.push({ kind: 'review', id: prior.id, amountJpy: source.amountJpy })
      hasCoveredOpening = true
    } else {
      const records = snapshot.pendingDecisions.filter(
        (row) =>
          row.id.startsWith('external-opening:') &&
          row.accountIds.length === 1 &&
          row.accountIds[0] === account.id,
      )
      const record = records[0]
      if (
        records.length !== 1 ||
        !record?.resolution ||
        !input.confirmedDecisionIds.includes(record.resolution.decisionId) ||
        input.openingProblems.some((row) => row.accountId === account.id) ||
        !record.sourceIds.length ||
        record.sourceIds.some((id) => !planning.evidence.some((row) => row.id === id))
      ) {
        unresolved.push(
          '外部期首の出典・本人確認・金額の意味を、既存の外部期首確認でそろえてください。',
        )
        continue
      }
      report.openingReferences.push({
        kind: 'external',
        id: record.id,
        amountJpy: source.amountJpy,
      })
      hasCoveredOpening = true
    }
  }
  report.lots = [...lots.values()].sort(
    (a, b) => a.costYear - b.costYear || a.contributionId.localeCompare(b.contributionId, 'en'),
  )
  if (hasCoveredOpening && report.lots.some((row) => row.costYear < account.openingYear))
    unresolved.push(
      '期首に含む期間の原価を別の増加としても集約しています。期首と明細を二重に加算しないよう対応を確認してください。',
    )

  // Do not treat a known small stock subtotal as the whole software price while
  // costs for that software remain unknown or have not yet been incorporated.
  const claims = new Map<string, number>()
  for (const movement of snapshot.movements)
    if (movement.kind === 'addition') {
      for (const lot of movement.costAllocations ?? []) {
        const id = key(lot.costYear, lot.contributionId)
        claims.set(id, safeAdd(claims.get(id) ?? 0, lot.amountJpy))
      }
    }
  for (const projection of costs.filter((row) => row.year <= year)) {
    if (hasCoveredOpening && projection.year < account.openingYear) continue
    for (const basis of projection.bases) {
      if (
        basis.amount.status === 'unknown' &&
        basis.period.startedOn <= occurredOn &&
        basis.affectedTaxUnitIds.includes(unit.id)
      )
        unresolved.push(
          `${projection.year}年 ${basis.id}: 対象ソフトウェアに未算定の原価があります。`,
        )
    }
    for (const cost of projection.contributions) {
      if (
        cost.consumedByBasisId ||
        cost.target.kind !== 'tax-unit' ||
        cost.target.taxUnitId !== unit.id
      )
        continue
      const basis = projection.bases.find((row) => row.id === cost.basisId)
      if (!basis || basis.period.startedOn > occurredOn) continue
      const unclaimed = cost.amountJpy - (claims.get(key(projection.year, cost.id)) ?? 0)
      if (unclaimed <= 0) continue
      const treatment = projection.treatments?.items.find((row) => row.contributionId === cost.id)
      if (treatment?.status === 'conditional' && treatment.candidate === 'ordinary-expense')
        continue
      report.unincorporated.push({
        costYear: projection.year,
        contributionId: cost.id,
        amountJpy: unclaimed,
      })
    }
  }
  if (report.unincorporated.length)
    unresolved.push(
      '対象ソフトウェアへの配分に、制作中原価へまだ組み入れていない部分があります。全体額の確認前に既存の原価取り込み・分類で整理してください。',
    )
  report.unresolved = [...new Set(unresolved)]
  report.status = report.unresolved.length
    ? 'needs-review'
    : sources.length && report.knownSubtotalJpy > 0
      ? 'ready'
      : 'empty'
  report.amountJpy = report.status === 'ready' ? report.knownSubtotalJpy : null
  return report
}
