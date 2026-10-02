import type { WorkspaceDraft } from '../planning/workspace.js'

type Contents = Pick<WorkspaceDraft, 'configuration' | 'planning'>

function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']'
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined)
    entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    return (
      '{' + entries.map(([key, item]) => JSON.stringify(key) + ':' + stable(item)).join(',') + '}'
    )
  }
  return JSON.stringify(value) ?? 'null'
}

/** Only descriptive fields are excluded. New fields default to calculation-affecting. */
function withoutNotes(input: Contents): Contents {
  const planning = structuredClone(input.planning)
  delete planning.profile.notes
  for (const unit of planning.taxUnits) delete unit.notes
  for (const evidence of planning.evidence) delete (evidence as Partial<typeof evidence>).note
  for (const direct of planning.directCosts) delete direct.note
  // Method reasons, confirmations, dates, classifications and reference IDs stay.
  return { configuration: input.configuration, planning }
}

/** Only the saved contents; a caller's WorkspaceDraft revision is not a content change. */
function contents(input: Contents): Contents {
  return { configuration: input.configuration, planning: input.planning }
}

/** This selects a UI path, never authorizes a save or replaces revision/hash checks. */
export function workspaceChangeKind(
  before: Contents,
  after: Contents,
): 'none' | 'notes' | 'calculation' {
  if (stable(contents(before)) === stable(contents(after))) return 'none'
  return stable(withoutNotes(before)) === stable(withoutNotes(after)) ? 'notes' : 'calculation'
}

/** No AI-only assumptions: an equipment/direct-cost workspace is already in use. */
export function isNewWorkspace(input: Contents, observedSessionCount: number): boolean {
  const { configuration, planning } = input
  return (
    observedSessionCount === 0 &&
    !planning.activityLedger?.products.length &&
    !planning.activityLedger?.facts.length &&
    planning.taxUnits.length === 0 &&
    planning.equipment.length === 0 &&
    planning.homeCosts.length === 0 &&
    planning.directCosts.length === 0 &&
    planning.evidence.length === 0 &&
    planning.lifecycleEvents.length === 0 &&
    planning.decisions.length === 0 &&
    planning.projectRules.length === 0 &&
    !planning.costPresence?.length &&
    !planning.costTreatmentFacts?.length &&
    !planning.sourceAdjustments?.length &&
    !planning.equipmentMethods?.length &&
    configuration.monthlyCharges.length === 0 &&
    !configuration.chargePeriods?.length &&
    !Object.values(configuration.charges).some((amount) => amount !== null && amount > 0)
  )
}
