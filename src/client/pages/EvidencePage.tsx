import type { Allocation, DashboardData } from '../types'
import type { Diagnosis, PlanningSnapshot, ProjectClassification } from '../../planning/types'
import { getPlanningExport } from '../api'
import { costProjectionMarkdown } from '../../core/costExport'
import { planningMarkdown } from '../../core/planningExport'
import { CLASSIFICATION_LABELS, categoryLabel, EmptyState, GROUP_CLASS, lifecycleLabel, PanelHeading, usageModeLabel, yen } from './shared'
import AnnualOverview from './AnnualOverview'
import ExportPreviewButton from './ExportPreviewButton'

export default function EvidencePage({ data, planning, diagnosis, allocations, selected,
  onSelect, busy, error, onReclassify }: {
  data: DashboardData
  planning: PlanningSnapshot
  diagnosis: Diagnosis
  allocations: Allocation[]
  selected: Allocation | null
  onSelect: (row: Allocation | null) => void
  busy: boolean
  error: string | null
  onReclassify: (row: Allocation, classification: ProjectClassification) => Promise<void>
}) {
  // A stale selection must not show a row that disappeared after filtering or saving.
  const active = allocations.find((row) => row.id === selected?.id) ?? allocations[0] ?? null
  async function exportDraft(): Promise<Blob> {
    if (data.meta.source === 'local') return getPlanningExport('markdown')
    const text = '# 合成データによる説明用デモ\n\n' + planningMarkdown(planning, diagnosis) + '\n' +
      (data.costProjection ? costProjectionMarkdown(data.costProjection) : '全費用の計算資料なし。')
    return new Blob([text], { type: 'text/markdown;charset=utf-8' })
  }
  return <>
    {error && <div className="setup-notice error" role="alert" aria-live="polite">{error}</div>}
    <section className="panel evidence-table-panel">
      <PanelHeading title="配賦明細" subtitle={`${allocations.length}件 · 契約・利用期間ごとの配分`} trailing={<ExportPreviewButton label="相談用Markdown" filename={`devtax-${planning.profile.taxYear}.md`} load={exportDraft} />} />
      <div className="table-scroll"><table><thead><tr><th>月</th><th>AIサービス</th><th>作っているもの</th><th>費用をまとめる単位</th><th>工程</th><th className="number">利用割合</th><th className="number">配賦額</th><th>分類</th></tr></thead>
        <tbody>{allocations.length === 0 && <tr><td colSpan={8}><EmptyState message="表示できるAI配賦明細がありません。AI以外の費用は下の全費用資料にも表示します。" /></td></tr>}
          {allocations.map((row) => <tr key={row.id} className={active?.id === row.id ? 'selected-row' : ''}>
            <td><button className="row-open-button" onClick={() => onSelect(row)} aria-label={`${row.month} ${row.provider} ${row.product}、配賦額${yen.format(row.amount)}の根拠を表示`}>{row.month}</button></td>
            <td>{row.provider}</td><td><strong>{row.product}</strong></td><td>{row.asset}</td><td>{row.stage}</td><td className="number">{row.usageRate === null ? '未算定' : `${row.usageRate}%`}</td><td className="number"><strong>{yen.format(row.amount)}</strong></td>
            <td>{row.projectKey && row.monthKey && data.meta.source === 'local' ? <select value={row.classification ?? 'unclassified'} disabled={busy} onChange={(event) => void onReclassify(row, event.target.value as ProjectClassification)} aria-label={`${row.month} ${row.product}の分類を変更`}>
              {Object.entries(CLASSIFICATION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select> : <span className={`tax-chip ${GROUP_CLASS[row.group]}`}>{row.taxCandidate}</span>}</td>
          </tr>)}
        </tbody></table></div>
    </section>
    {active && <div className="evidence-grid">
      <section className="panel decision-card">
        <PanelHeading title="判定説明" subtitle="現在の登録事実に基づく候補。採用済みの税務処理ではありません。" />
        <div className="decision-head"><div><small>分類候補</small><strong>{active.taxCandidate}</strong></div><span className="confidence">取得・対応の区分 {active.confidence}</span></div>
        <dl className="decision-list"><div><dt>適用ルール</dt><dd>{active.rule}</dd></div><div><dt>根拠</dt><dd>{active.reason}</dd></div><div><dt>不足情報</dt><dd className="missing">{active.missing}</dd></div></dl>
      </section>
      <section className="panel log-card">
        <PanelHeading title="根拠ログ" subtitle="本文を保存せずメタデータだけを表示" />
        <div className="session-summary"><div><strong>{active.provider} · {active.session.date}</strong><small>{active.session.id}</small></div><span className="privacy-chip">本文なし</span></div>
        <dl className="log-grid">
          <div><dt>作業フォルダ</dt><dd>{active.session.folder}</dd></div><div><dt>Model</dt><dd>{active.session.model}</dd></div>
          <div><dt>取得トークン数</dt><dd>{active.session.tokens === null ? '対象外（支払の確認行）' : active.session.tokens.toLocaleString()}</dd></div>
          <div><dt>分類ルール</dt><dd>{active.session.classification}</dd></div><div><dt>記録の内訳</dt><dd>{active.session.manualEdit}</dd></div>
        </dl>
      </section>
    </div>}
    <section className="planning-ledger" aria-labelledby="planning-ledger-title">
      <h2 id="planning-ledger-title">制作物・設備・自宅費用・証拠</h2>
      <div className="ledger-card-grid">
        <article className="panel ledger-card"><PanelHeading title="制作物と改良計画" subtitle={`${planning.taxUnits.length}件`} />
          <ul className="compact-record-list">{planning.taxUnits.map((unit) => <li key={unit.id}><div><strong>{unit.name}</strong><span>{usageModeLabel(unit.usageMode)}</span></div><small>{lifecycleLabel(unit.lifecycleStatus)}</small></li>)}</ul>
          <p>期間付き分類ルール {planning.projectRules.length}件。稼働版と改良計画はそれぞれの事実・残高を保持します。</p>
        </article>
        <article className="panel ledger-card"><PanelHeading title="パソコン・GPU機器等" subtitle="購入原額と当年の費用基礎は別です" />
          <ul className="compact-record-list">{planning.equipment.map((item) => <li key={item.id}><div><strong>{item.name}</strong><span>{item.acquisitionCostJpy === null ? `購入額不明：${item.unknownAmountReason}` : yen.format(item.acquisitionCostJpy)} · {item.role}</span></div><small>業務 {Math.round(item.businessUseRatio * 100)}%</small></li>)}</ul>
        </article>
        <article className="panel ledger-card"><PanelHeading title="家賃・電気・通信" subtitle="計算式と採用理由" />
          <ul className="compact-record-list">{planning.homeCosts.map((item) => <li key={item.id}><div><strong>{item.month} {categoryLabel(item.category)}</strong><span>{item.basis}</span></div><small>{item.amountJpy === null ? `支払額不明：${item.unknownAmountReason}` : yen.format(item.amountJpy)} / 業務割合 {Math.round(item.businessUseRatio * 100)}%</small></li>)}</ul>
        </article>
        <article className="panel ledger-card"><PanelHeading title="証拠と不足情報" subtitle="自由記述は第三者へ渡す前に確認してください" />
          <ul className="compact-record-list evidence-records">{planning.evidence.map((item) => <li key={item.id}><div><strong>{item.note}</strong><span>{item.occurredOn ?? '日付未登録'}</span></div><small>{item.strength}</small></li>)}
            {diagnosis.missingFacts.map((fact) => <li className="missing-record" key={fact}><span>{fact}</span></li>)}
          </ul>
        </article>
      </div>
      <AnnualOverview year={planning.profile.taxYear} projection={data.costProjection} />
      <p>全費用の配分チェックは「支払と配分」と同じ計算結果です。AI累計を取得価額・将来残高に置き換えていません。</p>
    </section>
  </>
}
