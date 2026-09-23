import { readSourceAdjustments, writeSourceAdjustments } from './sourceAdjustmentsRepository.js'
import {
  readDecisionSoftwareAnnualBindings,
  readDecisionTreatmentBindings,
  writeDecisionSoftwareAnnualBindings,
  writeDecisionTreatmentBindings,
} from './decisionTreatmentBindingsRepository.js'
import { readCostTreatmentFacts, writeCostTreatmentFacts } from './costTreatmentFactsRepository.js'
import {
  planningSnapshotSchema,
  planningSaveSchema,
  PlanningValidationError,
} from '../planning/schema.js'
export {
  planningSnapshotSchema,
  planningSaveSchema,
  projectRulesSchema,
  PlanningValidationError,
} from '../planning/schema.js'
export { planningMarkdown } from '../core/planningExport.js'
import { advanceWorkspaceRevision } from './workspaceRevision.js'
import type { DatabaseSync } from 'node:sqlite'
import {
  emptyPlanningSnapshot,
  type PlanningSnapshot,
  type ProjectRuleRecord,
} from '../planning/types.js'
import { getDatabase } from './database.js'
import { readCostPresence, writeCostPresence } from './costPresenceRepository.js'
import { readEquipmentMethods, writeEquipmentMethods } from './equipmentMethodsRepository.js'

function optional<T>(value: T | null): T | undefined {
  return value === null ? undefined : value
}
function parseIds(value: string): string[] {
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string'))
    throw new Error('Invalid evidence reference data in planning database')
  return parsed
}

