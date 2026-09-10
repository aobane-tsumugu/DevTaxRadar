import type { Allocation, TaxGroup } from '../client/types.js'
import type { ProjectClassification, TaxUnitRecord } from '../planning/types.js'
import type { UsageProvider } from '../adapters/types.js'
import type { AllocationLine } from '../core/types.js'
import { observationGroupKey, type UsageObservation } from '../core/usageGranularity.js'
import { localDateFromTimestamp } from '../adapters/localTime.js'
import type { SessionAssignment } from './sessionAssignment.js'

export const providerLabel = { claude: 'Claude Code', codex: 'Codex' } as const
export const displayBillingMonth = (month: string) =>
  `${month.slice(0, 4)}年${Number(month.slice(5))}月`

const classificationView: Record<ProjectClassification, {
  group: TaxGroup; stage: string; candidate: string; rule: string; reason: string
}> = {
  'new-development': { group: 'future', stage: '新規開発', candidate: '取得価額',
    rule: '供用前の特定ソフトウェアへの直接開発', reason: '本人が新規開発として分類した利用です。' },
  maintenance: { group: 'current', stage: '保守', candidate: '通常経費',
    rule: '供用済みソフトウェアの効用維持', reason: '本人が保守・障害修正として分類した利用です。' },
  'feature-addition': { group: 'future', stage: '機能追加', candidate: '資本的支出',
    rule: '既存資産への新機能追加・価値増加', reason: '本人が一つの改良計画として分類した利用です。' },
  'general-learning': { group: 'review', stage: '一般学習', candidate: '対象外',
    rule: '本人が一般学習として分類', reason: '特定の制作物へ直接対応しない学習として記録されています。' },
  private: { group: 'review', stage: '私用', candidate: '私用',
    rule: '本人が私用として分類', reason: '事業原価へ含めない利用として記録されています。' },
  unclassified: { group: 'review', stage: '未分類', candidate: '未分類',
    rule: '本人確認待ち', reason: '制作物と作業目的がまだ確定していません。' },
}

export function safeLocalLabel(value: string | null, fallback: string): string {
  if (!value) return fallback
  const segment = value.split(/[\\/]/).filter(Boolean).at(-1) ?? fallback
  return [...segment].filter((character) => {
    const code = character.charCodeAt(0)
    return code >= 32 && code !== 127
  }).join('').trim().slice(0, 120) || fallback
}

export function displayProject(
  projectKey: string, projectLabel: string | null,
  taxUnitId: string | null, units: Map<string, TaxUnitRecord>,
): string {
  return (taxUnitId ? units.get(taxUnitId)?.name : undefined) ??
    safeLocalLabel(projectLabel, `Project ${projectKey.slice(-6)}`)
}

export type AssignedSession = UsageObservation & { assignment: SessionAssignment }
export type ProjectMonthGroup = {
  provider: UsageProvider; month: string; projectKey: string; taxUnitId: string | null
  classification: ProjectClassification; projectLabel: string | null; model: string | null
  sessions: number; messageCount: number; inputTokens: number; outputTokens: number
  cacheReadTokens: number; cacheWriteTokens: number; firstStartedAt: string; lastEndedAt: string
}

export function groupKey(group: Pick<ProjectMonthGroup, 'provider' | 'month' | 'projectKey' | 'taxUnitId' | 'classification'>): string {
  return JSON.stringify([group.provider, group.month, group.projectKey, group.taxUnitId ?? '', group.classification])
}

