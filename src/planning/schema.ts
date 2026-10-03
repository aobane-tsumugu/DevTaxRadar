import { originalChargesSchema } from './originalCharges.js'
import { activityLedgerSchema } from './activityFacts.js'
import { sourceAdjustmentsSchema } from './sourceAdjustmentSchema.js'
import { treatmentDecisionBindingSchema } from './treatmentDecisionBindingSchema.js'
import { costTreatmentFactsSchema } from './costTreatmentFactsSchema.js'
import { equipmentSchema, homeCostSchema, directCostSchema } from './chargeRecords.js'
import { planningDateIssues } from './calendarDates.js'
import { z } from 'zod'
import { validIsoCalendarDate } from '../core/chargePeriods.js'
import { costPresenceRecordsSchema } from './costPresence.js'
import { equipmentMethodsSchema } from './equipmentMethods.js'
import { decisionIsConfirmed, MANUAL_DECISION_VERSION } from '../core/decisionConfirmation.js'
import { SOFTWARE_ANNUAL_DECISION_VERSION } from '../core/softwareAnnualDecision.js'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const identifier = z.string().trim().min(1).max(120)
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

export const projectRulesSchema = z.object({
  rules: z
    .array(
      projectRuleSchema.extend({
        effectiveFrom: date.refine(validIsoCalendarDate, '実在する年月日を指定してください。'),
        effectiveTo: date
          .refine(validIsoCalendarDate, '実在する年月日を指定してください。')
          .optional(),
      }),
    )
    .max(5_000),
})

export class PlanningValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlanningValidationError'
  }
}

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

const softwareAnnualDecisionBindingSchema = z.object({
  version: z.literal(1),
  accountId: identifier,
  year: z.number().int().min(2000).max(2100),
  methodBasis: z.string().trim().min(1).max(600_000),
  annualExpenseJpy: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  ordinaryYearConfirmed: z.literal(true),
})

const decisionSchema = z
  .object({
    id: identifier,
    taxUnitId: identifier,
    taxYear: z.number().int().min(2000).max(2100),
    engineVersion: z.string().trim().min(1).max(120),
    candidate: z.string().trim().min(1).max(160),
    treatmentBinding: treatmentDecisionBindingSchema.optional(),
    softwareAnnualBinding: softwareAnnualDecisionBindingSchema.optional(),
    status: z.enum(['pending', 'confirmed', 'overridden']),
    selectedCandidate: z.string().trim().min(1).max(160).optional(),
    reason: z.string().trim().max(2_000).optional(),
    createdAt: z.string().datetime({ offset: true }),
    confirmedAt: z.string().datetime({ offset: true }).optional(),
  })
  .superRefine((decision, context) => {
    if (decision.engineVersion === MANUAL_DECISION_VERSION) {
      if (
        decision.status === 'pending'
          ? decision.confirmedAt !== undefined
          : !decisionIsConfirmed(decision)
      )
        context.addIssue({
          code: 'custom',
          path: ['status'],
          message:
            '確認した扱い・根拠・確認日時を揃えてください。未確認の記録には確認日時を付けられません。',
        })
    }
    const generated = decision.softwareAnnualBinding
    if (decision.engineVersion === SOFTWARE_ANNUAL_DECISION_VERSION || generated) {
      if (
        !generated ||
        decision.engineVersion !== SOFTWARE_ANNUAL_DECISION_VERSION ||
        decision.candidate !== 'ordinary-expense' ||
        decision.selectedCandidate !== 'ordinary-expense' ||
        decision.status !== 'confirmed' ||
        !decisionIsConfirmed(decision) ||
        decision.taxYear !== generated.year
      )
        context.addIssue({
          code: 'custom',
          path: ['softwareAnnualBinding'],
          message: 'ソフトウェア年額の判断元と本人確認記録が一致しません。',
        })
    }
  })

