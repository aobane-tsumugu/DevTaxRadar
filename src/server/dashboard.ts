import { createSourceAdjuster, adjustSubscriptionScope } from '../core/adjustedCostSources.js'
import type { DatabaseSync } from 'node:sqlite'
import type { Allocation, DashboardData } from '../client/types.js'
import type { UsageProvider } from '../adapters/types.js'
import type { CostPeriod, ExpenseSource, CostTarget, AnnualCostProjection } from '../accounting/costs.js'
import type { SourceCaptureContext } from '../accounting/observationRecord.js'
import type { WorkspaceDraft } from '../planning/workspace.js'
import type { BillingMonth, UnobservedUsage } from '../core/types.js'
import { allocateMonthlySubscription, assertAllocationInvariant, calculateWeightedTokenUsage } from '../core/allocation.js'
import { calendarMonthPeriod, projectWorkspaceCosts, type SubscriptionCostScope } from '../core/workspaceCosts.js'
import { chargeReviewGroups, chargeContractMessage, distinctChargeContracts,
  chargePeriodCoversMonth, monthlyAmountsForCharge, monthlyAmountsForCharges,
  type ProviderChargePeriod } from '../core/chargePeriods.js'
import { selectContractUsage } from '../core/contractUsage.js'
import { observationGroupKey, type UsageObservation } from '../core/usageGranularity.js'
import { captureWarnings } from '../core/captureProvenance.js'
import { localDateFromTimestamp, resolvedTimeZone } from '../adapters/localTime.js'
import { getConfiguration, getDatabase, getLastScanTimeZones, getUsageOverview, getUsageSessions } from './database.js'
import { readUsageObservations } from './usageObservations.js'
import { readSourceCaptureContext } from './observationRecords.js'
import { contractCoversMonth, hasAnyContractPeriod } from './contractPeriod.js'
import { getPlanningSnapshot } from './planningRepository.js'
import { resolveSessionAssignment } from './sessionAssignment.js'
import {
  providerLabel, displayBillingMonth, safeLocalLabel, displayProject,
  groupKey, groupAssignedSessions, allocationForGroup, unobservedAllocation,
  outOfContractAllocation, type AssignedSession, type ProjectMonthGroup,
} from './dashboardPresentation.js'

export { safeLocalLabel } from './dashboardPresentation.js'

export function buildDashboard(year?: number): DashboardData {
  const db = getDatabase()
  // Read (or reuse) the observations before opening the savepoint: the reuse check needs a
  // connection outside a transaction, and nothing can write in between on this sync path.
  const observation = readDashboardObservation(db)
  db.exec('SAVEPOINT devtax_dashboard_read')
  try {
    const result = buildDashboardFromSnapshot(year, undefined, observation)
    db.exec('RELEASE devtax_dashboard_read')
    return result
  } catch (error) {
    db.exec('ROLLBACK TO devtax_dashboard_read; RELEASE devtax_dashboard_read')
    throw error
  }
}

type DashboardObservation = {
  sessions: UsageObservation[]
  overview: ReturnType<typeof getUsageOverview>
  lastScanTimeZones: Record<string, string>
  sourceCaptures?: SourceCaptureContext[]
}

const observationCache = new WeakMap<DatabaseSync, { key: string; value: DashboardObservation }>()

/**
 * Identifies the committed database state: `data_version` moves when another connection
 * commits and `total_changes()` when this one writes anything. Unknown inside a transaction,
 * where uncommitted rows could still roll back.
 */
function observationCacheKey(db: DatabaseSync): string | undefined {
  if (db.isTransaction) return undefined
  const version = db.prepare('PRAGMA data_version').get() as { data_version: number }
  const changes = db.prepare('SELECT total_changes() AS n').get() as { n: number }
  return `${version.data_version}:${changes.n}`
}

/**
 * Expanding every dated usage row costs seconds on a real history, so an unchanged database
 * returns the previous, frozen result. Any write — scan, save or restore — recomputes.
 */
