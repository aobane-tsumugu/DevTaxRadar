import type { WorkspaceDraft } from '../planning/workspace.js'

export type WorkspaceContents = Pick<WorkspaceDraft, 'configuration' | 'planning'>
export type MergeChoice = 'local' | 'latest'
export type WorkspaceChange = {
  key: string
  label: string
  base: unknown
  local: unknown
  latest: unknown
  conflict: boolean
  choice?: MergeChoice
}

const collections = [
  'taxUnits',
  'projectRules',
  'lifecycleEvents',
  'equipment',
  'homeCosts',
  'directCosts',
  'evidence',
  'decisions',
] as const
const labels: Record<string, string> = {
  taxUnits: '制作物',
  projectRules: '履歴の割当',
  lifecycleEvents: '出来事',
  equipment: '設備',
  homeCosts: '自宅費用',
  directCosts: '直接費',
  evidence: '証拠',
  decisions: '判断記録',
}

function canonical(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function index<T>(values: T[], key: (value: T) => string): Map<string, T> {
  const result = new Map<string, T>()
  for (const value of values) {
    const id = key(value)
    if (result.has(id))
      throw new Error('同じ記録が重複しているため比較できません。入力を確認してください。')
    result.set(id, value)
  }
  return result
}

/** Compare complete records so ratios, amounts, periods and reasons are never mixed silently. */
export function mergeWorkspaceDrafts(
  base: WorkspaceContents,
  local: WorkspaceContents,
  latest: WorkspaceContents,
  choices: Record<string, MergeChoice> = {},
): { changes: WorkspaceChange[]; contents: WorkspaceContents | null } {
  const result = structuredClone({ configuration: latest.configuration, planning: latest.planning })
  const changes: WorkspaceChange[] = []
  let unresolved = false
  function select<T>(key: string, label: string, old: T, mine: T, theirs: T): T {
    const oldText = canonical(old),
      mineText = canonical(mine),
      theirText = canonical(theirs)
    if (oldText === mineText && oldText === theirText) return theirs
    const conflict = oldText !== mineText && oldText !== theirText && mineText !== theirText
    const automatic: MergeChoice | undefined =
      mineText === theirText || mineText === oldText
        ? 'latest'
        : theirText === oldText
          ? 'local'
          : undefined
    const choice = choices[key] ?? automatic
    changes.push({ key, label, base: old, local: mine, latest: theirs, conflict, choice })
    if (!choice) unresolved = true
    return choice === 'local' ? mine : theirs
  }
  for (const provider of ['claude', 'codex'] as const) {
    const name = provider === 'claude' ? 'Claude Code' : 'Codex'
    const charge = (configuration: WorkspaceDraft['configuration']) => ({
      amountJpy: configuration.charges[provider],
      unknownAmountReason: configuration.unknownChargeReasons?.[provider],
    })
    const selected = select(
      `charges:${provider}`,
      `${name}の既定月額`,
      charge(base.configuration),
      charge(local.configuration),
      charge(latest.configuration),
    )
    result.configuration.charges[provider] = selected.amountJpy
    const reasons = { ...result.configuration.unknownChargeReasons }
    if (selected.unknownAmountReason !== undefined) reasons[provider] = selected.unknownAmountReason
    else delete reasons[provider]
    if (Object.keys(reasons).length) result.configuration.unknownChargeReasons = reasons
    else delete result.configuration.unknownChargeReasons
    result.configuration.contracts[provider] = select(
      `contract:${provider}`,
      `${name}の契約期間`,
      base.configuration.contracts[provider],
      local.configuration.contracts[provider],
      latest.configuration.contracts[provider],
    )
  }
  result.configuration.unobservedRatio = select(
    'unobservedRatio',
    '捕捉外の利用割合',
    base.configuration.unobservedRatio,
    local.configuration.unobservedRatio,
    latest.configuration.unobservedRatio,
  )
  result.planning.profile = select(
    'profile',
    '対象年・申告と活動の基本情報',
    base.planning.profile,
    local.planning.profile,
    latest.planning.profile,
  )
  function records<T>(
    group: string,
    label: string,
    old: T[],
    mine: T[],
    theirs: T[],
    id: (value: T) => string,
  ): T[] {
    const b = index(old, id),
      l = index(mine, id),
      r = index(theirs, id)
    return [...new Set([...r.keys(), ...l.keys(), ...b.keys()])].flatMap((key) => {
      const record = (l.get(key) ?? r.get(key) ?? b.get(key)) as Record<string, unknown>
      const title =
        record.name ||
        record.planName ||
        record.month ||
        record.serviceStartedOn ||
        record.incurredOn ||
        record.occurredOn ||
        key
      const provider =
        record.provider === 'claude'
          ? 'Claude Code'
          : record.provider === 'codex'
            ? 'Codex'
            : undefined
      const value = select(
        JSON.stringify([group, key]),
        `${label}${provider ? `（${provider}）` : ''}：${String(title)}`,
        b.get(key),
        l.get(key),
        r.get(key),
      )
      return value === undefined ? [] : [value]
    })
  }
  result.configuration.chargePeriods = records(
    'chargePeriods',
    '請求履歴',
    base.configuration.chargePeriods,
    local.configuration.chargePeriods,
    latest.configuration.chargePeriods,
    (value) => value.id,
  )
  result.configuration.monthlyCharges = records(
    'monthlyCharges',
    '月別料金',
    base.configuration.monthlyCharges,
    local.configuration.monthlyCharges,
    latest.configuration.monthlyCharges,
    (value) => `${value.provider}:${value.month}`,
  )
  for (const group of collections) {
    // All planning collections share a stable record ID; no positional array merge.
    const values = records<{ id: string }>(
      group,
      labels[group]!,
      base.planning[group],
      local.planning[group],
      latest.planning[group],
      (value) => value.id,
    )
    Object.assign(result.planning, { [group]: values })
  }
  if (
    base.planning.equipmentMethods ||
    local.planning.equipmentMethods ||
    latest.planning.equipmentMethods
  ) {
    result.planning.equipmentMethods = records(
      'equipmentMethods',
      '設備の年度別計算条件',
      base.planning.equipmentMethods ?? [],
      local.planning.equipmentMethods ?? [],
      latest.planning.equipmentMethods ?? [],
      (row) => `${row.taxYear}:${row.equipmentId}`,
    )
  }
  if (base.planning.costPresence || local.planning.costPresence || latest.planning.costPresence) {
    result.planning.costPresence = records(
      'costPresence',
      '年度別の費用項目の確認',
      base.planning.costPresence ?? [],
      local.planning.costPresence ?? [],
      latest.planning.costPresence ?? [],
      (value) => `${value.taxYear}:${value.category}`,
    )
  }
  if (base.planning.sourceAdjustments || local.planning.sourceAdjustments || latest.planning.sourceAdjustments) {
    result.planning.sourceAdjustments = records(
      'sourceAdjustments',
      '返金・訂正',
      base.planning.sourceAdjustments ?? [],
      local.planning.sourceAdjustments ?? [],
      latest.planning.sourceAdjustments ?? [],
      (value) => value.id,
    )
  }
  if (base.planning.costTreatmentFacts || local.planning.costTreatmentFacts || latest.planning.costTreatmentFacts) {
    result.planning.costTreatmentFacts = records(
      'costTreatmentFacts',
      '費用の処理条件',
      base.planning.costTreatmentFacts ?? [],
      local.planning.costTreatmentFacts ?? [],
      latest.planning.costTreatmentFacts ?? [],
      (value) => JSON.stringify([value.costYear, value.contributionId]),
    )
  }
  return { changes, contents: unresolved ? null : structuredClone(result) }
}
