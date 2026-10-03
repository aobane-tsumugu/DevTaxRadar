import type { ExpenseSource } from '../accounting/costs.js'
import type { PlanningSnapshot } from '../planning/types.js'

/** Provenance enriches the existing source; it never adds another cost basis. */
export function originalChargeSource(
  source: ExpenseSource,
  planning: PlanningSnapshot,
): ExpenseSource {
  const facts = planning.originalCharges?.facts ?? []
  const superseded = new Set(facts.flatMap((fact) => (fact.correctsId ? [fact.correctsId] : [])))
  const fact = facts.find((row) => row.sourceId === source.id && !superseded.has(row.id))
  return fact ? { ...source, originalChargeFact: fact } : source
}
