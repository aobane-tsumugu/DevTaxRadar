import type { SourceAdjustmentRecord } from '../../core/sourceAdjustments'
import { yen } from './shared'

export const adjustmentEffects = {
  'restate-original-cost': '元費用の対象期間を訂正',
  'balance-reduction': '残高減少へ対応',
  undetermined: '扱い未判断',
} as const

export const conversionRoundingLabels = {
  'nearest-yen': '円未満四捨五入',
  'floor-yen': '円未満切捨て',
  'ceiling-yen': '円未満切上げ',
} as const

/** Read-only rendering also works with an old adopted record, without recomputing it. */
export default function SourceAdjustmentDetails({ records }: { records: readonly SourceAdjustmentRecord[] }) {
  if (!records.length) return null
  return <section aria-label="原額と分けて保存した返金・訂正">
    <h4>原額と分けた返金・訂正</h4>
    {records.map((row) => <article key={row.id}>
      <p>{row.kind === 'refund' ? '返金' : '訂正'} {yen.format(row.amountJpy)} / {row.occurredOn} / {adjustmentEffects[row.effect]}</p>
      <p>{row.reason}</p>
      {row.balanceMovementId && <p>対応する残高減少：{row.balanceMovementId}</p>}
      {row.conversion && <p>換算根拠：{row.conversion.currency} {row.conversion.foreignAmount} × {row.conversion.jpyPerUnit}円 / {conversionRoundingLabels[row.conversion.rounding]} / {row.conversion.convertedOn} / {row.conversion.reference}</p>}
      <details><summary>確認時点の原額・期間と根拠</summary>
        <p>元費用：{row.sourceId} / 参照年：{row.sourceYear} / 記録ID：{row.id}</p>
        <p>確認した原額：{row.sourceBasis.originalAmountJpy === null ? '不明' : yen.format(row.sourceBasis.originalAmountJpy)}</p>
        {row.sourceBasis.servicePeriod && <p>{row.sourceBasis.servicePeriod.startedOn} ～ {row.sourceBasis.servicePeriod.endedOn}</p>}
        {row.sourceBasis.acquiredOn && <p>取得日：{row.sourceBasis.acquiredOn}</p>}
        {row.sourceBasis.incurredOn && <p>発生日：{row.sourceBasis.incurredOn}</p>}
        <p>証拠参照：{row.evidenceIds.join('、')} / 記録日時：{row.recordedAt}</p>
      </details>
    </article>)}
    <p>返金の受領年と元費用の対象年は別です。保存済み年度資料は自動で変更しません。</p>
  </section>
}
