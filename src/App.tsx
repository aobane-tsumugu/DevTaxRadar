import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  getDashboardData,
  isLocalRuntime,
  type Allocation,
  type DashboardData,
  type TaxGroup,
} from './client/dashboard'
import {
  getConfiguration,
  getRuntime,
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
  const [runtimeLoading, setRuntimeLoading] = useState(true)
  const autoOnboardingShown = useRef(false)

  useEffect(() => {
    getDashboardData().then(setData)
    if (!isLocalRuntime()) {
      setRuntimeLoading(false)
      return
    }
    Promise.all([getRuntime(), getConfiguration()])
      .then(([nextRuntime, nextConfiguration]) => {
        setRuntime(nextRuntime)
        setConfiguration(nextConfiguration)
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
          <strong>{data.meta.sessionCount.toLocaleString()} sessions</strong>
          <small>最終同期 {data.meta.lastSynced}</small>
          <button className="quiet-button" onClick={() => setOnboarding(true)}>
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
            <span className="eyebrow">TAX YEAR</span>
            <strong>2026年</strong>
            <span className="profile-pill">雑所得・未確定</span>
          </div>
          <div className="top-actions">
            <span className={data.meta.source === 'local' ? 'source-badge live' : 'source-badge'}>
              {data.meta.source === 'local' ? '実データ' : 'デモデータ'}
            </span>
            {data.meta.source !== 'demo' && (
              <button className="primary-button" onClick={() => setOnboarding(true)}>
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
                <span className="demo-label">PUBLIC DEMO · 合成データ</span>
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
              <span className="eyebrow">
                {page === 'summary' ? 'YEARLY OUTLOOK' : page === 'evidence' ? 'AUDIT TRAIL' : 'TAX GUIDE'}
              </span>
              <h1>{page === 'summary' ? '今年どうなる？' : page === 'evidence' ? 'なぜそうなる？' : '税務の言葉を知る'}</h1>
              <p>
                {page === 'summary'
                  ? '定額のClaude Code／Codexを利用実態で配賦し、今年の費用と将来へ残る原価を見通します。'
                  : page === 'evidence'
                    ? '月額料金からProvider・月・プロジェクト集計まで、数字の由来を辿れます。'
                    : '取得価額や資本的支出を、1文の結論と具体例から確認できます。'}
              </p>
            </div>
            {page !== 'guide' && (
              <div className="filters" aria-label="表示フィルター">
                <label>
                  <span>Provider</span>
                  <select value={provider} onChange={(event) => setProvider(event.target.value as Provider)}>
                    <option>すべて</option>
                    <option>Claude Code</option>
                    <option>Codex</option>
                  </select>
                </label>
                <label>
                  <span>Product</span>
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
          onStep={setOnboardingStep}
          onScan={runScan}
          onSave={storeConfiguration}
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
  months,
  totals,
  onOpenEvidence,
  onOpenGuide,
}: {
  data: DashboardData
  months: DashboardData['months']
  totals: Record<TaxGroup, number>
  onOpenEvidence: (allocation: Allocation) => void
  onOpenGuide: () => void
}) {
  const annualTotal = totals.current + totals.future + totals.review
  const maxMonth = Math.max(...months.map((month) => month.current + month.future + month.review), 1)

  return (
    <>
      <section className="summary-grid" aria-label="年間サマリー">
        {(['current', 'future', 'review'] as TaxGroup[]).map((group) => (
          <article className={`metric-card ${GROUP_CLASS[group]}`} key={group}>
            <div className="metric-top">
              <span className="metric-icon" aria-hidden="true">
                {group === 'current' ? '↘' : group === 'future' ? '◇' : '!'}
              </span>
              <span className="metric-kicker">
                {group === 'current' ? 'THIS YEAR' : group === 'future' ? 'CARRY FORWARD' : 'NEEDS REVIEW'}
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
            subtitle="Providerごとに配賦した月額の積み上げ"
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
            <div className="score-ring"><strong>82</strong><small>/ 100</small></div>
            <div><strong>説明準備は良好です</strong><p>あと3項目で7月を確定できます</p></div>
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
  allocations,
  selected,
  onSelect,
}: {
  data: DashboardData
  allocations: Allocation[]
  selected: Allocation | null
  onSelect: (row: Allocation | null) => void
}) {
  const active = selected ?? allocations[0] ?? null
  const asset = data.assets.find((item) => item.name === active?.asset) ?? data.assets[0]

  return (
    <>
      <section className="panel evidence-table-panel">
        <PanelHeading
          title="配賦明細"
          subtitle={`${allocations.length}件 · 月額料金をProvider内の利用比率で配賦`}
          trailing={<button className="export-button" disabled title="MVPでは未実装です">CSV（開発中）</button>}
        />
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>月</th><th>Provider</th><th>Product</th><th>税務単位</th>
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
            <div className="confirm-actions">
              <button className="secondary-button">修正する</button>
              <button className="primary-button">この候補を確認</button>
            </div>
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
    </>
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
    answer: 'PC・家賃・電気・交通費、暗号資産益との所得集計、AI以外の直接費、当年の減価償却額はまだ計算しません。',
    example: '画面の境界額はAI配賦額中心の候補プールです。PC本体は別資産、家事関連費は合理的な按分という別論点です。',
    check: '申告時は他の直接費、所得区分、供用日、耐用年数、償却方法を追加し、必要に応じて税理士へ確認する。',
  },
] as const

function TaxGuidePage() {
  return (
    <>
      <section className="guide-intro">
        <div>
          <span className="guide-intro-label">START HERE</span>
          <h2>月額料金を、そのまま税務処理しない。</h2>
          <p>
            まず「何を作るための利用か」を資産・改良計画単位で集め、
            金額境界と供用状況を確認します。DevTax Radarは判断を確定せず、候補と不足証拠を示します。
          </p>
        </div>
        <ol className="guide-route" aria-label="税務候補を確認する順序">
          <li><span>1</span><strong>作業目的</strong><small>新規・改良・保守・私用</small></li>
          <li><span>2</span><strong>税務単位</strong><small>資産・一つの改良計画</small></li>
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
      <span><strong>{item.folder}</strong><small>{item.sessions} sessions</small></span>
      <div className="mapping-fields">
        <label>
          <span>プロダクト名</span>
          <input
            value={mapping?.productName ?? ''}
            onChange={(event) => onChange(index, { productName: event.target.value })}
          />
        </label>
        <label>
          <span>税務単位・資産名</span>
          <input
            value={mapping?.assetName ?? ''}
            onChange={(event) => onChange(index, { assetName: event.target.value })}
          />
        </label>
        <label>
          <span>作業目的</span>
          <select
            value={mapping?.classification ?? 'unclassified'}
            onChange={(event) => onChange(index, {
              classification: event.target.value as ProjectClassification,
            })}
          >
            <option value="new-development">新規ソフトウェア開発</option>
            <option value="maintenance">保守・バグ修正</option>
            <option value="feature-addition">機能追加・改良計画</option>
            <option value="private">私用・対象外</option>
            <option value="unclassified">未分類・要確認</option>
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
  onStep,
  onScan,
  onSave,
  onClose,
}: {
  step: number
  data: DashboardData
  runtime: RuntimeData | null
  runtimeLoading: boolean
  configuration: LocalConfiguration | null
  onStep: (step: number) => void
  onScan: (providers: ProviderKey[]) => Promise<ScanResult>
  onSave: (configuration: LocalConfiguration) => Promise<void>
  onClose: () => void
}) {
  const steps = ['履歴を接続', 'プロダクトを分類', '税務プロファイル']
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
  const rankedProducts = data.products
    .map((product, index) => ({ product, index }))
    .sort((left, right) => right.product.sessions - left.product.sessions)
  const primaryProducts = rankedProducts.slice(0, 12)
  const remainingProducts = rankedProducts.slice(12)

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
      const monthKey = `2026-${month.label.replace('月', '').padStart(2, '0')}`
      return (['claude', 'codex'] as ProviderKey[]).map((provider) => ({
        provider,
        month: monthKey,
        amountJpy: saved.get(`${provider}:${monthKey}`) ?? configuration.charges[provider],
      }))
    }))
  }, [configuration, data.months])

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
        setNotice({ kind: 'error', message: '走査するProviderを1つ以上選択してください。' })
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
      const invalid = mappings.some((mapping) => !mapping.productName.trim() || !mapping.assetName.trim())
      if (invalid) {
        setNotice({ kind: 'error', message: 'プロダクト名と税務単位を入力してください。' })
        return
      }
      onStep(2)
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
      setNotice({ kind: 'success', message: '設定を保存し、ダッシュボードを再集計しました。' })
      window.setTimeout(onClose, 650)
    } catch (error) {
      setNotice({ kind: 'error', message: `保存に失敗しました：${error instanceof Error ? error.message : '不明なエラー'}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="onboarding-modal" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <button className="modal-close" aria-label="閉じる" onClick={onClose}>×</button>
        <div className="onboarding-side">
          <span className="eyebrow">LOCAL SETUP</span>
          <h2 id="onboarding-title">説明できる配賦を<br />3ステップで。</h2>
          <p>原文は読みません。フォルダ、日時、モデル、トークンなどのメタデータだけを使います。</p>
          <ol>
            {steps.map((item, index) => (
              <li className={index === step ? 'active' : index < step ? 'done' : ''} key={item}>
                <span>{index < step ? '✓' : index + 1}</span>{item}
              </li>
            ))}
          </ol>
        </div>
        <div className="onboarding-body">
          {isDemoData && (
            <div className="demo-mode-banner" role="status">
              <strong>デモモード</strong>
              <span>ローカルAPIへ接続していないため、合成データを表示・編集しています。変更は保存されません。</span>
            </div>
          )}
          {step === 0 && (
            <>
              <span className="eyebrow">STEP 1 / 3</span>
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
            </>
          )}
          {step === 1 && (
            <>
              <span className="eyebrow">STEP 2 / 3</span>
              <h3>作業フォルダを分類します</h3>
              <p>同じ月額の中で、どのプロダクトに使ったかを継続的なルールにします。</p>
              <div className="mapping-list">
                {primaryProducts.map(({ product: item, index }) => (
                  <MappingEditor
                    item={item}
                    index={index}
                    mapping={mappings[index]}
                    onChange={updateMapping}
                    key={item.projectKey ?? item.name}
                  />
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
            </>
          )}
          {step === 2 && (
            <>
              <span className="eyebrow">STEP 3 / 3</span>
              <h3>税務プロファイルを確認</h3>
              <p>ここでは税務処理を確定しません。適用候補を絞るための前提です。</p>
              <div className="invoice-box">
                <div><span className="provider-logo">C</span><strong>Claude Code 月額</strong><input aria-label="Claude Code 月額" type="number" min="0" value={claudeCharge} onChange={(event) => setClaudeCharge(event.target.valueAsNumber || 0)} /><span>円</span></div>
                <div><span className="provider-logo codex">O</span><strong>Codex 月額</strong><input aria-label="Codex 月額" type="number" min="0" value={codexCharge} onChange={(event) => setCodexCharge(event.target.valueAsNumber || 0)} /><span>円</span></div>
              </div>
              {monthlyCharges.length > 0 && (
                <details className="monthly-charges">
                  <summary>月別料金を編集（{monthlyCharges.length / 2}か月）</summary>
                  <div className="monthly-charge-grid">
                    {data.months.map((month) => {
                      const monthKey = `2026-${month.label.replace('月', '').padStart(2, '0')}`
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
              <label className="confirmation"><input type="checkbox" defaultChecked /> 自動判定は候補であり、事実を確認して確定することを理解しました</label>
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
              {step === 0 ? 'あとで' : '戻る'}
            </button>
            <button className="primary-button" disabled={busy || runtimeLoading} onClick={advance}>
              {busy
                ? step === 0 ? '履歴を走査中…' : '保存・再集計中…'
                : step === 0 ? apiUnavailable ? 'デモで次へ' : '履歴を走査して次へ'
                  : step === 2 ? apiUnavailable ? 'デモを閉じる' : '保存して再集計'
                    : '次へ'}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

export default App
