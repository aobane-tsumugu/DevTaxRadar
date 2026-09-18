import { costTreatmentMarkdown } from './costTreatmentExport.js'
import type { AnnualCostProjection, CostTarget } from '../accounting/costs.js'

// Free text stays readable but cannot introduce headings, HTML or hidden links.
function text(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/([\\`*_[\]<>#|])/g, '\\$1')
}

export function costProjectionMarkdown(
  projection: AnnualCostProjection,
  context: 'draft' | 'recorded' = 'draft',
): string {
  const amount = (value: number) => `${value.toLocaleString('ja-JP')}円`
  const target = (value: CostTarget) =>
    value.kind === 'tax-unit'
      ? (projection.byTaxUnit.find((unit) => unit.taxUnitId === value.taxUnitId)?.name ??
        value.taxUnitId)
      : {
          general: '通常業務',
          private: '私用',
          unallocated: '未配分・配分未算定',
          unobserved: '捕捉外の利用',
          rounding: '端数調整',
        }[value.kind]
  const lines = [
    '## 全費用の原額・費用基礎・配分',
    '',
    `対象年: ${projection.year}年 / 計算版: ${projection.engineVersion} / データ形式: ${projection.version}`,
    '',
    context === 'recorded'
      ? 'この年度資料に固定した費用基礎と配分です。税務上の当年費用・資産残高と同一ではありません。'
      : '作業中の費用資料です。採用済みの記録版、税務上の当年費用、資産残高ではありません。',
    '',
    `- 算定済みの費用基礎: ${amount(projection.totals.knownBasisJpy)}`,
    `- 制作物へ対応: ${amount(projection.totals.taxUnitJpy)}`,
    `- 通常業務: ${amount(projection.totals.generalJpy)}`,
    `- 私用: ${amount(projection.totals.privateJpy)}`,
    `- 未配分・配分未算定: ${amount(projection.totals.unallocatedJpy)}`,
    `- 捕捉外の利用: ${amount(projection.totals.unobservedJpy)}`,
    `- 端数調整: ${amount(projection.totals.roundingJpy)}`,
    `- 費用基礎が未算定: ${projection.totals.unknownBasisIds.length}件（上の金額に含めない）`,
    '',
    '対応先の合計は算定済みの費用基礎に一致。購入原額や組入れ元を二重に加算しません。',
    '',
    '### 制作物ごとの算定済み分',
    '',
  ]
  for (const unit of projection.byTaxUnit)
    lines.push(
      `- ${text(unit.name)}: ${amount(unit.amountJpy)} / 関連する未算定 ${unit.unknownBasisIds.length}件`,
    )
  lines.push('', '### 費用源', '')
  for (const source of projection.sources) {
    lines.push(
      `- ${text(source.label)} / 原額 ${source.originalAmountJpy === null ? '不明' : amount(source.originalAmountJpy)} / 種類 ${source.kind}`,
      `  - 費用源ID: ${text(source.id)} / 入力経路: ${source.origin}`,
      `  - 証拠参照ID: ${source.evidenceIds.map(text).join('、') || '未登録'}`,
    )
    for (const reason of source.unknownOriginalAmountReasons ?? [])
      lines.push(`  - 原額が不明な理由: ${text(reason)}`)
    if (source.servicePeriod)
      lines.push(
        `  - 利用期間: ${source.servicePeriod.startedOn} ～ ${source.servicePeriod.endedOn}`,
      )
    if (source.incurredOn) lines.push(`  - 発生日: ${source.incurredOn}`)
    if (source.acquiredOn) lines.push(`  - 取得日: ${source.acquiredOn}`)
    if (source.billedOn) lines.push(`  - 請求日: ${source.billedOn}`)
    if (source.paidOn) lines.push(`  - 支払日: ${source.paidOn}`)
    for (const adjustment of source.adjustments ?? []) {
      const effect = { 'restate-original-cost': '元費用の対象期間を訂正', 'balance-reduction': '残高減少へ対応', undetermined: '扱い未判断' }[adjustment.effect]
      lines.push(`  - ${adjustment.kind === 'refund' ? '返金' : '訂正'} ${amount(adjustment.amountJpy)} / ${adjustment.occurredOn} / ${effect} / 記録ID ${text(adjustment.id)}`)
      lines.push(`    - 対象・理由: ${text(adjustment.reason)} / 証拠: ${adjustment.evidenceIds.map(text).join('、')}`)
      if (adjustment.balanceMovementId) lines.push(`    - 対応する残高減少: ${text(adjustment.balanceMovementId)}`)
      if (adjustment.conversion) {
        const conversion = adjustment.conversion
        lines.push(`    - 換算: ${text(conversion.currency)} ${text(conversion.foreignAmount)} × ${text(conversion.jpyPerUnit)}円 / ${conversion.rounding} / ${conversion.convertedOn} / ${text(conversion.reference)}`)
      }
      lines.push('    - 原額は保持しています。受領年の税務処理や過去の採用資料を自動変更しません。')
    }
  }
  lines.push('', '### 費用基礎と寄与', '')
  for (const basis of projection.bases) {
    lines.push(
      `- ${text(basis.id)} / ${basis.period.startedOn} ～ ${basis.period.endedOn}: ${basis.amount.status === 'known' ? amount(basis.amount.amountJpy) : '未算定'}`,
      `  - 費用源ID: ${basis.sourceId ? text(basis.sourceId) : '親の寄与から組入れ'}`,
      `  - 方法: ${text(basis.method.id)} / ${text(basis.method.version)} / ${text(basis.method.explanation)}`,
    )
    if (basis.amount.status === 'unknown')
      for (const reason of basis.amount.reasons) lines.push(`  - 未算定の理由: ${text(reason)}`)
    for (const warning of basis.warnings) lines.push(`  - 要確認: ${text(warning)}`)
    if (basis.parentContributionIds.length)
      lines.push(`  - 親の寄与ID: ${basis.parentContributionIds.map(text).join('、')}`)
    for (const item of projection.contributions.filter((item) => item.basisId === basis.id))
      lines.push(
        `  - ${text(target(item.target))}: ${amount(item.amountJpy)} / ${text(item.reason)}`,
        `    - 寄与ID: ${text(item.id)} / 出典: ${item.sourceIds.map(text).join('、')}${item.consumedByBasisId ? ` / ${text(item.consumedByBasisId)}へ組入れ済み（合計に二重加算しない）` : ''}`,
      )
  }
  return lines.join('\n') + '\n' + costTreatmentMarkdown(projection.treatments)
}
