import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import {
  emptyPlanningSnapshot,
  type Diagnosis,
  type PlanningLedger,
  type PlanningSnapshot,
} from '../planning/types.js'
import { getDatabase } from './database.js'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
const identifier = z.string().trim().min(1).max(120)
const ratio = z.number().min(0).max(1)
const evidenceIds = z.array(identifier).max(100)

const profileSchema = z.object({
  taxYear: z.number().int().min(2000).max(2100),
  journeyMode: z.enum(['early', 'retrospective']),
  incomeCategory: z.enum(['undecided', 'miscellaneous', 'business']),
  filingType: z.enum(['undecided', 'white', 'blue']),
  activityStartedOn: date.optional(),
  monetizationStatus: z.enum(['none', 'planned', 'earning']),
  hasBookkeeping: z.boolean(),
  notes: z.string().trim().max(2_000).optional(),
})

const taxUnitSchema = z.object({
  id: identifier,
  name: z.string().trim().min(1).max(160),
  unitType: z.enum(['new-software', 'improvement-plan', 'sales-production']),
  usageMode: z.enum(['internal', 'external', 'mixed', 'undecided']),
  revenueModel: z.enum([
    'sales',
    'subscription',
    'advertising',
    'affiliate',
    'efficiency',
    'oss',
    'other',
    'undecided',
  ]),
  lifecycleStatus: z.enum([
    'idea',
    'prototype',
    'developing',
    'evaluating',
    'in-use',
    'maintaining',
    'improving',
    'retired',
    'abandoned',
  ]),
  journeyMode: z.enum(['early', 'retrospective']).optional(),
  monetizationStatus: z.enum(['none', 'planned', 'earning']).optional(),
  completionCriteria: z.string().trim().max(2_000).optional(),
  predecessorId: identifier.optional(),
  sameAsExternalVersion: z.enum(['yes', 'no', 'undecided']).optional(),
  notes: z.string().trim().max(2_000).optional(),
})

const projectRuleSchema = z.object({
  id: identifier,
  projectKey: z.string().trim().min(8).max(120),
  provider: z.enum(['claude', 'codex']).optional(),
  effectiveFrom: date,
  effectiveTo: date.optional(),
  taxUnitId: identifier.optional(),
  classification: z.enum([
    'new-development',
    'maintenance',
    'feature-addition',
    'general-learning',
    'private',
    'unclassified',
  ]),
  reason: z.string().trim().max(1_000).optional(),
})

const lifecycleEventSchema = z.object({
  id: identifier,
  taxUnitId: identifier,
  eventType: z.enum([
    'development-started',
    'evaluation-started',
    'internal-use-started',
    'external-released',
    'first-sale',
    'improvement-started',
    'retired',
    'abandoned',
  ]),
  occurredOn: date,
  recordedAt: z.string().datetime({ offset: true }),
  evidenceIds,
  note: z.string().trim().max(2_000).optional(),
})

const equipmentSchema = z.object({
  id: identifier,
  name: z.string().trim().min(1).max(160),
  equipmentType: z.enum(['pc', 'gpu', 'dgx', 'server', 'desk', 'peripheral', 'other']),
  acquisitionCostJpy: z.number().int().nonnegative(),
  orderedOn: date.optional(),
  deliveredOn: date.optional(),
  acquiredOn: date,
  businessUseStartedOn: date.optional(),
  convertedFromPrivate: z.boolean(),
  openingUnamortizedBalanceJpy: z.number().int().nonnegative().optional(),
  businessUseRatio: ratio,
  usefulLifeYears: z.number().int().positive().max(100).optional(),
  role: z.string().trim().min(1).max(1_000),
  taxUnitId: identifier.optional(),
  projectAllocationRatio: ratio,
  evidenceIds,
})

const homeCostSchema = z.object({
  id: identifier,
  month,
  category: z.enum(['rent', 'electricity', 'internet']),
  amountJpy: z.number().int().nonnegative(),
  method: z.enum(['area', 'area-time', 'meter', 'watt-hour', 'usage-time', 'fixed-ratio']),
  businessUseRatio: ratio,
  basis: z.string().trim().min(1).max(2_000),
  rationale: z.string().trim().min(1).max(2_000),
  taxUnitId: identifier.optional(),
  projectAllocationRatio: ratio,
  treatment: z.enum(['direct', 'shared', 'general']),
  evidenceIds,
})

