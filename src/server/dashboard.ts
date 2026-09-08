import {
  allocateSubscriptions,
  assertAllocationInvariant,
  calculateWeightedTokenUsage,
  type AllocationLine,
  type BillingMonth,
  type UnobservedUsage,
} from '../core/index.js'
import type { Allocation, DashboardData, TaxGroup } from '../client/types.js'
import type { ProjectClassification, TaxUnitRecord } from '../planning/types.js'
import type { UsageProvider } from '../adapters/types.ts'
import type { CostPeriod, ExpenseSource, CostTarget } from '../accounting/costs.js'
import {
  calendarMonthPeriod,
  projectWorkspaceCosts,
  type SubscriptionCostScope,
} from '../core/workspaceCosts.js'
import type { ProviderChargePeriod } from '../core/chargePeriods.js'
import { chargeReviewGroups, chargeContractMessage, distinctChargeContracts } from '../core/chargePeriods.js'
import { localDateFromTimestamp, resolvedTimeZone } from '../adapters/localTime.js'
import {
  chargePeriodCoversDate,
  chargePeriodCoversMonth,
  monthlyAmountsForCharge,
  monthlyAmountsForCharges,
} from '../core/chargePeriods.js'
import {
  getConfiguration,
  getDatabase,
  getLastScanTimeZones,
  getUsageOverview,
  getUsageSessions,
  type UsageSessionRow,
} from './database.js'
import { contractCoversDate, contractCoversMonth, hasAnyContractPeriod } from './contractPeriod.js'
import { getPlanningSnapshot } from './planningRepository.js'
import { resolveSessionAssignment, type SessionAssignment } from './sessionAssignment.js'
import type { WorkspaceDraft } from '../planning/workspace.js'
import type { AnnualCostProjection } from '../accounting/costs.js'
import type { DatabaseSync } from 'node:sqlite'

const providerLabel = {
  claude: 'Claude Code',
  codex: 'Codex',
} as const

function displayBillingMonth(month: string): string {
  return `${month.slice(0, 4)}年${Number(month.slice(5))}月`
}

const classificationView: Record<
  ProjectClassification,
  {
    group: TaxGroup
    stage: string
    candidate: string
    rule: string
    reason: string
  }
> = {
  'new-development': {
    group: 'future',
    stage: '新規開発',
    candidate: '取得価額',
    rule: '供用前の特定ソフトウェアへの直接開発',
    reason: 'ユーザーが新規開発として登録したプロダクトへのAI利用です。',
  },
  maintenance: {
    group: 'current',
    stage: '保守',
    candidate: '通常経費',
    rule: '供用済みソフトウェアの効用維持',
    reason: 'ユーザーが保守・障害修正として登録したAI利用です。',
  },
  'feature-addition': {
    group: 'future',
    stage: '機能追加',
    candidate: '資本的支出',
    rule: '既存資産への新機能追加・価値増加',
    reason: 'ユーザーが一つの改良計画として登録したAI利用です。',
  },
  'general-learning': {
    group: 'review',
    stage: '一般学習',
    candidate: '対象外',
    rule: 'ユーザーが一般学習として登録',
    reason: '特定の制作物へ直接対応しない学習として登録されています。',
  },
  private: {
    group: 'review',
    stage: '私用',
    candidate: '私用',
    rule: 'ユーザーが私用として登録',
    reason: '事業原価へ含めない利用として登録されています。',
  },
  unclassified: {
    group: 'review',
    stage: '未分類',
    candidate: '未分類',
    rule: 'ユーザー確認待ち',
    reason: 'プロダクトと作業目的がまだ確定していません。',
  },
}

export function safeLocalLabel(value: string | null, fallback: string): string {
  if (!value) return fallback
  const finalSegment = value.split(/[\\/]/).filter(Boolean).at(-1) ?? fallback
  const cleaned = finalSegment
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code >= 32 && code !== 127
    })
    .join('')
    .trim()
    .slice(0, 120)
  return cleaned || fallback
}

function displayProject(
  projectKey: string,
  projectLabel: string | null,
  taxUnitId: string | null,
  taxUnitById: Map<string, TaxUnitRecord>,
): string {
  const taxUnit = taxUnitId ? taxUnitById.get(taxUnitId) : undefined
  return taxUnit?.name ?? safeLocalLabel(projectLabel, `Project ${projectKey.slice(-6)}`)
}

type AssignedSession = UsageSessionRow & { assignment: SessionAssignment }

