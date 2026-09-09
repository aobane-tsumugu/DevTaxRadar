import {
  allocateSubscriptions,
  assertAllocationInvariant,
  calculateWeightedTokenUsage,
} from '../core/allocation.js'
import type { AllocationLine, BillingMonth, UnobservedUsage } from '../core/types.js'
import type { Allocation, DashboardData, TaxGroup } from '../client/types.js'
import type { ProjectClassification, TaxUnitRecord } from '../planning/types.js'
import type { UsageProvider } from '../adapters/types.ts'
import type { CostPeriod, ExpenseSource, CostTarget, AnnualCostProjection } from '../accounting/costs.js'
import { calendarMonthPeriod, projectWorkspaceCosts, type SubscriptionCostScope } from '../core/workspaceCosts.js'
import {
  chargeReviewGroups, chargeContractMessage, distinctChargeContracts,
  chargePeriodCoversMonth, monthlyAmountsForCharge,
  monthlyAmountsForCharges, type ProviderChargePeriod,
} from '../core/chargePeriods.js'
import { selectContractUsage } from '../core/contractUsage.js'
import { localDateFromTimestamp, resolvedTimeZone } from '../adapters/localTime.js'
import {
  getConfiguration, getDatabase, getLastScanTimeZones, getUsageOverview,
  getUsageSessions, type UsageSessionRow,
} from './database.js'
import { contractCoversMonth, hasAnyContractPeriod } from './contractPeriod.js'
import { getPlanningSnapshot } from './planningRepository.js'
import { resolveSessionAssignment, type SessionAssignment } from './sessionAssignment.js'
import type { WorkspaceDraft } from '../planning/workspace.js'
import type { DatabaseSync } from 'node:sqlite'

const providerLabel = { claude: 'Claude Code', codex: 'Codex' } as const
const displayBillingMonth = (month: string) => `${month.slice(0, 4)}年${Number(month.slice(5))}月`

const classificationView: Record<ProjectClassification, {
  group: TaxGroup; stage: string; candidate: string; rule: string; reason: string
}> = {
  'new-development': {
    group: 'future', stage: '新規開発', candidate: '取得価額',
    rule: '供用前の特定ソフトウェアへの直接開発',
    reason: 'ユーザーが新規開発として登録したプロダクトへのAI利用です。',
  },
  maintenance: {
    group: 'current', stage: '保守', candidate: '通常経費',
    rule: '供用済みソフトウェアの効用維持',
    reason: 'ユーザーが保守・障害修正として登録したAI利用です。',
  },
  'feature-addition': {
    group: 'future', stage: '機能追加', candidate: '資本的支出',
    rule: '既存資産への新機能追加・価値増加',
    reason: 'ユーザーが一つの改良計画として登録したAI利用です。',
  },
  'general-learning': {
    group: 'review', stage: '一般学習', candidate: '対象外',
    rule: 'ユーザーが一般学習として登録',
    reason: '特定の制作物へ直接対応しない学習として登録されています。',
  },
  private: {
    group: 'review', stage: '私用', candidate: '私用',
    rule: 'ユーザーが私用として登録',
    reason: '事業原価へ含めない利用として登録されています。',
  },
  unclassified: {
    group: 'review', stage: '未分類', candidate: '未分類',
    rule: 'ユーザー確認待ち', reason: 'プロダクトと作業目的がまだ確定していません。',
  },
}

export function safeLocalLabel(value: string | null, fallback: string): string {
  if (!value) return fallback
  const segment = value.split(/[\\/]/).filter(Boolean).at(-1) ?? fallback
  return segment.split('').filter((character) => {
    const code = character.charCodeAt(0)
    return code >= 32 && code !== 127
  }).join('').trim().slice(0, 120) || fallback
}

function displayProject(projectKey: string, projectLabel: string | null,
  taxUnitId: string | null, taxUnitById: Map<string, TaxUnitRecord>): string {
  return (taxUnitId ? taxUnitById.get(taxUnitId)?.name : undefined) ??
    safeLocalLabel(projectLabel, `Project ${projectKey.slice(-6)}`)
}

