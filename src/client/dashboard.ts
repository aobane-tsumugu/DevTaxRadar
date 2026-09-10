import type { Allocation, DashboardData, TaxGroup } from './types'
import { emptyPlanningSnapshot, type PlanningSnapshot } from '../planning/types'
import { diagnosePlanning } from '../core/diagnosis'
import { allocateMonthlySubscription } from '../core/allocation'
import { calendarMonthPeriod, projectWorkspaceCosts, type SubscriptionCostScope } from '../core/workspaceCosts'

export type { Allocation, DashboardData, TaxGroup } from './types'

/** Synthetic facts only. Every monetary output below is calculated, not a second ledger. */
export const demoPlanning: PlanningSnapshot = {
  ...emptyPlanningSnapshot(2026),
  profile: { ...emptyPlanningSnapshot(2026).profile, hasBookkeeping: true, activityStartedOn: '2026-04-01' },
  taxUnits: [
    { id: 'tax-unit-internal', name: '執筆アシスタント', unitType: 'new-software', usageMode: 'internal', revenueModel: 'efficiency', lifecycleStatus: 'in-use', completionCriteria: '正式原稿の制作工程で使用', sameAsExternalVersion: 'no' },
    { id: 'tax-unit-public', name: 'DevTax', unitType: 'new-software', usageMode: 'external', revenueModel: 'oss', lifecycleStatus: 'developing', completionCriteria: '利用者の受入条件を満たす', sameAsExternalVersion: 'yes' },
    { id: 'tax-unit-mixed', name: 'コンテンツ制作基盤 v2', unitType: 'improvement-plan', usageMode: 'mixed', revenueModel: 'sales', lifecycleStatus: 'improving', predecessorId: 'tax-unit-internal', completionCriteria: '新しい制作工程の受入条件を満たす', sameAsExternalVersion: 'undecided' },
  ],
  projectRules: [
    { id: 'demo-rule-public', projectKey: 'demo-public', effectiveFrom: '2026-07-01', taxUnitId: 'tax-unit-public', classification: 'new-development', reason: '合成例の開発期間' },
    { id: 'demo-rule-internal', projectKey: 'demo-internal', effectiveFrom: '2026-06-06', taxUnitId: 'tax-unit-internal', classification: 'maintenance', reason: '合成例の保守期間' },
    { id: 'demo-rule-improvement', projectKey: 'demo-improvement', effectiveFrom: '2026-07-01', taxUnitId: 'tax-unit-mixed', classification: 'feature-addition', reason: '合成例の改良計画' },
  ],
  lifecycleEvents: [
    { id: 'event-internal-use', taxUnitId: 'tax-unit-internal', eventType: 'internal-use-started', occurredOn: '2026-06-06', recordedAt: '2026-06-07T00:00:00Z', evidenceIds: ['evidence-first-use'], note: '合成例の正式利用開始' },
    { id: 'event-public-start', taxUnitId: 'tax-unit-public', eventType: 'development-started', occurredOn: '2026-07-01', recordedAt: '2026-07-01T00:00:00Z', evidenceIds: [] },
    { id: 'event-improvement-start', taxUnitId: 'tax-unit-mixed', eventType: 'improvement-started', occurredOn: '2026-07-01', recordedAt: '2026-07-01T00:00:00Z', evidenceIds: [] },
  ],
  equipment: [
    { id: 'equipment-dgx', name: 'GPU機器（合成）', equipmentType: 'dgx', acquisitionCostJpy: 650000, acquiredOn: '2026-07-20', businessUseStartedOn: '2026-07-21', convertedFromPrivate: false, businessUseRatio: 0.9, usefulLifeYears: 4, role: '画像生成と検証', taxUnitId: 'tax-unit-mixed', projectAllocationRatio: 0.6, evidenceIds: ['evidence-receipt'] },
  ],
  homeCosts: [
    { id: 'home-rent', month: '2026-07', category: 'rent', amountJpy: 120000, method: 'area-time', businessUseRatio: 0.12, basis: '作業面積と利用時間による合成値', rationale: '共用室の業務利用', taxUnitId: 'tax-unit-public', projectAllocationRatio: 0.5, treatment: 'shared', evidenceIds: ['evidence-receipt'] },
    { id: 'home-internet', month: '2026-07', category: 'internet', amountJpy: 6200, method: 'usage-time', businessUseRatio: 0.65, basis: '利用時間による合成値', rationale: '共用回線の業務利用', projectAllocationRatio: 0, treatment: 'general', evidenceIds: ['evidence-receipt'] },
  ],
  directCosts: [
    { id: 'direct-outsource', incurredOn: '2026-07-15', costType: 'outsource', amountJpy: 18000, taxUnitId: 'tax-unit-public', directlyAttributable: true, treatment: 'direct', evidenceIds: ['evidence-receipt'], note: '実在しない外注費の合成例' },
    { id: 'direct-unknown', incurredOn: '2026-07-25', costType: 'cloud', amountJpy: null, unknownAmountReason: '合成例：請求の確認待ち', taxUnitId: 'tax-unit-mixed', directlyAttributable: true, treatment: 'direct', evidenceIds: [] },
  ],
  evidence: [
    { id: 'evidence-first-use', evidenceType: 'first-use', strength: 'self-recorded', occurredOn: '2026-06-06', recordedAt: '2026-06-07T00:00:00Z', note: '合成の正式利用メモ', taxUnitId: 'tax-unit-internal' },
    { id: 'evidence-receipt', evidenceType: 'receipt', strength: 'external', recordedAt: '2026-07-01T00:00:00Z', note: '実在しない請求書の例' },
  ],
}

