import {
  costSnapshotSchema,
  type AnnualCostProjection,
  type CostBasis,
  type CostSnapshot,
} from '../accounting/costs.js'

import { evaluateSourceAdjustments } from './sourceAdjustments.js'

export class CostProjectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CostProjectionError'
  }
}
function fail(message: string): never {
  throw new CostProjectionError(message)
}
function sum(values: number[]): number {
  return values.reduce((total, value) => {
    const result = total + value
    if (!Number.isSafeInteger(result)) fail('費用の合計が扱える整数円を超えました。')
    return result
  }, 0)
}
function unique(records: Array<{ id: string }>, label: string): void {
  if (new Set(records.map((record) => record.id)).size !== records.length)
    fail(`${label}IDが重複しています。`)
}
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
function yearOf(basis: CostBasis): number {
  return Number(basis.period.startedOn.slice(0, 4))
}

/** Validate all years before selecting a view, so hidden duplicate consumption cannot pass. */
export function projectAnnualCosts(input: CostSnapshot, year: number): AnnualCostProjection {
  if (!Number.isInteger(year) || year < 1900 || year > 9999) fail('対象年を確認してください。')
  const snapshot = costSnapshotSchema.parse(input)
  unique(snapshot.sources, '費用源')
  unique(snapshot.bases, '費用基礎')
  unique(snapshot.contributions, '寄与')
  unique(snapshot.taxUnits, '制作物の単位')
  const sources = new Map(snapshot.sources.map((value) => [value.id, value]))
  const bases = new Map(snapshot.bases.map((value) => [value.id, value]))
  const contributions = new Map(snapshot.contributions.map((value) => [value.id, value]))
  const units = new Set(snapshot.taxUnits.map((value) => value.id))
  const consumedBy = new Map<string, string>()
  const byBasis = new Map<string, typeof snapshot.contributions>()
  for (const item of snapshot.contributions) {
    if (!bases.has(item.basisId)) fail(`寄与 ${item.id} の費用基礎がありません。`)
    if (item.target.kind === 'tax-unit' && !units.has(item.target.taxUnitId))
      fail(`寄与 ${item.id} の制作物がありません。`)
    byBasis.set(item.basisId, [...(byBasis.get(item.basisId) ?? []), item])
  }
  for (const basis of snapshot.bases) {
    if (basis.affectedTaxUnitIds.some((id) => !units.has(id)))
      fail(`費用基礎 ${basis.id} の影響先がありません。`)
    if (yearOf(basis) < 1900 || yearOf(basis) !== Number(basis.period.endedOn.slice(0, 4))) {
      fail('費用基礎は対象年ごとに分割してください。')
    }
    if (Boolean(basis.sourceId) === basis.parentContributionIds.length > 0) {
      fail('費用源か親の寄与のどちらか一方を指定してください。')
    }
    if (basis.sourceId) {
      const source = sources.get(basis.sourceId)
      if (!source) fail(`費用基礎 ${basis.id} の費用源がありません。`)
      if (
        source.servicePeriod &&
        (basis.period.startedOn < source.servicePeriod.startedOn ||
          basis.period.endedOn > source.servicePeriod.endedOn)
      ) {
        fail(`費用基礎 ${basis.id} が費用源の利用期間から外れています。`)
      }
    }
    for (const parentId of basis.parentContributionIds) {
      const parent = contributions.get(parentId)
      if (!parent) fail(`親の寄与 ${parentId} がありません。`)
      if (consumedBy.has(parentId)) fail(`寄与 ${parentId} を二重に組み入れることはできません。`)
      if (parent.target.kind !== 'tax-unit' && parent.target.kind !== 'general')
        fail('私用・未判断等を原価へ自動組入れできません。')
      const parentBasis = bases.get(parent.basisId)!
      if (yearOf(parentBasis) !== yearOf(basis))
        fail('過年度の寄与は残高を経由して引き継いでください。')
      consumedBy.set(parentId, basis.id)
    }
    const related = byBasis.get(basis.id) ?? []
    if (basis.amount.status === 'unknown') {
      if (related.length || basis.parentContributionIds.length)
        fail('未算定の費用基礎に金額寄与を生成できません。')
    } else {
      if (sum(related.map((item) => item.amountJpy)) !== basis.amount.amountJpy)
        fail(`費用基礎 ${basis.id} と配分額が一致しません。`)
      if (
        basis.parentContributionIds.length &&
        sum(basis.parentContributionIds.map((id) => contributions.get(id)!.amountJpy)) !==
          basis.amount.amountJpy
      ) {
        fail(`費用基礎 ${basis.id} が親の寄与額と一致しません。`)
      }
    }
  }

  // Iterative topological traversal avoids recursion depth failures on imported graphs.
  const sourceIdsByBasis = new Map<string, string[]>()
  const unresolved = new Map(bases)
  while (unresolved.size) {
    let progressed = false
    for (const [id, basis] of unresolved) {
      const parentBasisIds = basis.parentContributionIds.map(
        (parentId) => contributions.get(parentId)!.basisId,
      )
      if (!basis.sourceId && parentBasisIds.some((parentId) => !sourceIdsByBasis.has(parentId)))
        continue
      const sourceIds = basis.sourceId
        ? [basis.sourceId]
        : parentBasisIds.flatMap((parentId) => sourceIdsByBasis.get(parentId)!)
      sourceIdsByBasis.set(id, [...new Set(sourceIds)].sort(compare))
      unresolved.delete(id)
      progressed = true
    }
    if (!progressed) fail('原価形成の参照が循環しています。')
  }

  for (const source of snapshot.sources) {
    const roots = snapshot.bases.filter((basis) => basis.sourceId === source.id)
    const periods = [...roots].sort((a, b) => compare(a.period.startedOn, b.period.startedOn))
    for (let index = 1; index < periods.length; index++) {
      if (periods[index].period.startedOn <= periods[index - 1].period.endedOn)
        fail(`費用源 ${source.id} の基礎期間が重複しています。`)
    }
    // Different methods/scenarios must be separate snapshots, never additive roots.
    const known = roots.flatMap((basis) =>
      basis.amount.status === 'known' ? [basis.amount.amountJpy] : [],
    )
    const costLimit = source.adjustments?.length
      ? evaluateSourceAdjustments(source, source.adjustments).costAmountJpy
      : source.originalAmountJpy
    if (costLimit === null && known.length)
      fail(
        `費用源 ${source.id} の原額または訂正後の基礎が不明なため、数値の費用基礎を生成できません。`,
      )
    if (costLimit !== null && sum(known) > costLimit)
      fail(`費用源 ${source.id} の原額を重複して組み入れています。`)
  }

  const selectedBases = snapshot.bases
    .filter((basis) => yearOf(basis) === year)
    .sort((a, b) => compare(a.id, b.id))
  const selectedIds = new Set(selectedBases.map((basis) => basis.id))
  const rows = snapshot.contributions
    .filter((item) => selectedIds.has(item.basisId))
    .map((item) => ({
      ...item,
      sourceIds: sourceIdsByBasis.get(item.basisId)!,
      ...(consumedBy.has(item.id) ? { consumedByBasisId: consumedBy.get(item.id)! } : {}),
    }))
    .sort((a, b) => compare(a.id, b.id))
  const terminal = rows.filter((item) => !item.consumedByBasisId)
  const totalFor = (kind: (typeof terminal)[number]['target']['kind']) =>
    sum(terminal.filter((item) => item.target.kind === kind).map((item) => item.amountJpy))
  const knownBasisJpy = sum(
    selectedBases.flatMap((basis) =>
      basis.sourceId && basis.amount.status === 'known' ? [basis.amount.amountJpy] : [],
    ),
  )
  if (sum(terminal.map((item) => item.amountJpy)) !== knownBasisJpy)
    fail('多段階の費用基礎と最終配分額が一致しません。')
  const selectedSourceIds = new Set(
    selectedBases.flatMap((basis) => sourceIdsByBasis.get(basis.id)!),
  )
  return {
    version: 1,
    engineVersion: 'cost-projection/1',
    year,
    sources: snapshot.sources
      .filter((source) => selectedSourceIds.has(source.id))
      .sort((a, b) => compare(a.id, b.id)),
    bases: selectedBases,
    contributions: rows,
    totals: {
      knownBasisJpy,
      taxUnitJpy: totalFor('tax-unit'),
      generalJpy: totalFor('general'),
      privateJpy: totalFor('private'),
      unallocatedJpy: totalFor('unallocated'),
      unobservedJpy: totalFor('unobserved'),
      roundingJpy: totalFor('rounding'),
      unknownBasisIds: selectedBases
        .filter((basis) => basis.amount.status === 'unknown')
        .map((basis) => basis.id),
    },
    byTaxUnit: snapshot.taxUnits
      .map((unit) => {
        const related = terminal.filter(
          (item) => item.target.kind === 'tax-unit' && item.target.taxUnitId === unit.id,
        )
        return {
          taxUnitId: unit.id,
          name: unit.name,
          amountJpy: sum(related.map((item) => item.amountJpy)),
          contributionIds: related.map((item) => item.id),
          unknownBasisIds: selectedBases
            .filter(
              (basis) =>
                basis.amount.status === 'unknown' && basis.affectedTaxUnitIds.includes(unit.id),
            )
            .map((basis) => basis.id),
        }
      })
      .sort((a, b) => compare(a.taxUnitId, b.taxUnitId)),
    invariantSatisfied: true,
  }
}
