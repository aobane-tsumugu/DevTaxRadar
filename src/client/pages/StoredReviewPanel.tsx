import ProductTimelinePanel from './ProductTimelinePanel'
import ConsultationAnswersPanel from './ConsultationAnswersPanel'
import HomeAllocationPanel from './HomeAllocationPanel'
import BalanceFlowPanel from './BalanceFlowPanel'
import BalanceLotTracePanel from './BalanceLotTracePanel'
import OpeningLotCarryPanel from './OpeningLotCarryPanel'
import DirectAllocationPanel from './DirectAllocationPanel'
import type { BalanceReview } from '../../accounting/balanceWorkspace'
import type { AmountState } from '../../accounting/types'
import CostsPage from './CostsPage'
import EquipmentCalculationsPanel from './EquipmentCalculationsPanel'
import EquipmentAllocationPanel from './EquipmentAllocationPanel'
import { reviewExportJson, reviewExportMarkdown } from '../../core/reviewExport'
import { accountantCsvPreview, accountantCsvZip } from '../../core/accountantCsv'
import ExportPreviewButton from './ExportPreviewButton'

const amount = (value: AmountState) =>
  value.status === 'known'
    ? `${value.amountJpy.toLocaleString('ja-JP')}円`
    : `不明（${value.reasons.join(' / ')}）`
export default function StoredReviewPanel({ review }: { review: BalanceReview }) {
  return (
    <section aria-label="保存版の内容">
      <h3>{review.year}年の保存版</h3>
      <p>
        資料ID: {review.id} / 採用日時: {review.createdAt}
      </p>
      <p>採用理由: {review.reason}</p>
      <p>
        訂正元: {review.correctsReviewId ?? 'なし'} / 前年資料:{' '}
        {review.previousReviewId ?? '未接続'}
      </p>
      <p>
        指定した固定版を表示しています。現在の入力から再計算・補完せず、金額を税務上の確定額とは扱いません。
      </p>
      <p>
        汎用転記CSVは費用源・配分・処理候補・残高増減・未解決を別表にします。表どうしを合算しないでください。
        特定会計ソフトの仕訳形式ではありません。名称・理由などの自由記述を確認してから保存し、外部への送信は行いません。
      </p>
      <ExportPreviewButton
        key={review.id}
        label="税理士相談用CSV一式を確認"
        filename={`devtax-${review.year}-${review.id}-accountant-csv.zip`}
        load={async () => ({
          blob: new Blob([new Uint8Array(accountantCsvZip(review))], { type: 'application/zip' }),
          text: accountantCsvPreview(review),
        })}
      />
      <h4>保存時の年度別残高</h4>
      {!review.projection.accounts.length && (
        <p>この年度の残高は未登録です。残高なしの確認ではありません。</p>
      )}
      {review.projection.accounts.map((row) => (
        <div key={row.accountId}>
          <strong>
            {row.name} /{' '}
            {{ construction: '制作中原価', asset: '資産等', prepaid: '前払等' }[row.kind]} / 残高ID{' '}
            {row.accountId}
          </strong>
          <p>
            期首: {amount(row.opening)} / 期末: {amount(row.closing)}
          </p>
          <p>
            増加 {row.additionsJpy}円 / 振替受入 {row.transfersInJpy}円 / 振替払出{' '}
            {row.transfersOutJpy}円 / 費用化 {row.expensesJpy}円 / その他減少 {row.reductionsJpy}円
          </p>
        </div>
      ))}
      <ConsultationAnswersPanel snapshot={review.snapshot} year={review.year} />
      {review.materials ? (
        <>
          {review.materials.productTimeline ? (
            <ProductTimelinePanel
              products={review.materials.productTimeline}
              evidence={review.materials.planning.evidence}
            />
          ) : (
            <p>
              この旧保存版には活動タイムラインの固定資料がありません。現在の入力から補完しません。
            </p>
          )}
          <OpeningLotCarryPanel carry={review.materials.openingLotCarry} />
          <BalanceFlowPanel
            check={review.materials.balanceFlowCheck}
            snapshot={review.snapshot}
            costs={review.materials.costLinks?.costs ?? [review.materials.costs]}
          />
          <BalanceLotTracePanel
            trace={review.materials.balanceLotTrace}
            costs={review.materials.costLinks?.costs ?? [review.materials.costs]}
          />
          <CostsPage
            key={review.id}
            initial={review.materials.costs}
            evidence={review.materials.planning.evidence}
            recordState="recorded"
            local
            readOnly
            onEdit={() => {}}
          />
          <HomeAllocationPanel
            year={review.year}
            costs={review.materials.planning.homeCosts}
            units={review.materials.planning.taxUnits}
          />
          <DirectAllocationPanel
            year={review.year}
            costs={review.materials.planning.directCosts}
            units={review.materials.planning.taxUnits}
          />
          <EquipmentAllocationPanel
            year={review.year}
            methods={review.materials.planning.equipmentMethods}
            equipment={review.materials.planning.equipment}
            taxUnits={review.materials.planning.taxUnits}
          />
          <EquipmentCalculationsPanel
            rows={review.materials.equipmentCalculations}
            carry={review.materials.equipmentCarryCheck}
          />
        </>
      ) : (
        <p>旧版のため当時の費用・判断・利用量は含まれません。現在の入力から補完しません。</p>
      )}
      <details>
        <summary>判断・未解決事項・根拠を含む全説明を読む</summary>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {reviewExportMarkdown(review)}
        </pre>
      </details>
      <details>
        <summary>完全な保存データを確認する</summary>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {reviewExportJson(review)}
        </pre>
      </details>
    </section>
  )
}
