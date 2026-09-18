import { checkTreatmentDecisionReferences } from '../core/treatmentDecisionReferences.js'
import { sanitizedCaptureContext } from './observationRecords.js'
import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { ReviewMaterials } from '../accounting/reviewMaterials.js'
import type { BalanceSnapshot } from '../accounting/types.js'
import type { WorkspaceDraft } from '../planning/workspace.js'
import { resolvedTimeZone } from '../adapters/localTime.js'
import { assessCostPresence } from '../planning/costPresence.js'
import { inspectEquipmentAnnualCalculation } from '../core/equipmentAnnualCalculation.js'
import { checkBalanceReferences } from '../core/balanceReferences.js'
import { checkBalanceCostProvenance } from '../core/balanceCostProvenance.js'
import { checkBalanceFlowLinks } from '../core/balanceFlowLinks.js'
import { traceBalanceLots } from '../core/balanceLotTrace.js'
import { configurationSchema } from './configurationSchema.js'
import { planningSnapshotSchema } from './planningRepository.js'
import { readWorkspace } from './workspaceRepository.js'
import { readDashboardObservation, projectWorkspaceYears } from './dashboard.js'

const opaque = (parts: string[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex')

/** Caller must hold one DB snapshot for workspace, balances and observations. No original paths or session IDs are copied. */
export function buildReviewMaterials(
  workspace: WorkspaceDraft,
  balances: BalanceSnapshot,
  year: number,
  observation: ReturnType<typeof readDashboardObservation>,
): ReviewMaterials {
  const configuration = configurationSchema.parse(workspace.configuration)
  const parsed = planningSnapshotSchema.parse(workspace.planning)
  const planning = {
    ...parsed,
    evidence: parsed.evidence.map(({ localReference: _privateReference, ...record }) => record),
  }
  const observations = observation.sessions.map((row) => ({
    observationId: opaque(['observation', row.sourceId, row.provider, row.sessionKey]),
    sourceRef: opaque(['source', row.sourceId]),
    provider: row.provider,
    projectKey: row.projectKey,
    month: row.month,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    messageCount: row.messageCount,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
  }))
  const costYears = [
    ...new Set([
      year,
      ...planning.decisions.filter((decision) => decision.treatmentBinding && decision.taxYear <= year &&
        (balances.movements.some((movement) => movement.decisionId === decision.id && Number(movement.occurredOn.slice(0, 4)) <= year) ||
         balances.pendingDecisions.some((pending) => pending.resolution?.decisionId === decision.id && pending.resolution.taxYear <= year)))
        .map((decision) => decision.treatmentBinding!.costYear),
      ...(planning.sourceAdjustments ?? [])
        .filter((row) => row.effect === 'restate-original-cost' || Number(row.occurredOn.slice(0, 4)) <= year)
        .map((row) => row.sourceYear).filter((value) => value <= year),
      ...balances.movements
        .filter((row) => row.kind === 'addition' && Number(row.occurredOn.slice(0, 4)) <= year)
        .flatMap((row) =>
          row.kind === 'addition'
            ? (row.costAllocations ?? [])
                .map((link) => link.costYear)
                .filter((value) => value <= year)
            : [],
        ),
    ]),
  ].sort((a, b) => a - b)
  const linkedCosts = projectWorkspaceYears(workspace, observation, costYears).projections
  const costs = linkedCosts.find((row) => row.year === year)!
  const balanceLotTrace = traceBalanceLots(balances, linkedCosts, year)
  const instant = (value: unknown) =>
    typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
  const count = (value: unknown) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
  return {
    schemaVersion: 1,
    engineVersion: 'review-materials/1',
    year,
    workspaceRevision: workspace.revision,
    timeZone: resolvedTimeZone(),
    configuration: { ...configuration, chargePeriods: configuration.chargePeriods ?? [] },
    planning,
    observations,
    ...(observation.sourceCaptures ? { sourceCaptures: sanitizedCaptureContext(observation.sourceCaptures) } : {}),
    scanTimeZones: Object.fromEntries(
      Object.entries(observation.lastScanTimeZones).map(([key, zone]) => [
        opaque(['scan-source', key]),
        zone,
      ]),
    ),
    costs,
    equipmentCalculations: (planning.equipmentMethods ?? [])
      .filter((method) => method.taxYear === year)
      .map((method) =>
        inspectEquipmentAnnualCalculation(
          planning.equipment.find((equipment) => equipment.id === method.equipmentId)!,
          method,
        ),
      ),
    recentScans: observation.overview.recentScans.map((scan) => ({
      sourceRef: typeof scan.sourceId === 'string' ? opaque(['source', scan.sourceId]) : null,
      provider: scan.provider === 'claude' || scan.provider === 'codex' ? scan.provider : 'unknown',
      startedAt: instant(scan.startedAt),
      completedAt: instant(scan.completedAt),
      filesSeen: count(scan.filesSeen),
      eventsWritten: count(scan.eventsWritten),
      malformedLines: count(scan.malformedLines),
      status:
        scan.status === 'running' || scan.status === 'complete' || scan.status === 'failed'
          ? scan.status
          : 'unknown',
    })),
    referenceCheck: checkTreatmentDecisionReferences(balances, planning, linkedCosts, year, checkBalanceReferences(
      balances,
      planning,
      configuration.chargePeriods ?? [],
      linkedCosts.flatMap((row) => row.sources),
      { costs: linkedCosts, trace: balanceLotTrace },
      year,
    )),
    balanceFlowCheck: checkBalanceFlowLinks(balances, year),
    balanceLotTrace,
    costLinks: {
      costs: linkedCosts,
      check: checkBalanceCostProvenance(balances, linkedCosts, year),
    },
    taxTreatmentVerified: false,
    ...(year >= 2000 && year <= 2100
      ? {
          costPresenceCheck: {
            engineVersion: 'cost-presence/1' as const,
            year,
            items: assessCostPresence(planning, planning.costPresence ?? [], year),
          },
        }
      : {}),
  }
}

/** Can run inside adoption's BEGIN IMMEDIATE; nested SAVEPOINT keeps every read on the same snapshot. */
export function readReviewMaterials(
  db: DatabaseSync,
  balances: BalanceSnapshot,
  year: number,
): ReviewMaterials {
  return readWorkspace(
    (workspace) => buildReviewMaterials(workspace, balances, year, readDashboardObservation(db)),
    db,
  )
}
