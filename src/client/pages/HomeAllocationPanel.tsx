import type { HomeCostRecord } from '../../planning/types'

export default function HomeAllocationPanel({
  year,
  costs,
  units,
}: {
  year: number
  costs: HomeCostRecord[]
  units: { id: string; name: string }[]
}) {
  const rows = costs.filter((cost) => cost.month.startsWith(year + '-'))
  const targetName = (id: string) =>
    (units.find((unit) => unit.id === id)?.name || '名称未収録') + ' / 制作物ID ' + id
  return (
    <section aria-label="自宅費用の配分根拠">
      <h3>自宅費用の配分根拠</h3>
      {!rows.length && (
        <p>
          この資料には対象年の自宅費用がありません。該当なしの確認を意味せず、現在の入力から補完しません。
        </p>
      )}
      {rows.map((cost) => (
        <article key={cost.id}>
          <h4>
            {cost.month} / {{ rent: '家賃', electricity: '電気', internet: '通信' }[cost.category]}{' '}
            / 費用ID {cost.id}
          </h4>
          <p>
            支払原額:{' '}
            {cost.amountJpy === null ? '不明' : cost.amountJpy.toLocaleString('ja-JP') + '円'}
            {cost.amountJpy === null && ' / 理由: ' + (cost.unknownAmountReason || '未収録')}
          </p>
          <p>
            業務割合: {cost.businessUseRatio * 100}% / 計算根拠: {cost.basis || '未確認'} /
            採用理由: {cost.rationale || '未確認'}
          </p>
          {cost.treatment === 'general' ? (
            <p>業務分は通常業務に対応します。</p>
          ) : cost.targets !== undefined ? (
            <>
              {!cost.targets.length ? (
                <p>制作物対応先なし。業務分は未配分です。</p>
              ) : (
                <ul>
                  {cost.targets.map((target) => (
                    <li key={target.taxUnitId}>
                      {targetName(target.taxUnitId)} / 業務分の割合:{' '}
                      {target.shareBps === null ? '未確認' : target.shareBps / 100 + '%'}
                    </li>
                  ))}
                </ul>
              )}
              <p>未確認の割合は推定しません。残りの業務額は未配分です。</p>
            </>
          ) : (
            <p>
              制作物対応先: {cost.taxUnitId ? targetName(cost.taxUnitId) : '未確認・未配分'} /
              業務分の制作物割合: {cost.projectAllocationRatio * 100}%
            </p>
          )}
          <p>
            入力した条件の記録です。算定可否・私用額・端数調整後の対応額は、この資料の費用明細を参照してください。
          </p>
        </article>
      ))}
    </section>
  )
}
