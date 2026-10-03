import type { OriginalChargeFact } from '../planning/originalCharges.js'
const text = (value: string) => value.replace(/\r?\n/g, ' ').replace(/([\\`*_[\]<>#|])/g, '\\$1')
/** Renders only supplied frozen facts. It never reads the live workspace. */
export function originalChargeMarkdown(fact: OriginalChargeFact): string[] {
  const value = fact.original
  const lines = [
    `  - 原始請求事実: ${text(fact.id)} / 元費用: ${text(fact.sourceId)} / 記録日時: ${text(fact.recordedAt)}`,
    `  - 原通貨額: ${text(value.currency ?? '通貨不明')} ${text(value.amount ?? '金額不明')} / 採用円額: ${value.amountJpy === null ? '不明' : value.amountJpy + '円'}`,
    `  - 入力経路: ${fact.provenance.kind} / 証拠: ${fact.evidenceIds.map(text).join('、') || '未登録'}`,
  ]
  if (fact.document)
    lines.push(
      `  - 発行元: ${text(fact.document.issuer ?? '未確認')} / 請求書番号: ${text(fact.document.invoiceNumber ?? '未確認')}`,
    )
  if (value.unknownAmountReason)
    lines.push(`  - 原通貨額不明の理由: ${text(value.unknownAmountReason)}`)
  if (value.unknownJpyReason) lines.push(`  - 円額不明の理由: ${text(value.unknownJpyReason)}`)
  const dates = {
    billedOn: '請求日',
    paidOn: '支払日',
    acquiredOn: '取得日',
    incurredOn: '発生日',
  } as const
  for (const [key, label] of Object.entries(dates)) {
    const date = fact.dates?.[key as keyof typeof dates]
    if (date) lines.push(`  - ${label}: ${date}`)
  }
  if (fact.servicePeriod)
    lines.push(
      `  - 請求上の利用期間: ${fact.servicePeriod.startedOn} ～ ${fact.servicePeriod.endedOn}`,
    )
  if (fact.contract)
    lines.push(
      `  - 契約: ${text(fact.contract.reference)} / 理由: ${text(fact.contract.reason ?? '未記入')}`,
    )
  if (value.fx)
    lines.push(
      `  - 換算根拠: ${text(value.fx.currency)} ${text(value.fx.foreignAmount)} × ${text(value.fx.jpyPerUnit)}円 / ${value.fx.rounding} / ${value.fx.convertedOn} / ${text(value.fx.reference)}`,
    )
  if (value.conversionEvidenceIds?.length)
    lines.push(`  - 換算の証拠: ${value.conversionEvidenceIds.map(text).join('、')}`)
  if (fact.provenance.sourceKey)
    lines.push(
      `  - 取込元キー: ${text(fact.provenance.sourceKey)} / 内容hash: ${text(fact.provenance.contentHash ?? '')}`,
    )
  if (fact.correctsId || fact.legacySourceId)
    lines.push(
      `  - 訂正元: ${text(fact.correctsId ?? fact.legacySourceId!)} / 訂正理由: ${text(fact.correctionReason ?? '')}`,
    )
  return lines
}
