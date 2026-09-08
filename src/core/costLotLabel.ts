import type { AnnualCostProjection } from '../accounting/costs.js'
import type { BalanceCostAllocation } from '../accounting/types.js'

export type CostLotDescription = { costYear: number; contributionId: string; label: string }
/** Derive labels exclusively from the supplied version; never decode opaque IDs into facts. */
export function describeCostLots(costs: AnnualCostProjection[]): CostLotDescription[] {
  return costs.flatMap((cost) =>
    cost.contributions.map((contribution) => {
      const basis = cost.bases.find((row) => row.id === contribution.basisId)
      const labels = contribution.sourceIds.map(
        (id) => cost.sources.find((row) => row.id === id)?.label ?? '費用名未収録',
      )
      const unitId =
        contribution.target.kind === 'tax-unit' ? contribution.target.taxUnitId : undefined
      const target = unitId
        ? cost.byTaxUnit.find((row) => row.taxUnitId === unitId)?.name
        : undefined
      return {
        costYear: cost.year,
        contributionId: contribution.id,
        label: [
          labels.join(' + ') || '費用名未収録',
          basis ? basis.period.startedOn + '〜' + basis.period.endedOn : '対象期間未収録',
          target,
        ]
          .filter(Boolean)
          .join(' / '),
      }
    }),
  )
}
export function costLotLabel(
  lot: Pick<BalanceCostAllocation, 'costYear' | 'contributionId'>,
  descriptions: CostLotDescription[] = [],
): string {
  const matches = descriptions.filter(
    (row) => row.costYear === lot.costYear && row.contributionId === lot.contributionId,
  )
  return (
    lot.costYear +
    '年 / ' +
    (matches.length === 1 ? matches[0]!.label : '費用名・対象期間未収録') +
    ' / 費用配分ID ' +
    lot.contributionId
  )
}
