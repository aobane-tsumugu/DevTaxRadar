import type { EquipmentAnnualCalculation } from '../../core/equipmentAnnualCalculation'
import type { EquipmentCarryCheck } from '../../core/equipmentCarryCheck'
const yen = new Intl.NumberFormat('ja-JP', {
  style: 'currency',
  currency: 'JPY',
  maximumFractionDigits: 0,
})
export default function EquipmentCalculationsPanel({
  rows,
  carry,
}: {
  rows: EquipmentAnnualCalculation[] | undefined
  carry?: EquipmentCarryCheck
}) {
  return (
    <section aria-label="設備全体の年次計算">
      <h3>設備全体の年次計算</h3>
      {carry && (
        <>
          <h4>前年資料との数値照合</h4>
          <p>前年資料ID: {carry.previousReviewId ?? '未登録'}</p>
          <ul>
            {carry.rows.map((row) => (
              <li key={row.equipmentId} role={row.status === 'mismatch' ? 'alert' : undefined}>
                設備ID {row.equipmentId} / 入力 {yen.format(row.enteredJpy)} / 前年計算{' '}
                {row.previousClosingJpy === null ? '未収録' : yen.format(row.previousClosingJpy)}
                <p>{row.reason}</p>
              </li>
            ))}
          </ul>
        </>
      )}
      <p>
        業務割合を掛ける前の条件付き計算です。採用済みの税務残高ではなく、種類別残高へ加算しません。
      </p>
      {rows === undefined ? (
        <p>この資料に構造化した設備計算はありません。現在の入力から補完しません。</p>
      ) : rows.length === 0 ? (
        <p>この年度の設備計算条件は未登録です。</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={row.methodRecordId}>
              <strong>
                {row.taxYear}年 / 設備ID {row.equipmentId}
              </strong>
              {row.result?.calculation ? (
                <p>
                  設備全体の期首・当年取得基礎 {yen.format(row.result.calculation.openingBasisJpy)}{' '}
                  / 普通償却 {yen.format(row.result.calculation.depreciationJpy)} / 期末{' '}
                  {yen.format(row.result.calculation.closingBasisJpy)}
                </p>
              ) : (
                <p>未算定</p>
              )}
              <p>{[...row.inputIssues, ...(row.result?.reasons ?? [])].join(' / ')}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
