import {
  allocateSubscriptions,
  calculateWeightedTokenUsage,
  type AllocationLine,
  type BillingMonth,
} from '../core/index.js'
import type { Allocation, DashboardData, TaxGroup } from '../client/types.js'
import {
  getConfiguration,
  getProjectUsage,
  getUsageOverview,
  type ProjectMapping,
  type ProjectUsageRow,
} from './database.js'

const providerLabel = {
  claude: 'Claude Code',
  codex: 'Codex',
} as const

function displayBillingMonth(month: string): string {
  return `${month.slice(0, 4)}年${Number(month.slice(5))}月`
}

const classificationView: Record<ProjectMapping['classification'], {
  group: TaxGroup
  stage: string
  candidate: string
  rule: string
  reason: string
}> = {
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

function usageWeight(row: ProjectUsageRow): number {
  return calculateWeightedTokenUsage({
    inputTokens: row.inputTokens,
    cachedInputTokens: row.cacheReadTokens,
    cacheCreationTokens: row.cacheWriteTokens,
    outputTokens: row.outputTokens,
  })
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

function displayProject(row: ProjectUsageRow, mapping?: ProjectMapping): string {
  return mapping?.productName || safeLocalLabel(
    row.projectLabel,
    `Project ${row.projectKey.slice(-6)}`,
  )
}

function allocationForProject(
  row: ProjectUsageRow,
  line: AllocationLine,
  mapping: ProjectMapping | undefined,
): Allocation {
  const classification = mapping?.classification ?? 'unclassified'
  const view = classificationView[classification]
  const product = displayProject(row, mapping)
  return {
    id: `${row.provider}-${row.month}-${row.projectKey}`,
    month: displayBillingMonth(row.month),
    provider: providerLabel[row.provider],
    product,
    asset: mapping?.assetName || '要確認',
    stage: view.stage,
    usageRate: Math.round(line.allocationRatio * 1000) / 10,
    amount: line.allocatedAmountJpy,
    group: view.group,
    taxCandidate: view.candidate,
    confidence: mapping ? 'B' : 'C',
    rule: view.rule,
    reason: view.reason,
    missing: mapping
      ? '供用状況と証拠を月次確認してください。'
      : 'プロダクト、資産単位、作業目的を選択してください。',
    session: {
      date: row.month,
      id: `${row.provider === 'codex' ? 'cdx' : 'cld'}-••••-${row.projectKey.slice(-4)}`,
      folder: safeLocalLabel(row.projectLabel, '名称未取得'),
      branch: '取得対象外',
      model: row.model ?? 'unknown',
      tokens: row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheWriteTokens,
      classification: mapping
        ? `ローカル設定 → ${mapping.productName}`
        : '未分類',
      manualEdit: mapping ? '確認済み' : '要確認',
    },
  }
}

function unobservedAllocation(
  provider: 'claude' | 'codex',
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
    rule: isAdjustment
      ? 'Provider月額との合計不変条件'
      : 'ローカル履歴で捕捉できない利用を留保',
    reason: isAdjustment
      ? '各配賦額の1円未満を切り捨てた差額です。'
      : 'Webチャット等、Claude Code／Codex履歴に含まれない利用分です。',
    missing: isAdjustment
      ? 'なし'
      : '実際の未取得利用割合を月ごとに確認してください。',
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
  const rows = getProjectUsage()
  const overview = getUsageOverview()
  const configuration = getConfiguration()
  const mappingByProject = new Map(
    configuration.mappings.map((mapping) => [mapping.projectKey, mapping]),
  )
  const rowBySource = new Map<string, ProjectUsageRow>()
  const grouped = new Map<string, ProjectUsageRow[]>()
  const monthlyChargeByKey = new Map(
    configuration.monthlyCharges.map((charge) => [
      `${charge.provider}:${charge.month}`,
      charge.amountJpy,
    ]),
  )

  for (const row of rows) {
    const key = `${row.provider}:${row.month}`
    grouped.set(key, [...(grouped.get(key) ?? []), row])
  }

  const providerMonthKeys = new Set([
    ...grouped.keys(),
    ...monthlyChargeByKey.keys(),
  ])
  const inputs = [...providerMonthKeys].sort().map((key) => {
    const groupRows = grouped.get(key) ?? []
    const [provider, month] = key.split(':') as ['claude' | 'codex', string]
    return {
      provider,
      billingMonth: month as BillingMonth,
      monthlyFeeJpy: monthlyChargeByKey.get(key) ?? configuration.charges[provider],
      unobservedUsage: {
        kind: 'estimated' as const,
        ratio: configuration.unobservedRatio,
      },
      usageLines: groupRows.map((row) => {
        const id = `${row.provider}:${row.month}:${row.projectKey}`
        rowBySource.set(id, row)
        return {
          id,
          productId: row.projectKey,
          bucket: mappingByProject.get(row.projectKey)?.classification === 'private'
            ? 'private' as const
            : 'product' as const,
          usageWeight: usageWeight(row),
        }
      }),
    }
  })

  const allocations: Allocation[] = []
  for (const result of allocateSubscriptions(inputs)) {
    for (const line of result.lines) {
      if (line.kind === 'rounding-adjustment' && line.allocatedAmountJpy === 0) {
        continue
      }
      if (line.kind === 'unobserved' || line.kind === 'rounding-adjustment') {
        allocations.push(unobservedAllocation(result.provider, result.billingMonth, line))
        continue
      }
      const row = line.sourceId ? rowBySource.get(line.sourceId) : undefined
      if (!row) continue
      allocations.push(allocationForProject(
        row,
        line,
        mappingByProject.get(row.projectKey),
      ))
    }
  }

  const monthLabels = [...new Set(inputs.map((input) => input.billingMonth))].sort()
  const months = monthLabels.map((month) => {
    const label = displayBillingMonth(month)
    const monthAllocations = allocations.filter((row) => row.month === label)
    return {
      label,
      current: monthAllocations.reduce((sum, row) => sum + (row.group === 'current' ? row.amount : 0), 0),
      future: monthAllocations.reduce((sum, row) => sum + (row.group === 'future' ? row.amount : 0), 0),
      review: monthAllocations.reduce((sum, row) => sum + (row.group === 'review' ? row.amount : 0), 0),
    }
  })

  const projectSummaries = new Map<string, {
    name: string
    folder: string
    sessions: number
    projectKey: string
  }>()
  for (const row of rows) {
    const current = projectSummaries.get(row.projectKey)
    const mapping = mappingByProject.get(row.projectKey)
    projectSummaries.set(row.projectKey, {
      name: displayProject(row, mapping),
      folder: safeLocalLabel(row.projectLabel, `Project ${row.projectKey.slice(-6)}`),
      sessions: (current?.sessions ?? 0) + row.sessions,
      projectKey: row.projectKey,
    })
  }

  const futureByAsset = new Map<string, {
    product: string
    name: string
    candidate: string
    total: number
  }>()
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
    name: asset.candidate === '資本的支出'
      ? `${asset.name}（改良計画）`
      : asset.name,
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
        status: asset.total < 200_000
          ? `${(200_000 - asset.total).toLocaleString()}円手前・作業実態も確認`
          : '20万円以上：改良計画の範囲と作業実態を確認',
        tone: 'review' as const,
      }
    }

    const underImmediateExpenseBoundary = asset.total < 100_000
    const underThreeYearPoolBoundary = asset.total < 200_000
    const threshold = underImmediateExpenseBoundary ? 100_000
      : underThreeYearPoolBoundary ? 100_000
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
        ? asset.total >= 80_000 ? 'near' as const : 'safe' as const
        : 'review' as const,
    }
  })

  const uniqueProjects = projectSummaries.size
  const mappedProjects = [...projectSummaries.keys()].filter((key) => mappingByProject.has(key)).length
  const lastScan = overview.recentScans.find((scan) => scan.status === 'complete')

  return {
    meta: {
      source: 'local',
      sessionCount: overview.providers.reduce((sum, row) => sum + row.sessions, 0),
      lastSynced: typeof lastScan?.completedAt === 'string'
        ? new Date(lastScan.completedAt).toLocaleString('ja-JP')
        : '未走査',
      allocatedRate: uniqueProjects === 0 ? 0 : Math.round(mappedProjects / uniqueProjects * 100),
    },
    months,
    allocations,
    boundaries,
    assets,
    guidance: [
      {
        title: `${uniqueProjects - mappedProjects}件の未分類プロジェクト`,
        description: 'オンボーディングでプロダクトと作業目的を確認してください',
        severity: uniqueProjects === mappedProjects ? 'ok' : 'warning',
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
