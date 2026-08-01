import {
  allocateSubscriptions,
  assertAllocationInvariant,
  calculateWeightedTokenUsage,
  type AllocationLine,
  type BillingMonth,
} from '../core/index.js'
import type { Allocation, DashboardData, TaxGroup } from '../client/types.js'
import type { ProjectClassification, TaxUnitRecord } from '../planning/types.js'
import type { UsageProvider } from '../adapters/types.ts'
import {
  getConfiguration,
  getUsageOverview,
  getUsageSessions,
  type UsageSessionRow,
} from './database.js'
import { getPlanningSnapshot } from './planningRepository.js'
import { resolveSessionAssignment, type SessionAssignment } from './sessionAssignment.js'

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

function safeLocalLabel(value: string | null, fallback: string): string {
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

function allocationForGroup(
  group: ProjectMonthGroup,
  line: AllocationLine,
  taxUnitById: Map<string, TaxUnitRecord>,
): Allocation {
  // getPlanningSnapshot() returns DB rows, so an unexpected classification
  // value (e.g. an older DB row from before an enum change) must not throw --
  // fall back to the unclassified view rather than crashing /api/dashboard.
  const view = classificationView[group.classification] ?? classificationView.unclassified
  const taxUnit = group.taxUnitId ? taxUnitById.get(group.taxUnitId) : undefined
  const product =
    taxUnit?.name ?? safeLocalLabel(group.projectLabel, `Project ${group.projectKey.slice(-6)}`)
  return {
    id: groupKey(group),
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
): Allocation {
  const isAdjustment = line.kind === 'rounding-adjustment'
  return {
    id: `${provider}-${month}-${line.kind}`,
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

export function buildDashboard(): DashboardData {
  const sessions = getUsageSessions()
  const overview = getUsageOverview()
  const configuration = getConfiguration()
  const planning = getPlanningSnapshot()
  const taxUnitById = new Map(planning.taxUnits.map((unit) => [unit.id, unit]))

  const assigned: AssignedSession[] = sessions.map((session) => ({
    ...session,
    assignment: resolveSessionAssignment(session, planning.projectRules),
  }))

  const classifiedSessions = assigned.filter(
    (session) => session.assignment.classification !== 'unclassified',
  ).length
  const mappedSessions = assigned.filter((session) => session.assignment.ruleId !== null).length

  const groups = new Map<string, ProjectMonthGroup>()
  for (const session of assigned) {
    // Same JSON.stringify encoding as groupKey() below: taxUnitId is a
    // user-entered identifier that may contain any character, so joining
    // with ':' here would risk merging two distinct classification groups
    // into one during this very aggregation step.
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

  const groupById = new Map([...groups.values()].map((group) => [groupKey(group), group]))
  const byProviderMonth = new Map<string, ProjectMonthGroup[]>()
  for (const group of groups.values()) {
    const key = `${group.provider}:${group.month}`
    byProviderMonth.set(key, [...(byProviderMonth.get(key) ?? []), group])
  }

  const monthlyChargeByKey = new Map(
    configuration.monthlyCharges.map((charge) => [
      `${charge.provider}:${charge.month}`,
      charge.amountJpy,
    ]),
  )
  const providerMonthKeys = new Set([...byProviderMonth.keys(), ...monthlyChargeByKey.keys()])

  const inputs = [...providerMonthKeys].sort().map((key) => {
    const [provider, month] = key.split(':') as [UsageProvider, string]
    return {
      provider,
      billingMonth: month as BillingMonth,
      monthlyFeeJpy: monthlyChargeByKey.get(key) ?? configuration.charges[provider],
      unobservedUsage: {
        kind: 'estimated' as const,
        ratio: configuration.unobservedRatio,
      },
      usageLines: (byProviderMonth.get(key) ?? []).map((group) => ({
        id: groupKey(group),
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
      })),
    }
  })

  const allocations: Allocation[] = []
  for (const result of allocateSubscriptions(inputs)) {
    // The sum-equals-fee property is the product's core promise: turn a
    // future regression into a loud error instead of a silently wrong tax
    // figure shown to the user.
    assertAllocationInvariant(result)
    for (const line of result.lines) {
      if (line.kind === 'rounding-adjustment' && line.allocatedAmountJpy === 0) continue
      if (line.kind === 'unobserved' || line.kind === 'rounding-adjustment') {
        allocations.push(unobservedAllocation(result.provider, result.billingMonth, line))
        continue
      }
      const group = line.sourceId ? groupById.get(line.sourceId) : undefined
      if (!group) continue
      allocations.push(allocationForGroup(group, line, taxUnitById))
    }
  }

  const monthLabels = [...new Set(inputs.map((input) => input.billingMonth))].sort()
  const months = monthLabels.map((month) => {
    const label = displayBillingMonth(month)
    const monthAllocations = allocations.filter((row) => row.month === label)
    return {
      label,
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

  return {
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
    boundaries,
    assets,
    guidance: [
      {
        title: `${sessions.length - classifiedSessions}件の未分類利用（セッション単位）`,
        description: 'オンボーディングでプロダクトと作業目的を確認してください',
        severity: sessions.length === classifiedSessions ? 'ok' : 'warning',
      },
      {
        title: `未取得利用 ${Math.round(configuration.unobservedRatio * 100)}%`,
        description: 'Webチャット等の捕捉外利用として各Provider月額から留保します',
        severity: 'ok',
      },
    ],
    products: [...projectSummaries.values()],
  }
}
