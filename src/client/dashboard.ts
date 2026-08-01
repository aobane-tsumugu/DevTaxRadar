import type { Allocation, DashboardData } from './types'
import type { Diagnosis, PlanningLedger, PlanningSnapshot } from '../planning/types'

export type { Allocation, DashboardData, TaxGroup } from './types'

export const demoPlanning: PlanningSnapshot = {
  version: 1,
  profile: {
    taxYear: 2026,
    journeyMode: 'early',
    incomeCategory: 'undecided',
    filingType: 'undecided',
    activityStartedOn: '2026-04-01',
    monetizationStatus: 'planned',
    hasBookkeeping: true,
  },
  taxUnits: [
    {
      id: 'tax-unit-internal', name: '執筆アシスタント', unitType: 'new-software',
      usageMode: 'internal', revenueModel: 'efficiency', lifecycleStatus: 'in-use',
      completionCriteria: '正式原稿の制作工程で安定して一話を処理できる',
      sameAsExternalVersion: 'no',
    },
    {
      id: 'tax-unit-public', name: 'DevTax Radar', unitType: 'new-software',
      usageMode: 'external', revenueModel: 'oss', lifecycleStatus: 'developing',
      completionCriteria: '公開デモ、README、ローカル履歴集計が動作する',
      sameAsExternalVersion: 'yes',
    },
    {
      id: 'tax-unit-mixed', name: 'コンテンツ制作基盤 v2', unitType: 'improvement-plan',
      usageMode: 'mixed', revenueModel: 'sales', lifecycleStatus: 'improving',
      completionCriteria: '自分の制作工程と外部提供版の双方で受入条件を満たす',
      predecessorId: 'tax-unit-internal', sameAsExternalVersion: 'undecided',
    },
  ],
  projectRules: [
    {
      id: 'rule-devtax-developing', projectKey: 'demo-product-a', provider: 'codex',
      effectiveFrom: '2026-07-18', taxUnitId: 'tax-unit-public',
      classification: 'new-development', reason: '公開前の新規開発期間',
    },
    {
      id: 'rule-writer-in-use', projectKey: 'demo-product-b', provider: 'claude',
      effectiveFrom: '2026-06-06', taxUnitId: 'tax-unit-internal',
      classification: 'maintenance', reason: '自己利用開始後の保守期間',
    },
  ],
  lifecycleEvents: [
    {
      id: 'event-internal-use', taxUnitId: 'tax-unit-internal', eventType: 'internal-use-started',
      occurredOn: '2026-06-06', recordedAt: '2026-06-07T09:00:00+09:00', evidenceIds: ['evidence-first-use'],
      note: 'テストではなく正式な制作工程へ採用',
    },
    {
      id: 'event-public-start', taxUnitId: 'tax-unit-public', eventType: 'development-started',
      occurredOn: '2026-07-18', recordedAt: '2026-07-18T12:00:00+09:00', evidenceIds: [],
    },
  ],
  equipment: [
    {
      id: 'equipment-dgx', name: 'DGX Spark', equipmentType: 'dgx', acquisitionCostJpy: 650000,
      acquiredOn: '2026-07-20', deliveredOn: '2026-07-20', businessUseStartedOn: '2026-07-21',
      convertedFromPrivate: false, businessUseRatio: 0.9, usefulLifeYears: 4,
      role: 'ローカルLLM検証と画像生成', taxUnitId: 'tax-unit-mixed', projectAllocationRatio: 0.6,
      evidenceIds: ['evidence-dgx-receipt'],
    },
    {
      id: 'equipment-laptop', name: 'GPUノートPC', equipmentType: 'pc', acquisitionCostJpy: 280000,
      acquiredOn: '2025-03-15', businessUseStartedOn: '2026-04-01', convertedFromPrivate: true,
      openingUnamortizedBalanceJpy: 205000, businessUseRatio: 0.7, usefulLifeYears: 4,
      role: '外出時の開発と動作確認', taxUnitId: 'tax-unit-public', projectAllocationRatio: 0.5,
      evidenceIds: [],
    },
  ],
  homeCosts: [
    {
      id: 'home-rent-07', month: '2026-07', category: 'rent', amountJpy: 120000,
      method: 'area-time', businessUseRatio: 0.12, basis: '作業面積20% × 使用時間60%',
      rationale: '共用部屋のため面積と利用時間を併用', taxUnitId: 'tax-unit-public',
      projectAllocationRatio: 0.5, treatment: 'shared', evidenceIds: [],
    },
    {
      id: 'home-electricity-07', month: '2026-07', category: 'electricity', amountJpy: 14500,
      method: 'watt-hour', businessUseRatio: 0.22, basis: '機器消費電力 × 稼働時間 ÷ 月使用量',
      rationale: 'DGXとPCの仕様・稼働記録から算出', taxUnitId: 'tax-unit-mixed',
      projectAllocationRatio: 0.6, treatment: 'shared', evidenceIds: [],
    },
    {
      id: 'home-internet-07', month: '2026-07', category: 'internet', amountJpy: 6200,
      method: 'usage-time', businessUseRatio: 0.65, basis: '業務利用時間の記録',
      rationale: '共用回線のため利用時間で按分', projectAllocationRatio: 0,
      treatment: 'general', evidenceIds: [],
    },
  ],
  directCosts: [],
  evidence: [
    {
      id: 'evidence-first-use', evidenceType: 'first-use', strength: 'self-recorded',
      occurredOn: '2026-06-06', recordedAt: '2026-06-07T09:00:00+09:00',
      note: '正式原稿への初回採用メモ', taxUnitId: 'tax-unit-internal',
    },
    {
      id: 'evidence-dgx-receipt', evidenceType: 'receipt', strength: 'external',
      occurredOn: '2026-07-20', recordedAt: '2026-07-20T18:00:00+09:00',
      note: '購入領収書（ローカル参照のみ）', taxUnitId: 'tax-unit-mixed',
    },
  ],
  decisions: [],
}