export function readDashboardObservation(db: DatabaseSync = getDatabase()): DashboardObservation {
  const key = observationCacheKey(db)
  const cached = observationCache.get(db)
  if (key && cached?.key === key) return cached.value
  const sessions = readUsageObservations(db, getUsageSessions(db))
  const value: DashboardObservation = {
    sessions, sourceCaptures: readSourceCaptureContext(db, sessions),
    overview: getUsageOverview(db), lastScanTimeZones: getLastScanTimeZones(db),
  }
  if (!key) return value
  for (const row of sessions) Object.freeze(row)
  Object.freeze(sessions)
  if (value.sourceCaptures) Object.freeze(value.sourceCaptures)
  Object.freeze(value)
  observationCache.set(db, { key, value })
  return value
}

export function projectWorkspaceYears(
  input: Pick<WorkspaceDraft, 'configuration' | 'planning'>,
  observation: ReturnType<typeof readDashboardObservation>, years: number[],
) {
  const projections: AnnualCostProjection[] = []
  const dashboard = buildDashboardFromSnapshot(undefined, input, observation, (scopes) => {
    for (const year of years) projections.push(projectWorkspaceCosts(
      { ...input.planning, profile: { ...input.planning.profile, taxYear: year } }, scopes,
    ))
  })
  return { dashboard, projections }
}