const directCostSchema = z.object({
  id: identifier,
  taxUnitId: identifier.optional(),
  incurredOn: date,
  costType: z.enum([
    'outsource',
    'material',
    'cloud',
    'domain',
    'license',
    'old-version-balance',
    'other',
  ]),
  amountJpy: z.number().int().nonnegative(),
  directlyAttributable: z.boolean(),
  treatment: z.enum(['direct', 'shared', 'general']),
  note: z.string().trim().max(2_000).optional(),
  evidenceIds,
})

const evidenceSchema = z.object({
  id: identifier,
  evidenceType: z.enum([
    'deployment',
    'sale-page',
    'store-release',
    'first-use',
    'file',
    'screenshot',
    'receipt',
    'card-statement',
    'memo',
    'ai-session',
    'other',
  ]),
  strength: z.enum(['automatic', 'external', 'self-recorded']),
  occurredOn: date.optional(),
  recordedAt: z.string().datetime({ offset: true }),
  localReference: z.string().trim().max(2_000).optional(),
  note: z.string().trim().min(1).max(4_000),
  taxUnitId: identifier.optional(),
})

const decisionSchema = z.object({
  id: identifier,
  taxUnitId: identifier,
  taxYear: z.number().int().min(2000).max(2100),
  engineVersion: z.string().trim().min(1).max(120),
  candidate: z.string().trim().min(1).max(160),
  status: z.enum(['pending', 'confirmed', 'overridden']),
  selectedCandidate: z.string().trim().min(1).max(160).optional(),
  reason: z.string().trim().max(2_000).optional(),
  createdAt: z.string().datetime({ offset: true }),
  confirmedAt: z.string().datetime({ offset: true }).optional(),
})

export const planningSnapshotSchema = z
  .object({
    version: z.literal(1),
    profile: profileSchema,
    taxUnits: z.array(taxUnitSchema).max(1_000),
    projectRules: z.array(projectRuleSchema).max(5_000),
    lifecycleEvents: z.array(lifecycleEventSchema).max(10_000),
    equipment: z.array(equipmentSchema).max(5_000),
    homeCosts: z.array(homeCostSchema).max(20_000),
    directCosts: z.array(directCostSchema).max(20_000),
    evidence: z.array(evidenceSchema).max(20_000),
    decisions: z.array(decisionSchema).max(20_000),
  })
  .superRefine((snapshot, context) => {
    const unitIds = new Set(snapshot.taxUnits.map((unit) => unit.id))
    const knownEvidence = new Set(snapshot.evidence.map((item) => item.id))
    const collections = [
      ['taxUnits', snapshot.taxUnits],
      ['projectRules', snapshot.projectRules],
      ['lifecycleEvents', snapshot.lifecycleEvents],
      ['equipment', snapshot.equipment],
      ['homeCosts', snapshot.homeCosts],
      ['directCosts', snapshot.directCosts],
      ['evidence', snapshot.evidence],
      ['decisions', snapshot.decisions],
    ] as const

    for (const [name, records] of collections) {
      const seen = new Set<string>()
      records.forEach((record, index) => {
        if (seen.has(record.id)) {
          context.addIssue({
            code: 'custom',
            path: [name, index, 'id'],
            message: 'IDが重複しています。',
          })
        }
        seen.add(record.id)
      })
    }

    snapshot.taxUnits.forEach((unit, index) => {
      if (unit.predecessorId && !unitIds.has(unit.predecessorId)) {
        context.addIssue({
          code: 'custom',
          path: ['taxUnits', index, 'predecessorId'],
          message: '旧版が存在しません。',
        })
      }
      if (unit.predecessorId === unit.id) {
        context.addIssue({
          code: 'custom',
          path: ['taxUnits', index, 'predecessorId'],
          message: '自分自身を旧版にできません。',
        })
      }
    })

    const withTaxUnit = [
      ['projectRules', snapshot.projectRules],
      ['lifecycleEvents', snapshot.lifecycleEvents],
      ['equipment', snapshot.equipment],
      ['homeCosts', snapshot.homeCosts],
      ['directCosts', snapshot.directCosts],
      ['evidence', snapshot.evidence],
      ['decisions', snapshot.decisions],
    ] as const
    for (const [name, records] of withTaxUnit) {
      records.forEach((record, index) => {
        if (record.taxUnitId && !unitIds.has(record.taxUnitId)) {
          context.addIssue({
            code: 'custom',
            path: [name, index, 'taxUnitId'],
            message: '制作物・改良計画が存在しません。',
          })
        }
      })
    }

    snapshot.projectRules.forEach((rule, index) => {
      if (rule.effectiveTo && rule.effectiveTo < rule.effectiveFrom) {
        context.addIssue({
          code: 'custom',
          path: ['projectRules', index, 'effectiveTo'],
          message: '終了日は開始日以後にしてください。',
        })
      }
    })

    const evidenceOwners = [
      ['lifecycleEvents', snapshot.lifecycleEvents],
      ['equipment', snapshot.equipment],
      ['homeCosts', snapshot.homeCosts],
      ['directCosts', snapshot.directCosts],
    ] as const
    for (const [name, records] of evidenceOwners) {
      records.forEach((record, index) => {
        record.evidenceIds.forEach((evidenceId, evidenceIndex) => {
          if (!knownEvidence.has(evidenceId)) {
            context.addIssue({
              code: 'custom',
              path: [name, index, 'evidenceIds', evidenceIndex],
              message: '証拠レコードが存在しません。',
            })
          }
        })
      })
    }
  })

