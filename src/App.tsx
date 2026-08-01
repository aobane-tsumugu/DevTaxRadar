import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  demoDiagnosis,
  demoLedger,
  demoPlanning,
  getDashboardData,
  isLocalRuntime,
  type Allocation,
  type DashboardData,
  type TaxGroup,
} from './client/dashboard'
import {
  getDiagnosis,
  getConfiguration,
  getLedger,
  getPlanning,
  getPlanningExport,
  getRuntime,
  savePlanning,
  saveConfiguration,
  scanHistory,
} from './client/api'
import type {
  LocalConfiguration,
  ProjectClassification,
  ProjectMapping,
  ProviderKey,
  RuntimeData,
  ScanResult,
} from './client/types'
import type {
  Diagnosis,
  DirectCostRecord,
  EquipmentRecord,
  EvidenceRecord,
  HomeCostRecord,
  LifecycleEventType,
  PlanningLedger,
  PlanningSnapshot,
  TaxUnitRecord,
} from './planning/types'
import { diagnosePlanning } from './core/diagnosis'
import './index.css'

type Page = 'summary' | 'evidence' | 'guide'
type Provider = 'すべて' | 'Claude Code' | 'Codex'

const yen = new Intl.NumberFormat('ja-JP', {
  style: 'currency',
  currency: 'JPY',
  maximumFractionDigits: 0,
})

const GROUP_LABELS: Record<TaxGroup, string> = {
  current: '今年の必要経費',
  future: '翌年以後へ残る原価',
  review: '対象外・要確認',
}

const GROUP_CLASS: Record<TaxGroup, string> = {
  current: 'coral',
  future: 'indigo',
  review: 'amber',
}

const incomeCategoryLabel = (value: PlanningSnapshot['profile']['incomeCategory']) => ({
  undecided: '所得区分・未確定',
  miscellaneous: '雑所得・検討中',
  business: '事業所得・検討中',
}[value])

const usageModeLabel = (value: TaxUnitRecord['usageMode']) => ({
  internal: '自分の実作業で使う',
  external: '外部へ公開・提供する',
  mixed: '自分でも使い、外部にも提供する',
  undecided: 'まだ決めていない',
}[value])

const lifecycleLabel = (value: TaxUnitRecord['lifecycleStatus']) => ({
  idea: '構想', prototype: '試作', developing: '開発中', evaluating: '評価中',
  'in-use': '正式利用中', maintaining: '保守中', improving: '改良中',
  retired: '廃止', abandoned: '開発中止',
}[value])

const categoryLabel = (value: HomeCostRecord['category']) => ({
  rent: '家賃', electricity: '電気', internet: '通信',
}[value])

const monthKeyFromLabel = (label: string, fallbackYear: number) => {
  const japaneseMonth = label.match(/^(?:(\d{4})年)?(\d{1,2})月$/)
  if (japaneseMonth) {
    const year = japaneseMonth[1] ?? String(fallbackYear)
    return `${year}-${japaneseMonth[2].padStart(2, '0')}`
  }
  return `${fallbackYear}-01`
}

function App() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [page, setPage] = useState<Page>('summary')
  const [provider, setProvider] = useState<Provider>('すべて')
  const [product, setProduct] = useState('すべて')
  const [onboarding, setOnboarding] = useState(false)
  const [onboardingStep, setOnboardingStep] = useState(0)
  const [selectedAllocation, setSelectedAllocation] = useState<Allocation | null>(null)
  const [runtime, setRuntime] = useState<RuntimeData | null>(null)
  const [configuration, setConfiguration] = useState<LocalConfiguration | null>(null)
  const [planning, setPlanningState] = useState<PlanningSnapshot>(demoPlanning)
  const [diagnosis, setDiagnosis] = useState<Diagnosis>(demoDiagnosis)
  const [ledger, setLedger] = useState<PlanningLedger>(demoLedger)
  const [runtimeLoading, setRuntimeLoading] = useState(true)
  const autoOnboardingShown = useRef(false)

  useEffect(() => {
    getDashboardData().then(setData)
    if (!isLocalRuntime()) {
      setRuntimeLoading(false)
      return
    }
    Promise.all([getRuntime(), getConfiguration(), getPlanning(), getDiagnosis()])
      .then(async ([nextRuntime, nextConfiguration, nextPlanning, nextDiagnosis]) => {
        setRuntime(nextRuntime)
        setConfiguration(nextConfiguration)
        setPlanningState(nextPlanning)
        setDiagnosis(nextDiagnosis)
        setLedger(await getLedger(nextPlanning.profile.taxYear))
      })
      .catch(() => {
        // The standalone Vite preview intentionally falls back to demo data.
      })
      .finally(() => setRuntimeLoading(false))
  }, [])

  useEffect(() => {
    if (
      autoOnboardingShown.current ||
      !data ||
      data.meta.source !== 'local' ||
      !configuration
    ) return
    const hasAnyCharge =
      configuration.charges.claude > 0 ||
      configuration.charges.codex > 0 ||
      configuration.monthlyCharges.some((charge) => charge.amountJpy > 0)
    if (!hasAnyCharge || data.meta.allocatedRate === 0) {
      autoOnboardingShown.current = true
      setOnboardingStep(data.meta.sessionCount > 0 ? 1 : 0)
      setOnboarding(true)
    }
  }, [configuration, data])

  async function runScan(providers: ProviderKey[]): Promise<ScanResult> {
    const activeRuntime = runtime ?? await getRuntime()
    if (!runtime) setRuntime(activeRuntime)
    const result = await scanHistory(activeRuntime.csrfToken, providers)
    const [nextDashboard, nextConfiguration] = await Promise.all([
      getDashboardData(),
      getConfiguration(),
    ])
    setData(nextDashboard)
    setConfiguration(nextConfiguration)
    return result
  }

  async function storeConfiguration(nextConfiguration: LocalConfiguration): Promise<void> {
    const activeRuntime = runtime ?? await getRuntime()
    if (!runtime) setRuntime(activeRuntime)
    await saveConfiguration(activeRuntime.csrfToken, nextConfiguration)
    setConfiguration(nextConfiguration)
    setData(await getDashboardData())
  }

  async function storePlanning(nextPlanning: PlanningSnapshot): Promise<void> {
    const activeRuntime = runtime ?? await getRuntime()
    if (!runtime) setRuntime(activeRuntime)
    await savePlanning(activeRuntime.csrfToken, nextPlanning)
    const [nextDiagnosis, nextLedger, nextDashboard] = await Promise.all([
      getDiagnosis(),
      getLedger(nextPlanning.profile.taxYear),
      getDashboardData(),
    ])
    setPlanningState(nextPlanning)
    setDiagnosis(nextDiagnosis)
    setLedger(nextLedger)
    setData(nextDashboard)
  }

  const allocations = useMemo(() => {
    if (!data) return []
    return data.allocations.filter(
      (row) =>
        (provider === 'すべて' || row.provider === provider) &&
        (product === 'すべて' || row.product === product),
    )
  }, [data, product, provider])

  if (!data) {
    return (
      <main className="loading-shell" aria-busy="true">
        <div className="radar-mark">D</div>
        <p>ローカルの利用履歴を集計しています…</p>
      </main>
    )
  }

  const representativeTotals = allocations.reduce(
    (sum, row) => {
      sum[row.group] += row.amount
      return sum
    },
    { current: 0, future: 0, review: 0 } as Record<TaxGroup, number>,
  )
  const filteredTotals =
    provider === 'すべて' && product === 'すべて'
      ? data.months.reduce(
          (sum, month) => ({
            current: sum.current + month.current,
            future: sum.future + month.future,
            review: sum.review + month.review,
          }),
          { current: 0, future: 0, review: 0 },
        )
      : representativeTotals

  const products = ['すべて', ...new Set(data.allocations.map((row) => row.product))]
  const filteredMonths = data.months.map((month) => {
    if (provider === 'すべて' && product === 'すべて') return month
    const rows = allocations.filter((row) => row.month === month.label)
    return {
      ...month,
      current: rows.reduce((sum, row) => sum + (row.group === 'current' ? row.amount : 0), 0),
      future: rows.reduce((sum, row) => sum + (row.group === 'future' ? row.amount : 0), 0),
      review: rows.reduce((sum, row) => sum + (row.group === 'review' ? row.amount : 0), 0),
    }
  })

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#top" aria-label="DevTax Radar ホーム">
          <span className="radar-mark">D</span>
          <span>
            <strong>DevTax Radar</strong>
            <small>AI原価を、説明できる数字に。</small>
          </span>
        </a>

        <nav aria-label="メインナビゲーション">
          <button
            className={page === 'summary' ? 'nav-item active' : 'nav-item'}
            onClick={() => setPage('summary')}
          >
            <span aria-hidden="true">⌁</span>
            <span>今年どうなる？<small>年間見込と境界</small></span>
          </button>
          <button
            className={page === 'evidence' ? 'nav-item active' : 'nav-item'}
            onClick={() => setPage('evidence')}
          >
            <span aria-hidden="true">≡</span>
            <span>なぜそうなる？<small>配賦と根拠ログ</small></span>
          </button>
          <button
            className={page === 'guide' ? 'nav-item active' : 'nav-item'}
            onClick={() => setPage('guide')}
          >
            <span aria-hidden="true">?</span>
            <span>税務QA<small>言葉と境界を知る</small></span>
          </button>
        </nav>

        <div className="sidebar-status">
          <div className="status-line">
            <span className="pulse" />
            <span>{data.meta.source === 'local' ? 'ローカル接続中' : '合成データデモ'}</span>
          </div>
          <strong>{data.meta.sessionCount.toLocaleString()}件の利用記録</strong>
          <small>最終同期 {data.meta.lastSynced}</small>
          <button className="quiet-button" onClick={() => { setOnboardingStep(0); setOnboarding(true) }}>
            設定を確認
          </button>
        </div>
        <p className="local-note">
          {data.meta.source === 'local'
            ? '履歴本文はこのPCから送信されません'
            : '実在する履歴・請求額・パスは含みません'}
        </p>
      </aside>

      <div className="workspace" id="top">
        <header className="topbar">
          <div>
            <span className="eyebrow">対象年</span>
            <strong>{planning.profile.taxYear}年</strong>
            <span className="profile-pill">{incomeCategoryLabel(planning.profile.incomeCategory)}</span>
          </div>
          <div className="top-actions">
            <span className={data.meta.source === 'local' ? 'source-badge live' : 'source-badge'}>
              {data.meta.source === 'local' ? '実データ' : 'デモデータ'}
            </span>
            {data.meta.source !== 'demo' && (
              <button className="primary-button" onClick={() => { setOnboardingStep(3); setOnboarding(true) }}>
                ＋ 月次確認
              </button>
            )}
          </div>
        </header>

        <main className="content">
          {data.meta.source === 'demo' && (
            <section className="public-demo-banner" aria-labelledby="public-demo-title">
              <span className="demo-shield" aria-hidden="true">✓</span>
              <div className="demo-banner-copy">
                <span className="demo-label">公開デモ・合成データ</span>
                <strong id="public-demo-title">AIサブスク費用を、税務説明できるプロダクト原価へ。</strong>
                <p>
                  この画面に実在の履歴・請求額・パスは含まれません。
                  GitHub版はClaude Code／Codexの履歴をPC内だけで集計します。
                </p>
              </div>
              <button
                className="demo-cta"
                onClick={() => setPage(page === 'summary' ? 'evidence' : 'summary')}
              >
                {page === 'summary' ? '月次集計の根拠を辿る' : '年間サマリーへ戻る'}
                <span aria-hidden="true">{page === 'summary' ? ' →' : ' ←'}</span>
              </button>
            </section>
          )}
          <section className="page-heading">
            <div>
              <span className="eyebrow">{page === 'summary' ? '年間の見通し' : page === 'evidence' ? '数字の根拠' : 'やさしい税務ガイド'}</span>
              <h1>{page === 'summary' ? '今年どうなる？' : page === 'evidence' ? 'なぜそうなる？' : '税務の言葉を知る'}</h1>
              <p>
                {page === 'summary'
                  ? '定額のClaude Code／Codexを利用実態で配賦し、今年の費用と将来へ残る原価を見通します。'
                  : page === 'evidence'
                    ? '月額料金からAIサービス・月・作っているものまで、数字の由来を辿れます。'
                    : '取得価額や資本的支出を、1文の結論と具体例から確認できます。'}
              </p>
            </div>
            {page !== 'guide' && (
              <div className="filters" aria-label="表示フィルター">
                <label>
                  <span>AIサービス</span>
                  <select value={provider} onChange={(event) => setProvider(event.target.value as Provider)}>
                    <option>すべて</option>
                    <option>Claude Code</option>
                    <option>Codex</option>
                  </select>
                </label>
                <label>
                  <span>作っているもの</span>
                  <select value={product} onChange={(event) => setProduct(event.target.value)}>
                    {products.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
              </div>
            )}
          </section>

          {page === 'summary' ? (
            <SummaryPage
              data={data}
              planning={planning}
              diagnosis={diagnosis}
              months={filteredMonths}
              totals={filteredTotals}
              onOpenEvidence={(allocation) => {
                setSelectedAllocation(allocation)
                setPage('evidence')
              }}
              onOpenGuide={() => setPage('guide')}
            />
          ) : page === 'evidence' ? (
            <EvidencePage
              data={data}
              planning={planning}
              ledger={ledger}
              diagnosis={diagnosis}
              allocations={allocations}
              selected={selectedAllocation}
              onSelect={setSelectedAllocation}
            />
          ) : (
            <TaxGuidePage />
          )}
        </main>
      </div>

      {onboarding && (
        <Onboarding
          step={onboardingStep}
          data={data}
          runtime={runtime}
          runtimeLoading={runtimeLoading}
          configuration={configuration}
          planning={planning}
          onStep={setOnboardingStep}
          onScan={runScan}
          onSave={storeConfiguration}
          onSavePlanning={storePlanning}
          onClose={() => {
            setOnboarding(false)
            setOnboardingStep(0)
          }}
        />
      )}
    </div>
  )
}