const fixtures = [
  { provider: 'claude' as const, fee: 10000, rows: [
    { id: 'demo-internal', unit: 'tax-unit-internal', weight: 400, group: 'current' as TaxGroup, stage: '保守', classification: 'maintenance' as const },
    { id: 'demo-improvement', unit: 'tax-unit-mixed', weight: 600, group: 'future' as TaxGroup, stage: '機能追加', classification: 'feature-addition' as const },
  ] },
  { provider: 'codex' as const, fee: 20000, rows: [
    { id: 'demo-public', unit: 'tax-unit-public', weight: 1000, group: 'future' as TaxGroup, stage: '新規開発', classification: 'new-development' as const },
  ] },
]
const scopes: SubscriptionCostScope[] = []
const allocations: Allocation[] = []
for (const fixture of fixtures) {
  const month = '2026-07'
  const result = allocateMonthlySubscription({
    provider: fixture.provider, billingMonth: month, monthlyFeeJpy: fixture.fee,
    unobservedUsage: { kind: 'estimated', ratio: 0.1 },
    usageLines: fixture.rows.map((row) => ({ id: row.id, productId: row.id, taxUnitId: row.unit, bucket: 'product', usageWeight: row.weight })),
  })
  const sourceId = `demo:charge:${fixture.provider}`
  scopes.push({
    source: { id: sourceId, kind: 'subscription', label: `${fixture.provider} 合成請求`, originalAmountJpy: fixture.fee, currency: 'JPY', servicePeriod: calendarMonthPeriod(month), evidenceIds: ['evidence-receipt'], origin: 'entered' },
    basisId: `${sourceId}:basis`, period: calendarMonthPeriod(month), result,
    targets: Object.fromEntries(fixture.rows.map((row) => [row.id, { kind: 'tax-unit' as const, taxUnitId: row.unit }])),
  })
  for (const line of result.lines) {
    if (line.allocatedAmountJpy === 0) continue
    const fixtureRow = fixture.rows.find((row) => row.id === line.sourceId)
    const unit = demoPlanning.taxUnits.find((row) => row.id === fixtureRow?.unit)
    const group = fixtureRow?.group ?? 'review'
    allocations.push({
      id: `${sourceId}:${line.sourceId ?? line.kind}`, monthKey: month, month: '2026年7月',
      provider: fixture.provider === 'claude' ? 'Claude Code' : 'Codex', product: unit?.name ?? '未取得利用', asset: unit?.name ?? '未判断',
      stage: fixtureRow?.stage ?? '未取得', usageRate: Math.round(line.allocationRatio * 1000) / 10,
      amount: line.allocatedAmountJpy, group, taxCandidate: fixtureRow?.group === 'current' ? '通常経費候補' : fixtureRow ? '原価への対応候補' : '未判断', confidence: 'B',
      rule: '合成の利用量と期間分類', reason: '共通の配賦計算によるデモです。実在する利用や税務判断ではありません。', missing: '事実と扱いの確認は年度採用と別です。',
      projectKey: fixtureRow?.id, taxUnitId: fixtureRow?.unit, classification: fixtureRow?.classification,
      session: { date: month, id: fixtureRow?.id ?? 'synthetic-unobserved', folder: fixtureRow?.id ?? '履歴なし', branch: '取得対象外', model: 'synthetic', tokens: fixtureRow?.weight ?? null, classification: fixtureRow?.stage ?? '未判断', manualEdit: '合成データ' },
    })
  }
}
export const demoDiagnosis = diagnosePlanning(demoPlanning, { hasRelevantAiUsage: true })
export const demoDashboard: DashboardData = {
  meta: { source: 'demo', sessionCount: 3, lastSynced: '合成の固定データ', mappedRate: 100, classifiedRate: 100 },
  months: [{ monthKey: '2026-07', label: '2026年7月',
    current: allocations.filter((row) => row.group === 'current').reduce((sum, row) => sum + row.amount, 0),
    future: allocations.filter((row) => row.group === 'future').reduce((sum, row) => sum + row.amount, 0),
    review: allocations.filter((row) => row.group === 'review').reduce((sum, row) => sum + row.amount, 0),
  }],
  allocations, costProjection: projectWorkspaceCosts(demoPlanning, scopes),
  guidance: [{ title: '実在しない合成例です', description: '設備の方法未選択と請求額不明は、共通計算でも未算定として保持しています。', severity: 'warning' }],
  products: fixtures.flatMap((fixture) => fixture.rows.map((row) => ({ name: demoPlanning.taxUnits.find((unit) => unit.id === row.unit)!.name, folder: row.id, projectKey: row.id, sessions: 1, firstObservedMonth: '2026-07', lastObservedMonth: '2026-07', providers: [fixture.provider === 'claude' ? 'Claude Code' as const : 'Codex' as const] }))),
}

export function isLocalRuntime(): boolean {
  if (typeof window === 'undefined') return false
  const loopback = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
  return loopback && new URLSearchParams(window.location.search).get('mode') !== 'demo'
}
export async function getDashboardData(): Promise<DashboardData> {
  // Public demos never probe local history APIs, and failures never switch real data to demo.
  if (!isLocalRuntime()) return demoDashboard
  const response = await fetch('/api/dashboard', { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`利用履歴の読込に失敗しました（HTTP ${response.status}）。`)
  const value: unknown = await response.json()
  const candidate = value && typeof value === 'object' ? value as Partial<DashboardData> : null
  if (!candidate?.meta || !Array.isArray(candidate.months) || !Array.isArray(candidate.allocations)) throw new Error('利用履歴の応答形式を確認できませんでした。')
  return { ...candidate as DashboardData, meta: { ...candidate.meta, source: 'local' } }
}
