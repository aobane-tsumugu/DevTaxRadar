import type { OriginalChargeFact } from '../../planning/originalCharges'
import { conversionRoundingLabels } from './SourceAdjustmentDetails'
import EvidenceReferences, { type EvidenceExplanation } from './EvidenceReferences'
import { yen } from './shared'

/** This works on fixed adopted material too; never fetch newer source facts. */
export default function OriginalChargeDetails({
  fact,
  evidence,
}: {
  fact?: OriginalChargeFact
  evidence?: readonly EvidenceExplanation[]
}) {
  if (!fact) return null
  const money = fact.original
  return (
    <details className="original-charge-details">
      <summary>原通貨・換算根拠・原始請求の来歴</summary>
      <p>
        原通貨額：{money.currency ?? '通貨不明'} {money.amount ?? '金額不明'} / 採用円額：
        {money.amountJpy === null ? '不明' : yen.format(money.amountJpy)}
      </p>
      {fact.document && (
        <p>
          発行元：{fact.document.issuer ?? '未確認'} / 請求書番号：
          {fact.document.invoiceNumber ?? '未確認'}
        </p>
      )}
      {money.unknownAmountReason && <p>原通貨額不明の理由：{money.unknownAmountReason}</p>}
      {money.unknownJpyReason && <p>円額不明の理由：{money.unknownJpyReason}</p>}
      {money.fx && (
        <p>
          換算根拠：{money.fx.currency} {money.fx.foreignAmount} × {money.fx.jpyPerUnit}円 /{' '}
          {conversionRoundingLabels[money.fx.rounding]} / {money.fx.convertedOn} /{' '}
          {money.fx.reference}
        </p>
      )}
      <EvidenceReferences ids={money.conversionEvidenceIds ?? []} records={evidence} />
      {fact.dates?.billedOn && <p>請求日：{fact.dates.billedOn}</p>}
      {fact.dates?.paidOn && <p>支払日：{fact.dates.paidOn}</p>}
      {fact.dates?.acquiredOn && <p>取得日：{fact.dates.acquiredOn}</p>}
      {fact.dates?.incurredOn && <p>発生日：{fact.dates.incurredOn}</p>}
      {fact.servicePeriod && (
        <p>
          請求上の利用期間：{fact.servicePeriod.startedOn} ～ {fact.servicePeriod.endedOn}
        </p>
      )}
      {fact.contract && (
        <p>
          契約：{fact.contract.reference} / {fact.contract.reason ?? '理由未記入'}
          。重なる請求の契約確認は別に行います。
        </p>
      )}
      <p>
        事実ID：{fact.id} / 入力経路：{fact.provenance.kind} / 記録日時：{fact.recordedAt}
      </p>
      {fact.provenance.sourceKey && (
        <p>
          取込元キー：{fact.provenance.sourceKey} / 内容hash：{fact.provenance.contentHash}
        </p>
      )}
      {(fact.correctsId || fact.legacySourceId) && (
        <p>
          訂正元：{fact.correctsId ?? fact.legacySourceId} / 理由：{fact.correctionReason}
        </p>
      )}
      <p>原始請求の事実です。採用済み年度資料・残高を自動で変更しません。</p>
    </details>
  )
}
