import type { Allocation, DashboardData } from './types'

export type { Allocation, DashboardData, TaxGroup } from './types'

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

export async function getDashboardData(): Promise<DashboardData> {
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