function SummaryPage({
  data,
  planning,
  diagnosis,
  months,
  totals,
  onOpenEvidence,
  onOpenGuide,
}: {
  data: DashboardData
  planning: PlanningSnapshot
  diagnosis: Diagnosis
  months: DashboardData['months']
  totals: Record<TaxGroup, number>
  onOpenEvidence: (allocation: Allocation) => void
  onOpenGuide: () => void
}) {
  const annualTotal = totals.current + totals.future + totals.review
  const maxMonth = Math.max(...months.map((month) => month.current + month.future + month.review), 1)

  return (
    <>
      <section className="preparation-strip" aria-label="記録の準備状況">
        <div><span>準備できた項目</span><strong>{diagnosis.readiness.confirmed} / {diagnosis.readiness.total}</strong></div>
        <div><span>今月の確認</span><strong>{data.guidance.filter((item) => item.severity === 'ok').length} / {data.guidance.length}</strong></div>
        <div><span>記録のある月</span><strong>{months.length}か月</strong></div>
        <div className="small-wins" aria-label="できたこと">
          <span className={data.meta.sessionCount > 0 ? 'done' : ''}>✓ 履歴</span>
          <span className={planning.taxUnits.length > 0 ? 'done' : ''}>✓ 制作物</span>
          <span className={planning.equipment.length > 0 ? 'done' : ''}>✓ 設備</span>
          <span className={planning.homeCosts.length > 0 ? 'done' : ''}>✓ 自宅費用</span>
          <span className={planning.evidence.length > 0 ? 'done' : ''}>✓ 証拠</span>
        </div>
      </section>
      <section className="diagnosis-grid" aria-label="現在地診断と次の行動">
        <article className="panel position-panel">
          <PanelHeading
            title="現在地診断"
            subtitle="登録した事実から生成。税務判断を確定するものではありません"
            trailing={
              <span className="readiness-chip">
                確認済み {diagnosis.readiness.confirmed}/{diagnosis.readiness.total}
              </span>
            }
          />
          <ul className="position-list">
            {diagnosis.currentPosition.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <div className="usage-overview">
            {planning.taxUnits.slice(0, 3).map((unit) => (
              <div key={unit.id}>
                <strong>{unit.name}</strong>
                <span>{usageModeLabel(unit.usageMode)}</span>
                <small>{lifecycleLabel(unit.lifecycleStatus)}</small>
              </div>
            ))}
          </div>
        </article>
        <article className="panel action-panel">
          <PanelHeading
            title="次にやること"
            subtitle="税額ではなく、実態と証拠を整える順番です"
            trailing={<span className="action-count">不足 {diagnosis.missingFacts.length}件</span>}
          />
          <ol className="action-list">
            {diagnosis.immediateActions.slice(0, 3).map((action) => (
              <li key={action.id}>
                <span className={`priority-dot ${action.priority}`} aria-hidden="true" />
                <div><strong>{action.title}</strong><p>{action.reason}</p></div>
              </li>
            ))}
          </ol>
          {diagnosis.eventTriggeredActions[0] && (
            <details className="event-action">
              <summary>イベントが起きたら行うこと</summary>
              <p><strong>{diagnosis.eventTriggeredActions[0].title}</strong><br />{diagnosis.eventTriggeredActions[0].reason}</p>
            </details>
          )}
        </article>
      </section>
      <section className="summary-grid" aria-label="年間サマリー">
        {(['current', 'future', 'review'] as TaxGroup[]).map((group) => (
          <article className={`metric-card ${GROUP_CLASS[group]}`} key={group}>
            <div className="metric-top">
              <span className="metric-icon" aria-hidden="true">
                {group === 'current' ? '↘' : group === 'future' ? '◇' : '!'}
              </span>
              <span className="metric-kicker">
                {group === 'current' ? '今年' : group === 'future' ? 'これから' : 'あとで確認'}
              </span>
            </div>
            <h2>{GROUP_LABELS[group]}</h2>
            <strong className="metric-value">{yen.format(totals[group])}</strong>
            <div className="metric-foot">
              <span>{annualTotal ? Math.round((totals[group] / annualTotal) * 100) : 0}%</span>
              <span>
                {group === 'current' ? '当年の処理候補' : group === 'future' ? '開発中・未供用' : '未分類・私用'}
              </span>
            </div>
          </article>
        ))}
      </section>

      <ol className="value-flow" aria-label="DevTax Radarの処理フロー">
        <li>
          <span>01</span>
          <div><strong>利用履歴を読む</strong><small>Claude Code・Codex</small></div>
        </li>
        <li>
          <span>02</span>
          <div><strong>定額料金を配賦</strong><small>加重トークン・プロダクト</small></div>
        </li>
        <li>
          <span>03</span>
          <div><strong>税務候補と根拠を残す</strong><small>通常経費・取得価額・要確認</small></div>
        </li>
      </ol>

      <div className="main-grid">
        <section className="panel chart-panel">
          <PanelHeading
            title="費用の行き先"
            subtitle="AIサービスごとに配賦した月額の積み上げ"
            trailing={<span className="confidence">配賦済み {data.meta.allocatedRate}%</span>}
          />
          <div className="chart-legend" aria-hidden="true">
            <span><i className="dot coral" />今年の費用</span>
            <span><i className="dot indigo" />将来残高</span>
            <span><i className="dot amber" />要確認</span>
          </div>
          <div className="bar-chart" role="img" aria-label="2026年4月から7月までの費用配賦積み上げグラフ">
            <div className="axis-label top">{yen.format(maxMonth)}</div>
            <div className="axis-label middle">{yen.format(Math.round(maxMonth / 2))}</div>
            {months.map((month) => (
              <div className="bar-column" key={month.label}>
                <div className="bar-value">{yen.format(month.current + month.future + month.review)}</div>
                <div className="bar-track">
                  {(['review', 'future', 'current'] as TaxGroup[]).map((group) => (
                    <div
                      key={group}
                      className={`bar-part ${GROUP_CLASS[group]}`}
                      style={{ height: `${(month[group] / maxMonth) * 100}%` }}
                      title={`${GROUP_LABELS[group]} ${yen.format(month[group])}`}
                    />
                  ))}
                </div>
                <strong>{month.label}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="panel guide-panel">
          <PanelHeading title="今月の伴走メモ" subtitle="確認すると説明力が上がる項目" />
          <div className="guide-score">
            <div className="score-ring"><strong>{diagnosis.readiness.confirmed}</strong><small>/{diagnosis.readiness.total}</small></div>
            <div><strong>確認できた事実</strong><p>不足情報は{diagnosis.missingFacts.length}件です</p></div>
          </div>
          <ul className="guide-list">
            {data.guidance.map((item) => (
              <li key={item.title}>
                <span className={`guide-symbol ${item.severity}`} aria-hidden="true">
                  {item.severity === 'warning' ? '!' : '✓'}
                </span>
                <div><strong>{item.title}</strong><p>{item.description}</p></div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="panel alerts-panel">
        <PanelHeading
          title="金額境界レーダー"
          subtitle="金額だけで結論を出さず、資産単位と供用状況も合わせて確認します"
          trailing={<button className="text-button" onClick={onOpenGuide}>判定ルールを見る →</button>}
        />
        <div className="alert-list">
          {data.boundaries.map((boundary) => {
            const pct = Math.min((boundary.amount / boundary.threshold) * 100, 100)
            const allocation = data.allocations.find((row) => row.asset === boundary.asset)
            return (
              <button
                className="boundary-row"
                key={boundary.asset}
                onClick={() => allocation && onOpenEvidence(allocation)}
              >
                <div className="asset-monogram">{boundary.product.slice(-1)}</div>
                <div className="boundary-name">
                  <strong>{boundary.asset}</strong>
                  <span>{boundary.kind}</span>
                </div>
                <div className="progress-wrap">
                  <div className="progress-meta">
                    <span>{yen.format(boundary.amount)}</span>
                    <span>{boundary.thresholdLabel}</span>
                  </div>
                  <div className="progress"><i style={{ width: `${pct}%` }} /></div>
                </div>
                <span className={`boundary-status ${boundary.tone}`}>{boundary.status}</span>
                <span aria-hidden="true">›</span>
              </button>
            )
          })}
        </div>
      </section>

      <footer className="tax-disclaimer">
        <span aria-hidden="true">ⓘ</span>
        本画面は税務処理の候補と確認事項を示すもので、税務判断を確定するものではありません。
      </footer>
    </>
  )
}

function EvidencePage({
  data,
  planning,
  ledger,
  diagnosis,
  allocations,
  selected,
  onSelect,
}: {
  data: DashboardData
  planning: PlanningSnapshot
  ledger: PlanningLedger
  diagnosis: Diagnosis
  allocations: Allocation[]
  selected: Allocation | null
  onSelect: (row: Allocation | null) => void
}) {
  const active = selected ?? allocations[0] ?? null
  const asset = data.assets.find((item) => item.name === active?.asset) ?? data.assets[0]

  async function downloadLedger() {
    const blob = data.meta.source === 'local'
      ? await getPlanningExport('markdown')
      : new Blob([
          `# DevTax Radar 相談用出力\n\n年分: ${planning.profile.taxYear}\n\n` +
          ledger.byTaxUnit.map((item) => `- ${item.name}: ${yen.format(item.amountJpy)} / ${item.candidate}`).join('\n'),
        ], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `devtax-radar-${planning.profile.taxYear}.md`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <section className="panel evidence-table-panel">
        <PanelHeading
          title="配賦明細"
          subtitle={`${allocations.length}件 · 月額料金をAIサービス内の利用比率で配賦`}
          trailing={<button className="export-button" onClick={downloadLedger}>相談用Markdown</button>}
        />
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>月</th><th>AIサービス</th><th>作っているもの</th><th>費用をまとめる単位</th>
                <th>工程</th><th className="number">利用割合</th><th className="number">配賦額</th><th>税務候補</th>
              </tr>
            </thead>
            <tbody>
              {allocations.map((row) => (
                <tr
                  key={row.id}
                  className={active?.id === row.id ? 'selected-row' : ''}
                  onClick={() => onSelect(row)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelect(row)
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`${row.month} ${row.provider} ${row.product}、配賦額${yen.format(row.amount)}の根拠を表示`}
                >
                  <td>{row.month}</td>
                  <td><span className={`provider-logo ${row.provider === 'Codex' ? 'codex' : ''}`}>
                    {row.provider === 'Codex' ? 'O' : 'C'}
                  </span>{row.provider}</td>
                  <td><strong>{row.product}</strong></td>
                  <td>{row.asset}</td>
                  <td>{row.stage}</td>
                  <td className="number">{row.usageRate}%</td>
                  <td className="number"><strong>{yen.format(row.amount)}</strong></td>
                  <td><span className={`tax-chip ${GROUP_CLASS[row.group]}`}>{row.taxCandidate}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {active && asset && (
        <div className="evidence-grid">
          <section className="panel asset-card">
            <PanelHeading title="資産別の累積原価" subtitle={`${asset.product} / ${asset.name}`} />
            <div className="asset-total">
              <span>累積取得価額候補</span>
              <strong>{yen.format(asset.total)}</strong>
              <span className="status-chip">{asset.inService ? '供用中' : '開発中・未供用'}</span>
            </div>
            <dl className="cost-breakdown">
              <div><dt>AIサブスク配賦額</dt><dd>{yen.format(asset.aiCost)}</dd></div>
              <div><dt>外注費</dt><dd>{yen.format(asset.outsource)}</dd></div>
              <div><dt>その他直接費</dt><dd>{yen.format(asset.other)}</dd></div>
              <div className="total-line"><dt>翌年以後へ残る見込</dt><dd>{yen.format(asset.futureBalance)}</dd></div>
            </dl>
            <p className="scope-warning">
              AI以外の直接費入力は未実装です。10万円等の境界は、実際の資産全体の取得価額で再確認してください。
            </p>
            <div className="asset-progress">
              <div><span>10万円境界まで</span><strong>{yen.format(Math.max(100000 - asset.total, 0))}</strong></div>
              <div className="progress"><i style={{ width: `${Math.min(asset.total / 1000, 100)}%` }} /></div>
            </div>
          </section>

          <section className="panel decision-card">
            <PanelHeading title="判定説明" subtitle="現在の登録事実に基づく候補" />
            <div className="decision-head">
              <span className="decision-icon">◇</span>
              <div><small>判定候補</small><strong>{active.taxCandidate}</strong></div>
              <span className="confidence">信頼度 {active.confidence}</span>
            </div>
            <dl className="decision-list">
              <div><dt>適用ルール</dt><dd>{active.rule}</dd></div>
              <div><dt>根拠</dt><dd>{active.reason}</dd></div>
              <div><dt>不足情報</dt><dd className="missing">{active.missing}</dd></div>
            </dl>
            <p className="decision-next">この候補の確認・修正は、上の「設定を確認」から事実と証拠を更新すると再計算されます。</p>
          </section>

          <section className="panel log-card">
            <PanelHeading title="根拠ログ" subtitle="本文を保存せずメタデータだけを表示" />
            <div className="session-summary">
              <span className={`provider-logo ${active.provider === 'Codex' ? 'codex' : ''}`}>
                {active.provider === 'Codex' ? 'O' : 'C'}
              </span>
              <div><strong>{active.provider} · {active.session.date}</strong><small>{active.session.id}</small></div>
              <span className="privacy-chip">本文なし</span>
            </div>
            <dl className="log-grid">
              <div><dt>作業フォルダ</dt><dd>{active.session.folder}</dd></div>
              <div><dt>Git branch</dt><dd>{active.session.branch}</dd></div>
              <div><dt>Model</dt><dd>{active.session.model}</dd></div>
              <div><dt>加重トークン</dt><dd>{active.session.tokens.toLocaleString()}</dd></div>
              <div><dt>分類ルール</dt><dd>{active.session.classification}</dd></div>
              <div><dt>手動修正</dt><dd>{active.session.manualEdit}</dd></div>
            </dl>
          </section>
        </div>
      )}

      <PlanningEvidenceSections planning={planning} ledger={ledger} diagnosis={diagnosis} />
    </>
  )
}

function PlanningEvidenceSections({
  planning,
  ledger,
  diagnosis,
}: {
  planning: PlanningSnapshot
  ledger: PlanningLedger
  diagnosis: Diagnosis
}) {
  return (
    <section className="planning-ledger" aria-labelledby="planning-ledger-title">
      <div className="planning-ledger-heading">
        <span className="eyebrow">記録した内容</span>
        <h2 id="planning-ledger-title">制作物・設備・自宅費用・証拠</h2>
        <p>金額の結論だけでなく、誰が使うか、いつ正式利用したか、どの計算式を使ったかまで辿れます。</p>
      </div>
      <div className="ledger-card-grid">
        <article className="panel ledger-card">
          <PanelHeading title="制作物と改良計画" subtitle={`${planning.taxUnits.length}件 · 自分利用と公開を別イベントで管理`} />
          <ul className="compact-record-list">
            {planning.taxUnits.map((unit) => (
              <li key={unit.id}>
                <div><strong>{unit.name}</strong><span>{usageModeLabel(unit.usageMode)}</span></div>
                <small>{lifecycleLabel(unit.lifecycleStatus)}</small>
              </li>
            ))}
          </ul>
          <p className="ledger-footnote">期間付き分類ルール {planning.projectRules.length}件</p>
        </article>
        <article className="panel ledger-card">
          <PanelHeading title="PC・DGX等" subtitle={`${planning.equipment.length}件 · 業務割合と制作物割合を分離`} />
          <ul className="compact-record-list">
            {planning.equipment.map((item) => (
              <li key={item.id}>
                <div><strong>{item.name}</strong><span>{yen.format(item.acquisitionCostJpy)} · {item.role}</span></div>
                <small>業務 {Math.round(item.businessUseRatio * 100)}% / 制作物 {Math.round(item.projectAllocationRatio * 100)}%</small>
              </li>
            ))}
          </ul>
        </article>
        <article className="panel ledger-card">
          <PanelHeading title="家賃・電気・通信" subtitle={`${planning.homeCosts.length}件 · 計算式と採用理由を保存`} />
          <ul className="compact-record-list">
            {planning.homeCosts.map((item) => (
              <li key={item.id}>
                <div><strong>{item.month} {categoryLabel(item.category)}</strong><span>{item.basis}</span></div>
                <small>{yen.format(item.amountJpy)} × {Math.round(item.businessUseRatio * 100)}%</small>
              </li>
            ))}
          </ul>
        </article>
        <article className="panel ledger-card">
          <PanelHeading title="証拠と不足情報" subtitle={`${planning.evidence.length}件 · Gitがなくてもメモや外部記録を保存`} />
          <ul className="compact-record-list evidence-records">
            {planning.evidence.map((item) => (
              <li key={item.id}><div><strong>{item.note}</strong><span>{item.occurredOn ?? '日付未登録'}</span></div><small>{item.strength}</small></li>
            ))}
            {diagnosis.missingFacts.map((fact) => (
              <li className="missing-record" key={fact}><div><strong>不足</strong><span>{fact}</span></div><small>要確認</small></li>
            ))}
          </ul>
        </article>
      </div>
      <article className="panel ledger-balance">
        <PanelHeading title="設備・自宅費用の配賦チェック" subtitle="原額から私用・未配賦までを残し、二重計上を防ぎます" />
        <dl>
          <div><dt>原額</dt><dd>{yen.format(ledger.totals.grossAmountJpy)}</dd></div>
          <div><dt>業務利用額</dt><dd>{yen.format(ledger.totals.businessAmountJpy)}</dd></div>
          <div><dt>制作物へ配賦</dt><dd>{yen.format(ledger.totals.allocatedAmountJpy)}</dd></div>
          <div><dt>私用</dt><dd>{yen.format(ledger.totals.privateAmountJpy)}</dd></div>
          <div><dt>未配賦・一般管理</dt><dd>{yen.format(ledger.totals.unallocatedAmountJpy)}</dd></div>
        </dl>
      </article>
    </section>
  )
}

const TAX_GUIDE_ITEMS = [
  {
    term: '取得価額とは？',
    answer: '資産を買う・作るために直接必要だった金額を、使用開始まで集めたものです。',
    example: '新規アプリの実装に直接使ったAIサブスク配賦額は、自作ソフトウェアの取得価額に含める候補になります。',
    check: 'その作業は特定の資産へ直接対応するか。一般学習・保守・私用が混ざっていないか。',
  },
  {
    term: '資本的支出とは？',
    answer: '既存資産の価値を高めたり、使える期間を延ばしたりする改良費です。',
    example: '既存アプリへ独立した大型機能を追加する開発は候補です。小さな不具合修正や現状維持は通常経費の候補になり得ます。',
    check: '一つの改良計画として何を増強したか。通常の維持管理との境界を仕様・Issue・リリース記録で説明できるか。',
  },
  {
    term: '通常経費との違いは？',
    answer: '当年の活動を維持する費用か、将来にも効果が残る資産形成の費用かが大きな分岐です。',
    example: '稼働中サービスの軽微なバグ修正は通常経費、新規ソフトウェアの完成へ直接必要な実装は取得価額の候補です。',
    check: '支払名目だけで決めず、実際の作業目的・成果・供用状況を確認する。',
  },
  {
    term: '制作原価とは？',
    answer: '販売するコンテンツや棚卸資産を作るために直接かかった費用として集める候補です。',
    example: '販売用デジタル教材の本文生成に直接使ったAI利用分を、作品・商品単位で集計します。',
    check: '販売目的の成果物か、いつ売上原価になるか、仕掛中の扱いを含めて申告時に確認する。',
  },
  {
    term: '前払費用とは？',
    answer: '支払い済みでも、まだ提供を受けていない将来期間のサービスに対応する金額です。',
    example: '年払い契約のうち翌年分は候補になり得ます。一方、今月すでに利用したAI料金を単に翌年へ移す制度ではありません。',
    check: '契約期間、サービス提供済みの期間、短期前払費用の適用可否を契約書・請求書で確認する。',
  },
  {
    term: '10万円・20万円の境界は？',
    answer: '原則として、10万円未満は当年費用、10万円以上20万円未満は通常償却または3年の一括償却、20万円以上は通常の減価償却を検討します。',
    example: '99,999円は10万円未満、100,000円は10万円以上です。200,000円ちょうども「20万円未満」には入りません。',
    check: '青色申告者の少額特例など別制度の要件、取得・製作日、所得区分、年間上限も個別に確認する。',
  },
  {
    term: '金額の判定単位は？',
    answer: 'AIの月額料金1行ではなく、完成する一つの資産や一つの改良計画ごとに集めた金額が判定の出発点です。',
    example: '月3万円を4か月使って一つのアプリを作った場合、各月3万円だけを見て10万円未満とは判断しません。',
    check: 'リポジトリ名だけで機械的に分けず、仕様・用途・一体で機能する範囲から税務上の単位を確認する。',
  },
  {
    term: '供用開始とは？',
    answer: '資産が完成しただけでなく、本来の目的のため実際に使い始めた時点です。',
    example: '開発中のテストだけなら未供用候補。顧客向けサービスや正式な制作工程で使い始めれば供用開始候補です。',
    check: '初回リリース、正式採用、運用ログなど、実際に使い始めた日を示す証拠を残す。',
  },
  {
    term: '直接対応費と証拠は？',
    answer: '特定のプロダクトへ合理的に結び付く利用分だけを、同じ方法で継続配賦することが説明力につながります。',
    example: 'Claude Code／Codexの加重トークン、作業フォルダ、Gitブランチを使い、月額料金をプロダクト別に配賦します。',
    check: '請求書、配賦ルール、セッションメタデータ、手動修正理由、仕様・コミット・供用日の記録を保存する。',
  },
  {
    term: '旧版から新版へ作り直すときは？',
    answer: '大幅な仕様変更で新しいソフトウェアを製作し、完成後に旧版を使わない場合は、旧版残価を新版の原材料費に含める取扱いの検討対象です。',
    example: '旧パイプラインを廃止し、M1〜M5で構造を再設計する場合は、単なる機能追加か新しい資産かを移行記録で説明します。',
    check: '大幅な仕様変更、旧版廃止、移行日、二重控除がないことを確認する。旧版を10万円未満として全額費用化済みなら、移す残価は通常0円です。',
  },
  {
    term: '公開前なら未供用ですか？',
    answer: '公開前という事実だけでは決まりません。本来の目的で正式原稿や本番工程に使い始めたかを確認します。',
    example: '評価用コピーで比較するだけなら開発・試験寄りですが、新版の出力を正式原稿へ採用すれば供用済みとなる可能性があります。',
    check: 'テストのみ／正式採用、初回本番利用日、リリース記録、正式原稿への反映履歴を残す。',
  },
  {
    term: 'このMVPで未計算のものは？',
    answer: 'PC・DGX、家賃・電気・通信、直接費は概算候補を計算します。交通費、暗号資産益との所得集計、最終的な償却額や税額はまだ確定しません。',
    example: '私用から転用したPCの未償却残高や耐用年数が未入力なら、無理に計算せず「要確認」として残します。',
    check: '申告時は所得区分、供用日、耐用年数、償却方法、取得価額に含める範囲を確認し、必要に応じて税理士へ相談する。',
  },
] as const

function TaxGuidePage() {
  return (
    <>
      <section className="guide-intro">
        <div>
          <span className="guide-intro-label">まずここから</span>
          <h2>月額料金を、そのまま税務処理しない。</h2>
          <p>
            まず「何を作るための利用か」を資産・改良計画単位で集め、
            金額境界と供用状況を確認します。DevTax Radarは判断を確定せず、候補と不足証拠を示します。
          </p>
        </div>
        <ol className="guide-route" aria-label="税務候補を確認する順序">
          <li><span>1</span><strong>作業目的</strong><small>新規・改良・保守・私用</small></li>
          <li><span>2</span><strong>費用をまとめる単位</strong><small>一つのアプリ・改良計画</small></li>
          <li><span>3</span><strong>時点と金額</strong><small>供用開始・合計額</small></li>
          <li><span>4</span><strong>証拠</strong><small>履歴・仕様・請求書</small></li>
        </ol>
      </section>

      <section className="tax-qa-grid" aria-label="税務用語のよくある質問">
        {TAX_GUIDE_ITEMS.map((item, index) => (
          <details className="tax-qa-card" key={item.term} open={index < 2}>
            <summary>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{item.term}</strong>
              <i aria-hidden="true">＋</i>
            </summary>
            <div className="tax-qa-answer">
              <p className="one-line-answer">{item.answer}</p>
              <dl>
                <div><dt>例</dt><dd>{item.example}</dd></div>
                <div><dt>確認</dt><dd>{item.check}</dd></div>
              </dl>
            </div>
          </details>
        ))}
      </section>

      <section className="official-sources" aria-labelledby="official-sources-title">
        <div>
          <span aria-hidden="true">↗</span>
          <div>
            <h2 id="official-sources-title">国税庁の公式資料で確認する</h2>
            <p>個別事情や制度改正で結論は変わります。申告前は原文と専門家へ確認してください。</p>
          </div>
        </div>
        <ul>
          <li><a href="https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/08/06.htm" target="_blank" rel="noreferrer">自己の製作に係るソフトウェアの取得価額等</a></li>
          <li><a href="https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/05/07.htm" target="_blank" rel="noreferrer">資本的支出と修繕費等</a></li>
          <li><a href="https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2100.htm" target="_blank" rel="noreferrer">減価償却のあらまし</a></li>
          <li><a href="https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/08/12.htm" target="_blank" rel="noreferrer">少額減価償却資産・一括償却資産</a></li>
        </ul>
      </section>

      <footer className="tax-disclaimer">
        <span aria-hidden="true">ⓘ</span>
        このQAは一般的な整理候補です。資産計上・必要経費・申告内容を確定するものではありません。
      </footer>
    </>
  )
}

function PanelHeading({
  title,
  subtitle,
  trailing,
}: {
  title: string
  subtitle: string
  trailing?: ReactNode
}) {
  return (
    <div className="panel-heading">
      <div><h2>{title}</h2><p>{subtitle}</p></div>
      {trailing}
    </div>
  )
}

function MappingEditor({
  item,
  index,
  mapping,
  onChange,
}: {
  item: DashboardData['products'][number]
  index: number
  mapping: ProjectMapping | undefined
  onChange: (index: number, patch: Partial<ProjectMapping>) => void
}) {
  return (
    <div className="mapping-row">
      <span className="folder-icon">⌑</span>
      <span><strong>{item.folder}</strong><small>{item.sessions}件の利用記録</small></span>
      <div className="mapping-fields">
        <label>
          <span>作っているもの</span>
          <input
            value={mapping?.productName ?? ''}
            onChange={(event) => onChange(index, { productName: event.target.value })}
          />
        </label>
        <label>
          <span>今回まとめる開発・改良</span>
          <input
            value={mapping?.assetName ?? ''}
            onChange={(event) => onChange(index, { assetName: event.target.value })}
          />
        </label>
        <label>
          <span>この期間にしたこと</span>
          <select
            value={mapping?.classification ?? 'unclassified'}
            onChange={(event) => onChange(index, {
              classification: event.target.value as ProjectClassification,
            })}
          >
            <option value="new-development">新しく作った</option>
            <option value="maintenance">保守・バグ修正</option>
            <option value="feature-addition">機能を大きく追加した</option>
            <option value="private">趣味・私用</option>
            <option value="unclassified">あとで確認</option>
          </select>
        </label>
      </div>
      <i className={`product-color color-${index}`} />
    </div>
  )
}

function Onboarding({
  step,
  data,
  runtime,
  runtimeLoading,
  configuration,
  planning,
  onStep,
  onScan,
  onSave,
  onSavePlanning,
  onClose,
}: {
  step: number
  data: DashboardData
  runtime: RuntimeData | null
  runtimeLoading: boolean
  configuration: LocalConfiguration | null
  planning: PlanningSnapshot
  onStep: (step: number) => void
  onScan: (providers: ProviderKey[]) => Promise<ScanResult>
  onSave: (configuration: LocalConfiguration) => Promise<void>
  onSavePlanning: (planning: PlanningSnapshot) => Promise<void>
  onClose: () => void
}) {
  const steps = ['履歴', '対象年', '制作物', '費用', '診断']
  const isDemoData = data.meta.source === 'demo'
  const apiUnavailable = !runtime
  const [selectedProviders, setSelectedProviders] = useState<ProviderKey[]>(['claude', 'codex'])
  const [mappings, setMappings] = useState<ProjectMapping[]>([])
  const [claudeCharge, setClaudeCharge] = useState(30000)
  const [codexCharge, setCodexCharge] = useState(30000)
  const [monthlyCharges, setMonthlyCharges] = useState<LocalConfiguration['monthlyCharges']>([])
  const [unobservedPercent, setUnobservedPercent] = useState(10)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error' | 'info'; message: string } | null>(null)
  const [planningDraft, setPlanningDraft] = useState<PlanningSnapshot>(planning)
  const [ruleAssignments, setRuleAssignments] = useState<Record<string, { taxUnitId: string | undefined; effectiveFrom: string }>>({})
  const [selectedHistoryProjects, setSelectedHistoryProjects] = useState<Record<string, boolean>>({})
  const onboardingBodyRef = useRef<HTMLDivElement>(null)
  const rankedProducts = data.products
    .map((product, index) => ({ product, index }))
    .sort((left, right) => right.product.sessions - left.product.sessions)
  const observedHistoryMonths = data.products
    .flatMap((product) => [product.firstObservedMonth, product.lastObservedMonth])
    .filter((month): month is string => Boolean(month))
    .sort()
  const historyRangeText = observedHistoryMonths.length > 0
    ? `${observedHistoryMonths[0]}月～${observedHistoryMonths.at(-1)}月`
    : '利用時期を確認中'
  const primaryProducts = rankedProducts.slice(0, 12)
  const remainingProducts = rankedProducts.slice(12)
  const planningWithCurrentRules = useMemo<PlanningSnapshot>(() => ({
    ...planningDraft,
    projectRules: mappings
      .filter((mapping) => !mapping.projectKey.startsWith('demo-'))
      .map((mapping, index) => {
        const assignment = ruleAssignments[mapping.projectKey]
        const taxUnitId = assignment?.taxUnitId || planningDraft.taxUnits[0]?.id || ''
        const developmentStartedOn = planningDraft.lifecycleEvents.find((event) => (
          event.taxUnitId === taxUnitId && event.eventType === 'development-started'
        ))?.occurredOn
        return {
          id: planningDraft.projectRules.find((rule) => rule.projectKey === mapping.projectKey)?.id ?? `rule-${index}-${mapping.projectKey.slice(-8)}`,
          projectKey: mapping.projectKey,
          effectiveFrom: assignment?.effectiveFrom || developmentStartedOn || `${planningDraft.profile.taxYear}-01-01`,
          taxUnitId,
          classification: mapping.classification,
          reason: 'オンボーディングで登録した期間付き分類',
        }
      })
      .filter((rule) => rule.taxUnitId),
  }), [mappings, planningDraft, ruleAssignments])
  const draftDiagnosis = useMemo(() => diagnosePlanning(planningWithCurrentRules), [planningWithCurrentRules])

  useEffect(() => {
    onboardingBodyRef.current?.scrollTo({ top: 0 })
  }, [step])

  useEffect(() => {
    if (!runtime) return
    setSelectedProviders(
      (['claude', 'codex'] as ProviderKey[]).filter((provider) => runtime.providers[provider].detected),
    )
  }, [runtime])

  useEffect(() => {
    const saved = new Map(configuration?.mappings.map((mapping) => [mapping.projectKey, mapping]))
    setMappings(data.products.map((product) => {
      const existing = product.projectKey ? saved.get(product.projectKey) : undefined
      return existing ?? {
        projectKey: product.projectKey ?? `demo-${product.name.padEnd(8, '-')}`,
        productName: product.name,
        assetName: `${product.name}-v1`,
        classification: 'unclassified',
      }
    }))
  }, [configuration, data.products])

  useEffect(() => {
    if (!configuration) return
    setClaudeCharge(configuration.charges.claude)
    setCodexCharge(configuration.charges.codex)
    setUnobservedPercent(Math.round(configuration.unobservedRatio * 100))
    const saved = new Map(configuration.monthlyCharges.map((charge) => [
      `${charge.provider}:${charge.month}`,
      charge.amountJpy,
    ]))
    setMonthlyCharges(data.months.flatMap((month) => {
      const monthKey = monthKeyFromLabel(month.label, planning.profile.taxYear)
      return (['claude', 'codex'] as ProviderKey[]).map((provider) => ({
        provider,
        month: monthKey,
        amountJpy: saved.get(`${provider}:${monthKey}`) ?? configuration.charges[provider],
      }))
    }))
  }, [configuration, data.months, planning.profile.taxYear])

  useEffect(() => {
    const fallbackUnit: TaxUnitRecord = {
      id: `tax-unit-${Date.now()}`,
      name: data.products[0]?.name ?? '新しいアプリ',
      unitType: 'new-software',
      usageMode: 'undecided',
      revenueModel: 'undecided',
      lifecycleStatus: 'developing',
      journeyMode: planning.profile.journeyMode,
      monetizationStatus: 'none',
      sameAsExternalVersion: 'undecided',
    }
    const next = planning.taxUnits.length > 0
      ? planning
      : { ...planning, taxUnits: [fallbackUnit] }
    setPlanningDraft(next)
    setRuleAssignments(Object.fromEntries(next.projectRules.map((rule) => [
      rule.projectKey,
      { taxUnitId: rule.taxUnitId, effectiveFrom: rule.effectiveFrom },
    ])))
  }, [data.products, planning])

  function updateMapping(index: number, patch: Partial<ProjectMapping>) {
    setMappings((current) => current.map((mapping, mappingIndex) => (
      mappingIndex === index ? { ...mapping, ...patch } : mapping
    )))
  }

  function toggleProvider(provider: ProviderKey) {
    setSelectedProviders((current) => current.includes(provider)
      ? current.filter((item) => item !== provider)
      : [...current, provider])
  }

  function updateProviderCharge(provider: ProviderKey, amount: number) {
    const normalized = Math.max(0, amount || 0)
    if (provider === 'claude') setClaudeCharge(normalized)
    else setCodexCharge(normalized)
    setMonthlyCharges((current) => current.map((charge) => (
      charge.provider === provider ? { ...charge, amountJpy: normalized } : charge
    )))
  }

  function updateTaxUnit(index: number, patch: Partial<TaxUnitRecord>) {
    setPlanningDraft((current) => ({
      ...current,
      taxUnits: current.taxUnits.map((unit, unitIndex) => unitIndex === index ? { ...unit, ...patch } : unit),
    }))
  }

  function addHistoryCandidates() {
    const selected = rankedProducts
      .map(({ product }) => product)
      .filter((product) => product.projectKey && selectedHistoryProjects[product.projectKey])
    if (selected.length === 0) {
      setNotice({ kind: 'info', message: '候補を1件以上選んでください。' })
      return
    }

    const units = [...planningDraft.taxUnits]
    const assignments: Record<string, { taxUnitId: string; effectiveFrom: string }> = {}
    selected.forEach((product, index) => {
      const existing = units.find((unit) => unit.name.trim().toLowerCase() === product.name.trim().toLowerCase())
      const unitId = existing?.id ?? `tax-unit-history-${Date.now()}-${index}`
      if (!existing) {
        units.push({
          id: unitId,
          name: product.name,
          unitType: 'new-software',
          usageMode: 'undecided',
          revenueModel: 'undecided',
          lifecycleStatus: 'developing',
          journeyMode: 'retrospective',
          monetizationStatus: 'none',
          sameAsExternalVersion: 'undecided',
          notes: 'ローカルAI履歴から名称候補を作成。用途・状態・実際の開始日は利用者確認が必要。',
        })
      }
      assignments[product.projectKey!] = {
        taxUnitId: unitId,
        effectiveFrom: product.firstObservedAt?.slice(0, 10)
          || (product.firstObservedMonth ? `${product.firstObservedMonth}-01` : undefined)
          || planningDraft.profile.activityStartedOn
          || `${planningDraft.profile.taxYear}-01-01`,
      }
    })

    setPlanningDraft((current) => ({ ...current, taxUnits: units }))
    setRuleAssignments((current) => ({ ...current, ...assignments }))
    setMappings((current) => current.map((mapping) => {
      const product = selected.find((candidate) => candidate.projectKey === mapping.projectKey)
      return product ? { ...mapping, productName: product.name, assetName: mapping.assetName || `${product.name}-v1` } : mapping
    }))
    setSelectedHistoryProjects({})
    setNotice({ kind: 'success', message: `${selected.length}件を履歴から入力しました。用途・状態・実際の開始日を確認してください。` })
  }

  function updateEquipment(index: number, patch: Partial<EquipmentRecord>) {
    setPlanningDraft((current) => ({
      ...current,
      equipment: current.equipment.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    }))
  }

  function updateHomeCost(index: number, patch: Partial<HomeCostRecord>) {
    setPlanningDraft((current) => ({
      ...current,
      homeCosts: current.homeCosts.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    }))
  }

  function updateDirectCost(index: number, patch: Partial<DirectCostRecord>) {
    setPlanningDraft((current) => ({
      ...current,
      directCosts: current.directCosts.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    }))
  }

  function updateEvidence(index: number, patch: Partial<EvidenceRecord>) {
    setPlanningDraft((current) => ({
      ...current,
      evidence: current.evidence.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    }))
  }

  function lifecycleDate(taxUnitId: string, eventType: LifecycleEventType) {
    return planningDraft.lifecycleEvents.find((event) => event.taxUnitId === taxUnitId && event.eventType === eventType)?.occurredOn ?? ''
  }

  function updateLifecycleDate(taxUnitId: string, eventType: LifecycleEventType, occurredOn: string) {
    setPlanningDraft((current) => {
      const existing = current.lifecycleEvents.find((event) => event.taxUnitId === taxUnitId && event.eventType === eventType)
      if (!occurredOn) {
        return { ...current, lifecycleEvents: current.lifecycleEvents.filter((event) => event !== existing) }
      }
      const next = {
        id: existing?.id ?? `event-${eventType}-${taxUnitId}`,
        taxUnitId,
        eventType,
        occurredOn,
        recordedAt: existing?.recordedAt ?? new Date().toISOString(),
        evidenceIds: existing?.evidenceIds ?? [],
        note: existing?.note ?? 'オンボーディングで登録',
      }
      return {
        ...current,
        lifecycleEvents: existing
          ? current.lifecycleEvents.map((event) => event === existing ? next : event)
          : [...current.lifecycleEvents, next],
      }
    })
  }

  async function advance() {
    setNotice(null)
    if (step === 0) {
      if (apiUnavailable) {
        setNotice({ kind: 'info', message: 'デモではスキャンを行わず、合成された利用履歴で次へ進みます。' })
        onStep(1)
        return
      }
      if (!runtime) {
        setNotice({ kind: 'error', message: 'ローカルサーバーへ接続できません。npm start後に再度お試しください。' })
        return
      }
      if (selectedProviders.length === 0) {
        setNotice({ kind: 'error', message: '確認するAIサービスを1つ以上選択してください。' })
        return
      }
      setBusy(true)
      try {
        const result = await onScan(selectedProviders)
        const events = Object.values(result.providers).reduce((sum, provider) => sum + (provider?.events ?? 0), 0)
        setNotice({ kind: 'success', message: `${events.toLocaleString()}件の利用記録をローカルに取り込みました。` })
        onStep(1)
      } catch (error) {
        setNotice({ kind: 'error', message: `走査に失敗しました：${error instanceof Error ? error.message : '不明なエラー'}` })
      } finally {
        setBusy(false)
      }
      return
    }
    if (step === 1) {
      onStep(2)
      return
    }
    if (step === 2) {
      const invalid = mappings.some((mapping) => !mapping.productName.trim() || !mapping.assetName.trim())
      if (invalid || planningDraft.taxUnits.some((unit) => !unit.name.trim())) {
        setNotice({ kind: 'error', message: 'プロダクト名と、作っているものの名前を入力してください。' })
        return
      }
      onStep(3)
      return
    }
    if (step === 3) {
      const invalidEquipment = planningDraft.equipment.some((item) => !item.name.trim() || !item.acquiredOn || !item.role.trim())
      const invalidHomeCost = planningDraft.homeCosts.some((item) => !item.month || !item.basis.trim() || !item.rationale.trim())
      const invalidDirectCost = planningDraft.directCosts.some((item) => !item.incurredOn)
      const invalidEvidence = planningDraft.evidence.some((item) => !item.note.trim())
      if (invalidEquipment || invalidHomeCost || invalidDirectCost || invalidEvidence) {
        setNotice({ kind: 'error', message: '空欄の必須項目があります。機器名・日付・役割・按分根拠・根拠メモを確認してください。' })
        return
      }
      onStep(4)
      return
    }
    if (apiUnavailable) {
      onClose()
      return
    }
    setBusy(true)
    try {
      await onSave({
        charges: {
          claude: Math.max(0, Math.round(claudeCharge)),
          codex: Math.max(0, Math.round(codexCharge)),
        },
        monthlyCharges,
        unobservedRatio: Math.min(95, Math.max(0, unobservedPercent)) / 100,
        mappings: mappings.filter((mapping) => !mapping.projectKey.startsWith('demo-')),
      })
      await onSavePlanning(planningWithCurrentRules)
      setNotice({ kind: 'success', message: '設定を保存し、ダッシュボードを再集計しました。' })
      window.setTimeout(onClose, 650)
    } catch (error) {
      setNotice({ kind: 'error', message: `保存に失敗しました：${error instanceof Error ? error.message : '不明なエラー'}` })
    } finally {
      setBusy(false)
    }
  }

  async function saveProgress() {
    setNotice(null)
    if (apiUnavailable) {
      setNotice({ kind: 'info', message: '公開デモでは保存しません。ローカル版では、ここまでの入力をこのPCに保存できます。' })
      return
    }
    setBusy(true)
    try {
      await onSavePlanning(planningWithCurrentRules)
      setNotice({ kind: 'success', message: 'ここまでの入力を保存しました。次回は続きから確認できます。' })
    } catch (error) {
      setNotice({ kind: 'error', message: `保存できませんでした。ローカルサーバーを確認して、もう一度お試しください。詳細：${error instanceof Error ? error.message : '不明なエラー'}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="onboarding-modal" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <button className="modal-close" aria-label="閉じる" onClick={onClose}>×</button>
        <div className="onboarding-side">
          <span className="setup-kicker">はじめの準備</span>
          <h2 id="onboarding-title">税務の準備を、<br />少しずつ。</h2>
          <p>分からない項目は後回しにできます。入力した内容はこのPCだけに保存します。</p>
          <div className="setup-progress" aria-label={`${step + 1}/${steps.length}まで進みました`}>
            <i style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
            <span>{step + 1} / {steps.length}</span>
          </div>
          <ol>
            {steps.map((item, index) => (
              <li className={index === step ? 'active' : index < step ? 'done' : ''} key={item}>
                <span>{index < step ? '✓' : index + 1}</span>{item}
              </li>
            ))}
          </ol>
        </div>
        <div className="onboarding-body" ref={onboardingBodyRef}>
          {isDemoData && (
            <div className="demo-mode-banner" role="status">
              <strong>デモモード</strong>
              <span>ローカルAPIへ接続していないため、合成データを表示・編集しています。変更は保存されません。</span>
            </div>
          )}
          {step === 0 && (
            <>
              <span className="step-label">1 / 5　AIの利用履歴</span>
              <h3>{runtimeLoading ? 'ローカル履歴を探しています…' : 'AI開発履歴を確認'}</h3>
              <p>読み取り専用で集計します。プロンプトや応答本文、ソースコードは取得しません。</p>
              <div className="detected-list">
                {([
                  ['claude', 'Claude Code', '~/.claude/projects', 'C'],
                  ['codex', 'Codex', '~/.codex/sessions', 'O'],
                ] as const).map(([key, label, path, monogram]) => {
                  const detected = runtime?.providers[key].detected ?? isDemoData
                  return (
                    <label className={!detected ? 'provider-undetected' : ''} key={key}>
                      <input
                        type="checkbox"
                        checked={selectedProviders.includes(key)}
                        disabled={!detected || busy || runtimeLoading}
                        onChange={() => toggleProvider(key)}
                      />
                      <span className={`provider-logo ${key === 'codex' ? 'codex' : ''}`}>{monogram}</span>
                      <span><strong>{label}</strong><small>{path}</small></span>
                      <b>{runtimeLoading ? '確認中' : detected ? '検出済み' : '未検出'}</b>
                      <span className="check">{detected ? '✓' : '—'}</span>
                    </label>
                  )
                })}
              </div>
              <div className="privacy-callout"><span>⌂</span><p><strong>データはこのPCの中だけ</strong><br />外部送信・クラウド同期・テレメトリはありません。</p></div>
              <div className="setup-insight"><span>✓</span><p><strong>ここまで分かりました</strong><br />{selectedProviders.length}種類のAI履歴を確認します。本文やソースコードは読みません。</p></div>
            </>
          )}
          {step === 1 && (
            <>
              <span className="step-label">2 / 5　対象年と申告全体</span>
              <h3>まず、今回整理する年を確認します</h3>
              <p>ここでは申告全体に共通することだけ確認します。開発時期や売上状況は、次の画面で制作物ごとに登録します。</p>
              <div className="history-context-bridge">
                <div>
                  <span>履歴から分かったこと</span>
                  <strong>{data.meta.sessionCount.toLocaleString('ja-JP')}件・{historyRangeText}</strong>
                  <small>利用AI、作業フォルダ、利用量</small>
                </div>
                <b>＋</b>
                <div>
                  <span>この画面で確認</span>
                  <strong>対象年・申告全体</strong>
                  <small>所得区分は未確定でも進められます</small>
                </div>
                <b>→</b>
                <div>
                  <span>次の画面で確認</span>
                  <strong>制作物ごとの現在地</strong>
                  <small>開始時期、売上、利用・公開状況</small>
                </div>
              </div>
              <p className="answer-later-note">分からない項目は「まだ決めていない」で進められます。</p>
              <div className="simple-form-grid">
                <label>
                  <span><strong>対象の年</strong><small>今回まとめたい費用の年</small></span>
                  <input type="number" min="2020" max="2100" value={planningDraft.profile.taxYear} onChange={(event) => setPlanningDraft((current) => ({ ...current, profile: { ...current.profile, taxYear: event.target.valueAsNumber || new Date().getFullYear() } }))} />
                </label>
              </div>
              <details className="advanced-fields">
                <summary>申告について分かる範囲で答える</summary>
                <div className="simple-form-grid">
                  <label><span><strong>所得の区分</strong><small>分からなければ未確定のままで進めます</small></span><select value={planningDraft.profile.incomeCategory} onChange={(event) => setPlanningDraft((current) => ({ ...current, profile: { ...current.profile, incomeCategory: event.target.value as PlanningSnapshot['profile']['incomeCategory'] } }))}><option value="undecided">まだ分からない</option><option value="miscellaneous">雑所得として検討中</option><option value="business">事業所得として検討中</option></select></label>
                  <label><span><strong>申告方法</strong><small>開業届だけで所得区分が決まるものではありません</small></span><select value={planningDraft.profile.filingType} onChange={(event) => setPlanningDraft((current) => ({ ...current, profile: { ...current.profile, filingType: event.target.value as PlanningSnapshot['profile']['filingType'] } }))}><option value="undecided">まだ分からない</option><option value="white">白色申告</option><option value="blue">青色申告</option></select></label>
                </div>
              </details>
              <div className="setup-insight"><span>✓</span><p><strong>ここまで分かりました</strong><br />{planningDraft.profile.taxYear}年分として整理します。制作物ごとの開始時期と売上状況は次に確認します。</p></div>
            </>
          )}
          {step === 2 && (
            <>
              <span className="step-label">3 / 5　作っているもの</span>
              <h3>AIを使って何を作っていますか？</h3>
              <p>自分で使うものも、外へ公開するものも登録できます。公開日だけでなく、実際に使い始めた時点も大切です。</p>
              {!isDemoData && rankedProducts.length > 0 && (
                <details className="history-candidate-import">
                  <summary>履歴からプロダクト候補を入力する</summary>
                  <p>AI履歴にある名前・最初と最後の利用日時・利用AIを候補にします。税務上の用途や正式な開始日は自動で決めません。</p>
                  <div className="history-candidate-list">
                    {rankedProducts.slice(0, 12).map(({ product }) => (
                      <label key={product.projectKey ?? product.name}>
                        <input
                          type="checkbox"
                          checked={Boolean(product.projectKey && selectedHistoryProjects[product.projectKey])}
                          disabled={!product.projectKey}
                          onChange={(event) => product.projectKey && setSelectedHistoryProjects((current) => ({ ...current, [product.projectKey!]: event.target.checked }))}
                        />
                        <span>
                          <strong>{product.name}</strong>
                          <small>{product.sessions}セッション　{product.providers?.join('・') || '利用AI確認中'}<br />履歴上：{product.firstObservedAt?.slice(0, 10) || (product.firstObservedMonth ? `${product.firstObservedMonth}月` : '開始時期不明')} ～ {product.lastObservedAt?.slice(0, 10) || (product.lastObservedMonth ? `${product.lastObservedMonth}月` : '終了時期不明')}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                  {rankedProducts.length > 12 && <p className="candidate-note">まず利用量の多い12件を表示しています。残りは下の履歴結び付け欄で確認できます。</p>}
                  <button type="button" className="primary-button candidate-import-button" onClick={addHistoryCandidates}>選んだ候補を入力</button>
                </details>
              )}
              <div className="multi-product-guide">
                <strong>複数の開発があるとき</strong>
                <p><b>1つずつ別々に登録</b>します。まず1件目を入力し、下の「別の開発をもう1件追加」を押してください。</p>
                <details>
                  <summary>どこまでを1つとして分ける？</summary>
                  <ul>
                    <li><b>別々にする：</b>家計アプリと小説執筆ツールなど、目的や完成条件が違うもの</li>
                    <li><b>同じまま：</b>同じアプリの軽い修正や通常の更新</li>
                    <li><b>迷うとき：</b>普段、別の名前で進捗を管理している単位で登録する</li>
                  </ul>
                </details>
              </div>
              <div className="tax-unit-editor-list">
                {planningDraft.taxUnits.map((unit, index) => (
                  <article className="tax-unit-editor" key={unit.id}>
                    <div className="tax-unit-card-heading"><span>{index + 1}</span><strong>{unit.name || `開発 ${index + 1}`}</strong></div>
                    <label><span><strong>作っているものの名前</strong><small>例：自分用の執筆ツール、公開予定の家計アプリ</small></span><input value={unit.name} onChange={(event) => updateTaxUnit(index, { name: event.target.value })} /></label>
                    <label><span><strong>この開発の整理のしかた</strong><small>制作物ごとに早期準備と過去整理を分けられます</small></span><select value={unit.journeyMode ?? planningDraft.profile.journeyMode} onChange={(event) => updateTaxUnit(index, { journeyMode: event.target.value as NonNullable<TaxUnitRecord['journeyMode']> })}><option value="early">これからの記録を準備する</option><option value="retrospective">過去の履歴を整理する</option></select></label>
                    <label><span><strong>この制作物の売上状況</strong><small>販売、広告、アフィリエイトなどを含みます</small></span><select value={unit.monetizationStatus ?? planningDraft.profile.monetizationStatus} onChange={(event) => updateTaxUnit(index, { monetizationStatus: event.target.value as NonNullable<TaxUnitRecord['monetizationStatus']> })}><option value="none">まだ収益化を決めていない</option><option value="planned">これから収益化する予定</option><option value="earning">すでに売上がある</option></select></label>
                    <label><span><strong>誰が使いますか？</strong><small>自分利用と外部公開の両方にも対応します</small></span><select value={unit.usageMode} onChange={(event) => updateTaxUnit(index, { usageMode: event.target.value as TaxUnitRecord['usageMode'] })}><option value="internal">自分の実作業で使う</option><option value="external">外部へ公開・提供する</option><option value="mixed">自分でも使い、外部にも提供する</option><option value="undecided">まだ決めていない</option></select></label>
                    <label><span><strong>いまの状態</strong><small>「正式利用」はテストではなく実際の作業に使っている状態です</small></span><select value={unit.lifecycleStatus} onChange={(event) => updateTaxUnit(index, { lifecycleStatus: event.target.value as TaxUnitRecord['lifecycleStatus'] })}><option value="idea">構想中</option><option value="prototype">試作中</option><option value="developing">開発中</option><option value="evaluating">評価中</option><option value="in-use">実際の作業で利用中</option><option value="maintaining">保守中</option><option value="improving">改良中</option><option value="retired">利用終了</option><option value="abandoned">開発中止</option></select></label>
                    <label><span><strong>この開発を始めた日</strong><small>履歴上の最初の日と異なる場合は、実態の日を入力します</small></span><input type="date" value={lifecycleDate(unit.id, 'development-started')} onChange={(event) => updateLifecycleDate(unit.id, 'development-started', event.target.value)} /></label>
                    <label className="wide-field"><span><strong>完成したと言える条件</strong><small>例：一連の作業を最初から最後まで処理できる</small></span><textarea value={unit.completionCriteria ?? ''} onChange={(event) => updateTaxUnit(index, { completionCriteria: event.target.value })} /></label>
                    {(unit.monetizationStatus ?? planningDraft.profile.monetizationStatus) === 'earning' && <label><span><strong>初めて売上が発生した日</strong><small>入金日ではなく、売上の事実が発生した日を確認します</small></span><input type="date" value={lifecycleDate(unit.id, 'first-sale')} onChange={(event) => updateLifecycleDate(unit.id, 'first-sale', event.target.value)} /></label>}
                    {(unit.usageMode === 'internal' || unit.usageMode === 'mixed') && <label><span><strong>自分の本番作業で使い始めた日</strong><small>テストではなく、実際の仕事や制作に初めて使った日</small></span><input type="date" value={lifecycleDate(unit.id, 'internal-use-started')} onChange={(event) => updateLifecycleDate(unit.id, 'internal-use-started', event.target.value)} /></label>}
                    {(unit.usageMode === 'external' || unit.usageMode === 'mixed') && <label><span><strong>外部へ公開・提供した日</strong><small>販売ページ、公開URL、顧客提供などを開始した日</small></span><input type="date" value={lifecycleDate(unit.id, 'external-released')} onChange={(event) => updateLifecycleDate(unit.id, 'external-released', event.target.value)} /></label>}
                  </article>
                ))}
              </div>
              <button className="secondary-button add-record" onClick={() => setPlanningDraft((current) => ({ ...current, taxUnits: [...current.taxUnits, { id: `tax-unit-${Date.now()}`, name: '', unitType: 'new-software', usageMode: 'undecided', revenueModel: 'undecided', lifecycleStatus: 'developing', journeyMode: 'early', monetizationStatus: 'none', sameAsExternalVersion: 'undecided' }] }))}>＋ 別の開発をもう1件追加</button>
              <details className="history-rules">
                <summary>AI履歴を作っているものへ結び付ける</summary>
                <p>上で複数登録した場合は、各作業フォルダがどの開発に当たるか「結び付けるもの」で選びます。</p>
              <div className="mapping-list">
                {primaryProducts.map(({ product: item, index }) => (
                  <div key={item.projectKey ?? item.name}>
                    <MappingEditor item={item} index={index} mapping={mappings[index]} onChange={updateMapping} />
                    {item.projectKey && <div className="rule-fields"><label><span>結び付けるもの</span><select value={ruleAssignments[item.projectKey]?.taxUnitId ?? planningDraft.taxUnits[0]?.id ?? ''} onChange={(event) => setRuleAssignments((current) => ({ ...current, [item.projectKey!]: { taxUnitId: event.target.value, effectiveFrom: current[item.projectKey!]?.effectiveFrom || lifecycleDate(event.target.value, 'development-started') || `${planningDraft.profile.taxYear}-01-01` } }))}>{planningDraft.taxUnits.map((unit) => <option value={unit.id} key={unit.id}>{unit.name || '名前未入力'}</option>)}</select></label><label><span>この分類を始める日</span><input type="date" value={ruleAssignments[item.projectKey]?.effectiveFrom || lifecycleDate(ruleAssignments[item.projectKey]?.taxUnitId ?? planningDraft.taxUnits[0]?.id ?? '', 'development-started') || `${planningDraft.profile.taxYear}-01-01`} onChange={(event) => setRuleAssignments((current) => ({ ...current, [item.projectKey!]: { taxUnitId: current[item.projectKey!]?.taxUnitId ?? planningDraft.taxUnits[0]?.id ?? '', effectiveFrom: event.target.value } }))} /></label></div>}
                  </div>
                ))}
                {remainingProducts.length > 0 && (
                  <details className="remaining-projects">
                    <summary>残り{remainingProducts.length}件を表示（初期状態は未分類）</summary>
                    {remainingProducts.map(({ product: item, index }) => (
                      <MappingEditor
                        item={item}
                        index={index}
                        mapping={mappings[index]}
                        onChange={updateMapping}
                        key={item.projectKey ?? item.name}
                      />
                    ))}
                  </details>
                )}
              </div>
              {data.products.length === 0 && (
                <div className="empty-setup">プロジェクトがまだありません。戻って履歴を走査してください。</div>
              )}
              </details>
              <div className="setup-insight"><span>✓</span><p><strong>ここまで分かりました</strong><br />作っているものは{planningDraft.taxUnits.length}件です。自分利用{planningDraft.taxUnits.filter((unit) => unit.usageMode === 'internal' || unit.usageMode === 'mixed').length}件、外部提供{planningDraft.taxUnits.filter((unit) => unit.usageMode === 'external' || unit.usageMode === 'mixed').length}件として整理します。</p></div>
            </>
          )}
          {step === 3 && (
            <>
              <span className="step-label">4 / 5　支払った費用</span>
              <h3>AI料金と開発に使う費用を登録します</h3>
              <p>金額が分からない項目は後から追加できます。私用分を除くための割合も残します。</p>
              <section className="development-scale-guide" aria-label="開発費の規模感と処理候補">
                <div className="scale-guide-heading">
                  <span>金額の見取り図</span>
                  <strong>10万円未満でも、完成・利用前なら今年の費用とは限りません</strong>
                  <p>AI料金などを1つのソフトウェアに直接対応する原価として集める場合の、簡略化した候補です。</p>
                </div>
                <div className="scale-example-list">
                  <div><b>8万円</b><span>まだ開発中</span><strong className="future-tone">将来へ残る原価候補</strong><small>完成・利用開始を確認するまで</small></div>
                  <div><b>8万円</b><span>完成して利用開始</span><strong className="current-tone">今年の費用候補</strong><small>10万円未満の少額資産候補</small></div>
                  <div><b>10万円ちょうど</b><span>完成して利用開始</span><strong className="review-tone">3年均等または通常償却候補</strong><small>「10万円未満」には含まれません</small></div>
                  <div><b>15万円</b><span>完成して利用開始</span><strong className="review-tone">3年で1/3ずつ、または通常償却候補</strong><small>10万円以上20万円未満</small></div>
                  <div><b>25万円</b><span>完成して利用開始</span><strong className="future-tone">通常の減価償却候補</strong><small>青色申告者向け特例は別に確認</small></div>
                </div>
                <p className="scale-warning"><b>注意：</b>判定は請求書1枚や月額ごとではなく、通常は機能する1つの資産単位の取得価額で行います。税務目的で不自然に分割しません。</p>
              </section>
              <div className="invoice-box">
                <div><span className="provider-logo">C</span><strong>Claude Code 月額</strong><input aria-label="Claude Code 月額" type="number" min="0" value={claudeCharge} onChange={(event) => updateProviderCharge('claude', event.target.valueAsNumber || 0)} /><span>円</span></div>
                <div><span className="provider-logo codex">O</span><strong>Codex 月額</strong><input aria-label="Codex 月額" type="number" min="0" value={codexCharge} onChange={(event) => updateProviderCharge('codex', event.target.valueAsNumber || 0)} /><span>円</span></div>
              </div>
              {monthlyCharges.length > 0 && (
                <details className="monthly-charges">
                  <summary>月別料金を編集（{monthlyCharges.length / 2}か月）</summary>
                  <div className="monthly-charge-grid">
                    {data.months.map((month) => {
                      const monthKey = monthKeyFromLabel(month.label, planningDraft.profile.taxYear)
                      return (
                        <div className="monthly-charge-row" key={monthKey}>
                          <strong>{month.label}</strong>
                          {(['claude', 'codex'] as ProviderKey[]).map((provider) => {
                            const index = monthlyCharges.findIndex((charge) => (
                              charge.provider === provider && charge.month === monthKey
                            ))
                            return (
                              <label key={provider}>
                                <span>{provider === 'claude' ? 'Claude' : 'Codex'}</span>
                                <input
                                  aria-label={`${month.label} ${provider}料金`}
                                  type="number"
                                  min="0"
                                  value={monthlyCharges[index]?.amountJpy ?? 0}
                                  onChange={(event) => setMonthlyCharges((current) => current.map((charge, chargeIndex) => (
                                    chargeIndex === index
                                      ? { ...charge, amountJpy: event.target.valueAsNumber || 0 }
                                      : charge
                                  )))}
                                />
                                <span>円</span>
                              </label>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                </details>
              )}
              <label className="ratio-field">
                <span><strong>未取得利用の割合</strong><small>Webチャットや別PCなど、ローカル履歴に現れない利用</small></span>
                <input aria-label="未取得利用割合" type="number" min="0" max="95" value={unobservedPercent} onChange={(event) => setUnobservedPercent(event.target.valueAsNumber || 0)} />
                <span>%</span>
              </label>
              <div className="cost-editor-section">
                <div className="cost-editor-heading"><div><h4>PC・DGXなど</h4><p>10万円の境界だけで決めず、使い始めた日・耐用年数・私用転用も記録します。</p></div><button className="secondary-button" onClick={() => setPlanningDraft((current) => ({ ...current, equipment: [...current.equipment, { id: `equipment-${Date.now()}`, name: '開発用PC', equipmentType: 'pc', acquisitionCostJpy: 0, acquiredOn: `${current.profile.taxYear}-01-01`, convertedFromPrivate: false, businessUseRatio: 1, role: 'アプリ開発', taxUnitId: current.taxUnits[0]?.id, projectAllocationRatio: 1, evidenceIds: [] }] }))}>＋ 追加</button></div>
                {planningDraft.equipment.map((item, index) => (
                  <div className="cost-edit-row" key={item.id}>
                    <label><span>機器名</span><input value={item.name} onChange={(event) => updateEquipment(index, { name: event.target.value })} /></label>
                    <label><span>種類</span><select value={item.equipmentType} onChange={(event) => updateEquipment(index, { equipmentType: event.target.value as EquipmentRecord['equipmentType'] })}><option value="pc">パソコン</option><option value="gpu">GPU機器</option><option value="dgx">DGX</option><option value="server">サーバー</option><option value="desk">机</option><option value="peripheral">周辺機器</option><option value="other">その他</option></select></label>
                    <label><span>購入額</span><input type="number" min="0" value={item.acquisitionCostJpy} onChange={(event) => updateEquipment(index, { acquisitionCostJpy: event.target.valueAsNumber || 0 })} /></label>
                    <label><span>購入日</span><input type="date" value={item.acquiredOn} onChange={(event) => updateEquipment(index, { acquiredOn: event.target.value })} /></label>
                    <label><span>業務で使い始めた日</span><input type="date" value={item.businessUseStartedOn ?? ''} onChange={(event) => updateEquipment(index, { businessUseStartedOn: event.target.value || undefined })} /></label>
                    <label><span>耐用年数（不明なら空欄）</span><input type="number" min="1" max="100" value={item.usefulLifeYears ?? ''} onChange={(event) => updateEquipment(index, { usefulLifeYears: Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : undefined })} /></label>
                    <label><span>業務で使う割合</span><input type="number" min="0" max="100" value={Math.round(item.businessUseRatio * 100)} onChange={(event) => updateEquipment(index, { businessUseRatio: Math.min(100, Math.max(0, event.target.valueAsNumber || 0)) / 100 })} /></label>
                    <label><span>どの制作物に使う？</span><select value={item.taxUnitId ?? ''} onChange={(event) => updateEquipment(index, { taxUnitId: event.target.value || undefined })}><option value="">まだ分けない</option>{planningDraft.taxUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
                    <label><span>その制作物に使う割合</span><input type="number" min="0" max="100" value={Math.round(item.projectAllocationRatio * 100)} onChange={(event) => updateEquipment(index, { projectAllocationRatio: Math.min(100, Math.max(0, event.target.valueAsNumber || 0)) / 100 })} /></label>
                    <label className="checkbox-field"><input type="checkbox" checked={item.convertedFromPrivate} onChange={(event) => updateEquipment(index, { convertedFromPrivate: event.target.checked })} /><span>以前は私用だった機器を転用した</span></label>
                    {item.convertedFromPrivate && <label><span>転用時の未償却残高</span><input type="number" min="0" value={item.openingUnamortizedBalanceJpy ?? ''} onChange={(event) => updateEquipment(index, { openingUnamortizedBalanceJpy: Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : undefined })} /></label>}
                    <label className="wide-field"><span>役割</span><input placeholder="例：外出時の開発、ローカルAI検証" value={item.role} onChange={(event) => updateEquipment(index, { role: event.target.value })} /></label>
                  </div>
                ))}
              </div>
              <div className="cost-editor-section">
                <div className="cost-editor-heading"><div><h4>家賃・電気・通信</h4><p>計算の方法と、その方法を選んだ理由を残します。</p></div></div>
                <div className="cost-add-buttons">{(['rent', 'electricity', 'internet'] as const).map((category) => <button className="secondary-button" key={category} onClick={() => setPlanningDraft((current) => ({ ...current, homeCosts: [...current.homeCosts, { id: `home-${category}-${Date.now()}`, month: `${current.profile.taxYear}-01`, category, amountJpy: 0, method: category === 'rent' ? 'area-time' : category === 'electricity' ? 'watt-hour' : 'usage-time', businessUseRatio: 0, basis: '未入力', rationale: 'あとで確認', projectAllocationRatio: 0, treatment: 'shared', evidenceIds: [] }] }))}>＋ {categoryLabel(category)}</button>)}</div>
                {planningDraft.homeCosts.map((item, index) => (
                  <div className="cost-edit-row home" key={item.id}>
                    <strong>{categoryLabel(item.category)}</strong>
                    <label><span>対象月</span><input type="month" value={item.month} onChange={(event) => updateHomeCost(index, { month: event.target.value })} /></label>
                    <label><span>支払額</span><input type="number" min="0" value={item.amountJpy} onChange={(event) => updateHomeCost(index, { amountJpy: event.target.valueAsNumber || 0 })} /></label>
                    <label><span>業務割合</span><input type="number" min="0" max="100" value={Math.round(item.businessUseRatio * 100)} onChange={(event) => updateHomeCost(index, { businessUseRatio: Math.min(100, Math.max(0, event.target.valueAsNumber || 0)) / 100 })} /></label>
                    <label><span>どの制作物に使う？</span><select value={item.taxUnitId ?? ''} onChange={(event) => updateHomeCost(index, { taxUnitId: event.target.value || undefined })}><option value="">全体・まだ分けない</option>{planningDraft.taxUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
                    <label><span>その制作物に使う割合</span><input type="number" min="0" max="100" value={Math.round(item.projectAllocationRatio * 100)} onChange={(event) => updateHomeCost(index, { projectAllocationRatio: Math.min(100, Math.max(0, event.target.valueAsNumber || 0)) / 100 })} /></label>
                    <label className="wide-field"><span>計算の根拠</span><input placeholder="例：作業面積20% × 使用時間60%" value={item.basis} onChange={(event) => updateHomeCost(index, { basis: event.target.value })} /></label>
                    <label className="wide-field"><span>この方法にした理由</span><input placeholder="例：専用部屋がないため面積と時間を併用" value={item.rationale} onChange={(event) => updateHomeCost(index, { rationale: event.target.value })} /></label>
                  </div>
                ))}
              </div>
              <div className="cost-editor-section">
                <div className="cost-editor-heading"><div><h4>そのほかの直接費</h4><p>ドメイン、クラウド、外注など、制作物へ直接結び付く支払いです。</p></div><button className="secondary-button" onClick={() => setPlanningDraft((current) => ({ ...current, directCosts: [...current.directCosts, { id: `direct-${Date.now()}`, taxUnitId: current.taxUnits[0]?.id, incurredOn: `${current.profile.taxYear}-01-01`, costType: 'cloud', amountJpy: 0, directlyAttributable: true, treatment: 'direct', note: '', evidenceIds: [] }] }))}>＋ 追加</button></div>
                {planningDraft.directCosts.map((item, index) => <div className="cost-edit-row" key={item.id}><label><span>支払日</span><input type="date" value={item.incurredOn} onChange={(event) => updateDirectCost(index, { incurredOn: event.target.value })} /></label><label><span>種類</span><select value={item.costType} onChange={(event) => updateDirectCost(index, { costType: event.target.value as DirectCostRecord['costType'] })}><option value="cloud">クラウド</option><option value="domain">ドメイン</option><option value="license">ライセンス</option><option value="outsource">外注</option><option value="material">材料</option><option value="old-version-balance">旧版の残価候補</option><option value="other">その他</option></select></label><label><span>金額</span><input type="number" min="0" value={item.amountJpy} onChange={(event) => updateDirectCost(index, { amountJpy: event.target.valueAsNumber || 0 })} /></label><label><span>結び付ける制作物</span><select value={item.taxUnitId ?? ''} onChange={(event) => updateDirectCost(index, { taxUnitId: event.target.value || undefined })}><option value="">まだ決めない</option>{planningDraft.taxUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label><label className="wide-field"><span>メモ</span><input value={item.note ?? ''} onChange={(event) => updateDirectCost(index, { note: event.target.value })} /></label></div>)}
              </div>
              <div className="cost-editor-section">
                <div className="cost-editor-heading"><div><h4>根拠メモ</h4><p>領収書、販売ページ、初回利用などの所在だけを記録します。ファイル自体はアップロードしません。</p></div><button className="secondary-button" onClick={() => setPlanningDraft((current) => ({ ...current, evidence: [...current.evidence, { id: `evidence-${Date.now()}`, evidenceType: 'memo', strength: 'self-recorded', occurredOn: `${current.profile.taxYear}-01-01`, recordedAt: new Date().toISOString(), note: 'あとで内容を確認', taxUnitId: current.taxUnits[0]?.id }] }))}>＋ 追加</button></div>
                {planningDraft.evidence.map((item, index) => <div className="cost-edit-row" key={item.id}><label><span>日付</span><input type="date" value={item.occurredOn ?? ''} onChange={(event) => updateEvidence(index, { occurredOn: event.target.value || undefined })} /></label><label><span>根拠の種類</span><select value={item.evidenceType} onChange={(event) => updateEvidence(index, { evidenceType: event.target.value as EvidenceRecord['evidenceType'] })}><option value="receipt">領収書</option><option value="card-statement">カード明細</option><option value="deployment">公開記録</option><option value="sale-page">販売ページ</option><option value="first-use">初回利用</option><option value="screenshot">画面保存</option><option value="memo">自分のメモ</option><option value="ai-session">AI利用履歴</option><option value="other">その他</option></select></label><label><span>結び付ける制作物</span><select value={item.taxUnitId ?? ''} onChange={(event) => updateEvidence(index, { taxUnitId: event.target.value || undefined })}><option value="">全体</option>{planningDraft.taxUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label><label className="wide-field"><span>何を確認できる記録？</span><input value={item.note} onChange={(event) => updateEvidence(index, { note: event.target.value })} /></label><label className="wide-field"><span>このPC内の保存場所（任意）</span><input placeholder="例：領収書フォルダ/2026-07.pdf" value={item.localReference ?? ''} onChange={(event) => updateEvidence(index, { localReference: event.target.value || undefined })} /></label></div>)}
              </div>
              <div className="setup-insight"><span>✓</span><p><strong>ここまで分かりました</strong><br />機器{planningDraft.equipment.length}件、自宅費用{planningDraft.homeCosts.length}件、直接費{planningDraft.directCosts.length}件、根拠{planningDraft.evidence.length}件を記録します。入力が増えるほど、説明できる金額が増えていきます。</p></div>
            </>
          )}
          {step === 4 && (
            <>
              <span className="step-label">5 / 5　これから行うこと</span>
              <h3>いまの整理結果です</h3>
              <p>保存すると、登録した事実から診断と金額を計算し直します。</p>
              <div className="onboarding-diagnosis">
                <section><h4>準備の進み具合</h4><p className="readiness-copy"><strong>{draftDiagnosis.readiness.confirmed} / {draftDiagnosis.readiness.total}</strong> 項目まで確認できました。全部埋めなくても保存して、次回ここから続けられます。</p></section>
                <section><h4>現在地</h4><ul>{planningDraft.taxUnits.map((unit) => <li key={unit.id}><strong>{unit.name || '名前未入力'}</strong>：{usageModeLabel(unit.usageMode)}・{lifecycleLabel(unit.lifecycleStatus)}</li>)}</ul></section>
                <section><h4>今すぐ確認すること</h4><ul>{draftDiagnosis.immediateActions.slice(0, 3).map((action) => <li key={action.id}><strong>{action.title}</strong><span>{action.reason}</span></li>)}</ul></section>
                <section><h4>あとで出来事が起きたら</h4><ul>{draftDiagnosis.eventTriggeredActions.slice(0, 2).map((action) => <li key={action.id}><strong>{action.title}</strong><span>{action.reason}</span></li>)}</ul></section>
              </div>
              <details className="advanced-fields"><summary>詳しい税務上の注意を見る</summary><p>表示される処理は候補です。金額を増やすための追加開発や、税務だけを目的に公開日を動かす提案は行いません。実際の使い方と記録を一致させてください。</p></details>
            </>
          )}
          {notice && (
            <div className={`setup-notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'} aria-live="polite">
              <span>{notice.kind === 'success' ? '✓' : notice.kind === 'error' ? '!' : 'ⓘ'}</span>
              {notice.message}
            </div>
          )}
          <div className="modal-actions">
            <button className="secondary-button" disabled={busy} onClick={() => step === 0 ? onClose() : onStep(step - 1)}>
              {step === 0 ? 'あとで確認' : '戻る'}
            </button>
            {step > 0 && step < 4 && <button className="text-button save-progress" disabled={busy} onClick={saveProgress}>ここまで保存</button>}
            <button className="primary-button" disabled={busy || runtimeLoading} onClick={advance}>
              {busy
                ? step === 0 ? '履歴を確認中…' : '保存中…'
                : step === 0 ? apiUnavailable ? 'デモで次へ' : '履歴を確認して次へ'
                  : step === 4 ? apiUnavailable ? 'デモを閉じる' : '保存する'
                    : '次へ'}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

export default App