type AssignedSession = UsageSessionRow & { assignment: SessionAssignment }
type ProjectMonthGroup = {
  provider: UsageProvider; month: string; projectKey: string; taxUnitId: string | null
  classification: ProjectClassification; projectLabel: string | null; model: string | null
  sessions: number; messageCount: number; inputTokens: number; outputTokens: number
  cacheReadTokens: number; cacheWriteTokens: number; firstStartedAt: string; lastEndedAt: string
}

function groupKey(group: Pick<ProjectMonthGroup, 'provider' | 'month' | 'projectKey' | 'taxUnitId' | 'classification'>): string {
  return JSON.stringify([group.provider, group.month, group.projectKey, group.taxUnitId ?? '', group.classification])
}

function groupAssignedSessions(sessions: AssignedSession[]): ProjectMonthGroup[] {
  const groups = new Map<string, ProjectMonthGroup>()
  for (const session of sessions) {
    const key = groupKey({ ...session, ...session.assignment })
    const current = groups.get(key)
    if (!current) {
      groups.set(key, {
        provider: session.provider, month: session.month, projectKey: session.projectKey,
        taxUnitId: session.assignment.taxUnitId, classification: session.assignment.classification,
        projectLabel: session.projectLabel, model: session.model, sessions: 1,
        messageCount: session.messageCount, inputTokens: session.inputTokens,
        outputTokens: session.outputTokens, cacheReadTokens: session.cacheReadTokens,
        cacheWriteTokens: session.cacheWriteTokens,
        firstStartedAt: session.startedAt, lastEndedAt: session.endedAt,
      })
      continue
    }
    current.sessions++
    current.messageCount += session.messageCount
    current.inputTokens += session.inputTokens
    current.outputTokens += session.outputTokens
    current.cacheReadTokens += session.cacheReadTokens
    current.cacheWriteTokens += session.cacheWriteTokens
    current.projectLabel ??= session.projectLabel
    current.model ??= session.model
    if (session.startedAt < current.firstStartedAt) current.firstStartedAt = session.startedAt
    if (session.endedAt > current.lastEndedAt) current.lastEndedAt = session.endedAt
  }
  return [...groups.values()]
}

function allocationForGroup(group: ProjectMonthGroup, line: AllocationLine,
  taxUnitById: Map<string, TaxUnitRecord>, allocationId = groupKey(group)): Allocation {
  const view = classificationView[group.classification] ?? classificationView.unclassified
  const taxUnit = group.taxUnitId ? taxUnitById.get(group.taxUnitId) : undefined
  const product = taxUnit?.name ?? safeLocalLabel(group.projectLabel, `Project ${group.projectKey.slice(-6)}`)
  return {
    id: allocationId, month: displayBillingMonth(group.month), provider: providerLabel[group.provider],
    product, asset: taxUnit?.name ?? '要確認', stage: view.stage,
    usageRate: Math.round(line.allocationRatio * 1000) / 10, amount: line.allocatedAmountJpy,
    group: view.group, taxCandidate: view.candidate, confidence: taxUnit ? 'B' : 'C',
    rule: view.rule, reason: view.reason,
    missing: taxUnit ? '供用状況と対応する証拠を確認してください。' : 'プロダクト、資産単位、作業目的を選択してください。',
    projectKey: group.projectKey, monthKey: group.month,
    classification: group.classification, taxUnitId: group.taxUnitId ?? undefined,
    session: {
      date: `${group.firstStartedAt.slice(0, 10)} 〜 ${group.lastEndedAt.slice(0, 10)}`,
      id: `${group.provider === 'codex' ? 'cdx' : 'cld'}-••••-${group.projectKey.slice(-4)}`,
      folder: safeLocalLabel(group.projectLabel, '名称未取得'), branch: '取得対象外',
      model: group.model ?? 'unknown',
      tokens: group.inputTokens + group.outputTokens + group.cacheReadTokens + group.cacheWriteTokens,
      classification: taxUnit ? `期間ルール → ${taxUnit.name}` : '未分類',
      manualEdit: `${group.sessions}セッション / ${group.messageCount}メッセージ`,
    },
  }
}

