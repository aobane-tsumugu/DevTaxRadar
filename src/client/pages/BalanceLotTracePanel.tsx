import type { BalanceLotTrace } from '../../core/balanceLotTrace'
import type { AnnualCostProjection } from '../../accounting/costs'
import { costLotLabel, describeCostLots } from '../../core/costLotLabel'

export default function BalanceLotTracePanel({
  trace,
  costs = [],
}: {
  trace?: BalanceLotTrace
  costs?: AnnualCostProjection[]
}) {
  const descriptions = describeCostLots(costs)
  const yen = (n: number | null) => (n === null ? '内訳未確定' : n.toLocaleString('ja-JP') + '円')
  return (
    <section aria-label="残高から元費用への追跡">
      <h3>残高から元費用への追跡</h3>
      {!trace ? (
        <p>この保存版には原価追跡が未収録です。現在の入力から補完しません。</p>
      ) : (
        <>
          <p>
            {trace.year}年 /{' '}
            {trace.status === 'invalid'
              ? '対応元に不整合があるため追跡できません。'
              : trace.status === 'incomplete'
                ? '元費用まで追えない金額・内訳があります。'
                : '記録した移動と残りの原価内訳を追跡できています。'}
          </p>
          <p>
            明示された原価内訳と、一意に決まる単一原価の一部使用・内訳全体の移動を追跡します。未指定の混在原価、期首の原価由来、税務上の扱いは自動確定しません。段階ごとの金額を足し合わせないでください。
          </p>
          {trace.issues.map((issue, i) => (
            <p key={i}>
              移動ID {issue.movementId}: {issue.message}
            </p>
          ))}
          <details>
            <summary>移動ごとの元費用</summary>
            {trace.movements.map((row) => (
              <article key={row.movementId}>
                <h4>移動ID {row.movementId}</h4>
                <p>
                  移動額 {yen(row.amountJpy)} / 原価未追跡 {yen(row.untracedJpy)}
                </p>
                {row.lots.map((lot) => (
                  <p key={JSON.stringify([lot.costYear, lot.contributionId])}>
                    {costLotLabel(lot, descriptions)} / {yen(lot.amountJpy)}
                  </p>
                ))}
              </article>
            ))}
          </details>
          <details>
            <summary>残っている元費用</summary>
            {trace.remaining.map((row) => (
              <article key={JSON.stringify([row.sourceKind, row.sourceId])}>
                <h4>
                  {row.sourceKind === 'opening' ? '期首' : '増加・振替受入'} / 対応元ID{' '}
                  {row.sourceId} / 残高ID {row.accountId}
                </h4>
                <p>
                  残額 {yen(row.amountJpy)} / 原価未追跡 {yen(row.untracedJpy)}
                </p>
                {row.lots.map((lot) => (
                  <p key={JSON.stringify([lot.costYear, lot.contributionId])}>
                    {costLotLabel(lot, descriptions)} / 受入時 {yen(lot.amountJpy)} / 残り{' '}
                    {yen(lot.remainingJpy)}
                  </p>
                ))}
              </article>
            ))}
          </details>
        </>
      )}
    </section>
  )
}