// Manual and imported adjustments use the same validator as persistence.
export const planningSnapshotSchema = z
  .strictObject({
    activityLedger: activityLedgerSchema.optional(),
    originalCharges: originalChargesSchema.optional(),
    sourceAdjustments: sourceAdjustmentsSchema.optional(),
    costTreatmentFacts: costTreatmentFactsSchema.optional(),
    costPresence: costPresenceRecordsSchema.optional(),
    equipmentMethods: equipmentMethodsSchema.optional(),
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
    for (const link of snapshot.activityLedger?.unitLinks ?? [])
      if (!unitIds.has(link.taxUnitId))
        context.addIssue({
          code: 'custom',
          path: ['activityLedger'],
          message: '活動記録に対応する費用単位が存在しません。',
        })
    for (const fact of snapshot.activityLedger?.facts ?? [])
      for (const id of fact.evidenceIds)
        if (!knownEvidence.has(id))
          context.addIssue({
            code: 'custom',
            path: ['activityLedger'],
            message: '活動記録の証拠が存在しません。',
          })
    for (const fact of snapshot.originalCharges?.facts ?? []) {
      for (const evidenceId of [
        ...fact.evidenceIds,
        ...(fact.original.conversionEvidenceIds ?? []),
        ...(fact.legacyPreviousRecord?.evidenceIds ?? []),
      ])
        if (!knownEvidence.has(evidenceId))
          context.addIssue({
            code: 'custom',
            path: ['originalCharges'],
            message: '原請求または換算根拠の証拠が存在しません。',
          })
      const targetIds = [
        ...('taxUnitId' in fact.record && fact.record.taxUnitId ? [fact.record.taxUnitId] : []),
        ...('targets' in fact.record
          ? (fact.record.targets ?? []).map((target) => target.taxUnitId)
          : []),
      ]
      for (const targetId of targetIds)
        if (!unitIds.has(targetId))
          context.addIssue({
            code: 'custom',
            path: ['originalCharges'],
            message: '原請求の分類先に対応する制作物が存在しません。',
          })
    }
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

    for (const [index, row] of (snapshot.equipmentMethods ?? []).entries()) {
      for (const [targetIndex, target] of (row.allocation?.targets ?? []).entries())
        if (!unitIds.has(target.taxUnitId))
          context.addIssue({
            code: 'custom',
            path: ['equipmentMethods', index, 'allocation', 'targets', targetIndex, 'taxUnitId'],
            message: '配分先の制作物が存在しません。',
          })
      if (row.priorReviewId && !row.priorClosing)
        context.addIssue({
          code: 'custom',
          path: ['equipmentMethods', index, 'priorReviewId'],
          message: '前年資料IDには前年残高の記録が必要です。',
        })
      if (
        row.allocation?.targets === undefined &&
        row.allocation?.taxUnitId &&
        !unitIds.has(row.allocation.taxUnitId)
      )
        context.addIssue({
          code: 'custom',
          path: ['equipmentMethods', index, 'allocation', 'taxUnitId'],
          message: '年度別の配分先となる制作物が存在しません。',
        })
      if (!snapshot.equipment.some((item) => item.id === row.equipmentId))
        context.addIssue({
          code: 'custom',
          path: ['equipmentMethods', index, 'equipmentId'],
          message: '計算条件に対応する設備が存在しません。',
        })
    }
    for (const group of ['homeCosts', 'directCosts'] as const)
      snapshot[group].forEach((row, index) => {
        if (row.targets !== undefined && row.treatment === 'general')
          context.addIssue({
            code: 'custom',
            path: [group, index, 'targets'],
            message: '一般業務の費用には制作物別配分を設定できません。',
          })
        row.targets?.forEach((target, targetIndex) => {
          if (!unitIds.has(target.taxUnitId))
            context.addIssue({
              code: 'custom',
              path: [group, index, 'targets', targetIndex, 'taxUnitId'],
              message: '制作物・改良計画が存在しません。',
            })
        })
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

/** Keep legacy inputs readable for repair; validate calendar dates on new writes. */
export const planningSaveSchema = planningSnapshotSchema.superRefine((snapshot, context) => {
  for (const issue of planningDateIssues(snapshot))
    context.addIssue({
      code: 'custom',
      path: issue.path,
      message: '実在する年月日を指定してください。',
    })
})