function unobservedAllocation(provider: UsageProvider, month: string,
  line: AllocationLine, allocationScope = 'monthly'): Allocation {
  const adjustment = line.kind === 'rounding-adjustment'
  return {
    id: `${provider}-${month}-${allocationScope}-${line.kind}`,
    month: displayBillingMonth(month), monthKey: month, provider: providerLabel[provider],
    product: adjustment ? '丸め調整' : '未取得利用', asset: '要確認',
    stage: adjustment ? '1円未満調整' : '未取得',
    usageRate: Math.round(line.allocationRatio * 1000) / 10, amount: line.allocatedAmountJpy,
    group: 'review', taxCandidate: '未分類', confidence: 'C',
    rule: adjustment ? '請求との合計不変条件' : 'ローカル履歴で捕捉できない利用を留保',
    reason: adjustment ? '各配賦額の1円未満を切り捨てた差額です。' : 'Webチャット等、Claude Code／Codex履歴に含まれない利用分です。',
    missing: adjustment ? 'なし' : '契約・適用期間に対応する未取得利用の根拠を確認してください。',
    session: {
      date: month, id: adjustment ? 'rounding' : 'unobserved', folder: '履歴なし',
      branch: '対象外', model: '複数', tokens: 0,
      classification: adjustment ? '丸め調整' : '未取得利用', manualEdit: adjustment ? '自動' : '割合入力',
    },
  }
}

function outOfContractAllocation(session: AssignedSession,
  taxUnitById: Map<string, TaxUnitRecord>): Allocation {
  return {
    id: `out-of-contract:${JSON.stringify([session.sourceId, session.provider, session.month, session.projectKey, session.sessionKey, session.startedAt, session.endedAt])}`,
    month: displayBillingMonth(session.month), monthKey: session.month,
    provider: providerLabel[session.provider],
    product: displayProject(session.projectKey, session.projectLabel, session.assignment.taxUnitId, taxUnitById),
    asset: '対象外', stage: '契約期間外', usageRate: 0, amount: 0, group: 'review',
    taxCandidate: '契約期間外', confidence: 'C', rule: '契約期間外の利用は月額の配賦対象から除外',
    reason: '入力された契約期間の外の利用です。契約の開始日・終了日が誤っている場合は、費用の入力で修正できます。',
    missing: '契約の開始日・終了日が正しいか確認してください。',
    session: {
      date: localDateFromTimestamp(session.startedAt) ?? session.month,
      id: '契約期間外', folder: safeLocalLabel(session.projectLabel, `Project ${session.projectKey.slice(-6)}`),
      branch: '対象外', model: session.model ?? '不明', tokens: 0,
      classification: '契約期間外', manualEdit: '契約期間の入力',
    },
  }
}

export function buildDashboard(year?: number): DashboardData {
  const db = getDatabase()
  db.exec('SAVEPOINT devtax_dashboard_read')
  try {
    const result = buildDashboardFromSnapshot(year)
    db.exec('RELEASE devtax_dashboard_read')
    return result
  } catch (error) {
    db.exec('ROLLBACK TO devtax_dashboard_read')
    db.exec('RELEASE devtax_dashboard_read')
    throw error
  }
}

export function readDashboardObservation(db: DatabaseSync = getDatabase()) {
  return {
    sessions: getUsageSessions(db),
    overview: getUsageOverview(db),
    lastScanTimeZones: getLastScanTimeZones(db),
  }
}

export function projectWorkspaceYears(input: Pick<WorkspaceDraft, 'configuration' | 'planning'>,
  observation: ReturnType<typeof readDashboardObservation>, years: number[]) {
  const projections: AnnualCostProjection[] = []
  const dashboard = buildDashboardFromSnapshot(undefined, input, observation, (scopes) => {
    for (const year of years) projections.push(projectWorkspaceCosts(
      { ...input.planning, profile: { ...input.planning.profile, taxYear: year } }, scopes,
    ))
  })
  return { dashboard, projections }
}

