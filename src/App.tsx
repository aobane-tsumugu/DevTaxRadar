import { useEffect, useMemo, useRef, useState } from 'react'
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
  getFolders,
  getLedger,
  getPlanning,
  getPlanningExport,
  getRuntime,
  savePlanning,
  savePlanningRules,
  saveConfiguration,
  scanHistory,
} from './client/api'
import type {
  FolderSummary,
  LocalConfiguration,
  ProviderKey,
  RuntimeData,
  ScanResult,
} from './client/types'
import type {
  Diagnosis,
  PlanningLedger,
  PlanningSnapshot,
  ProjectRuleRecord,
} from './planning/types'
import Onboarding from './client/pages/Onboarding'
import FolderAssignmentPage from './client/pages/FolderAssignmentPage'
import {
  categoryLabel,
  GROUP_CLASS,
  GROUP_LABELS,
  incomeCategoryLabel,
  lifecycleLabel,
  PanelHeading,
  usageModeLabel,
  yen,
} from './client/pages/shared'
import './index.css'

type Page = 'summary' | 'evidence' | 'folders' | 'guide'
type Provider = 'すべて' | 'Claude Code' | 'Codex'

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
  const [folders, setFolders] = useState<FolderSummary[]>([])
  const [rulesBusy, setRulesBusy] = useState(false)
  const [runtimeLoading, setRuntimeLoading] = useState(true)
  const autoOnboardingShown = useRef(false)

  useEffect(() => {
    getDashboardData().then(setData)
    if (!isLocalRuntime()) {
      setRuntimeLoading(false)
      return
    }
    Promise.all([getRuntime(), getConfiguration(), getPlanning(), getDiagnosis(), getFolders()])
      .then(async ([nextRuntime, nextConfiguration, nextPlanning, nextDiagnosis, nextFolders]) => {
        setRuntime(nextRuntime)
        setConfiguration(nextConfiguration)
        setPlanningState(nextPlanning)
        setDiagnosis(nextDiagnosis)
        setFolders(nextFolders.folders)
        setLedger(await getLedger(nextPlanning.profile.taxYear))
      })
      .catch(() => {
        // The standalone Vite preview intentionally falls back to demo data.
      })
      .finally(() => setRuntimeLoading(false))
  }, [])

  useEffect(() => {
    if (autoOnboardingShown.current || !data || data.meta.source !== 'local' || !configuration)
      return
    const hasAnyCharge =
      configuration.charges.claude > 0 ||
      configuration.charges.codex > 0 ||
      configuration.monthlyCharges.some((charge) => charge.amountJpy > 0)
    if (!hasAnyCharge || data.meta.sessionCount === 0) {
      autoOnboardingShown.current = true
      setOnboardingStep(data.meta.sessionCount > 0 ? 1 : 0)
      setOnboarding(true)
    }
  }, [configuration, data])

  async function runScan(providers: ProviderKey[]): Promise<ScanResult> {
    const activeRuntime = runtime ?? (await getRuntime())
    if (!runtime) setRuntime(activeRuntime)
    const result = await scanHistory(activeRuntime.csrfToken, providers)
    const [nextDashboard, nextConfiguration, nextFolders] = await Promise.all([
      getDashboardData(),
      getConfiguration(),
      getFolders(),
    ])
    setData(nextDashboard)
    setConfiguration(nextConfiguration)
    setFolders(nextFolders.folders)
    return result
  }

  async function storeConfiguration(nextConfiguration: LocalConfiguration): Promise<void> {
    const activeRuntime = runtime ?? (await getRuntime())
    if (!runtime) setRuntime(activeRuntime)
    await saveConfiguration(activeRuntime.csrfToken, nextConfiguration)
    setConfiguration(nextConfiguration)
    setData(await getDashboardData())
  }

  async function storePlanning(nextPlanning: PlanningSnapshot): Promise<void> {
    const activeRuntime = runtime ?? (await getRuntime())
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

  async function storeRules(rules: ProjectRuleRecord[]): Promise<void> {
    setRulesBusy(true)
    try {
      const activeRuntime = runtime ?? (await getRuntime())
      if (!runtime) setRuntime(activeRuntime)
      await savePlanningRules(activeRuntime.csrfToken, rules)
      const [nextFolders, nextPlanning, nextDashboard] = await Promise.all([
        getFolders(),
        getPlanning(),
        getDashboardData(),
      ])
      setFolders(nextFolders.folders)
      setPlanningState(nextPlanning)
      setData(nextDashboard)
    } finally {
      setRulesBusy(false)
    }
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
  const unassignedFolderCount = folders.filter((folder) => folder.unassignedSessionCount > 0).length
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
            <span>
              今年どうなる？<small>年間見込と境界</small>
            </span>
          </button>
          <button
            className={page === 'evidence' ? 'nav-item active' : 'nav-item'}
            onClick={() => setPage('evidence')}
          >
            <span aria-hidden="true">≡</span>
            <span>
              なぜそうなる？<small>配賦と根拠ログ</small>
            </span>
          </button>
          <button
            className={page === 'folders' ? 'nav-item active' : 'nav-item'}
            onClick={() => setPage('folders')}
          >
            <span aria-hidden="true">▤</span>
            <span>
              フォルダの割当
              <small>履歴と制作物を結ぶ</small>
            </span>
          </button>
          <button
            className={page === 'guide' ? 'nav-item active' : 'nav-item'}
            onClick={() => setPage('guide')}
          >
            <span aria-hidden="true">?</span>
            <span>
              税務QA<small>言葉と境界を知る</small>
            </span>
          </button>
        </nav>

        <div className="sidebar-status">
          <div className="status-line">
            <span className="pulse" />
            <span>{data.meta.source === 'local' ? 'ローカル接続中' : '合成データデモ'}</span>
          </div>
          <strong>{data.meta.sessionCount.toLocaleString()}件の利用記録</strong>
          <small>最終同期 {data.meta.lastSynced}</small>
          <button
            className="quiet-button"
            onClick={() => {
              setOnboardingStep(0)
              setOnboarding(true)
            }}
          >
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
            <span className="profile-pill">
              {incomeCategoryLabel(planning.profile.incomeCategory)}
            </span>
          </div>
          <div className="top-actions">
            <span className={data.meta.source === 'local' ? 'source-badge live' : 'source-badge'}>
              {data.meta.source === 'local' ? '実データ' : 'デモデータ'}
            </span>
            {data.meta.source !== 'demo' && (
              <button
                className="primary-button"
                onClick={() => {
                  setOnboardingStep(3)
                  setOnboarding(true)
                }}
              >
                ＋ 月次確認
              </button>
            )}
          </div>
        </header>

        <main className="content">
          {data.meta.source === 'demo' && (
            <section className="public-demo-banner" aria-labelledby="public-demo-title">
              <span className="demo-shield" aria-hidden="true">
                ✓
              </span>
              <div className="demo-banner-copy">
                <span className="demo-label">公開デモ・合成データ</span>
                <strong id="public-demo-title">
                  AIサブスク費用を、税務説明できるプロダクト原価へ。
                </strong>
                <p>
                  この画面に実在の履歴・請求額・パスは含まれません。 GitHub版はClaude
                  Code／Codexの履歴をPC内だけで集計します。
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
              <span className="eyebrow">
                {page === 'summary'
                  ? '年間の見通し'
                  : page === 'evidence'
                    ? '数字の根拠'
                    : page === 'folders'
                      ? '履歴と制作物の対応'
                      : 'やさしい税務ガイド'}
              </span>
              <h1>
                {page === 'summary'
                  ? '今年どうなる？'
                  : page === 'evidence'
                    ? 'なぜそうなる？'
                    : page === 'folders'
                      ? 'フォルダの割当'
                      : '税務の言葉を知る'}
              </h1>
              <p>
                {page === 'summary'
                  ? '定額のClaude Code／Codexを利用実態で配賦し、今年の費用と将来へ残る原価を見通します。'
                  : page === 'evidence'
                    ? '月額料金からAIサービス・月・作っているものまで、数字の由来を辿れます。'
                    : page === 'folders'
                      ? 'AI履歴の作業フォルダを、制作物と作業内容へ結び付けます。ここで割り当てた内容が配賦額の分類になります。'
                      : '取得価額や資本的支出を、1文の結論と具体例から確認できます。'}
              </p>
            </div>
            {(page === 'summary' || page === 'evidence') && (
              <div className="filters" aria-label="表示フィルター">
                <label>
                  <span>AIサービス</span>
                  <select
                    value={provider}
                    onChange={(event) => setProvider(event.target.value as Provider)}
                  >
                    <option>すべて</option>
                    <option>Claude Code</option>
                    <option>Codex</option>
                  </select>
                </label>
                <label>
                  <span>作っているもの</span>
                  <select value={product} onChange={(event) => setProduct(event.target.value)}>
                    {products.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
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
          ) : page === 'folders' ? (
            <FolderAssignmentPage
              folders={folders}
              planning={planning}
              busy={rulesBusy}
              onSaveRules={storeRules}
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
          unassignedFolderCount={unassignedFolderCount}
          onStep={setOnboardingStep}
          onScan={runScan}
          onSave={storeConfiguration}
          onSavePlanning={storePlanning}
          onClose={() => {
            setOnboarding(false)
            setOnboardingStep(0)
            if (unassignedFolderCount > 0) setPage('folders')
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
  const maxMonth = Math.max(
    ...months.map((month) => month.current + month.future + month.review),
    1,
  )

  return (
    <>
      <section className="preparation-strip" aria-label="記録の準備状況">
        <div>
          <span>準備できた項目</span>
          <strong>
            {diagnosis.readiness.confirmed} / {diagnosis.readiness.total}
          </strong>
        </div>
        <div>
          <span>今月の確認</span>
          <strong>
            {data.guidance.filter((item) => item.severity === 'ok').length} / {data.guidance.length}
          </strong>
        </div>
        <div>
          <span>記録のある月</span>
          <strong>{months.length}か月</strong>
        </div>
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
            {diagnosis.currentPosition.map((item) => (
              <li key={item}>{item}</li>
            ))}
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
                <div>
                  <strong>{action.title}</strong>
                  <p>{action.reason}</p>
                </div>
              </li>
            ))}
          </ol>
          {diagnosis.eventTriggeredActions[0] && (
            <details className="event-action">
              <summary>イベントが起きたら行うこと</summary>
              <p>
                <strong>{diagnosis.eventTriggeredActions[0].title}</strong>
                <br />
                {diagnosis.eventTriggeredActions[0].reason}
              </p>
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
                {group === 'current'
                  ? '当年の処理候補'
                  : group === 'future'
                    ? '開発中・未供用'
                    : '未分類・私用'}
              </span>
            </div>
          </article>
        ))}
      </section>

      <ol className="value-flow" aria-label="DevTax Radarの処理フロー">
        <li>
          <span>01</span>
          <div>
            <strong>利用履歴を読む</strong>
            <small>Claude Code・Codex</small>
          </div>
        </li>
        <li>
          <span>02</span>
          <div>
            <strong>定額料金を配賦</strong>
            <small>加重トークン・プロダクト</small>
          </div>
        </li>
        <li>
          <span>03</span>
          <div>
            <strong>税務候補と根拠を残す</strong>
            <small>通常経費・取得価額・要確認</small>
          </div>
        </li>
      </ol>

      <div className="main-grid">
        <section className="panel chart-panel">
          <PanelHeading
            title="費用の行き先"
            subtitle="AIサービスごとに配賦した月額の積み上げ"
            trailing={
              <span className="confidence">
                対応付け済み {data.meta.mappedRate}% ・ 分類済み {data.meta.classifiedRate}%
              </span>
            }
          />
          <div className="chart-legend" aria-hidden="true">
            <span>
              <i className="dot coral" />
              今年の費用
            </span>
            <span>
              <i className="dot indigo" />
              将来残高
            </span>
            <span>
              <i className="dot amber" />
              要確認
            </span>
          </div>
          <div
            className="bar-chart"
            role="img"
            aria-label="2026年4月から7月までの費用配賦積み上げグラフ"
          >
            <div className="axis-label top">{yen.format(maxMonth)}</div>
            <div className="axis-label middle">{yen.format(Math.round(maxMonth / 2))}</div>
            {months.map((month) => (
              <div className="bar-column" key={month.label}>
                <div className="bar-value">
                  {yen.format(month.current + month.future + month.review)}
                </div>
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
            <div className="score-ring">
              <strong>{diagnosis.readiness.confirmed}</strong>
              <small>/{diagnosis.readiness.total}</small>
            </div>
            <div>
              <strong>確認できた事実</strong>
              <p>不足情報は{diagnosis.missingFacts.length}件です</p>
            </div>
          </div>
          <ul className="guide-list">
            {data.guidance.map((item) => (
              <li key={item.title}>
                <span className={`guide-symbol ${item.severity}`} aria-hidden="true">
                  {item.severity === 'warning' ? '!' : '✓'}
                </span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="panel alerts-panel">
        <PanelHeading
          title="金額境界レーダー"
          subtitle="金額だけで結論を出さず、資産単位と供用状況も合わせて確認します"
          trailing={
            <button className="text-button" onClick={onOpenGuide}>
              判定ルールを見る →
            </button>
          }
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
                  <div className="progress">
                    <i style={{ width: `${pct}%` }} />
                  </div>
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
    const blob =
      data.meta.source === 'local'
        ? await getPlanningExport('markdown')
        : new Blob(
            [
              `# DevTax Radar 相談用出力\n\n年分: ${planning.profile.taxYear}\n\n` +
                ledger.byTaxUnit
                  .map(
                    (item) => `- ${item.name}: ${yen.format(item.amountJpy)} / ${item.candidate}`,
                  )
                  .join('\n'),
            ],
            { type: 'text/markdown' },
          )
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
          trailing={
            <button className="export-button" onClick={downloadLedger}>
              相談用Markdown
            </button>
          }
        />
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>月</th>
                <th>AIサービス</th>
                <th>作っているもの</th>
                <th>費用をまとめる単位</th>
                <th>工程</th>
                <th className="number">利用割合</th>
                <th className="number">配賦額</th>
                <th>税務候補</th>
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
                  <td>
                    <span className={`provider-logo ${row.provider === 'Codex' ? 'codex' : ''}`}>
                      {row.provider === 'Codex' ? 'O' : 'C'}
                    </span>
                    {row.provider}
                  </td>
                  <td>
                    <strong>{row.product}</strong>
                  </td>
                  <td>{row.asset}</td>
                  <td>{row.stage}</td>
                  <td className="number">{row.usageRate}%</td>
                  <td className="number">
                    <strong>{yen.format(row.amount)}</strong>
                  </td>
                  <td>
                    <span className={`tax-chip ${GROUP_CLASS[row.group]}`}>{row.taxCandidate}</span>
                  </td>
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
              <div>
                <dt>AIサブスク配賦額</dt>
                <dd>{yen.format(asset.aiCost)}</dd>
              </div>
              <div>
                <dt>外注費</dt>
                <dd>{yen.format(asset.outsource)}</dd>
              </div>
              <div>
                <dt>その他直接費</dt>
                <dd>{yen.format(asset.other)}</dd>
              </div>
              <div className="total-line">
                <dt>翌年以後へ残る見込</dt>
                <dd>{yen.format(asset.futureBalance)}</dd>
              </div>
            </dl>
            <p className="scope-warning">
              AI以外の直接費入力は未実装です。10万円等の境界は、実際の資産全体の取得価額で再確認してください。
            </p>
            <div className="asset-progress">
              <div>
                <span>10万円境界まで</span>
                <strong>{yen.format(Math.max(100000 - asset.total, 0))}</strong>
              </div>
              <div className="progress">
                <i style={{ width: `${Math.min(asset.total / 1000, 100)}%` }} />
              </div>
            </div>
          </section>

          <section className="panel decision-card">
            <PanelHeading title="判定説明" subtitle="現在の登録事実に基づく候補" />
            <div className="decision-head">
              <span className="decision-icon">◇</span>
              <div>
                <small>判定候補</small>
                <strong>{active.taxCandidate}</strong>
              </div>
              <span className="confidence">信頼度 {active.confidence}</span>
            </div>
            <dl className="decision-list">
              <div>
                <dt>適用ルール</dt>
                <dd>{active.rule}</dd>
              </div>
              <div>
                <dt>根拠</dt>
                <dd>{active.reason}</dd>
              </div>
              <div>
                <dt>不足情報</dt>
                <dd className="missing">{active.missing}</dd>
              </div>
            </dl>
            <p className="decision-next">
              この候補の確認・修正は、上の「設定を確認」から事実と証拠を更新すると再計算されます。
            </p>
          </section>

          <section className="panel log-card">
            <PanelHeading title="根拠ログ" subtitle="本文を保存せずメタデータだけを表示" />
            <div className="session-summary">
              <span className={`provider-logo ${active.provider === 'Codex' ? 'codex' : ''}`}>
                {active.provider === 'Codex' ? 'O' : 'C'}
              </span>
              <div>
                <strong>
                  {active.provider} · {active.session.date}
                </strong>
                <small>{active.session.id}</small>
              </div>
              <span className="privacy-chip">本文なし</span>
            </div>
            <dl className="log-grid">
              <div>
                <dt>作業フォルダ</dt>
                <dd>{active.session.folder}</dd>
              </div>
              <div>
                <dt>Git branch</dt>
                <dd>{active.session.branch}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>{active.session.model}</dd>
              </div>
              <div>
                <dt>加重トークン</dt>
                <dd>{active.session.tokens.toLocaleString()}</dd>
              </div>
              <div>
                <dt>分類ルール</dt>
                <dd>{active.session.classification}</dd>
              </div>
              <div>
                <dt>手動修正</dt>
                <dd>{active.session.manualEdit}</dd>
              </div>
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
        <p>
          金額の結論だけでなく、誰が使うか、いつ正式利用したか、どの計算式を使ったかまで辿れます。
        </p>
      </div>
      <div className="ledger-card-grid">
        <article className="panel ledger-card">
          <PanelHeading
            title="制作物と改良計画"
            subtitle={`${planning.taxUnits.length}件 · 自分利用と公開を別イベントで管理`}
          />
          <ul className="compact-record-list">
            {planning.taxUnits.map((unit) => (
              <li key={unit.id}>
                <div>
                  <strong>{unit.name}</strong>
                  <span>{usageModeLabel(unit.usageMode)}</span>
                </div>
                <small>{lifecycleLabel(unit.lifecycleStatus)}</small>
              </li>
            ))}
          </ul>
          <p className="ledger-footnote">期間付き分類ルール {planning.projectRules.length}件</p>
        </article>
        <article className="panel ledger-card">
          <PanelHeading
            title="PC・DGX等"
            subtitle={`${planning.equipment.length}件 · 業務割合と制作物割合を分離`}
          />
          <ul className="compact-record-list">
            {planning.equipment.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <span>
                    {yen.format(item.acquisitionCostJpy)} · {item.role}
                  </span>
                </div>
                <small>
                  業務 {Math.round(item.businessUseRatio * 100)}% / 制作物{' '}
                  {Math.round(item.projectAllocationRatio * 100)}%
                </small>
              </li>
            ))}
          </ul>
        </article>
        <article className="panel ledger-card">
          <PanelHeading
            title="家賃・電気・通信"
            subtitle={`${planning.homeCosts.length}件 · 計算式と採用理由を保存`}
          />
          <ul className="compact-record-list">
            {planning.homeCosts.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>
                    {item.month} {categoryLabel(item.category)}
                  </strong>
                  <span>{item.basis}</span>
                </div>
                <small>
                  {yen.format(item.amountJpy)} × {Math.round(item.businessUseRatio * 100)}%
                </small>
              </li>
            ))}
          </ul>
        </article>
        <article className="panel ledger-card">
          <PanelHeading
            title="証拠と不足情報"
            subtitle={`${planning.evidence.length}件 · Gitがなくてもメモや外部記録を保存`}
          />
          <ul className="compact-record-list evidence-records">
            {planning.evidence.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.note}</strong>
                  <span>{item.occurredOn ?? '日付未登録'}</span>
                </div>
                <small>{item.strength}</small>
              </li>
            ))}
            {diagnosis.missingFacts.map((fact) => (
              <li className="missing-record" key={fact}>
                <div>
                  <strong>不足</strong>
                  <span>{fact}</span>
                </div>
                <small>要確認</small>
              </li>
            ))}
          </ul>
        </article>
      </div>
      <article className="panel ledger-balance">
        <PanelHeading
          title="設備・自宅費用の配賦チェック"
          subtitle="原額から私用・未配賦までを残し、二重計上を防ぎます"
        />
        <dl>
          <div>
            <dt>原額</dt>
            <dd>{yen.format(ledger.totals.grossAmountJpy)}</dd>
          </div>
          <div>
            <dt>業務利用額</dt>
            <dd>{yen.format(ledger.totals.businessAmountJpy)}</dd>
          </div>
          <div>
            <dt>制作物へ配賦</dt>
            <dd>{yen.format(ledger.totals.allocatedAmountJpy)}</dd>
          </div>
          <div>
            <dt>私用</dt>
            <dd>{yen.format(ledger.totals.privateAmountJpy)}</dd>
          </div>
          <div>
            <dt>未配賦・一般管理</dt>
            <dd>{yen.format(ledger.totals.unallocatedAmountJpy)}</dd>
          </div>
        </dl>
      </article>
    </section>
  )
}

const TAX_GUIDE_ITEMS = [
  {
    term: '取得価額とは？',
    answer: '資産を買う・作るために直接必要だった金額を、使用開始まで集めたものです。',
    example:
      '新規アプリの実装に直接使ったAIサブスク配賦額は、自作ソフトウェアの取得価額に含める候補になります。',
    check: 'その作業は特定の資産へ直接対応するか。一般学習・保守・私用が混ざっていないか。',
  },
  {
    term: '資本的支出とは？',
    answer: '既存資産の価値を高めたり、使える期間を延ばしたりする改良費です。',
    example:
      '既存アプリへ独立した大型機能を追加する開発は候補です。小さな不具合修正や現状維持は通常経費の候補になり得ます。',
    check:
      '一つの改良計画として何を増強したか。通常の維持管理との境界を仕様・Issue・リリース記録で説明できるか。',
  },
  {
    term: '通常経費との違いは？',
    answer: '当年の活動を維持する費用か、将来にも効果が残る資産形成の費用かが大きな分岐です。',
    example:
      '稼働中サービスの軽微なバグ修正は通常経費、新規ソフトウェアの完成へ直接必要な実装は取得価額の候補です。',
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
    example:
      '年払い契約のうち翌年分は候補になり得ます。一方、今月すでに利用したAI料金を単に翌年へ移す制度ではありません。',
    check: '契約期間、サービス提供済みの期間、短期前払費用の適用可否を契約書・請求書で確認する。',
  },
  {
    term: '10万円・20万円の境界は？',
    answer:
      '原則として、10万円未満は当年費用、10万円以上20万円未満は通常償却または3年の一括償却、20万円以上は通常の減価償却を検討します。',
    example:
      '99,999円は10万円未満、100,000円は10万円以上です。200,000円ちょうども「20万円未満」には入りません。',
    check:
      '青色申告者の少額特例など別制度の要件、取得・製作日、所得区分、年間上限も個別に確認する。',
  },
  {
    term: '金額の判定単位は？',
    answer:
      'AIの月額料金1行ではなく、完成する一つの資産や一つの改良計画ごとに集めた金額が判定の出発点です。',
    example:
      '月3万円を4か月使って一つのアプリを作った場合、各月3万円だけを見て10万円未満とは判断しません。',
    check:
      'リポジトリ名だけで機械的に分けず、仕様・用途・一体で機能する範囲から税務上の単位を確認する。',
  },
  {
    term: '供用開始とは？',
    answer: '資産が完成しただけでなく、本来の目的のため実際に使い始めた時点です。',
    example:
      '開発中のテストだけなら未供用候補。顧客向けサービスや正式な制作工程で使い始めれば供用開始候補です。',
    check: '初回リリース、正式採用、運用ログなど、実際に使い始めた日を示す証拠を残す。',
  },
  {
    term: '直接対応費と証拠は？',
    answer:
      '特定のプロダクトへ合理的に結び付く利用分だけを、同じ方法で継続配賦することが説明力につながります。',
    example:
      'Claude Code／Codexの加重トークン、作業フォルダ、Gitブランチを使い、月額料金をプロダクト別に配賦します。',
    check:
      '請求書、配賦ルール、セッションメタデータ、手動修正理由、仕様・コミット・供用日の記録を保存する。',
  },
  {
    term: '旧版から新版へ作り直すときは？',
    answer:
      '大幅な仕様変更で新しいソフトウェアを製作し、完成後に旧版を使わない場合は、旧版残価を新版の原材料費に含める取扱いの検討対象です。',
    example:
      '旧パイプラインを廃止し、M1〜M5で構造を再設計する場合は、単なる機能追加か新しい資産かを移行記録で説明します。',
    check:
      '大幅な仕様変更、旧版廃止、移行日、二重控除がないことを確認する。旧版を10万円未満として全額費用化済みなら、移す残価は通常0円です。',
  },
  {
    term: '公開前なら未供用ですか？',
    answer:
      '公開前という事実だけでは決まりません。本来の目的で正式原稿や本番工程に使い始めたかを確認します。',
    example:
      '評価用コピーで比較するだけなら開発・試験寄りですが、新版の出力を正式原稿へ採用すれば供用済みとなる可能性があります。',
    check: 'テストのみ／正式採用、初回本番利用日、リリース記録、正式原稿への反映履歴を残す。',
  },
  {
    term: 'このMVPで未計算のものは？',
    answer:
      'PC・DGX、家賃・電気・通信、直接費は概算候補を計算します。交通費、暗号資産益との所得集計、最終的な償却額や税額はまだ確定しません。',
    example:
      '私用から転用したPCの未償却残高や耐用年数が未入力なら、無理に計算せず「要確認」として残します。',
    check:
      '申告時は所得区分、供用日、耐用年数、償却方法、取得価額に含める範囲を確認し、必要に応じて税理士へ相談する。',
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
          <li>
            <span>1</span>
            <strong>作業目的</strong>
            <small>新規・改良・保守・私用</small>
          </li>
          <li>
            <span>2</span>
            <strong>費用をまとめる単位</strong>
            <small>一つのアプリ・改良計画</small>
          </li>
          <li>
            <span>3</span>
            <strong>時点と金額</strong>
            <small>供用開始・合計額</small>
          </li>
          <li>
            <span>4</span>
            <strong>証拠</strong>
            <small>履歴・仕様・請求書</small>
          </li>
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
                <div>
                  <dt>例</dt>
                  <dd>{item.example}</dd>
                </div>
                <div>
                  <dt>確認</dt>
                  <dd>{item.check}</dd>
                </div>
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
          <li>
            <a
              href="https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/08/06.htm"
              target="_blank"
              rel="noreferrer"
            >
              自己の製作に係るソフトウェアの取得価額等
            </a>
          </li>
          <li>
            <a
              href="https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/05/07.htm"
              target="_blank"
              rel="noreferrer"
            >
              資本的支出と修繕費等
            </a>
          </li>
          <li>
            <a
              href="https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2100.htm"
              target="_blank"
              rel="noreferrer"
            >
              減価償却のあらまし
            </a>
          </li>
          <li>
            <a
              href="https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/08/12.htm"
              target="_blank"
              rel="noreferrer"
            >
              少額減価償却資産・一括償却資産
            </a>
          </li>
        </ul>
      </section>

      <footer className="tax-disclaimer">
        <span aria-hidden="true">ⓘ</span>
        このQAは一般的な整理候補です。資産計上・必要経費・申告内容を確定するものではありません。
      </footer>
    </>
  )
}

export default App