export function getPlanningSnapshot(db: DatabaseSync = getDatabase()): PlanningSnapshot {
  const profile = db
    .prepare(
      `SELECT tax_year AS taxYear, journey_mode AS journeyMode,
    income_category AS incomeCategory, filing_type AS filingType,
    activity_started_on AS activityStartedOn, monetization_status AS monetizationStatus,
    has_bookkeeping AS hasBookkeeping, notes FROM planning_profiles WHERE singleton_id = 1`,
    )
    .get() as Record<string, unknown> | undefined
  const sourceAdjustments = readSourceAdjustments(db)
  const decisionBindings = readDecisionTreatmentBindings(db)
  const annualBindings = readDecisionSoftwareAnnualBindings(db)
  const costTreatmentFacts = readCostTreatmentFacts(db)
  if (!profile)
    return {
      ...emptyPlanningSnapshot(),
      ...(sourceAdjustments.length ? { sourceAdjustments } : {}),
      ...(costTreatmentFacts.length ? { costTreatmentFacts } : {}),
    }
  const snapshot = {
    version: 1 as const,
    profile: {
      ...profile,
      activityStartedOn: optional(profile.activityStartedOn as string | null),
      notes: optional(profile.notes as string | null),
      hasBookkeeping: Boolean(profile.hasBookkeeping),
    },
    taxUnits: (
      db
        .prepare(
          `SELECT id, name, unit_type AS unitType, usage_mode AS usageMode,
      revenue_model AS revenueModel, lifecycle_status AS lifecycleStatus,
      journey_mode AS journeyMode, monetization_status AS monetizationStatus,
      completion_criteria AS completionCriteria, predecessor_id AS predecessorId,
      same_as_external_version AS sameAsExternalVersion, notes FROM planning_tax_units ORDER BY rowid`,
        )
        .all() as Array<Record<string, unknown>>
    ).map((row) => ({
      ...row,
      journeyMode: optional(row.journeyMode as string | null),
      monetizationStatus: optional(row.monetizationStatus as string | null),
      completionCriteria: optional(row.completionCriteria as string | null),
      predecessorId: optional(row.predecessorId as string | null),
      sameAsExternalVersion: optional(row.sameAsExternalVersion as string | null),
      notes: optional(row.notes as string | null),
    })),
    projectRules: (
      db
        .prepare(
          `SELECT id, project_key AS projectKey, provider,
      effective_from AS effectiveFrom, effective_to AS effectiveTo,
      tax_unit_id AS taxUnitId, classification, reason FROM planning_project_rules ORDER BY rowid`,
        )
        .all() as Array<Record<string, unknown>>
    ).map((row) => ({
      ...row,
      provider: optional(row.provider as string | null),
      effectiveTo: optional(row.effectiveTo as string | null),
      taxUnitId: optional(row.taxUnitId as string | null),
      reason: optional(row.reason as string | null),
    })),
    lifecycleEvents: (
      db
        .prepare(
          `SELECT id, tax_unit_id AS taxUnitId, event_type AS eventType,
      occurred_on AS occurredOn, recorded_at AS recordedAt, evidence_ids_json AS evidenceIdsJson, note
      FROM planning_lifecycle_events ORDER BY rowid`,
        )
        .all() as Array<Record<string, unknown>>
    ).map(({ evidenceIdsJson, ...row }) => ({
      ...row,
      note: optional(row.note as string | null),
      evidenceIds: parseIds(evidenceIdsJson as string),
    })),
    equipment: (
      db
        .prepare(
          `SELECT id, name, equipment_type AS equipmentType,
      acquisition_cost_jpy AS acquisitionCostJpy, unknown_amount_reason AS unknownAmountReason, ordered_on AS orderedOn,
      delivered_on AS deliveredOn, acquired_on AS acquiredOn, business_use_started_on AS businessUseStartedOn,
      converted_from_private AS convertedFromPrivate, opening_unamortized_balance_jpy AS openingUnamortizedBalanceJpy,
      business_use_ratio AS businessUseRatio, useful_life_years AS usefulLifeYears, role, tax_unit_id AS taxUnitId,
      project_allocation_ratio AS projectAllocationRatio, evidence_ids_json AS evidenceIdsJson FROM planning_equipment ORDER BY rowid`,
        )
        .all() as Array<Record<string, unknown>>
    ).map(({ evidenceIdsJson, ...row }) => ({
      ...row,
      orderedOn: optional(row.orderedOn as string | null),
      deliveredOn: optional(row.deliveredOn as string | null),
      businessUseStartedOn: optional(row.businessUseStartedOn as string | null),
      openingUnamortizedBalanceJpy: optional(row.openingUnamortizedBalanceJpy as number | null),
      usefulLifeYears: optional(row.usefulLifeYears as number | null),
      taxUnitId: optional(row.taxUnitId as string | null),
      convertedFromPrivate: Boolean(row.convertedFromPrivate),
      unknownAmountReason: optional(row.unknownAmountReason as string | null),
      evidenceIds: parseIds(evidenceIdsJson as string),
    })),
    homeCosts: (
      db
        .prepare(
          `SELECT id, month, category, amount_jpy AS amountJpy, unknown_amount_reason AS unknownAmountReason, method,
      business_use_ratio AS businessUseRatio, basis, rationale, tax_unit_id AS taxUnitId,
      project_allocation_ratio AS projectAllocationRatio, treatment, targets_json AS targetsJson,
      evidence_ids_json AS evidenceIdsJson FROM planning_home_costs ORDER BY rowid`,
        )
        .all() as Array<Record<string, unknown>>
    ).map(({ evidenceIdsJson, targetsJson, ...row }) => ({
      ...row,
      ...(targetsJson === null ? {} : { targets: JSON.parse(targetsJson as string) }),
      taxUnitId: optional(row.taxUnitId as string | null),
      unknownAmountReason: optional(row.unknownAmountReason as string | null),
      evidenceIds: parseIds(evidenceIdsJson as string),
    })),
    directCosts: (
      db
        .prepare(
          `SELECT id, tax_unit_id AS taxUnitId, incurred_on AS incurredOn,
      cost_type AS costType, amount_jpy AS amountJpy, unknown_amount_reason AS unknownAmountReason,
      directly_attributable AS directlyAttributable, treatment, note, evidence_ids_json AS evidenceIdsJson,
      targets_json AS targetsJson FROM planning_direct_costs ORDER BY rowid`,
        )
        .all() as Array<Record<string, unknown>>
    ).map(({ evidenceIdsJson, targetsJson, ...row }) => ({
      ...row,
      ...(targetsJson === null ? {} : { targets: JSON.parse(targetsJson as string) }),
      taxUnitId: optional(row.taxUnitId as string | null),
      note: optional(row.note as string | null),
      directlyAttributable: Boolean(row.directlyAttributable),
      unknownAmountReason: optional(row.unknownAmountReason as string | null),
      evidenceIds: parseIds(evidenceIdsJson as string),
    })),
    evidence: (
      db
        .prepare(
          `SELECT id, evidence_type AS evidenceType, strength,
      occurred_on AS occurredOn, recorded_at AS recordedAt, local_reference AS localReference,
      note, tax_unit_id AS taxUnitId FROM planning_evidence ORDER BY rowid`,
        )
        .all() as Array<Record<string, unknown>>
    ).map((row) => ({
      ...row,
      occurredOn: optional(row.occurredOn as string | null),
      localReference: optional(row.localReference as string | null),
      taxUnitId: optional(row.taxUnitId as string | null),
    })),
    decisions: (
      db
        .prepare(
          `SELECT id, tax_unit_id AS taxUnitId, tax_year AS taxYear,
      engine_version AS engineVersion, candidate, status, selected_candidate AS selectedCandidate,
      reason, created_at AS createdAt, confirmed_at AS confirmedAt FROM planning_decisions ORDER BY rowid`,
        )
        .all() as Array<Record<string, unknown>>
    ).map((row) => ({
      ...row,
      ...(decisionBindings.has(String(row.id))
        ? { treatmentBinding: decisionBindings.get(String(row.id)) }
        : {}),
      ...(annualBindings.has(String(row.id))
        ? { softwareAnnualBinding: annualBindings.get(String(row.id)) }
        : {}),
      selectedCandidate: optional(row.selectedCandidate as string | null),
      reason: optional(row.reason as string | null),
      confirmedAt: optional(row.confirmedAt as string | null),
    })),
  }
  const costPresence = readCostPresence(db),
    equipmentMethods = readEquipmentMethods(db)
  return planningSnapshotSchema.parse({
    ...snapshot,
    ...(costTreatmentFacts.length ? { costTreatmentFacts } : {}),
    ...(sourceAdjustments.length ? { sourceAdjustments } : {}),
    ...(costPresence.length ? { costPresence } : {}),
    ...(equipmentMethods.length ? { equipmentMethods } : {}),
  })
}

