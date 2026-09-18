import type { CostTreatmentProjection } from '../../core/costTreatments'
import { treatmentCandidateLabels } from '../../core/costTreatmentFacts'
import { yen } from './shared'
import AnnualMethodComparisonPanel from './AnnualMethodComparisonPanel'

export default function CostTreatmentPanel({ report }: { report?: CostTreatmentProjection }) {
  if (!report) return null
  const amount = (value: number | null) => value === null ? '未算定' : yen.format(value)
  return <article className="panel cost-overview" aria-label="登録事実に基づく処理候補">
    <h2>{report.year}年の条件付き処理候補</h2>
    <p>この費用資料と同じ版の登録条件から計算した候補です。採用済みの費用・残高ではなく、自動記帳しません。費用基礎や採用済み残高へこの候補額を重ねて加算しないでください。</p>
    <dl className="cost-totals">
      <div><dt>当年費用候補の算定済み分</dt><dd>{amount(report.totals.currentYearExpenseCandidateJpy)}</dd></div>
      <div><dt>将来原価候補の算定済み分</dt><dd>{amount(report.totals.futureCostCandidateJpy)}</dd></div>
      <div><dt>金額は既知・処理は未算定</dt><dd>{amount(report.totals.unresolvedKnownJpy)}</dd></div>
      <div><dt>私用として配分済み</dt><dd>{amount(report.totals.excludedJpy)}</dd></div>
      <div><dt>金額自体が未算定</dt><dd>{report.unknownBases.length}基礎（小計に含めません）</dd></div>
    </dl>
    {report.items.map((item) => <details key={item.contributionId}>
      <summary>{item.label} / {amount(item.amountJpy)} / {treatmentCandidateLabels[item.candidate]}</summary>
      <p>当年候補 {amount(item.currentYearExpenseJpy)} / 将来原価候補 {amount(item.futureCostJpy)}</p>
      {item.status === 'stale' && <p role="status">確認した費用や根拠が変わっています。古い条件で金額を確定していません。</p>}
      {item.reasons.map((reason, index) => <p key={'r' + index}>{reason}</p>)}
      {item.missingFacts.map((missing, index) => <p key={'m' + index}>確認事項：{missing}</p>)}
      <p>出典：{item.sourceIds.join('、')}</p>
      <p>費用配分ID：{item.contributionId} / 処理条件ID：{item.factsId ?? '未登録'}</p>
    </details>)}
    {report.unknownBases.map((basis) => <p key={basis.basisId}>未算定の費用基礎：{basis.basisId} / {basis.reasons.join(' / ')}</p>)}
    {!!report.orphanFactIds.length && <p>現在の最終配分に対応しない条件があります。自動削除していません：{report.orphanFactIds.join('、')}</p>}
    <AnnualMethodComparisonPanel reports={report.methodComparisons} />
  </article>
}