function optional<T>(value: T | null): T | undefined {
  return value === null ? undefined : value
}

function parseIds(value: string): string[] {
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new Error('Invalid evidence reference data in planning database')
  }
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
  if (!profile) return emptyPlanningSnapshot()

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
      same_as_external_version AS sameAsExternalVersion, notes
      FROM planning_tax_units ORDER BY rowid`,
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
      tax_unit_id AS taxUnitId, classification, reason
      FROM planning_project_rules ORDER BY rowid`,
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
      acquisition_cost_jpy AS acquisitionCostJpy, ordered_on AS orderedOn,
      delivered_on AS deliveredOn, acquired_on AS acquiredOn,
      business_use_started_on AS businessUseStartedOn,
      converted_from_private AS convertedFromPrivate,
      opening_unamortized_balance_jpy AS openingUnamortizedBalanceJpy,
      business_use_ratio AS businessUseRatio, useful_life_years AS usefulLifeYears,
      role, tax_unit_id AS taxUnitId, project_allocation_ratio AS projectAllocationRatio,
      evidence_ids_json AS evidenceIdsJson FROM planning_equipment ORDER BY rowid`,
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
      evidenceIds: parseIds(evidenceIdsJson as string),
    })),
    homeCosts: (
      db
        .prepare(
          `SELECT id, month, category, amount_jpy AS amountJpy, method,
      business_use_ratio AS businessUseRatio, basis, rationale, tax_unit_id AS taxUnitId,
      project_allocation_ratio AS projectAllocationRatio, treatment,
      evidence_ids_json AS evidenceIdsJson FROM planning_home_costs ORDER BY rowid`,
        )
        .all() as Array<Record<string, unknown>>
    ).map(({ evidenceIdsJson, ...row }) => ({
      ...row,
      taxUnitId: optional(row.taxUnitId as string | null),
      evidenceIds: parseIds(evidenceIdsJson as string),
    })),
    directCosts: (
      db
        .prepare(
          `SELECT id, tax_unit_id AS taxUnitId, incurred_on AS incurredOn,
      cost_type AS costType, amount_jpy AS amountJpy,
      directly_attributable AS directlyAttributable, treatment, note,
      evidence_ids_json AS evidenceIdsJson FROM planning_direct_costs ORDER BY rowid`,
        )
        .all() as Array<Record<string, unknown>>
    ).map(({ evidenceIdsJson, ...row }) => ({
      ...row,
      taxUnitId: optional(row.taxUnitId as string | null),
      note: optional(row.note as string | null),
      directlyAttributable: Boolean(row.directlyAttributable),
      evidenceIds: parseIds(evidenceIdsJson as string),
    })),
    evidence: (
      db
        .prepare(
          `SELECT id, evidence_type AS evidenceType, strength,
      occurred_on AS occurredOn, recorded_at AS recordedAt,
      local_reference AS localReference, note, tax_unit_id AS taxUnitId
      FROM planning_evidence ORDER BY rowid`,
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
      engine_version AS engineVersion, candidate, status,
      selected_candidate AS selectedCandidate, reason, created_at AS createdAt,
      confirmed_at AS confirmedAt FROM planning_decisions ORDER BY rowid`,
        )
        .all() as Array<Record<string, unknown>>
    ).map((row) => ({
      ...row,
      selectedCandidate: optional(row.selectedCandidate as string | null),
      reason: optional(row.reason as string | null),
      confirmedAt: optional(row.confirmedAt as string | null),
    })),
  }
  return planningSnapshotSchema.parse(snapshot)
}