function buildDashboardFromSnapshot(year?: number,
  input?: Pick<WorkspaceDraft, 'configuration' | 'planning'>,
  observation = readDashboardObservation(),
  inspectCosts?: (scopes: SubscriptionCostScope[]) => void): DashboardData {
  const { sessions, overview, lastScanTimeZones } = observation
  const configuration = input?.configuration ?? getConfiguration()
  const storedPlanning = input?.planning ?? getPlanningSnapshot()
  const planning = year === undefined ? storedPlanning
    : { ...storedPlanning, profile: { ...storedPlanning.profile, taxYear: year } }
  const taxUnitById = new Map(planning.taxUnits.map((unit) => [unit.id, unit]))
  const assigned: AssignedSession[] = sessions.map((session) => ({
    ...session, assignment: resolveSessionAssignment(session, planning.projectRules),
  }))
  const contracts = configuration.contracts
  const configuredChargePeriods = configuration.chargePeriods ?? []
  const chargeWarningsByYear = new Map<number, Map<string, string[]>>()
  function chargeWarningsForYear(targetYear: number): Map<string, string[]> {
    const cached = chargeWarningsByYear.get(targetYear)
    if (cached) return cached
    const warnings = new Map<string, string[]>()
    for (const period of configuredChargePeriods) {
      if (period.serviceStartedOn > `${targetYear}-12-31` || period.serviceEndedOn < `${targetYear}-01-01`) continue
      const message = chargeContractMessage(period)
      if (message) warnings.set(`ai:charge:${period.id}`, [message])
    }
    for (const { kind, ids } of chargeReviewGroups(configuredChargePeriods, targetYear)) {
      const message = distinctChargeContracts(configuredChargePeriods.filter((period) => ids.includes(period.id)))
        ? '利用期間が重なる請求を異なる契約として確認済みです。契約の履歴範囲ごとに配分し、範囲が不明・重複する原額は配分未算定として保持します。参照：' + ids.join('、')
        : kind === 'duplicate'
          ? `同じAIサービス・利用期間・原額の請求が${ids.length}件あります。重複候補のため明細を確認してください。各請求を合計に含めており、自動で除外していません。参照：${ids.join('、')}`
          : `同じAIサービスで利用期間が重なる請求の組があります。各請求は他の1件以上と重なり、全件が同日に重なるとは限りません。終了日も含めて比較し、原額を自動除外していません。参照：${ids.join('、')}`
      for (const id of ids) {
        const key = `ai:charge:${id}`
        warnings.set(key, [...(warnings.get(key) ?? []), message])
      }
    }
    chargeWarningsByYear.set(targetYear, warnings)
    return warnings
  }
  const chargePeriodsForMonth = (provider: UsageProvider, month: string) =>
    configuredChargePeriods.filter((period) => period.provider === provider && chargePeriodCoversMonth(period, month))
  const contractsConfigured = configuredChargePeriods.length > 0 || hasAnyContractPeriod(contracts)
  function withinContract(session: AssignedSession): boolean {
    const start = localDateFromTimestamp(session.startedAt)
    const end = localDateFromTimestamp(session.endedAt)
    if (!start || !end) return true
    const periods = chargePeriodsForMonth(session.provider, session.month)
    if (periods.length) return periods.some((period) => start <= period.serviceEndedOn && end >= period.serviceStartedOn)
    const contract = contracts[session.provider]
    return (!contract.startedOn || end >= contract.startedOn) && (!contract.endedOn || start <= contract.endedOn)
  }
  const coveredSessions = assigned.filter(withinContract)
  const outOfContractSessions = assigned.filter((session) => !withinContract(session))
  const classifiedSessions = assigned.filter((session) => session.assignment.classification !== 'unclassified').length
  const mappedSessions = assigned.filter((session) => session.assignment.ruleId !== null).length
  const byProviderMonth = new Map<string, ProjectMonthGroup[]>()
  for (const group of groupAssignedSessions(coveredSessions)) {
    const key = `${group.provider}:${group.month}`
    byProviderMonth.set(key, [...(byProviderMonth.get(key) ?? []), group])
  }
  const monthlyChargeRows = [
    ...configuration.monthlyCharges.filter((charge) => chargePeriodsForMonth(charge.provider, charge.month).length === 0),
    ...monthlyAmountsForCharges(configuredChargePeriods),
  ]
  const monthlyChargeByKey = new Map(monthlyChargeRows.map((charge) => [`${charge.provider}:${charge.month}`, charge.amountJpy]))
  const providerMonthKeys = new Set([...byProviderMonth.keys(), ...monthlyChargeByKey.keys()].filter((key) => {
    const [provider, month] = key.split(':') as [UsageProvider, string]
    return chargePeriodsForMonth(provider, month).length > 0 || contractCoversMonth(contracts[provider], month)
  }))
  const observedMonthKeys = new Set(assigned.map((session) => `${session.provider}:${session.month}`))
  const monthsExcludedByContract = new Set([...new Set([...observedMonthKeys, ...monthlyChargeByKey.keys()])]
    .filter((key) => !providerMonthKeys.has(key)).map((key) => key.split(':')[1])).size

  const groupById = new Map<string, ProjectMonthGroup>()
  const inputs: Array<{
    scopeId: string; provider: UsageProvider; billingMonth: BillingMonth; monthlyFeeJpy: number | null
    source: ExpenseSource; period: CostPeriod; unobservedUsage: UnobservedUsage
    sourceWarnings: string[]; usesLegacyRatio: boolean
    usageLines: Array<{ id: string; productId: string; taxUnitId?: string; bucket: 'private' | 'product'; usageWeight: number }>
  }> = []

  function allocationInput(scopeId: string, provider: UsageProvider, month: string,
    monthlyFeeJpy: number | null, sourceGroups: ProjectMonthGroup[],
    chargePeriod?: ProviderChargePeriod, captureRatio = configuration.unobservedRatio,
    scopeWarnings: string[] = []) {
    const usageLines = sourceGroups.map((group) => {
      const id = JSON.stringify([scopeId, groupKey(group)])
      groupById.set(id, group)
      return {
        id, productId: group.projectKey, taxUnitId: group.taxUnitId ?? undefined,
        bucket: group.classification === 'private' || group.classification === 'general-learning'
          ? ('private' as const) : ('product' as const),
        usageWeight: calculateWeightedTokenUsage({
          inputTokens: group.inputTokens, cachedInputTokens: group.cacheReadTokens,
          cacheCreationTokens: group.cacheWriteTokens, outputTokens: group.outputTokens,
        }),
      }
    })
    const monthPeriod = calendarMonthPeriod(month)
    const source: ExpenseSource = chargePeriod ? {
      id: `ai:charge:${chargePeriod.id}`, kind: 'subscription',
      label: chargePeriod.planName.trim() || `${providerLabel[provider]} ${chargePeriod.serviceStartedOn}～${chargePeriod.serviceEndedOn}`,
      originalAmountJpy: chargePeriod.amountJpy,
      ...(chargePeriod.amountJpy === null ? { unknownOriginalAmountReasons: [chargePeriod.unknownAmountReason ?? '請求額が未確認です。'] } : {}),
      currency: 'JPY', servicePeriod: { startedOn: chargePeriod.serviceStartedOn, endedOn: chargePeriod.serviceEndedOn },
      ...(chargePeriod.billedOn ? { billedOn: chargePeriod.billedOn } : {}),
      evidenceIds: [...(chargePeriod.evidenceIds ?? [])], origin: 'entered',
    } : {
      id: `ai:${scopeId}`, kind: 'subscription', label: `${providerLabel[provider]} ${month}`,
      originalAmountJpy: monthlyFeeJpy,
      ...(monthlyFeeJpy === null ? { unknownOriginalAmountReasons: [
        configuration.monthlyCharges.find((row) => row.provider === provider && row.month === month)?.unknownAmountReason
          ?? configuration.unknownChargeReasons?.[provider] ?? '料金が未確認です。',
      ] } : {}),
      currency: 'JPY', servicePeriod: monthPeriod, evidenceIds: [], origin: 'legacy-monthly',
    }
    return {
      scopeId, source, provider, billingMonth: month as BillingMonth, monthlyFeeJpy,
      period: chargePeriod ? {
        startedOn: monthPeriod.startedOn > chargePeriod.serviceStartedOn ? monthPeriod.startedOn : chargePeriod.serviceStartedOn,
        endedOn: monthPeriod.endedOn < chargePeriod.serviceEndedOn ? monthPeriod.endedOn : chargePeriod.serviceEndedOn,
      } : monthPeriod,
      unobservedUsage: captureRatio === null ? { kind: 'unknown' as const }
        : captureRatio === 0 ? { kind: 'confirmed-none' as const }
          : { kind: 'estimated' as const, ratio: captureRatio },
      sourceWarnings: scopeWarnings,
      usesLegacyRatio: !chargePeriod?.contractConfirmation?.usageScope,
      usageLines,
    }
  }
  for (const key of [...providerMonthKeys].sort()) {
    const [provider, month] = key.split(':') as [UsageProvider, string]
    if (chargePeriodsForMonth(provider, month).length) continue
    const amount = monthlyChargeByKey.has(key) ? monthlyChargeByKey.get(key)! : configuration.charges[provider]
    const calendar = calendarMonthPeriod(month)
    const contract = contracts[provider]
    const virtualPeriod: ProviderChargePeriod = {
      id: `monthly:${key}`, provider, planName: '', amountJpy: amount,
      serviceStartedOn: contract.startedOn && contract.startedOn > calendar.startedOn ? contract.startedOn : calendar.startedOn,
      serviceEndedOn: contract.endedOn && contract.endedOn < calendar.endedOn ? contract.endedOn : calendar.endedOn,
    }
    const selected = selectContractUsage(virtualPeriod, [], assigned, month, configuration.unobservedRatio, localDateFromTimestamp)
    inputs.push(allocationInput(`monthly:${key}`, provider, month, amount,
      groupAssignedSessions(selected.observations), undefined, selected.unobservedRatio, selected.warnings))
  }
  for (const period of configuredChargePeriods) {
    for (const amount of monthlyAmountsForCharge(period)) {
      const selected = selectContractUsage(period, configuredChargePeriods, assigned,
        amount.month, configuration.unobservedRatio, localDateFromTimestamp)
      inputs.push(allocationInput(`charge:${period.id}:${amount.month}`, period.provider,
        amount.month, amount.amountJpy, groupAssignedSessions(selected.observations),
        period, selected.unobservedRatio, selected.warnings))
    }
  }

  const allocations: Allocation[] = []
  const costScopes: SubscriptionCostScope[] = []
  for (const input of inputs) {
    const sourceWarnings = [...new Set([
      ...(chargeWarningsForYear(Number(input.billingMonth.slice(0, 4))).get(input.source.id) ?? []),
      ...input.sourceWarnings,
    ])]
    const result = input.monthlyFeeJpy === null ? null
      : (allocateSubscriptions([{ ...input, monthlyFeeJpy: input.monthlyFeeJpy }])[0] ?? null)
    if (!result && input.monthlyFeeJpy !== null) throw new Error('請求額の配分結果を生成できませんでした。')
    if (result) {
      if (result.status === 'pending') result.warnings = [...new Set([...result.warnings, ...input.sourceWarnings])]
      assertAllocationInvariant(result)
    }
    const targets: Record<string, CostTarget> = {}
    for (const usage of input.usageLines) {
      const group = groupById.get(usage.id)!
      targets[usage.id] = usage.bucket === 'private' ? { kind: 'private' }
        : group.taxUnitId ? { kind: 'tax-unit', taxUnitId: group.taxUnitId }
          : group.classification === 'maintenance' ? { kind: 'general' } : { kind: 'unallocated' }
    }
    costScopes.push({ source: input.source, sourceWarnings,
      basisId: `ai:${input.scopeId}:basis`, period: input.period, result, targets })
    if (!result) continue
    if (result.status === 'pending') {
      allocations.push({
        id: `${input.scopeId}:pending`, month: displayBillingMonth(input.billingMonth), monthKey: input.billingMonth,
        provider: providerLabel[input.provider], product: '配分未算定', asset: '対応先を確認',
        stage: '割合・配分基準の確認待ち', usageRate: null, amount: result.pendingAmountJpy,
        group: 'review', taxCandidate: '未判断', confidence: 'C',
        rule: '契約の履歴範囲・割合・配分基準が不明な支払を保持', reason: result.warnings.join(' '),
        missing: '契約・適用期間に対応する履歴範囲と捕捉外の利用割合を確認してください。',
        session: {
          date: input.billingMonth, id: 'pending-allocation', folder: '支払単位', branch: '対象外',
          model: '対象外', tokens: null, classification: '配分未算定', manualEdit: '不明を保持',
        },
      })
      continue
    }
    for (const line of result.lines) {
      if (line.kind === 'rounding-adjustment' && line.allocatedAmountJpy === 0) continue
      if (line.kind === 'unobserved' || line.kind === 'rounding-adjustment') {
        allocations.push(unobservedAllocation(result.provider, result.billingMonth, line, input.scopeId))
      } else {
        const group = line.sourceId ? groupById.get(line.sourceId) : undefined
        if (group) allocations.push(allocationForGroup(group, line, taxUnitById, line.sourceId))
      }
    }
  }
  for (const session of outOfContractSessions) allocations.push(outOfContractAllocation(session, taxUnitById))
  const months = [...new Set(inputs.map((input) => input.billingMonth))].sort().map((month) => {
    const label = displayBillingMonth(month)
    const rows = allocations.filter((row) => row.month === label)
    return {
      monthKey: month, label,
      unknownChargeIds: configuredChargePeriods.filter((period) => period.amountJpy === null && chargePeriodCoversMonth(period, month)).map((period) => period.id),
      current: rows.reduce((sum, row) => sum + (row.group === 'current' ? row.amount : 0), 0),
      future: rows.reduce((sum, row) => sum + (row.group === 'future' ? row.amount : 0), 0),
      review: rows.reduce((sum, row) => sum + (row.group === 'review' ? row.amount : 0), 0),
    }
  })
  const projectSummaries = new Map<string, {
    name: string; folder: string; sessions: number; projectKey: string
    firstObservedAt?: string; lastObservedAt?: string; firstObservedMonth: string; lastObservedMonth: string
    providers: Array<'Claude Code' | 'Codex'>
  }>()
  for (const session of assigned) {
    const current = projectSummaries.get(session.projectKey)
    projectSummaries.set(session.projectKey, {
      name: displayProject(session.projectKey, session.projectLabel, session.assignment.taxUnitId, taxUnitById),
      folder: safeLocalLabel(session.projectLabel, `Project ${session.projectKey.slice(-6)}`),
      sessions: (current?.sessions ?? 0) + 1, projectKey: session.projectKey,
      firstObservedAt: [current?.firstObservedAt, session.startedAt].filter((value): value is string => Boolean(value)).sort()[0],
      lastObservedAt: [current?.lastObservedAt, session.endedAt].filter((value): value is string => Boolean(value)).sort().at(-1),
      firstObservedMonth: [current?.firstObservedMonth, session.month].filter(Boolean).sort()[0]!,
      lastObservedMonth: [current?.lastObservedMonth, session.month].filter(Boolean).sort().at(-1)!,
      providers: [...new Set([...(current?.providers ?? []), providerLabel[session.provider]])],
    })
  }

  const futureByAsset = new Map<string, { product: string; name: string; candidate: string; total: number }>()
  for (const row of allocations.filter((item) => item.group === 'future')) {
    const key = JSON.stringify([row.product, row.asset, row.taxCandidate])
    futureByAsset.set(key, { product: row.product, name: row.asset, candidate: row.taxCandidate,
      total: (futureByAsset.get(key)?.total ?? 0) + row.amount })
  }
  const assets = [...futureByAsset.values()].map((asset) => ({
    product: asset.product, name: asset.candidate === '資本的支出' ? `${asset.name}（改良計画）` : asset.name,
    candidate: asset.candidate, total: asset.total, aiCost: asset.total, outsource: 0, other: 0,
    futureBalance: asset.total, inService: false,
  }))
  const boundaries = assets.map((asset) => {
    if (asset.candidate === '資本的支出') return {
      product: asset.product, asset: asset.name, kind: '一つの改良計画（候補）', amount: asset.total,
      threshold: 200_000, thresholdLabel: '修繕・改良の20万円形式基準（別判定）',
      status: asset.total < 200_000 ? `${(200_000 - asset.total).toLocaleString()}円手前・作業実態も確認`
        : '20万円以上：改良計画の範囲と作業実態を確認', tone: 'review' as const,
    }
    const under100 = asset.total < 100_000
    const under200 = asset.total < 200_000
    return {
      product: asset.product, asset: asset.name, kind: 'ユーザー確認中の資産単位', amount: asset.total,
      threshold: under200 ? 100_000 : 200_000, thresholdLabel: under200 ? '10万円境界' : '20万円境界',
      status: under100 ? `${(100_000 - asset.total).toLocaleString()}円手前`
        : under200 ? '10万円以上：通常償却または3年一括の候補を確認'
          : '20万円以上：通常償却等の候補を確認（青色特例は別途要件確認）',
      tone: under100 ? asset.total >= 80_000 ? ('near' as const) : ('safe' as const) : ('review' as const),
    }
  })
  const lastScan = overview.recentScans.find((scan) => scan.status === 'complete')
  const relevantSessions = assigned.filter((row) => row.month.startsWith(`${planning.profile.taxYear}-`))
  const relevantInputs = inputs.filter((row) => row.billingMonth.startsWith(`${planning.profile.taxYear}-`))
  const unclassified = relevantSessions.filter((row) => row.assignment.classification === 'unclassified').length
  const hasLegacyRatio = relevantInputs.some((row) => row.usesLegacyRatio && (row.monthlyFeeJpy === null || row.monthlyFeeJpy > 0))
  const staleTimeZones = [...new Set(Object.entries(lastScanTimeZones)
    .filter(([key]) => relevantSessions.some((row) => key === (row.sourceId === `local-${row.provider}` ? row.provider : `${row.sourceId}:${row.provider}`)))
    .map(([, zone]) => zone))].filter((zone) => zone !== resolvedTimeZone())
  inspectCosts?.(costScopes)
  return {
    costProjection: projectWorkspaceCosts(planning, costScopes),
    unknownCharges: configuredChargePeriods.filter((period) => period.amountJpy === null).map((period) => ({
      id: period.id, provider: period.provider, serviceStartedOn: period.serviceStartedOn,
      serviceEndedOn: period.serviceEndedOn, reason: period.unknownAmountReason!,
    })),
    meta: {
      source: 'local', sessionCount: overview.providers.reduce((sum, row) => sum + row.sessions, 0),
      lastSynced: typeof lastScan?.completedAt === 'string' ? new Date(lastScan.completedAt).toLocaleString('ja-JP') : '未走査',
      mappedRate: sessions.length === 0 ? 0 : Math.round(mappedSessions / sessions.length * 100),
      classifiedRate: sessions.length === 0 ? 0 : Math.round(classifiedSessions / sessions.length * 100),
    },
    months, allocations,
    boundaries: configuredChargePeriods.some((period) => period.amountJpy === null) ? [] : boundaries,
    assets,
    guidance: [
      ...(!contractsConfigured && hasLegacyRatio ? [{
        title: '契約期間が未入力です',
        description: '対象年の履歴に既定の月額を適用しています。実際の契約期間を入力すると、契約外の月を配賦から外せます。',
        severity: 'warning' as const,
      }] : []),
      ...(contractsConfigured && monthsExcludedByContract > 0 ? [providerMonthKeys.size === 0 ? {
        title: '契約期間が利用履歴と重なっていません',
        description: '契約期間の中に配賦する利用月がありません。実際の開始日・終了日を確認してください。',
        severity: 'warning' as const,
      } : {
        title: `契約期間外の${monthsExcludedByContract}か月を配賦から除外しています`,
        description: '除外された利用は、配賦明細に「契約期間外」として金額0で残しています。', severity: 'ok' as const,
      }] : []),
      ...(staleTimeZones.length ? [{
        title: 'タイムゾーンが走査時と変わっています',
        description: `対象年の走査時は${staleTimeZones.join('・')}、現在は${resolvedTimeZone()}です。再走査で現在の暦へ付け直します。保存済みの年度採用資料は変更しません。`,
        severity: 'warning' as const,
      }] : []),
      ...(unclassified ? [{ title: `${unclassified}件の未分類利用（セッション単位）`,
        description: '対象年のプロダクトと作業目的を確認してください。', severity: 'warning' as const }] : []),
      ...(hasLegacyRatio ? [{
        title: configuration.unobservedRatio === null ? '履歴にない利用の割合が不明です'
          : `履歴にない利用 ${configuration.unobservedRatio * 100}%`,
        description: configuration.unobservedRatio === null
          ? '支払額は配分未算定として保持しています。不明を0%へ置き換えていません。'
          : '期間別の指定がない請求だけに既存割合を使用しています。この期間について本人確認済みとは断定していません。',
        severity: configuration.unobservedRatio === null ? ('warning' as const) : ('ok' as const),
      }] : []),
    ],
    products: [...projectSummaries.values()],
  }
}