function buildDashboardFromSnapshot(
  year?: number, input?: Pick<WorkspaceDraft, 'configuration' | 'planning'>,
  observation = readDashboardObservation(),
  inspectCosts?: (scopes: SubscriptionCostScope[]) => void,
): DashboardData {
  const { sessions, overview, lastScanTimeZones } = observation
  const configuration = input?.configuration ?? getConfiguration()
  const storedPlanning = input?.planning ?? getPlanningSnapshot()
  const planning = year === undefined ? storedPlanning :
    { ...storedPlanning, profile: { ...storedPlanning.profile, taxYear: year } }
  const units = new Map(planning.taxUnits.map((unit) => [unit.id, unit]))
  const assigned: AssignedSession[] = sessions.map((session) => ({
    ...session, assignment: resolveSessionAssignment(session, planning.projectRules),
  }))
  const contracts = configuration.contracts
  const chargePeriods = configuration.chargePeriods ?? []
  const warningsByYear = new Map<number, Map<string, string[]>>()
  function chargeWarningsForYear(targetYear: number) {
    const cached = warningsByYear.get(targetYear)
    if (cached) return cached
    const warnings = new Map<string, string[]>()
    for (const period of chargePeriods) {
      if (period.serviceStartedOn > `${targetYear}-12-31` || period.serviceEndedOn < `${targetYear}-01-01`) continue
      const message = chargeContractMessage(period)
      if (message) warnings.set(`ai:charge:${period.id}`, [message])
    }
    for (const { kind, ids } of chargeReviewGroups(chargePeriods, targetYear)) {
      const message = distinctChargeContracts(chargePeriods.filter((period) => ids.includes(period.id)))
        ? '重なる請求を別契約として確認済みです。契約ごとに履歴範囲を使い、範囲の不明・重複は配分未算定として保持します。参照：' + ids.join('、')
        : kind === 'duplicate'
          ? `同じAIサービス・利用期間・原額の請求が${ids.length}件あります。重複候補ですが原額を自動除外していません。参照：${ids.join('、')}`
          : `同じAIサービスの請求期間が重なっています。全件が同日に重なるとは限りません。原額を自動除外していません。参照：${ids.join('、')}`
      for (const id of ids) {
        const key = `ai:charge:${id}`
        warnings.set(key, [...(warnings.get(key) ?? []), message])
      }
    }
    warningsByYear.set(targetYear, warnings)
    return warnings
  }
  const periodsForMonth = (provider: UsageProvider, month: string) =>
    chargePeriods.filter((period) => period.provider === provider && chargePeriodCoversMonth(period, month))
  const contractsConfigured = chargePeriods.length > 0 || hasAnyContractPeriod(contracts)
  function withinContract(session: AssignedSession): boolean {
    const start = localDateFromTimestamp(session.startedAt)
    const end = localDateFromTimestamp(session.endedAt)
    if (!start || !end) return true
    const periods = periodsForMonth(session.provider, session.month)
    if (periods.length) return periods.some((period) => start <= period.serviceEndedOn && end >= period.serviceStartedOn)
    const contract = contracts[session.provider]
    return (!contract.startedOn || end >= contract.startedOn) && (!contract.endedOn || start <= contract.endedOn)
  }
  const coveredSessions = assigned.filter(withinContract)
  const outOfContractSessions = assigned.filter((session) => !withinContract(session))
  const sessionIds = new Set(assigned.map(observationGroupKey))
  const unclassifiedIds = new Set(assigned.filter((row) => row.assignment.classification === 'unclassified').map(observationGroupKey))
  const unmappedIds = new Set(assigned.filter((row) => row.assignment.ruleId === null).map(observationGroupKey))
  const monthlyChargeRows = [
    ...configuration.monthlyCharges.filter((charge) => periodsForMonth(charge.provider, charge.month).length === 0),
    ...monthlyAmountsForCharges(chargePeriods),
  ]
  const monthlyChargeByKey = new Map(monthlyChargeRows.map((charge) => [`${charge.provider}:${charge.month}`, charge.amountJpy]))
  const providerMonthKeys = new Set([
    ...coveredSessions.map((session) => `${session.provider}:${session.month}`),
    ...monthlyChargeByKey.keys(),
  ].filter((key) => {
    const [provider, month] = key.split(':') as [UsageProvider, string]
    return periodsForMonth(provider, month).length > 0 || contractCoversMonth(contracts[provider], month)
  }))
  const observedMonthKeys = new Set(assigned.map((session) => `${session.provider}:${session.month}`))
  const excludedMonths = new Set([...new Set([...observedMonthKeys, ...monthlyChargeByKey.keys()])]
    .filter((key) => !providerMonthKeys.has(key)).map((key) => key.split(':')[1])).size
  const groupById = new Map<string, ProjectMonthGroup>()
  const inputs: Array<{
    scopeId: string; provider: UsageProvider; billingMonth: BillingMonth; monthlyFeeJpy: number | null
    source: ExpenseSource; period: CostPeriod; unobservedUsage: UnobservedUsage
    sourceWarnings: string[]; usesLegacyRatio: boolean
    usageLines: Array<{ id: string; productId: string; taxUnitId?: string; bucket: 'private' | 'product'; usageWeight: number }>
  }> = []

  function allocationInput(
    scopeId: string, provider: UsageProvider, month: string,
    monthlyFeeJpy: number | null, sourceGroups: ProjectMonthGroup[],
    charge?: ProviderChargePeriod, captureRatio = configuration.unobservedRatio,
    scopeWarnings: string[] = [],
  ) {
    const usageLines = sourceGroups.map((group) => {
      const id = JSON.stringify([scopeId, groupKey(group)])
      groupById.set(id, group)
      return {
        id, productId: group.projectKey, taxUnitId: group.taxUnitId ?? undefined,
        bucket: group.classification === 'private' || group.classification === 'general-learning'
          ? ('private' as const) : ('product' as const),
        usageWeight: calculateWeightedTokenUsage({ inputTokens: group.inputTokens,
          cachedInputTokens: group.cacheReadTokens, cacheCreationTokens: group.cacheWriteTokens,
          outputTokens: group.outputTokens }),
      }
    })
    const calendar = calendarMonthPeriod(month)
    const source: ExpenseSource = charge ? {
      id: `ai:charge:${charge.id}`, kind: 'subscription',
      label: charge.planName.trim() || `${providerLabel[provider]} ${charge.serviceStartedOn}～${charge.serviceEndedOn}`,
      originalAmountJpy: charge.amountJpy,
      ...(charge.amountJpy === null ? { unknownOriginalAmountReasons: [charge.unknownAmountReason ?? '請求額が未確認です。'] } : {}),
      currency: 'JPY', servicePeriod: { startedOn: charge.serviceStartedOn, endedOn: charge.serviceEndedOn },
      ...(charge.billedOn ? { billedOn: charge.billedOn } : {}),
      evidenceIds: [...(charge.evidenceIds ?? [])], origin: 'entered',
    } : {
      id: `ai:${scopeId}`, kind: 'subscription', label: `${providerLabel[provider]} ${month}`,
      originalAmountJpy: monthlyFeeJpy,
      ...(monthlyFeeJpy === null ? { unknownOriginalAmountReasons: [
        configuration.monthlyCharges.find((row) => row.provider === provider && row.month === month)?.unknownAmountReason ??
          configuration.unknownChargeReasons?.[provider] ?? '料金が未確認です。',
      ] } : {}),
      currency: 'JPY', servicePeriod: calendar, evidenceIds: [], origin: 'legacy-monthly',
    }
    return {
      scopeId, source, provider, billingMonth: month as BillingMonth, monthlyFeeJpy,
      period: charge ? {
        startedOn: calendar.startedOn > charge.serviceStartedOn ? calendar.startedOn : charge.serviceStartedOn,
        endedOn: calendar.endedOn < charge.serviceEndedOn ? calendar.endedOn : charge.serviceEndedOn,
      } : calendar,
      unobservedUsage: captureRatio === null ? { kind: 'unknown' as const } :
        captureRatio === 0 ? { kind: 'confirmed-none' as const } : { kind: 'estimated' as const, ratio: captureRatio },
      sourceWarnings: [...scopeWarnings, ...captureWarnings(observation.sourceCaptures, provider,
        charge?.contractConfirmation?.usageScope?.kind === 'selected'
          ? [...new Set(charge.contractConfirmation.usageScope.selectors.map((selector) => selector.sourceId))] : undefined)],
      usesLegacyRatio: !charge?.contractConfirmation?.usageScope,
      usageLines,
    }
  }
  for (const key of [...providerMonthKeys].sort()) {
    const [provider, month] = key.split(':') as [UsageProvider, string]
    if (periodsForMonth(provider, month).length) continue
    const amount = monthlyChargeByKey.has(key) ? monthlyChargeByKey.get(key)! : configuration.charges[provider]
    const calendar = calendarMonthPeriod(month), contract = contracts[provider]
    const virtual: ProviderChargePeriod = {
      id: `monthly:${key}`, provider, planName: '', amountJpy: amount,
      serviceStartedOn: contract.startedOn && contract.startedOn > calendar.startedOn ? contract.startedOn : calendar.startedOn,
      serviceEndedOn: contract.endedOn && contract.endedOn < calendar.endedOn ? contract.endedOn : calendar.endedOn,
    }
    const selected = selectContractUsage(virtual, [], assigned, month, configuration.unobservedRatio, localDateFromTimestamp)
    inputs.push(allocationInput(`monthly:${key}`, provider, month, amount,
      groupAssignedSessions(selected.observations), undefined, selected.unobservedRatio, selected.warnings))
  }
  for (const period of chargePeriods) {
    for (const amount of monthlyAmountsForCharge(period)) {
      const selected = selectContractUsage(period, chargePeriods, assigned,
        amount.month, configuration.unobservedRatio, localDateFromTimestamp)
      inputs.push(allocationInput(`charge:${period.id}:${amount.month}`, period.provider,
        amount.month, amount.amountJpy, groupAssignedSessions(selected.observations),
        period, selected.unobservedRatio, selected.warnings))
    }
  }

  const adjusters = new Map<number, ReturnType<typeof createSourceAdjuster>>()
  const adjustmentEvidence = new Set(planning.evidence.map((row) => row.id))
  const allocations: Allocation[] = [], costScopes: SubscriptionCostScope[] = []
  for (const input of inputs) {
    const sourceWarnings = [...new Set([
      ...(chargeWarningsForYear(Number(input.billingMonth.slice(0, 4))).get(input.source.id) ?? []), ...input.sourceWarnings,
    ])]
    // Every invoice is an independent denominator; no redundant one-item batch.
    let result = input.monthlyFeeJpy === null ? null :
      allocateMonthlySubscription({ ...input, monthlyFeeJpy: input.monthlyFeeJpy })
    if (result) {
      if (result.status === 'pending') result.warnings = [...new Set([...result.warnings, ...input.sourceWarnings])]
      assertAllocationInvariant(result)
    }
    const targets: Record<string, CostTarget> = {}
    for (const usage of input.usageLines) {
      const group = groupById.get(usage.id)!
      targets[usage.id] = usage.bucket === 'private' ? { kind: 'private' } :
        group.taxUnitId ? { kind: 'tax-unit', taxUnitId: group.taxUnitId } :
          group.classification === 'maintenance' ? { kind: 'general' } : { kind: 'unallocated' }
    }
    const costYear = Number(input.billingMonth.slice(0, 4))
    if (!adjusters.has(costYear)) adjusters.set(costYear, createSourceAdjuster(planning.sourceAdjustments, adjustmentEvidence, costYear))
    const scope = adjustSubscriptionScope({ source: input.source, sourceWarnings,
      basisId: `ai:${input.scopeId}:basis`, period: input.period, result, targets }, adjusters.get(costYear)!)
    costScopes.push(scope)
    result = scope.result
    if (!result) continue
    if (result.status === 'pending') {
      allocations.push({
        id: `${input.scopeId}:pending`, month: displayBillingMonth(input.billingMonth), monthKey: input.billingMonth,
        provider: providerLabel[input.provider], product: '配分未算定', asset: '対応先を確認',
        stage: '割合・配分基準の確認待ち', usageRate: null, amount: result.pendingAmountJpy,
        group: 'review', taxCandidate: '未判断', confidence: 'C',
        rule: '契約の履歴範囲・割合・配分基準が不明な支払を保持', reason: result.warnings.join(' '),
        missing: '契約・適用期間に対応する履歴範囲と捕捉外の利用割合を確認してください。',
        session: { date: input.billingMonth, id: 'pending-allocation', folder: '支払単位', branch: '対象外',
          model: '対象外', tokens: null, classification: '配分未算定', manualEdit: '不明を保持' },
      })
      continue
    }
    const firstRow = allocations.length
    for (const line of result.lines) {
      if (line.kind === 'rounding-adjustment' && line.allocatedAmountJpy === 0) continue
      if (line.kind === 'unobserved' || line.kind === 'rounding-adjustment') {
        allocations.push(unobservedAllocation(result.provider, result.billingMonth, line, input.scopeId))
      } else {
        const group = line.sourceId ? groupById.get(line.sourceId) : undefined
        if (group) allocations.push(allocationForGroup(group, line, units, line.sourceId))
      }
    }
    if (scope.source.adjustments?.length) {
      for (const row of allocations.slice(firstRow)) {
        row.reason += ' 返金・訂正後の費用基礎から再配分しています。元の請求額と訂正理由は「支払と配分」に保持しています。'
      }
    }
  }
  for (const session of outOfContractSessions) allocations.push(outOfContractAllocation(session, units))
  const months = [...new Set(inputs.map((input) => input.billingMonth))].sort().map((month) => {
    const rows = allocations.filter((row) => row.monthKey === month)
    return {
      monthKey: month, label: displayBillingMonth(month),
      unknownChargeIds: chargePeriods.filter((period) => period.amountJpy === null && chargePeriodCoversMonth(period, month)).map((period) => period.id),
      current: rows.reduce((sum, row) => sum + (row.group === 'current' ? row.amount : 0), 0),
      future: rows.reduce((sum, row) => sum + (row.group === 'future' ? row.amount : 0), 0),
      review: rows.reduce((sum, row) => sum + (row.group === 'review' ? row.amount : 0), 0),
    }
  })
  const projects = new Map<string, DashboardData['products'][number]>()
  const projectSessionIds = new Map<string, Set<string>>()
  for (const session of assigned) {
    const identities = projectSessionIds.get(session.projectKey) ?? new Set<string>()
    identities.add(observationGroupKey(session))
    projectSessionIds.set(session.projectKey, identities)
    const current = projects.get(session.projectKey)
    projects.set(session.projectKey, {
      name: displayProject(session.projectKey, session.projectLabel, session.assignment.taxUnitId, units),
      folder: safeLocalLabel(session.projectLabel, `Project ${session.projectKey.slice(-6)}`),
      sessions: identities.size, projectKey: session.projectKey,
      firstObservedAt: [current?.firstObservedAt, session.startedAt].filter((value): value is string => Boolean(value)).sort()[0],
      lastObservedAt: [current?.lastObservedAt, session.endedAt].filter((value): value is string => Boolean(value)).sort().at(-1),
      firstObservedMonth: [current?.firstObservedMonth, session.month].filter(Boolean).sort()[0]!,
      lastObservedMonth: [current?.lastObservedMonth, session.month].filter(Boolean).sort().at(-1)!,
      providers: [...new Set([...(current?.providers ?? []), providerLabel[session.provider]])],
    })
  }
  const lastScan = overview.recentScans.find((scan) => scan.status === 'complete')
  const relevantSessions = assigned.filter((row) => row.month.startsWith(`${planning.profile.taxYear}-`))
  const relevantInputs = inputs.filter((row) => row.billingMonth.startsWith(`${planning.profile.taxYear}-`))
  const unclassified = new Set(relevantSessions.filter((row) => row.assignment.classification === 'unclassified').map(observationGroupKey)).size
  const hasLegacyRatio = relevantInputs.some((row) => row.usesLegacyRatio && (row.monthlyFeeJpy === null || row.monthlyFeeJpy > 0))
  const staleTimeZones = [...new Set(Object.entries(lastScanTimeZones)
    .filter(([key]) => relevantSessions.some((row) => key === (row.sourceId === `local-${row.provider}` ? row.provider : `${row.sourceId}:${row.provider}`)))
    .map(([, zone]) => zone))].filter((zone) => zone !== resolvedTimeZone())
  inspectCosts?.(costScopes)
  return {
    costProjection: projectWorkspaceCosts(planning, costScopes),
    unknownCharges: chargePeriods.filter((period) => period.amountJpy === null).map((period) => ({
      id: period.id, provider: period.provider, serviceStartedOn: period.serviceStartedOn,
      serviceEndedOn: period.serviceEndedOn, reason: period.unknownAmountReason!,
    })),
    meta: {
      source: 'local', sessionCount: overview.providers.reduce((sum, row) => sum + row.sessions, 0),
      lastSynced: typeof lastScan?.completedAt === 'string' ? new Date(lastScan.completedAt).toLocaleString('ja-JP') : '未走査',
      mappedRate: sessionIds.size ? Math.round((sessionIds.size - unmappedIds.size) / sessionIds.size * 100) : 0,
      classifiedRate: sessionIds.size ? Math.round((sessionIds.size - unclassifiedIds.size) / sessionIds.size * 100) : 0,
    },
    months, allocations, products: [...projects.values()],
    guidance: [
      ...((planning.sourceAdjustments ?? []).length ? [{
        title: '返金・訂正の記録を含みます',
        description: '原額と訂正を分けて保持しています。元費用の訂正を選んだ範囲だけ作業中の配分を再計算し、採用済み年度資料は変更しません。原額不明・確認内容の変更等は未算定です。',
        severity: 'warning' as const,
      }] : []),
      ...(!contractsConfigured && hasLegacyRatio ? [{ title: '契約期間が未入力です',
        description: '対象年の履歴に既定月額を適用しています。実際の契約期間を入力すると契約外の月を除外できます。', severity: 'warning' as const }] : []),
      ...(contractsConfigured && excludedMonths > 0 ? [providerMonthKeys.size === 0 ? {
        title: '契約期間が利用履歴と重なっていません', description: '契約期間の中に配賦する利用月がありません。実際の開始日・終了日を確認してください。', severity: 'warning' as const,
      } : { title: `契約期間外の${excludedMonths}か月を配賦から除外しています`,
        description: '除外された利用は「契約期間外」として金額0で残しています。', severity: 'ok' as const }] : []),
      ...(staleTimeZones.length ? [{ title: 'タイムゾーンが走査時と変わっています',
        description: `対象年の走査時は${staleTimeZones.join('・')}、現在は${resolvedTimeZone()}です。再走査で暦を付け直します。保存済み年度資料は変更しません。`, severity: 'warning' as const }] : []),
      ...(unclassified ? [{ title: `${unclassified}件の未分類利用（セッション単位）`,
        description: '対象年の制作物と作業目的を確認してください。', severity: 'warning' as const }] : []),
      ...(hasLegacyRatio ? [{ title: configuration.unobservedRatio === null ? '履歴にない利用の割合が不明です' : `履歴にない利用 ${configuration.unobservedRatio * 100}%`,
        description: configuration.unobservedRatio === null ? '支払額は配分未算定として保持しています。不明を0%に置換していません。' :
          '期間別指定がない請求だけに既存割合を使用しています。この期間について本人確認済みとは断定していません。',
        severity: configuration.unobservedRatio === null ? ('warning' as const) : ('ok' as const) }] : []),
    ],
  }
}
