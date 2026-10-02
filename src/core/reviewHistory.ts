import { scopedActivityFacts } from '../planning/activityFacts.js'
import type { ReviewMaterials } from '../accounting/reviewMaterials.js'
import type { AnnualCostProjection } from '../accounting/costs.js'
import type { BalanceSnapshot } from '../accounting/types.js'

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) {
    const rows = value.map(ordered)
    const key = (item: unknown) => {
      if (typeof item === 'string') return item
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      return row.id ?? row.accountId ?? row.observationId ?? row.taxUnitId ?? null
    }
    if (rows.every((row) => typeof key(row) === 'string'))
      rows.sort((a, b) => String(key(a)).localeCompare(String(key(b)), 'en'))
    return rows
  }
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, ordered(item)]))
  return value
}

// incurredOn is duplicated from the existing dated direct-cost record. Adding
// this metadata must not turn a no-adjustment legacy year into a correction.
function comparableCosts(costs: AnnualCostProjection): AnnualCostProjection {
  const treatments = costs.treatments
  const qualification = treatments
    ? (() => {
        const { methodComparisons: _unadoptedScenarios, ...recordedQualification } = treatments
        return recordedQualification
      })()
    : undefined
  return {
    ...costs,
    ...(qualification ? { treatments: qualification } : {}),
    sources: costs.sources.map((source) => {
      if (source.adjustments?.length) return source
      const { incurredOn: _duplicateDate, ...compatible } = source
      return compatible
    }),
  }
}

/** Year-scoped evidence used to guard a carry-forward; later scans and unrelated future inputs are not historical changes. */
export function historicalReviewMaterials(material: ReviewMaterials, balances: BalanceSnapshot) {
  const year = material.year
  const inYear = (date: string) => date.startsWith(String(year) + '-')
  const pendingDecisions = balances.pendingDecisions
    .filter((row) => row.taxYear <= year)
    .map((row) => {
      const { answers, resolution, ...historical } = row
      const applicable = answers?.filter((answer) => answer.taxYear <= year)
      return {
        ...historical,
        ...(applicable?.length ? { answers: applicable } : {}),
        ...(resolution && resolution.taxYear <= year ? { resolution } : {}),
      }
    })
  // Linked prior-year inputs are part of this fixed material too. Comparing
  // only their IDs/amounts misses edits to the receipt or allocation evidence.
  const costInputs = [
    material.costs,
    ...(material.costLinks?.costs.filter((row) => row.year !== year) ?? []),
  ]
  const costYears = new Set(costInputs.map((cost) => cost.year))
  const costTreatmentFacts = (material.planning.costTreatmentFacts ?? [])
    .filter((fact) => costYears.has(fact.costYear))
    .map((fact) => {
      // Actual method selections live on asset accounts. A hypothetical chart or
      // its display horizon must not force a correction of production facts.
      const { methodComparison: _scenario, recordedAt: _editedAt, ...production } = fact
      return production
    })
  const activityFacts = [
    ...new Map(
      material.planning.taxUnits
        .flatMap((unit) =>
          [...costYears].flatMap((year) =>
            scopedActivityFacts(material.planning, unit.id, `${year}-01-01`, `${year}-12-31`),
          ),
        )
        .map((fact) => [fact.id, fact]),
    ).values(),
  ]
  const evidenceIds = new Set([
    ...activityFacts.flatMap((fact) => fact.evidenceIds),
    ...costTreatmentFacts.flatMap((fact) => fact.evidenceIds),
    ...costInputs.flatMap((costs) => costs.sources.flatMap((source) => source.evidenceIds)),
    ...costInputs.flatMap((costs) => costs.contributions.flatMap((item) => item.evidenceIds)),
    ...costInputs.flatMap((costs) =>
      costs.sources.flatMap((source) =>
        (source.adjustments ?? []).flatMap((row) => row.evidenceIds),
      ),
    ),
    ...balances.movements
      .filter((movement) => inYear(movement.occurredOn))
      .flatMap((movement) => movement.sourceIds),
    ...pendingDecisions.flatMap((row) => row.sourceIds),
  ])
  const costIds = new Set(material.costs.sources.map((source) => source.id))
  const adjustments = (material.planning.sourceAdjustments ?? []).filter((row) =>
    row.effect === 'restate-original-cost'
      ? costIds.has(row.sourceId) || row.sourceYear === year
      : inYear(row.occurredOn),
  )
  for (const row of adjustments) for (const id of row.evidenceIds) evidenceIds.add(id)
  const directCosts = material.planning.directCosts
    .filter((row) => inYear(row.incurredOn))
    .map((row) => {
      if (row.targets === undefined) return row
      const { taxUnitId: _oldTarget, directlyAttributable: _oldDirect, ...used } = row
      return used
    })
  const homeCosts = material.planning.homeCosts
    .filter((row) => inYear(row.month))
    .map((row) => {
      if (row.targets === undefined) return row
      const { taxUnitId: _oldTarget, projectAllocationRatio: _oldRatio, ...used } = row
      return used
    })
  const equipment = material.planning.equipment
    .filter((row) => costIds.has('equipment:' + row.id))
    .map((row) => {
      const annual = material.planning.equipmentMethods?.find(
        (method) => method.equipmentId === row.id && method.taxYear === year,
      )
      if (!annual?.allocation) return row
      const { businessUseRatio: _business, projectAllocationRatio: _project, ...usedFacts } = row
      if (annual.allocation.targets !== undefined || annual.allocation.taxUnitId !== undefined) {
        const { taxUnitId: _target, ...annualTargetFacts } = usedFacts
        return annualTargetFacts
      }
      return usedFacts
    })
  for (const row of [...directCosts, ...homeCosts, ...equipment])
    for (const id of row.evidenceIds) evidenceIds.add(id)
  return ordered({
    year,
    ...(activityFacts.length ? { activityFacts } : {}),
    timeZone: material.timeZone,
    costs: comparableCosts(material.costs),
    ...(costTreatmentFacts.length ? { costTreatmentFacts } : {}),
    ...(adjustments.length ? { sourceAdjustments: adjustments } : {}),
    ...(material.costLinks?.costs.some((row) => row.year !== year)
      ? {
          linkedCostInputs: material.costLinks.costs
            .filter((row) => row.year !== year)
            .map(comparableCosts),
        }
      : {}),
    directCosts,
    homeCosts,
    equipment,
    ...(material.planning.equipmentMethods?.some((row) => row.taxYear === year)
      ? {
          equipmentMethods: material.planning.equipmentMethods
            .filter((row) => row.taxYear === year)
            .map((row) => {
              if (row.allocation?.targets === undefined) return row
              const {
                taxUnitId: _single,
                projectAllocationRatio: _ratio,
                ...allocation
              } = row.allocation
              return { ...row, allocation }
            }),
        }
      : {}),
    ...(material.planning.costPresence?.some((row) => row.taxYear === year)
      ? {
          costPresence: material.planning.costPresence.filter((row) => row.taxYear === year),
        }
      : {}),
    decisions: material.planning.decisions.filter((row) => row.taxYear === year),
    pendingDecisions,
    evidence: material.planning.evidence.filter((row) => evidenceIds.has(row.id)),
    observations: material.observations.filter((row) => inYear(row.month)),
  })
}
