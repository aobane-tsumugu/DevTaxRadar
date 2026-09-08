import type { DirectCostRecord } from '../../planning/types'
import { validIsoCalendarDate } from '../../core/chargePeriods'

export default function DirectAllocationPanel({
  year,
  costs,
  units,
}: {
  year: number
  costs: DirectCostRecord[]
  units: { id: string; name: string }[]
}) {
  const rows = costs.filter(
    (cost) => !validIsoCalendarDate(cost.incurredOn) || cost.incurredOn.startsWith(year + '-'),
  )
  const name = (id: string) =>
    (units.find((unit) => unit.id === id)?.name || '名称未収録') + ' / 制作物ID ' + id
  return (
    <section aria-label="直接費の配分根拠">
      <h3>直接費の配分根拠</h3>
      {!rows.length && (
        <p>
          この資料には対象年の直接費がありません。該当なしの確認を意味せず、現在の入力から補完しません。
        </p>
      )}
      {rows.map((cost) => (
        <article key={cost.id}>
          <h4>
            {cost.incurredOn} /{' '}
            {
              {
                outsource: '外注費',
                material: '材料費',
                cloud: 'クラウド利用料',
                domain: 'ドメイン',
                license: 'ライセンス',
                'old-version-balance': '旧版から引き継ぐ残高',
                other: 'その他の直接費',
              }[cost.costType]
            }{' '}
            / 費用ID {cost.id}
          </h4>
          {!validIsoCalendarDate(cost.incurredOn) && (
            <p>発生日が実在する日付ではないため、年度帰属は未確認です。</p>
          )}
          <p>
            記録額:{' '}
            {cost.amountJpy === null ? '不明' : cost.amountJpy.toLocaleString('ja-JP') + '円'}
            {cost.amountJpy === null && ' / 理由: ' + (cost.unknownAmountReason || '未収録')}
          </p>
          {cost.costType === 'old-version-balance' && (
            <p>旧版残高は新規の支払ではありません。元の採用版と振替先の照合が必要です。</p>
          )}
          <p>メモ: {cost.note || '未収録'}</p>
          {cost.treatment === 'general' ? (
            <p>通常業務に対応します。</p>
          ) : cost.targets !== undefined ? (
            <>
              {!cost.targets.length ? (
                <p>制作物対応先なし。全額未配分です。</p>
              ) : (
                <ul>
                  {cost.targets.map((target) => (
                    <li key={target.taxUnitId}>
                      {name(target.taxUnitId)} / 割合:{' '}
                      {target.shareBps === null ? '未確認' : target.shareBps / 100 + '%'}
                    </li>
                  ))}
                </ul>
              )}
              <p>未確認の割合は推定しません。残額は未配分です。</p>
            </>
          ) : cost.directlyAttributable && cost.treatment === 'direct' && cost.taxUnitId ? (
            <p>全額を {name(cost.taxUnitId)} に直接対応します。</p>
          ) : (
            <p>直接対応または対応先が未確認のため、未配分です。</p>
          )}
          <p>
            入力した条件の記録です。算定可否と端数調整後の対応額は、この資料の費用明細を参照してください。
          </p>
        </article>
      ))}
    </section>
  )
}