type ProjectMonthGroup = {
  provider: 'claude' | 'codex'
  month: string
  projectKey: string
  taxUnitId: string | null
  classification: ProjectClassification
  projectLabel: string | null
  model: string | null
  sessions: number
  messageCount: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  firstStartedAt: string
  lastEndedAt: string
}

function groupKey(group: ProjectMonthGroup): string {
  // taxUnitId is a user-entered identifier (src/server/planningRepository.ts's
  // `identifier` schema permits any character), so joining fields with ':'
  // could let a taxUnitId containing ':' merge two distinct classification
  // groups into one row. JSON.stringify keeps each field distinguishable.
  return JSON.stringify([
    group.provider,
    group.month,
    group.projectKey,
    group.taxUnitId ?? '',
    group.classification,
  ])
}

function groupAssignedSessions(sessions: AssignedSession[]): ProjectMonthGroup[] {
  const groups = new Map<string, ProjectMonthGroup>()
  for (const session of sessions) {
    const key = JSON.stringify([
      session.provider,
      session.month,
      session.projectKey,
      session.assignment.taxUnitId ?? '',
      session.assignment.classification,
    ])
    const current = groups.get(key)
    if (!current) {
      groups.set(key, {
        provider: session.provider,
        month: session.month,
        projectKey: session.projectKey,
        taxUnitId: session.assignment.taxUnitId,
        classification: session.assignment.classification,
        projectLabel: session.projectLabel,
        model: session.model,
        sessions: 1,
        messageCount: session.messageCount,
        inputTokens: session.inputTokens,
        outputTokens: session.outputTokens,
        cacheReadTokens: session.cacheReadTokens,
        cacheWriteTokens: session.cacheWriteTokens,
        firstStartedAt: session.startedAt,
        lastEndedAt: session.endedAt,
      })
      continue
    }
    current.sessions += 1
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

function allocationForGroup(
  group: ProjectMonthGroup,
  line: AllocationLine,
  taxUnitById: Map<string, TaxUnitRecord>,
  allocationId = groupKey(group),
): Allocation {
  // getPlanningSnapshot() returns DB rows, so an unexpected classification
  // value (e.g. an older DB row from before an enum change) must not throw --
  // fall back to the unclassified view rather than crashing /api/dashboard.
  const view = classificationView[group.classification] ?? classificationView.unclassified
  const taxUnit = group.taxUnitId ? taxUnitById.get(group.taxUnitId) : undefined
  const product =
    taxUnit?.name ?? safeLocalLabel(group.projectLabel, `Project ${group.projectKey.slice(-6)}`)
  return {
    id: allocationId,
    month: displayBillingMonth(group.month),
    provider: providerLabel[group.provider],
    product,
    asset: taxUnit?.name ?? '要確認',
    stage: view.stage,
    usageRate: Math.round(line.allocationRatio * 1000) / 10,
    amount: line.allocatedAmountJpy,
    group: view.group,
    taxCandidate: view.candidate,
    confidence: taxUnit ? 'B' : 'C',
    rule: view.rule,
    reason: view.reason,
    missing: taxUnit
      ? '供用状況と証拠を月次確認してください。'
      : 'プロダクト、資産単位、作業目的を選択してください。',
    projectKey: group.projectKey,
    monthKey: group.month,
    classification: group.classification,
    taxUnitId: group.taxUnitId ?? undefined,
    session: {
      date: `${group.firstStartedAt.slice(0, 10)} 〜 ${group.lastEndedAt.slice(0, 10)}`,
      id: `${group.provider === 'codex' ? 'cdx' : 'cld'}-••••-${group.projectKey.slice(-4)}`,
      folder: safeLocalLabel(group.projectLabel, '名称未取得'),
      branch: '取得対象外',
      model: group.model ?? 'unknown',
      tokens:
        group.inputTokens + group.outputTokens + group.cacheReadTokens + group.cacheWriteTokens,
      classification: taxUnit ? `期間ルール → ${taxUnit.name}` : '未分類',
      manualEdit: `${group.sessions}セッション / ${group.messageCount}メッセージ`,
    },
  }
}

function unobservedAllocation(
  provider: UsageProvider,
  month: string,
  line: AllocationLine,
  allocationScope = 'monthly',
): Allocation {
  const isAdjustment = line.kind === 'rounding-adjustment'
  return {
    id: `${provider}-${month}-${allocationScope}-${line.kind}`,
    month: displayBillingMonth(month),
    provider: providerLabel[provider],
    product: isAdjustment ? '丸め調整' : '未取得利用',
    asset: '要確認',
    stage: isAdjustment ? '1円未満調整' : '未取得',
    usageRate: Math.round(line.allocationRatio * 1000) / 10,
    amount: line.allocatedAmountJpy,
    group: 'review',
    taxCandidate: '未分類',
    confidence: 'C',
    rule: isAdjustment ? 'Provider月額との合計不変条件' : 'ローカル履歴で捕捉できない利用を留保',
    reason: isAdjustment
      ? '各配賦額の1円未満を切り捨てた差額です。'
      : 'Webチャット等、Claude Code／Codex履歴に含まれない利用分です。',
    missing: isAdjustment ? 'なし' : '実際の未取得利用割合を月ごとに確認してください。',
    session: {
      date: month,
      id: isAdjustment ? 'rounding' : 'unobserved',
      folder: '履歴なし',
      branch: '対象外',
      model: '複数',
      tokens: 0,
      classification: isAdjustment ? '丸め調整' : '未取得利用',
      manualEdit: isAdjustment ? '自動' : '割合入力',
    },
  }
}

function outOfContractAllocation(
  session: AssignedSession,
  taxUnitById: Map<string, TaxUnitRecord>,
): Allocation {
  return {
    // sessionKey alone is not unique: sessionAggregation splits a session that
    // crosses a month boundary into one row per month, so two rows can share it.
    // React keys off Allocation.id, and a duplicate id silently drops a row.
    id: `out-of-contract-${session.provider}-${session.month}-${session.projectKey}-${session.sessionKey}`,
    month: displayBillingMonth(session.month),
    provider: providerLabel[session.provider],
    product: displayProject(
      session.projectKey,
      session.projectLabel,
      session.assignment.taxUnitId,
      taxUnitById,
    ),
    asset: '対象外',
    stage: '契約期間外',
    usageRate: 0,
    amount: 0,
    group: 'review',
    taxCandidate: '契約期間外',
    confidence: 'C',
    rule: '契約期間外の利用は月額の配賦対象から除外',
    reason:
      '入力された契約期間の外で使われたセッションです。この月の月額には含めていません。契約期間が誤っていれば、はじめの準備の費用ステップで直せます。',
    missing: '契約の開始日・終了日が正しいか確認してください。',
    session: {
      // The exclusion decision is made on the local date, so show that date.
      // The raw ISO timestamp would display a UTC calendar day that can differ
      // from the day the rule actually used.
      date: localDateFromTimestamp(session.startedAt) ?? session.month,
      id: '契約期間外',
      folder: safeLocalLabel(session.projectLabel, `Project ${session.projectKey.slice(-6)}`),
      branch: '対象外',
      model: session.model ?? '不明',
      tokens: 0,
      classification: '契約期間外',
      manualEdit: '契約期間の入力',
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

export function projectWorkspaceYears(
  input: Pick<WorkspaceDraft, 'configuration' | 'planning'>,
  observation: ReturnType<typeof readDashboardObservation>,
  years: number[],
) {
  const projections: AnnualCostProjection[] = []
  const dashboard = buildDashboardFromSnapshot(undefined, input, observation, (scopes) => {
    for (const year of years)
      projections.push(
        projectWorkspaceCosts(
          { ...input.planning, profile: { ...input.planning.profile, taxYear: year } },
          scopes,
        ),
      )
  })
  return { dashboard, projections }
}

function buildDashboardFromSnapshot(
  year?: number,
  input?: Pick<WorkspaceDraft, 'configuration' | 'planning'>,
  observation = readDashboardObservation(),
  inspectCosts?: (scopes: SubscriptionCostScope[]) => void,
): DashboardData {
  const { sessions, overview, lastScanTimeZones } = observation
  const configuration = input?.configuration ?? getConfiguration()
  const staleTimeZones = [...new Set(Object.values(lastScanTimeZones))].filter(
    (zone) => zone !== resolvedTimeZone(),
  )
  const storedPlanning = input?.planning ?? getPlanningSnapshot()
  const planning =
    year === undefined
      ? storedPlanning
      : { ...storedPlanning, profile: { ...storedPlanning.profile, taxYear: year } }
  const taxUnitById = new Map(planning.taxUnits.map((unit) => [unit.id, unit]))

  const assigned: AssignedSession[] = sessions.map((session) => ({
    ...session,
    assignment: resolveSessionAssignment(session, planning.projectRules),
  }))

  const contracts = configuration.contracts
  const configuredChargePeriods = configuration.chargePeriods ?? []
  const chargeWarningsByYear = new Map<number, Map<string, string[]>>()
  function chargeWarningsForYear(year: number): Map<string, string[]> {
    const cached = chargeWarningsByYear.get(year)
    if (cached) return cached
    const duplicateChargeWarnings = new Map<string, string[]>()
    for (const period of configuredChargePeriods) {
      if (!(period.serviceStartedOn <= `${year}-12-31` && period.serviceEndedOn >= `${year}-01-01`)) continue
      const confirmationMessage = chargeContractMessage(period)
      if (confirmationMessage) duplicateChargeWarnings.set(`ai:charge:${period.id}`, [confirmationMessage])
    }
    for (const { kind, ids } of chargeReviewGroups(configuredChargePeriods, year)) {
      const message =
        distinctChargeContracts(configuredChargePeriods.filter((period) => ids.includes(period.id)))
          ? '利用期間が重なる請求ですが、各請求を異なる契約として確認済みです。各請求の原額を保持し、不明額は未算定として扱います。参照：' + ids.join('、')
          : kind === 'duplicate'
          ? `同じAIサービス・利用期間・原額の請求が${ids.length}件あります。重複候補のため明細を確認してください。各請求を合計に含めており、自動で除外していません。参照：${ids.join('、')}`
          : `同じAIサービスで利用期間が重なる請求の組があります。各請求はこの組の他の1件以上と重なり、全件が同日に重なるとは限りません。終了日も含めて比較しています。別契約・プラン変更の明細を確認してください。原額は自動除外せず、不明額は未算定として保持します。参照：${ids.join('、')}`
      for (const id of ids) {
        const key = `ai:charge:${id}`
        duplicateChargeWarnings.set(key, [...(duplicateChargeWarnings.get(key) ?? []), message])
      }
    }
    chargeWarningsByYear.set(year, duplicateChargeWarnings)
    return duplicateChargeWarnings
  }
  const chargePeriodsByProvider = new Map(
    (['claude', 'codex'] as const).map((provider) => [
      provider,
      configuredChargePeriods.filter((period) => period.provider === provider),
    ]),
  )
  // Dated invoices replace monthly estimates only in the months they cover.
  // A later invoice must not remove earlier observed or explicitly entered costs.
  const chargePeriodsForMonth = (provider: UsageProvider, month: string) =>
    (chargePeriodsByProvider.get(provider) ?? []).filter((period) =>
      chargePeriodCoversMonth(period, month),
    )
  const contractsConfigured = configuredChargePeriods.length > 0 || hasAnyContractPeriod(contracts)
  // A session whose timestamp cannot be read is kept inside the contract:
  // dropping money from the allocation because of an unparsable timestamp
  // would be a worse failure than including it.
  const withinContract = (session: AssignedSession): boolean => {
    const startedOn = localDateFromTimestamp(session.startedAt)
    if (startedOn === undefined) return true
    const chargePeriods = chargePeriodsForMonth(session.provider, startedOn.slice(0, 7))
    if (chargePeriods.length > 0) {
      return chargePeriods.some((period) => chargePeriodCoversDate(period, startedOn))
    }
    return contractCoversDate(contracts[session.provider], startedOn)
  }
  const coveredSessions = assigned.filter(withinContract)
  const outOfContractSessions = assigned.filter((session) => !withinContract(session))

  const classifiedSessions = assigned.filter(
    (session) => session.assignment.classification !== 'unclassified',
  ).length
  const mappedSessions = assigned.filter((session) => session.assignment.ruleId !== null).length

  const groups = groupAssignedSessions(coveredSessions)
  const byProviderMonth = new Map<string, ProjectMonthGroup[]>()
  for (const group of groups) {
    const key = `${group.provider}:${group.month}`
    byProviderMonth.set(key, [...(byProviderMonth.get(key) ?? []), group])
  }

  const datedMonthlyCharges = monthlyAmountsForCharges(configuredChargePeriods)
  const monthlyChargeRows = [
    ...configuration.monthlyCharges.filter(
      (charge) => chargePeriodsForMonth(charge.provider, charge.month).length === 0,
    ),
    ...datedMonthlyCharges,
  ]
  const monthlyChargeByKey = new Map(
    monthlyChargeRows.map((charge) => [`${charge.provider}:${charge.month}`, charge.amountJpy]),
  )
  const providerMonthKeys = new Set(
    [...byProviderMonth.keys(), ...monthlyChargeByKey.keys()].filter((key) => {
      const [provider, month] = key.split(':') as [UsageProvider, string]
      const chargePeriods = chargePeriodsForMonth(provider, month)
      if (chargePeriods.length > 0) {
        return chargePeriods.some((period) => chargePeriodCoversMonth(period, month))
      }
      return contractCoversMonth(contracts[provider], month)
    }),
  )
  // Count from ALL observed sessions, not from byProviderMonth: that map is
  // already restricted to in-contract sessions, so a month the contract removed
  // entirely has already vanished from it and would never be counted.
  // Without this the user sees months quietly disappear from the chart, or an
  // entirely empty chart, with nothing naming the contract period as the reason.
  const observedMonthKeys = new Set(
    assigned.map((session) => `${session.provider}:${session.month}`),
  )
  // Distinct calendar months, not provider-month pairs: the message counts
  // them in か月, and one month excluded for both providers is still one month.
  const monthsExcludedByContract = new Set(
    [...new Set([...observedMonthKeys, ...monthlyChargeByKey.keys()])]
      .filter((key) => !providerMonthKeys.has(key))
      .map((key) => key.split(':')[1]),
  ).size

  const groupById = new Map<string, ProjectMonthGroup>()
  const inputs: Array<{
    scopeId: string
    provider: UsageProvider
    billingMonth: BillingMonth
    monthlyFeeJpy: number | null
    source: ExpenseSource
    period: CostPeriod
    unobservedUsage: UnobservedUsage
    usageLines: Array<{
      id: string
      productId: string
      taxUnitId?: string
      bucket: 'private' | 'product'
      usageWeight: number
    }>
  }> = []

  function allocationInput(
    scopeId: string,
    provider: UsageProvider,
    month: string,
    monthlyFeeJpy: number | null,
    sourceGroups: ProjectMonthGroup[],
    chargePeriod?: ProviderChargePeriod,
  ) {
    const usageLines = sourceGroups.map((group) => {
      const id = JSON.stringify([scopeId, groupKey(group)])
      groupById.set(id, group)
      return {
        id,
        productId: group.projectKey,
        taxUnitId: group.taxUnitId ?? undefined,
        bucket:
          group.classification === 'private' || group.classification === 'general-learning'
            ? ('private' as const)
            : ('product' as const),
        usageWeight: calculateWeightedTokenUsage({
          inputTokens: group.inputTokens,
          cachedInputTokens: group.cacheReadTokens,
          cacheCreationTokens: group.cacheWriteTokens,
          outputTokens: group.outputTokens,
        }),
      }
    })
    const monthPeriod = calendarMonthPeriod(month)
    const source: ExpenseSource = chargePeriod
      ? {
          id: `ai:charge:${chargePeriod.id}`,
          kind: 'subscription',
          label:
            chargePeriod.planName.trim() ||
            `${providerLabel[provider]} ${chargePeriod.serviceStartedOn}～${chargePeriod.serviceEndedOn}`,
          originalAmountJpy: chargePeriod.amountJpy,
          ...(chargePeriod.amountJpy === null
            ? {
                unknownOriginalAmountReasons: [
                  chargePeriod.unknownAmountReason ?? '請求額が未確認です。',
                ],
              }
            : {}),
          currency: 'JPY',
          servicePeriod: {
            startedOn: chargePeriod.serviceStartedOn,
            endedOn: chargePeriod.serviceEndedOn,
          },
          ...(chargePeriod.billedOn ? { billedOn: chargePeriod.billedOn } : {}),
          evidenceIds: [...(chargePeriod.evidenceIds ?? [])],
          origin: 'entered',
        }
      : {
          id: `ai:${scopeId}`,
          kind: 'subscription',
          label: `${providerLabel[provider]} ${month}`,
          originalAmountJpy: monthlyFeeJpy,
          ...(monthlyFeeJpy === null
            ? {
                unknownOriginalAmountReasons: [
                  configuration.monthlyCharges.find(
                    (row) => row.provider === provider && row.month === month,
                  )?.unknownAmountReason ??
                    configuration.unknownChargeReasons?.[provider] ??
                    '料金が未確認です。',
                ],
              }
            : {}),
          currency: 'JPY',
          servicePeriod: monthPeriod,
          evidenceIds: [],
          origin: 'legacy-monthly',
        }
    const period = chargePeriod
      ? {
          startedOn:
            monthPeriod.startedOn > chargePeriod.serviceStartedOn
              ? monthPeriod.startedOn
              : chargePeriod.serviceStartedOn,
          endedOn:
            monthPeriod.endedOn < chargePeriod.serviceEndedOn
              ? monthPeriod.endedOn
              : chargePeriod.serviceEndedOn,
        }
      : monthPeriod
    return {
      scopeId,
      source,
      period,
      provider,
      billingMonth: month as BillingMonth,
      monthlyFeeJpy,
      unobservedUsage:
        configuration.unobservedRatio === null
          ? { kind: 'unknown' as const }
          : configuration.unobservedRatio === 0
            ? { kind: 'confirmed-none' as const }
            : { kind: 'estimated' as const, ratio: configuration.unobservedRatio },
      usageLines,
    }
  }

  for (const key of [...providerMonthKeys].sort()) {
    const [provider, month] = key.split(':') as [UsageProvider, string]
    if (chargePeriodsForMonth(provider, month).length > 0) continue
    inputs.push(
      allocationInput(
        `monthly:${key}`,
        provider,
        month,
        monthlyChargeByKey.has(key)
          ? monthlyChargeByKey.get(key)!
          : configuration.charges[provider],
        byProviderMonth.get(key) ?? [],
      ),
    )
  }

  for (const period of configuredChargePeriods) {
    for (const amount of monthlyAmountsForCharge(period)) {
      const periodSessions = coveredSessions.filter((session) => {
        if (session.provider !== period.provider || session.month !== amount.month) return false
        const startedOn = localDateFromTimestamp(session.startedAt)
        return startedOn !== undefined && chargePeriodCoversDate(period, startedOn)
      })
      inputs.push(
        allocationInput(
          `charge:${period.id}:${amount.month}`,
          period.provider,
          amount.month,
          amount.amountJpy,
          groupAssignedSessions(periodSessions),
          period,
        ),
      )
    }
  }

  const allocations: Allocation[] = []
  const costScopes: SubscriptionCostScope[] = []
  for (const input of inputs) {
    const duplicateChargeWarnings = chargeWarningsForYear(Number(input.billingMonth.slice(0, 4)))
    const result =
      input.monthlyFeeJpy === null
        ? null
        : (allocateSubscriptions([{ ...input, monthlyFeeJpy: input.monthlyFeeJpy }])[0] ?? null)
    if (!result && input.monthlyFeeJpy !== null)
      throw new Error('請求額の配分結果を生成できませんでした。')
    // The sum-equals-fee property is the product's core promise: turn a
    // future regression into a loud error instead of a silently wrong tax
    // figure shown to the user.
    if (result) assertAllocationInvariant(result)
    const targets: Record<string, CostTarget> = {}
    for (const usage of input.usageLines) {
      const group = groupById.get(usage.id)!
      targets[usage.id] =
        usage.bucket === 'private'
          ? { kind: 'private' }
          : group.taxUnitId
            ? { kind: 'tax-unit', taxUnitId: group.taxUnitId }
            : group.classification === 'maintenance'
              ? { kind: 'general' }
              : { kind: 'unallocated' }
    }
    costScopes.push({
      source: input.source,
      ...(duplicateChargeWarnings.has(input.source.id)
        ? { sourceWarnings: duplicateChargeWarnings.get(input.source.id)! }
        : {}),
      basisId: `ai:${input.scopeId}:basis`,
      period: input.period,
      result,
      targets,
    })
    if (!result) continue
    if (result.status === 'pending') {
      allocations.push({
        id: `${input.scopeId}:pending`,
        month: displayBillingMonth(input.billingMonth),
        monthKey: input.billingMonth,
        provider: providerLabel[input.provider],
        product: '配分未算定',
        asset: '対応先を確認',
        stage: '割合・配分基準の確認待ち',
        usageRate: null,
        amount: result.pendingAmountJpy,
        group: 'review',
        taxCandidate: '未判断',
        confidence: 'C',
        rule: '割合や配分基準が不明な支払を保持',
        reason: result.warnings.join(' '),
        missing: '捕捉外の利用割合と、対応先へ配分するための基準を確認してください。',
        session: {
          date: input.billingMonth,
          id: 'pending-allocation',
          folder: '支払単位',
          branch: '対象外',
          model: '対象外',
          tokens: null,
          classification: '配分未算定',
          manualEdit: '不明を保持',
        },
      })
      continue
    }
    for (const line of result.lines) {
      if (line.kind === 'rounding-adjustment' && line.allocatedAmountJpy === 0) continue
      if (line.kind === 'unobserved' || line.kind === 'rounding-adjustment') {
        allocations.push(
          unobservedAllocation(result.provider, result.billingMonth, line, input.scopeId),
        )
        continue
      }
      const group = line.sourceId ? groupById.get(line.sourceId) : undefined
      if (!group) continue
      allocations.push(allocationForGroup(group, line, taxUnitById, line.sourceId))
    }
  }

  for (const session of outOfContractSessions) {
    allocations.push(outOfContractAllocation(session, taxUnitById))
  }

  const monthLabels = [...new Set(inputs.map((input) => input.billingMonth))].sort()
  const months = monthLabels.map((month) => {
    const label = displayBillingMonth(month)
    const monthAllocations = allocations.filter((row) => row.month === label)
    return {
      monthKey: month,
      label,
      unknownChargeIds: configuredChargePeriods
        .filter((period) => period.amountJpy === null && chargePeriodCoversMonth(period, month))
        .map((period) => period.id),
      current: monthAllocations.reduce(
        (sum, row) => sum + (row.group === 'current' ? row.amount : 0),
        0,
      ),
      future: monthAllocations.reduce(
        (sum, row) => sum + (row.group === 'future' ? row.amount : 0),
        0,
      ),
      review: monthAllocations.reduce(
        (sum, row) => sum + (row.group === 'review' ? row.amount : 0),
        0,
      ),
    }
  })

  // Built from the raw session rows (pre-classification), not from `groups`:
  // a folder must appear exactly once in the product list regardless of how
  // many classifications its sessions carry across a month.
  const projectSummaries = new Map<
    string,
    {
      name: string
      folder: string
      sessions: number
      projectKey: string
      firstObservedAt?: string
      lastObservedAt?: string
      firstObservedMonth: string
      lastObservedMonth: string
      providers: Array<'Claude Code' | 'Codex'>
    }
  >()
  for (const session of assigned) {
    const current = projectSummaries.get(session.projectKey)
    projectSummaries.set(session.projectKey, {
      name: displayProject(
        session.projectKey,
        session.projectLabel,
        session.assignment.taxUnitId,
        taxUnitById,
      ),
      folder: safeLocalLabel(session.projectLabel, `Project ${session.projectKey.slice(-6)}`),
      sessions: (current?.sessions ?? 0) + 1,
      projectKey: session.projectKey,
      firstObservedAt: [current?.firstObservedAt, session.startedAt]
        .filter((value): value is string => Boolean(value))
        .sort()[0],
      lastObservedAt: [current?.lastObservedAt, session.endedAt]
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1),
      firstObservedMonth: [current?.firstObservedMonth, session.month].filter(Boolean).sort()[0]!,
      lastObservedMonth: [current?.lastObservedMonth, session.month].filter(Boolean).sort().at(-1)!,
      providers: [
        ...new Set([
          ...(current?.providers ?? []),
          session.provider === 'claude' ? ('Claude Code' as const) : ('Codex' as const),
        ]),
      ],
    })
  }

  const futureByAsset = new Map<
    string,
    {
      product: string
      name: string
      candidate: string
      total: number
    }
  >()
  for (const row of allocations.filter((item) => item.group === 'future')) {
    const key = JSON.stringify([row.product, row.asset, row.taxCandidate])
    const current = futureByAsset.get(key)
    futureByAsset.set(key, {
      product: row.product,
      name: row.asset,
      candidate: row.taxCandidate,
      total: (current?.total ?? 0) + row.amount,
    })
  }

  const assets = [...futureByAsset.values()].map((asset) => ({
    product: asset.product,
    name: asset.candidate === '資本的支出' ? `${asset.name}（改良計画）` : asset.name,
    candidate: asset.candidate,
    total: asset.total,
    aiCost: asset.total,
    outsource: 0,
    other: 0,
    futureBalance: asset.total,
    inService: false,
  }))
  const boundaries = assets.map((asset) => {
    if (asset.candidate === '資本的支出') {
      return {
        product: asset.product,
        asset: asset.name,
        kind: '一つの改良計画（候補）',
        amount: asset.total,
        threshold: 200_000,
        thresholdLabel: '修繕・改良の20万円形式基準（別判定）',
        status:
          asset.total < 200_000
            ? `${(200_000 - asset.total).toLocaleString()}円手前・作業実態も確認`
            : '20万円以上：改良計画の範囲と作業実態を確認',
        tone: 'review' as const,
      }
    }

    const underImmediateExpenseBoundary = asset.total < 100_000
    const underThreeYearPoolBoundary = asset.total < 200_000
    const threshold = underImmediateExpenseBoundary
      ? 100_000
      : underThreeYearPoolBoundary
        ? 100_000
        : 200_000
    const thresholdLabel = threshold === 100_000 ? '10万円境界' : '20万円境界'
    const status = underImmediateExpenseBoundary
      ? `${(100_000 - asset.total).toLocaleString()}円手前`
      : underThreeYearPoolBoundary
        ? '10万円以上：通常償却または3年一括の候補を確認'
        : '20万円以上：通常償却等の候補を確認（青色特例は別途要件確認）'
    return {
      product: asset.product,
      asset: asset.name,
      kind: 'ユーザー確認中の資産単位',
      amount: asset.total,
      threshold,
      thresholdLabel,
      status,
      tone: underImmediateExpenseBoundary
        ? asset.total >= 80_000
          ? ('near' as const)
          : ('safe' as const)
        : ('review' as const),
    }
  })

  const lastScan = overview.recentScans.find((scan) => scan.status === 'complete')
  inspectCosts?.(costScopes)

  return {
    costProjection: projectWorkspaceCosts(planning, costScopes),
    unknownCharges: configuredChargePeriods
      .filter((period) => period.amountJpy === null)
      .map((period) => ({
        id: period.id,
        provider: period.provider,
        serviceStartedOn: period.serviceStartedOn,
        serviceEndedOn: period.serviceEndedOn,
        reason: period.unknownAmountReason!,
      })),
    meta: {
      source: 'local',
      sessionCount: overview.providers.reduce((sum, row) => sum + row.sessions, 0),
      lastSynced:
        typeof lastScan?.completedAt === 'string'
          ? new Date(lastScan.completedAt).toLocaleString('ja-JP')
          : '未走査',
      mappedRate: sessions.length === 0 ? 0 : Math.round((mappedSessions / sessions.length) * 100),
      classifiedRate:
        sessions.length === 0 ? 0 : Math.round((classifiedSessions / sessions.length) * 100),
    },
    months,
    allocations,
    boundaries: configuredChargePeriods.some((period) => period.amountJpy === null)
      ? []
      : boundaries,
    assets,
    guidance: [
      ...(contractsConfigured
        ? []
        : [
            {
              title: '契約期間が未入力です',
              description:
                '契約期間が未入力のため、履歴のある全月へ同額を適用しています。はじめの準備の費用ステップで契約の開始日（解約済みなら終了日も）を入力すると、契約外の月を配賦から外せます。',
              severity: 'warning' as const,
            },
          ]),
      ...(contractsConfigured && monthsExcludedByContract > 0
        ? [
            providerMonthKeys.size === 0
              ? {
                  title: '契約期間が利用履歴と重なっていません',
                  description:
                    '入力された契約期間の中に、利用履歴のある月が1つもありません。そのため配賦する月がなく、月額はどこにも計上されていません。はじめの準備の費用ステップで、契約の開始日・終了日を確認してください。',
                  severity: 'warning' as const,
                }
              : {
                  title: `契約期間外の${monthsExcludedByContract}か月を配賦から除外しています`,
                  description:
                    '入力された契約期間の外にある月は、月額の配賦対象から外しています。除外された月の利用は、配賦明細に「契約期間外」として金額0で残しています。',
                  severity: 'ok' as const,
                },
          ]
        : []),
      ...(staleTimeZones.length > 0
        ? [
            {
              title: 'タイムゾーンが走査時と変わっています',
              description: `走査したときは${staleTimeZones.join('・')}、いまは${resolvedTimeZone()}です。月の帰属はPCのローカルタイムで判定するため、月末・月初の利用が別の月へ移っている可能性があります。もう一度走査すると、現在のタイムゾーンで付け直します。`,
              severity: 'warning' as const,
            },
          ]
        : []),
      {
        title: `${sessions.length - classifiedSessions}件の未分類利用（セッション単位）`,
        description: 'オンボーディングでプロダクトと作業目的を確認してください',
        severity: sessions.length === classifiedSessions ? 'ok' : 'warning',
      },
      {
        title:
          configuration.unobservedRatio === null
            ? '履歴にない利用の割合が不明です'
            : `履歴にない利用 ${configuration.unobservedRatio * 100}%`,
        description:
          configuration.unobservedRatio === null
            ? '支払額は配分未算定として保持しています。0%や一定割合を自動的に置かず、確認した割合で再計算します。'
            : '保存された割合で各Providerの支払を配分します。既存設定は本人確認済みと断定できないため、取得範囲と割合の根拠を確認してください。',
        severity: configuration.unobservedRatio === null ? 'warning' : 'ok',
      },
    ],
    products: [...projectSummaries.values()],
  }
}