export function savePlanningSnapshot(
  snapshot: PlanningSnapshot,
  db: DatabaseSync = getDatabase(),
): void {
  const parsed = planningSnapshotSchema.parse(snapshot)
  db.exec('BEGIN IMMEDIATE')
  try {
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
      useful_life_years, role, tax_unit_id, project_allocation_ratio, evidence_ids_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
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
      )

    const home = db.prepare(`INSERT INTO planning_home_costs(id, month, category, amount_jpy,
      method, business_use_ratio, basis, rationale, tax_unit_id, project_allocation_ratio,
      treatment, evidence_ids_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
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
      )

    const direct = db.prepare(`INSERT INTO planning_direct_costs(id, tax_unit_id, incurred_on,
      cost_type, amount_jpy, directly_attributable, treatment, note, evidence_ids_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
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
      )

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
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function planningMarkdown(
  snapshot: PlanningSnapshot,
  diagnosis?: Diagnosis,
  ledger?: PlanningLedger,
): string {
  const lines = [
    '# DevTax Radar 計画・原価資料',
    '',
    `対象年: ${snapshot.profile.taxYear}年`,
    `所得区分候補: ${snapshot.profile.incomeCategory}`,
    `申告方式: ${snapshot.profile.filingType}`,
    '',
    '## 制作物・改良計画',
    '',
  ]
  for (const unit of snapshot.taxUnits) {
    const journey =
      (unit.journeyMode ?? snapshot.profile.journeyMode) === 'early' ? '早期準備' : '過去整理'
    const monetization = unit.monetizationStatus ?? snapshot.profile.monetizationStatus
    lines.push(
      `- ${unit.name}: ${unit.unitType} / ${unit.usageMode} / ${unit.lifecycleStatus} / ${journey} / 売上状況:${monetization}`,
    )
  }
  lines.push('', '## 設備', '')
  for (const item of snapshot.equipment) {
    lines.push(
      `- ${item.name}: ${item.acquisitionCostJpy.toLocaleString('ja-JP')}円、業務利用${Math.round(item.businessUseRatio * 100)}%`,
    )
  }
  lines.push('', '## 家賃・電気・通信費', '')
  for (const item of snapshot.homeCosts) {
    lines.push(
      `- ${item.month} ${item.category}: ${item.amountJpy.toLocaleString('ja-JP')}円、${item.method}（${item.rationale}）`,
    )
  }
  lines.push('', '## 直接費', '')
  for (const item of snapshot.directCosts) {
    lines.push(`- ${item.incurredOn} ${item.costType}: ${item.amountJpy.toLocaleString('ja-JP')}円`)
  }
  if (ledger) {
    lines.push('', '## 原価集計', '')
    lines.push(`- 支出総額: ${ledger.totals.grossAmountJpy.toLocaleString('ja-JP')}円`)
    lines.push(`- 業務利用額: ${ledger.totals.businessAmountJpy.toLocaleString('ja-JP')}円`)
    lines.push(`- 制作物への配賦額: ${ledger.totals.allocatedAmountJpy.toLocaleString('ja-JP')}円`)
    lines.push(`- 私用部分: ${ledger.totals.privateAmountJpy.toLocaleString('ja-JP')}円`)
    lines.push(`- 未配賦額: ${ledger.totals.unallocatedAmountJpy.toLocaleString('ja-JP')}円`, '')
    for (const unit of ledger.byTaxUnit) {
      lines.push(`- ${unit.name}: ${unit.amountJpy.toLocaleString('ja-JP')}円 / ${unit.candidate}`)
      if (unit.missingFacts.length > 0) lines.push(`  - 要確認: ${unit.missingFacts.join('、')}`)
    }
  }
  lines.push('', '## ライフサイクルと証拠', '')
  for (const event of snapshot.lifecycleEvents) {
    lines.push(`- ${event.occurredOn} ${event.eventType}${event.note ? ` — ${event.note}` : ''}`)
  }
  for (const item of snapshot.evidence) {
    lines.push(
      `- ${item.occurredOn ?? item.recordedAt.slice(0, 10)} ${item.evidenceType} (${item.strength}): ${item.note}`,
    )
  }
  if (diagnosis) {
    lines.push('', '## 次に確認すること', '')
    for (const action of diagnosis.immediateActions) {
      lines.push(`- [${action.priority}] ${action.title}: ${action.reason}`)
    }
    if (diagnosis.missingFacts.length > 0) {
      lines.push('', `不足情報: ${diagnosis.missingFacts.join('、')}`)
    }
  }
  lines.push(
    '',
    '> 税務処理を確定する資料ではありません。登録事実・計算根拠を確認し、必要に応じて税理士へ相談してください。',
    '',
  )
  return lines.join('\n')
}