export const demoDiagnosis: Diagnosis = {
  currentPosition: [
    '自分の実作業で使う制作物と、外部公開を目指す制作物の両方があります。',
    '執筆アシスタントは自己利用開始済み、DevTax Radarは公開前の開発中です。',
    'PC・DGXと自宅費用の按分根拠を登録済みですが、未添付の証拠があります。',
  ],
  immediateActions: [
    { id: 'action-1', priority: 'high', title: 'GPUノートPCの転用時残高を確認', reason: '私用から業務へ転用しているため、購入額全額ではなく転用時点の残高確認が必要です。', trigger: 'now' },
    { id: 'action-2', priority: 'high', title: 'DevTax Radarの完成条件を確認', reason: '供用開始を後から説明できるよう、正式利用の条件を先に残します。', trigger: 'now', taxUnitId: 'tax-unit-public' },
    { id: 'action-3', priority: 'medium', title: '7月の家賃按分根拠を添付', reason: '面積と利用時間の計算メモが未登録です。', trigger: 'now' },
  ],
  eventTriggeredActions: [
    { id: 'action-4', priority: 'medium', title: '初回公開日を記録', reason: '外部公開した日に、URLやデプロイ履歴を証拠として残します。', trigger: 'event', taxUnitId: 'tax-unit-public' },
    { id: 'action-5', priority: 'low', title: '旧版の利用終了を記録', reason: 'v2へ全面移行したときに、旧版の残価と二重計上を確認します。', trigger: 'event', taxUnitId: 'tax-unit-mixed' },
  ],
  missingFacts: ['GPUノートPCの転用時未償却残高', '家賃按分の計測メモ', '公開版と自己利用版が同一かの最終判断'],
  readiness: { confirmed: 7, total: 10 },
}

export const demoLedger: PlanningLedger = {
  year: 2026,
  contributions: [
    { sourceType: 'equipment', sourceId: 'equipment-dgx', taxUnitId: 'tax-unit-mixed', grossAmountJpy: 650000, businessAmountJpy: 585000, allocatedAmountJpy: 351000, privateAmountJpy: 65000, unallocatedAmountJpy: 234000, treatment: 'direct', warnings: ['当年償却額は供用日・耐用年数・償却方法の確認後に算定'] },
    { sourceType: 'home', sourceId: 'home-rent-07', taxUnitId: 'tax-unit-public', grossAmountJpy: 120000, businessAmountJpy: 14400, allocatedAmountJpy: 7200, privateAmountJpy: 105600, unallocatedAmountJpy: 7200, treatment: 'shared', warnings: [] },
    { sourceType: 'home', sourceId: 'home-electricity-07', taxUnitId: 'tax-unit-mixed', grossAmountJpy: 14500, businessAmountJpy: 3190, allocatedAmountJpy: 1914, privateAmountJpy: 11310, unallocatedAmountJpy: 1276, treatment: 'shared', warnings: [] },
  ],
  totals: { grossAmountJpy: 784500, businessAmountJpy: 602590, allocatedAmountJpy: 360114, privateAmountJpy: 181910, unallocatedAmountJpy: 242476 },
  byTaxUnit: [
    { taxUnitId: 'tax-unit-public', name: 'DevTax Radar', amountJpy: 7200, candidate: '取得価額候補', missingFacts: ['供用開始日'] },
    { taxUnitId: 'tax-unit-mixed', name: 'コンテンツ制作基盤 v2', amountJpy: 352914, candidate: '資本的支出候補', missingFacts: ['改良完了日'] },
  ],
}