/** Granular events may split purposes without inflating the session count. */
export function groupAssignedSessions(sessions: AssignedSession[]): ProjectMonthGroup[] {
  const groups = new Map<string, ProjectMonthGroup>()
  const seenSessions = new Set<string>()
  for (const session of sessions) {
    const key = groupKey({ ...session, ...session.assignment })
    const current = groups.get(key)
    const identity = JSON.stringify([key, observationGroupKey(session)])
    const isNewSession = !seenSessions.has(identity)
    seenSessions.add(identity)
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
    if (isNewSession) current.sessions++
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

export function allocationForGroup(
  group: ProjectMonthGroup, line: AllocationLine,
  units: Map<string, TaxUnitRecord>, allocationId = groupKey(group),
): Allocation {
  const view = classificationView[group.classification] ?? classificationView.unclassified
  const unit = group.taxUnitId ? units.get(group.taxUnitId) : undefined
  return {
    id: allocationId, month: displayBillingMonth(group.month), provider: providerLabel[group.provider],
    product: unit?.name ?? safeLocalLabel(group.projectLabel, `Project ${group.projectKey.slice(-6)}`),
    asset: unit?.name ?? '要確認', stage: view.stage,
    usageRate: Math.round(line.allocationRatio * 1000) / 10, amount: line.allocatedAmountJpy,
    group: view.group, taxCandidate: view.candidate, confidence: unit ? 'B' : 'C',
    rule: view.rule, reason: view.reason,
    missing: unit ? '供用状況と対応する証拠を確認してください。' : '制作物と作業目的を確認してください。',
    projectKey: group.projectKey, monthKey: group.month,
    classification: group.classification, taxUnitId: group.taxUnitId ?? undefined,
    session: {
      date: `${localDateFromTimestamp(group.firstStartedAt) ?? group.month} 〜 ${localDateFromTimestamp(group.lastEndedAt) ?? group.month}`,
      id: `${group.provider === 'codex' ? 'cdx' : 'cld'}-••••-${group.projectKey.slice(-4)}`,
      folder: safeLocalLabel(group.projectLabel, '名称未取得'), branch: '取得対象外',
      model: group.model ?? 'unknown',
      tokens: group.inputTokens + group.outputTokens + group.cacheReadTokens + group.cacheWriteTokens,
      classification: unit ? `期間ルール → ${unit.name}` : '未分類',
      manualEdit: `${group.sessions}セッション / ${group.messageCount}利用記録`,
    },
  }
}

export function unobservedAllocation(
  provider: UsageProvider, month: string, line: AllocationLine, scopeId: string,
): Allocation {
  const adjustment = line.kind === 'rounding-adjustment'
  return {
    id: `${provider}-${month}-${scopeId}-${line.kind}`,
    month: displayBillingMonth(month), monthKey: month, provider: providerLabel[provider],
    product: adjustment ? '丸め調整' : '未取得利用', asset: '要確認',
    stage: adjustment ? '1円未満調整' : '未取得',
    usageRate: Math.round(line.allocationRatio * 1000) / 10, amount: line.allocatedAmountJpy,
    group: 'review', taxCandidate: '未分類', confidence: 'C',
    rule: adjustment ? '請求との合計不変条件' : 'ローカル履歴で捕捉できない利用を留保',
    reason: adjustment ? '各配賦額の1円未満を切り捨てた差額です。' : 'ローカル履歴に含まれない利用分です。',
    missing: adjustment ? 'なし' : '契約・適用期間に対応する未取得利用の根拠を確認してください。',
    session: { date: month, id: adjustment ? 'rounding' : 'unobserved', folder: '履歴なし',
      branch: '対象外', model: '複数', tokens: 0,
      classification: adjustment ? '丸め調整' : '未取得利用', manualEdit: adjustment ? '自動' : '割合入力' },
  }
}

export function outOfContractAllocation(session: AssignedSession, units: Map<string, TaxUnitRecord>): Allocation {
  return {
    id: `out-of-contract:${JSON.stringify([session.sourceId, session.provider, session.month, session.projectKey, session.sessionKey, session.startedAt, session.endedAt])}`,
    month: displayBillingMonth(session.month), monthKey: session.month,
    provider: providerLabel[session.provider],
    product: displayProject(session.projectKey, session.projectLabel, session.assignment.taxUnitId, units),
    asset: '対象外', stage: '契約期間外', usageRate: 0, amount: 0, group: 'review',
    taxCandidate: '契約期間外', confidence: 'C', rule: '契約期間外の利用は月額の配賦対象から除外',
    reason: '入力した契約期間の外の利用です。契約期間を誤って入力した場合は費用の入力で修正します。',
    missing: '契約の開始日・終了日が正しいか確認してください。',
    session: { date: localDateFromTimestamp(session.startedAt) ?? session.month,
      id: '契約期間外', folder: safeLocalLabel(session.projectLabel, `Project ${session.projectKey.slice(-6)}`),
      branch: '対象外', model: session.model ?? '不明', tokens: 0,
      classification: '契約期間外', manualEdit: '契約期間の入力' },
  }
}
