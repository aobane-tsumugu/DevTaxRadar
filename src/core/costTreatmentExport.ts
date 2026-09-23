import type { CostTreatmentProjection } from './costTreatments.js'
import { treatmentCandidateLabels } from './costTreatmentFacts.js'

const text = (value: string) => value.replace(/[\r\n\t]/g, ' ').replace(/([\\`*_[\]<>#|])/g, '\\$1')
const yen = (value: number | null) =>
  value === null ? '未算定' : value.toLocaleString('ja-JP') + '円'

/** Render the supplied version only, including older records where this layer is absent. */
export function costTreatmentMarkdown(report: CostTreatmentProjection | undefined): string {
  if (!report) return ''
  const lines = [
    '### 登録した事実に基づく処理候補',
    '',
    `対象年: ${report.year} / 計算版: ${report.engineVersion}`,
    '',
    '条件付きの候補です。採用済みの費用・残高ではなく、税務上の適用確認や自動記帳は行っていません。費用基礎や記録した残高と重ねて加算しないでください。',
    `- 当年費用候補の算定済み分: ${yen(report.totals.currentYearExpenseCandidateJpy)}`,
    `- 将来原価候補の算定済み分: ${yen(report.totals.futureCostCandidateJpy)}`,
    `- 金額は既知だが処理は未算定: ${yen(report.totals.unresolvedKnownJpy)}`,
    `- 私用として配分済み: ${yen(report.totals.excludedJpy)}`,
    `- 金額自体が未算定: ${report.unknownBases.length}基礎（小計に含めません）`,
    '',
  ]
  for (const item of report.items) {
    lines.push(
      `- ${text(item.label)} / ${text(item.contributionId)} / 対象額 ${yen(item.amountJpy)}`,
      `  - ${treatmentCandidateLabels[item.candidate]} / 状態 ${item.status}`,
      `  - 当年候補 ${yen(item.currentYearExpenseJpy)} / 将来原価候補 ${yen(item.futureCostJpy)}`,
      `  - 出典: ${item.sourceIds.map(text).join('、')} / 処理条件ID: ${text(item.factsId ?? '未登録')}`,
    )
    for (const reason of item.reasons) lines.push('  - 理由: ' + text(reason))
    for (const missing of item.missingFacts) lines.push('  - 確認事項: ' + text(missing))
  }
  for (const basis of report.unknownBases)
    lines.push(`- 未算定の費用基礎 ${text(basis.basisId)}: ${basis.reasons.map(text).join(' / ')}`)
  if (report.orphanFactIds.length)
    lines.push('現在の最終配分に対応しない処理条件: ' + report.orphanFactIds.map(text).join('、'))
  for (const comparison of report.methodComparisons ?? []) {
    lines.push(
      '',
      '### 方法別の条件付き年次比較',
      '',
      `条件ID: ${text(comparison.ownerFactsId)} / 資産全体額: ${yen(comparison.amountJpy)} / 状態: ${comparison.status}`,
      '各方法は排他的な比較案です。全方法を合算せず、候補小計・採用済み残高へも加算しません。将来の継続利用等は入力された仮定で、税額・適用認定ではありません。',
    )
    for (const reason of comparison.reasons) lines.push('- ' + text(reason))
    for (const scenario of comparison.scenarios) {
      lines.push('', `#### ${text(scenario.method)} / ${scenario.status}`)
      for (const reason of scenario.reasons) lines.push('- ' + text(reason))
      for (const year of scenario.years ?? [])
        lines.push(
          `- ${year.year}年（仮定）: 期首 ${yen(year.openingJpy)} / 取得 ${yen(year.additionsJpy)} / 費用 ${yen(year.expenseJpy)} / 期末 ${yen(year.closingJpy)}`,
        )
      if (!scenario.years) lines.push('未算定。0円として補完していません。')
    }
    for (const url of comparison.sourceUrls) lines.push('- 条件の参照先: ' + text(url))
  }
  return lines.join('\n') + '\n'
}
