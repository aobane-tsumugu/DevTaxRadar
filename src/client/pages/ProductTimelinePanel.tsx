import type { ProductTimeline } from '../../core/productTimeline'
import type { PlanningSnapshot } from '../../planning/types'
import { yen } from './shared'

export default function ProductTimelinePanel({
  products,
  evidence = [],
  onCosts,
  onBalances,
}: {
  products: ProductTimeline
  evidence?: PlanningSnapshot['evidence']
  onCosts?: (year?: number, contributionId?: string) => void
  onBalances?: (year?: number) => void
}) {
  return (
    <section className="product-timeline" aria-label="制作物の全期間タイムライン">
      <p>
        期間は並行して記録します。旧版の利用、改良、新規開発は排他的ではありません。公開・販売から供用日や所得区分を決めず、中止・終了から費用化や残高振替を行いません。
      </p>
      {!products.length && <p>制作物の記録はありません。利用履歴が0件でも登録できます。</p>}
      {products.map((product) => (
        <article className="panel" key={product.id}>
          <h3>{product.name}</h3>
          <p>
            制作物ID：{product.id}
            {product.legacy && ' / 旧費用単位からの表示（制作物の関係は未登録）'}
          </p>
          <p>
            費用資料の収録年：{product.costYears?.join('・') || 'なし'}
            。活動事実は全期間です。収録年以外の費用がないという意味ではありません。
          </p>
          <p>
            費用単位：
            {product.units.map((unit) => `${unit.name}（${unit.id}）`).join(' / ') ||
              '未接続。後から既存の費用単位を同じ制作物へ結べます。'}
          </p>
          {!product.entries.length && (
            <p>活動事実は未登録です。活動がなかったという意味ではありません。</p>
          )}
          <ol className="timeline-entries">
            {product.entries.map((row) => (
              <li key={row.id} id={`activity-${encodeURIComponent(row.id)}`}>
                <h4>
                  {row.time}　{row.title}
                </h4>
                <p>
                  {row.state} / 対象：{row.taxUnitId ?? '制作物全体'} / {row.scope}
                </p>
                {row.correctedById && (
                  <p>
                    訂正済みの元記録 →{' '}
                    <a href={`#activity-${encodeURIComponent(row.correctedById)}`}>
                      {row.correctedById}
                    </a>
                  </p>
                )}
                {row.correctsId && (
                  <p>
                    訂正元：
                    <a href={`#activity-${encodeURIComponent(row.correctsId)}`}>
                      {row.correctsId}
                    </a>{' '}
                    / {row.correctionReason}
                  </p>
                )}
                <p>{row.reason}</p>
                <p>
                  記録日時：{row.recordedAt ?? '旧記録に記録日時なし'} / ID：{row.id}
                </p>
                <details>
                  <summary>根拠と関連費用（{row.costs.length}件）</summary>
                  {row.evidenceIds.length ? (
                    row.evidenceIds.map((id) => (
                      <p key={id}>
                        根拠 {id}：
                        {evidence.find((item) => item.id === id)?.note ?? '本文はこの資料に未収録'}
                      </p>
                    ))
                  ) : (
                    <p>根拠は未指定</p>
                  )}
                  <p>
                    対象・期間が重なる費用の参考表示です。この事実による税務処理の確定や全額対応を意味しません。
                  </p>
                  {row.costs.map((cost) => (
                    <p key={`${cost.year}:${cost.contributionId}`}>
                      {cost.year}年 {cost.amountJpy === null ? '不明' : yen.format(cost.amountJpy)}{' '}
                      / 配分 {cost.contributionId} / 費用基礎 {cost.basisId} / 原額参照{' '}
                      {cost.sourceIds.join(', ')}
                      {onCosts && (
                        <button
                          type="button"
                          onClick={() => onCosts(cost.year, cost.contributionId)}
                        >
                          この年・配分の根拠を開く
                        </button>
                      )}
                    </p>
                  ))}
                  {onCosts && (
                    <button type="button" onClick={() => onCosts()}>
                      支払・配分・処理条件を確認
                    </button>
                  )}
                </details>
              </li>
            ))}
          </ol>
          <details>
            <summary>費用・残高・判断のつながり</summary>
            <p>原額・費用基礎・配分・残高は別の段階です。合計して経費にはしません。</p>
            {product.costs.map((cost) => (
              <p key={`${cost.year}:${cost.contributionId}`}>
                {cost.year}年 / 配分 {cost.contributionId} / 基礎 {cost.basisId} /{' '}
                {cost.amountJpy === null ? '不明' : yen.format(cost.amountJpy)}
              </p>
            ))}
            {product.unknownCosts?.map((cost) => (
              <p key={`${cost.year}:${cost.basisId}`}>
                {cost.year}年 / 費用基礎 {cost.basisId} / 金額不明：{cost.reasons.join(' / ')}
              </p>
            ))}
            {product.movements?.map((movement) => (
              <p key={movement.id}>
                残高増減 {movement.occurredOn} / {movement.id} / {movement.kind} /{' '}
                {yen.format(movement.amountJpy)} / 判断 {movement.decisionId} / 原価参照{' '}
                {movement.sourceIds.join(', ')}
              </p>
            ))}
            {product.accounts.map((account) => (
              <p key={account.id}>
                残高 {account.name} / {account.id} / {account.openingYear}年期首{' '}
                {account.opening.status === 'known'
                  ? yen.format(account.opening.amountJpy)
                  : '不明'}
              </p>
            ))}
            {product.decisions.map((decision) => (
              <p key={decision.id}>
                {decision.taxYear}年 判断 {decision.id} / {decision.status} / {decision.reason}
              </p>
            ))}
            {product.pending.map((pending) => (
              <p key={pending.id}>
                {pending.taxYear}年 保留 {pending.id} /{' '}
                {pending.amount.status === 'known'
                  ? yen.format(pending.amount.amountJpy)
                  : '金額不明'}{' '}
                / {pending.reasons.join(' / ')}
                {onBalances && (
                  <button type="button" onClick={() => onBalances(pending.taxYear)}>
                    この年の保留を開く
                  </button>
                )}
              </p>
            ))}
            {onCosts && (
              <button type="button" onClick={() => onCosts()}>
                費用と判断候補を開く
              </button>
            )}
            {onBalances && (
              <button type="button" onClick={() => onBalances()}>
                残高・採用済み資料・訂正の影響を確認
              </button>
            )}
          </details>
        </article>
      ))}
    </section>
  )
}