export function savePlanningSnapshot(
  snapshot: PlanningSnapshot,
  db: DatabaseSync = getDatabase(),
): void {
  const parsed = planningSaveSchema.parse(snapshot)
  db.exec('SAVEPOINT devtax_planning_write')
  try {
    writeSourceAdjustments(db, parsed.sourceAdjustments)
    writeDecisionTreatmentBindings(db, parsed.decisions)
    writeDecisionSoftwareAnnualBindings(db, parsed.decisions)
    writeCostTreatmentFacts(db, parsed.costTreatmentFacts)
    writeCostPresence(db, parsed.costPresence ?? [])
    db.exec('DELETE FROM planning_equipment_methods')
    for (const table of [
      'planning_decisions',
      'planning_lifecycle_events',
      'planning_project_rules',
      'planning_equipment',
      'planning_home_costs',
      'planning_direct_costs',
      'planning_evidence',
      'planning_tax_units',
      'planning_profiles',
    ])
      db.exec(`DELETE FROM ${table}`)
    db.prepare(
      `INSERT INTO planning_profiles(singleton_id, tax_year, journey_mode,
      income_category, filing_type, activity_started_on, monetization_status,
      has_bookkeeping, notes) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      parsed.profile.taxYear,
      parsed.profile.journeyMode,
      parsed.profile.incomeCategory,
      parsed.profile.filingType,
      parsed.profile.activityStartedOn ?? null,
      parsed.profile.monetizationStatus,
      Number(parsed.profile.hasBookkeeping),
      parsed.profile.notes ?? null,
    )
    const taxUnit = db.prepare(`INSERT INTO planning_tax_units(id, name, unit_type,
      usage_mode, revenue_model, lifecycle_status, journey_mode, monetization_status,
      completion_criteria, predecessor_id, same_as_external_version, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    for (const item of parsed.taxUnits)
      taxUnit.run(
        item.id,
        item.name,
        item.unitType,
        item.usageMode,
        item.revenueModel,
        item.lifecycleStatus,
        item.journeyMode ?? parsed.profile.journeyMode,
        item.monetizationStatus ?? parsed.profile.monetizationStatus,
        item.completionCriteria ?? null,
        item.predecessorId ?? null,
        item.sameAsExternalVersion ?? null,
        item.notes ?? null,
      )
    const projectRule = db.prepare(`INSERT INTO planning_project_rules(id, project_key,
      provider, effective_from, effective_to, tax_unit_id, classification, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    for (const item of parsed.projectRules)
      projectRule.run(
        item.id,
        item.projectKey,
        item.provider ?? null,
        item.effectiveFrom,
        item.effectiveTo ?? null,
        item.taxUnitId ?? null,
        item.classification,
        item.reason ?? null,
      )
    const event = db.prepare(`INSERT INTO planning_lifecycle_events(id, tax_unit_id,
      event_type, occurred_on, recorded_at, evidence_ids_json, note) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    for (const item of parsed.lifecycleEvents)
      event.run(
        item.id,
        item.taxUnitId,
        item.eventType,
        item.occurredOn,
        item.recordedAt,
        JSON.stringify(item.evidenceIds),
        item.note ?? null,
      )
    const equipment = db.prepare(`INSERT INTO planning_equipment(id, name, equipment_type,
      acquisition_cost_jpy, ordered_on, delivered_on, acquired_on, business_use_started_on,
      converted_from_private, opening_unamortized_balance_jpy, business_use_ratio,
      useful_life_years, role, tax_unit_id, project_allocation_ratio, evidence_ids_json, unknown_amount_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    for (const item of parsed.equipment)
      equipment.run(
        item.id,
        item.name,
        item.equipmentType,
        item.acquisitionCostJpy,
        item.orderedOn ?? null,
        item.deliveredOn ?? null,
        item.acquiredOn,
        item.businessUseStartedOn ?? null,
        Number(item.convertedFromPrivate),
        item.openingUnamortizedBalanceJpy ?? null,
        item.businessUseRatio,
        item.usefulLifeYears ?? null,
        item.role,
        item.taxUnitId ?? null,
        item.projectAllocationRatio,
        JSON.stringify(item.evidenceIds),
        item.unknownAmountReason ?? null,
      )
    const home = db.prepare(`INSERT INTO planning_home_costs(id, month, category, amount_jpy,
      method, business_use_ratio, basis, rationale, tax_unit_id, project_allocation_ratio,
      treatment, evidence_ids_json, unknown_amount_reason, targets_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    for (const item of parsed.homeCosts)
      home.run(
        item.id,
        item.month,
        item.category,
        item.amountJpy,
        item.method,
        item.businessUseRatio,
        item.basis,
        item.rationale,
        item.taxUnitId ?? null,
        item.projectAllocationRatio,
        item.treatment,
        JSON.stringify(item.evidenceIds),
        item.unknownAmountReason ?? null,
        item.targets === undefined ? null : JSON.stringify(item.targets),
      )
    const direct = db.prepare(`INSERT INTO planning_direct_costs(id, tax_unit_id, incurred_on,
      cost_type, amount_jpy, directly_attributable, treatment, note, evidence_ids_json, unknown_amount_reason, targets_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    for (const item of parsed.directCosts)
      direct.run(
        item.id,
        item.taxUnitId ?? null,
        item.incurredOn,
        item.costType,
        item.amountJpy,
        Number(item.directlyAttributable),
        item.treatment,
        item.note ?? null,
        JSON.stringify(item.evidenceIds),
        item.unknownAmountReason ?? null,
        item.targets === undefined ? null : JSON.stringify(item.targets),
      )
    writeEquipmentMethods(db, parsed.equipmentMethods ?? [])
    const evidence = db.prepare(`INSERT INTO planning_evidence(id, evidence_type, strength,
      occurred_on, recorded_at, local_reference, note, tax_unit_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    for (const item of parsed.evidence)
      evidence.run(
        item.id,
        item.evidenceType,
        item.strength,
        item.occurredOn ?? null,
        item.recordedAt,
        item.localReference ?? null,
        item.note,
        item.taxUnitId ?? null,
      )
    const decision = db.prepare(`INSERT INTO planning_decisions(id, tax_unit_id, tax_year,
      engine_version, candidate, status, selected_candidate, reason, created_at, confirmed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    for (const item of parsed.decisions)
      decision.run(
        item.id,
        item.taxUnitId,
        item.taxYear,
        item.engineVersion,
        item.candidate,
        item.status,
        item.selectedCandidate ?? null,
        item.reason ?? null,
        item.createdAt,
        item.confirmedAt ?? null,
      )
    advanceWorkspaceRevision(db)
    db.exec('RELEASE devtax_planning_write')
  } catch (error) {
    db.exec('ROLLBACK TO devtax_planning_write')
    db.exec('RELEASE devtax_planning_write')
    throw error
  }
}

/** Internal import/migration helper; no unversioned HTTP route exposes it. */
export function replaceProjectRules(
  rules: ProjectRuleRecord[],
  db: DatabaseSync = getDatabase(),
): void {
  const unitIds = new Set(
    (db.prepare('SELECT id FROM planning_tax_units').all() as Array<{ id: string }>).map(
      (row) => row.id,
    ),
  )
  const seenIds = new Set<string>()
  for (const rule of rules) {
    if (seenIds.has(rule.id))
      throw new PlanningValidationError(`同じIDのルールが重複しています: ${rule.id}`)
    seenIds.add(rule.id)
    if (rule.taxUnitId && !unitIds.has(rule.taxUnitId))
      throw new PlanningValidationError(`未登録の制作物を指すルールです: ${rule.id}`)
    if (rule.effectiveTo && rule.effectiveTo < rule.effectiveFrom)
      throw new PlanningValidationError(`終了日が開始日より前のルールです: ${rule.id}`)
  }
  const insert = db.prepare(`INSERT INTO planning_project_rules(id, project_key,
    provider, effective_from, effective_to, tax_unit_id, classification, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec('DELETE FROM planning_project_rules')
    for (const rule of rules)
      insert.run(
        rule.id,
        rule.projectKey,
        rule.provider ?? null,
        rule.effectiveFrom,
        rule.effectiveTo ?? null,
        rule.taxUnitId ?? null,
        rule.classification,
        rule.reason ?? null,
      )
    advanceWorkspaceRevision(db)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