const session = (
  provider: 'Claude Code' | 'Codex',
  month: string,
  suffix: string,
  tokens: number,
  branch: string,
): Allocation['session'] => ({
  date: `2026-${month.replace('月', '').padStart(2, '0')}-18 21:42`,
  id: `${provider === 'Codex' ? 'cdx' : 'cld'}-••••-${suffix}`,
  folder: `C:\\work\\product-${suffix.slice(0, 1).toLowerCase()}`,
  branch,
  model: provider === 'Codex' ? 'gpt-5.4' : 'claude-opus-4',
  tokens,
  classification: `作業フォルダ完全一致 → Product ${suffix.slice(0, 1)}`,
  manualEdit: 'なし',
})

export const demoDashboard: DashboardData = {
  meta: {
    source: 'demo',
    sessionCount: 1051,
    lastSynced: 'たった今',
    allocatedRate: 92,
  },
  months: [
    { label: '4月', current: 11400, future: 29400, review: 4200 },
    { label: '5月', current: 13800, future: 31200, review: 9000 },
    { label: '6月', current: 8400, future: 38400, review: 7200 },
    { label: '7月', current: 14600, future: 27800, review: 6200 },
  ],
  allocations: [
    {
      id: 'a1', month: '4月', provider: 'Codex', product: 'Product A', asset: 'A-v1',
      stage: '新規開発', usageRate: 42, amount: 8400, group: 'future', taxCandidate: '取得価額',
      confidence: 'A', rule: '特定ソフトウェアの供用前・直接開発',
      reason: '登録済みリポジトリと開発ブランチに一致し、A-v1は未供用です。',
      missing: '供用開始時にリリース証跡を登録してください。',
      session: session('Codex', '4月', 'A14', 184200, 'feature/core-engine'),
    },
    {
      id: 'a2', month: '4月', provider: 'Claude Code', product: 'Product B', asset: 'B-v1',
      stage: '保守', usageRate: 18, amount: 5400, group: 'current', taxCandidate: '通常経費',
      confidence: 'B', rule: '供用済みソフトウェアの効用維持',
      reason: '障害修正ブランチと供用済み資産B-v1に対応しています。',
      missing: '機能追加を含まないことをIssueで確認してください。',
      session: session('Claude Code', '4月', 'B22', 97500, 'fix/auth-timeout'),
    },
    {
      id: 'a3', month: '5月', provider: 'Claude Code', product: 'Product B', asset: 'B決済機能',
      stage: '機能追加', usageRate: 31, amount: 9300, group: 'future', taxCandidate: '資本的支出',
      confidence: 'B', rule: '既存資産への新機能追加・価値増加',
      reason: '新しい決済手段を追加する一連の改良計画に対応しています。',
      missing: '改良計画の完了日と供用開始日が未登録です。',
      session: session('Claude Code', '5月', 'B31', 164800, 'feature/payment-v2'),
    },
    {
      id: 'a4', month: '5月', provider: 'Codex', product: 'Product A', asset: 'A-v1',
      stage: '新規開発', usageRate: 52, amount: 15600, group: 'future', taxCandidate: '取得価額',
      confidence: 'A', rule: '特定ソフトウェアの供用前・直接開発',
      reason: 'A-v1の開発ブランチに対応し、作業フォルダ分類も確定済みです。',
      missing: 'なし。月次確定が可能です。',
      session: session('Codex', '5月', 'A52', 268300, 'feature/allocation'),
    },
    {
      id: 'a5', month: '6月', provider: 'Claude Code', product: 'Product A', asset: 'A-v1',
      stage: '新規開発', usageRate: 71, amount: 21300, group: 'future', taxCandidate: '取得価額',
      confidence: 'A', rule: '特定ソフトウェアの供用前・直接開発',
      reason: 'A-v1の開発環境で行われた未供用期間の直接開発です。',
      missing: '供用開始の判断条件を設定してください。',
      session: session('Claude Code', '6月', 'A71', 352900, 'feature/tax-rules'),
    },
    {
      id: 'a6', month: '6月', provider: 'Codex', product: 'Product C', asset: '対象外',
      stage: '趣味', usageRate: 12, amount: 2400, group: 'review', taxCandidate: '私用',
      confidence: 'B', rule: 'ユーザー登録済みの私用フォルダ',
      reason: '私用として登録したフォルダに一致しています。',
      missing: 'ユーザーの最終確認が必要です。',
      session: session('Codex', '6月', 'C12', 44200, 'main'),
    },
    {
      id: 'a7', month: '7月', provider: 'Claude Code', product: 'Product A', asset: 'A-v1',
      stage: '新規開発', usageRate: 64, amount: 19200, group: 'future', taxCandidate: '取得価額',
      confidence: 'A', rule: '特定ソフトウェアの供用前・直接開発',
      reason: 'A-v1の開発作業として継続的に分類されています。',
      missing: '外注費18,000円の対応関係を確認してください。',
      session: session('Claude Code', '7月', 'A64', 311600, 'feature/onboarding'),
    },
    {
      id: 'a8', month: '7月', provider: 'Codex', product: '未分類', asset: '要確認',
      stage: '調査', usageRate: 8, amount: 2400, group: 'review', taxCandidate: '未分類',
      confidence: 'C', rule: '分類ルールに一致しない作業フォルダ',
      reason: '登録済みプロダクトへ自動で対応付けられませんでした。',
      missing: 'プロダクトまたは私用を選択してください。',
      session: session('Codex', '7月', 'X08', 39800, 'main'),
    },
  ],
  boundaries: [
    { product: 'Product A', asset: 'A-v1', kind: '新規ソフトウェア', amount: 96500, threshold: 100000, thresholdLabel: '10万円境界', status: '3,500円手前', tone: 'near' },
    { product: 'Product B', asset: 'B決済機能', kind: '一つの改良計画', amount: 182000, threshold: 200000, thresholdLabel: '明らかでない改良の20万円基準', status: '要事実確認', tone: 'review' },
    { product: 'Product D', asset: 'D-v1', kind: '新規ソフトウェア', amount: 365000, threshold: 400000, thresholdLabel: '青色40万円特例', status: '適用要件確認', tone: 'review' },
    { product: 'Claude', asset: '年払Claude', kind: '契約期間12か月', amount: 330000, threshold: 360000, thresholdLabel: '11か月分受益済み', status: '前払確認', tone: 'safe' },
  ],
  assets: [
    { product: 'Product A', name: 'A-v1', total: 96500, aiCost: 72000, outsource: 18000, other: 6500, futureBalance: 96500, inService: false },
    { product: 'Product B', name: 'B決済機能', total: 182000, aiCost: 52700, outsource: 120000, other: 9300, futureBalance: 182000, inService: false },
  ],
  guidance: [
    { title: '7月の未分類利用 8%', description: '1件の作業フォルダを確認してください', severity: 'warning' },
    { title: 'A-v1の供用条件', description: '初回ユーザー利用を証跡候補に設定済み', severity: 'ok' },
    { title: 'Claude未取得利用', description: '10%として対象外・要確認に残しています', severity: 'ok' },
  ],
  products: [
    { name: 'Product A', folder: 'C:\\work\\product-a', sessions: 418 },
    { name: 'Product B', folder: 'C:\\work\\product-b', sessions: 227 },
    { name: 'Product C', folder: 'C:\\work\\private-lab', sessions: 84 },
  ],
}

function isDashboardData(value: unknown): value is DashboardData {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<DashboardData>
  return Boolean(candidate.meta && Array.isArray(candidate.months) && Array.isArray(candidate.allocations))
}

export function isLocalRuntime(): boolean {
  if (typeof window === 'undefined') return false
  return window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
}

export async function getDashboardData(): Promise<DashboardData> {
  // A hosted demo must never probe for local history APIs. Only loopback builds
  // may request the read-only collector; every other origin uses synthetic data.
  if (!isLocalRuntime()) return demoDashboard

  try {
    const response = await fetch('/api/dashboard', { headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`Dashboard API: ${response.status}`)
    const value: unknown = await response.json()
    if (!isDashboardData(value)) throw new Error('Dashboard API returned an unsupported shape')
    return { ...value, meta: { ...value.meta, source: 'local' } }
  } catch {
    return demoDashboard
  }
}
