import type { BalanceFlowCheck } from '../../core/balanceFlowLinks'
import type { BalanceSnapshot } from '../../accounting/types'
import type { AnnualCostProjection } from '../../accounting/costs'
import { costLotLabel, describeCostLots } from '../../core/costLotLabel'

export default function BalanceFlowPanel({
  check,
  snapshot,
  costs = [],
}: {
  check?: BalanceFlowCheck
  snapshot?: BalanceSnapshot
  costs?: AnnualCostProjection[]
}) {
  const descriptions = describeCostLots(costs)
  const yen = (amount: number | null) =>
    amount === null ? '照合不能' : amount.toLocaleString('ja-JP') + '円'
  const name = (id: string) =>
    (snapshot?.accounts.find((row) => row.id === id)?.name || '名称未収録') + ' / 残高ID ' + id
  return (
    <section aria-label="残高移動の対応元の照合">
      <h3>残高移動の対応元の照合</h3>
      {!check ? (
        <p>この資料には照合結果が未収録です。現在の入力から補完しません。</p>
      ) : (
        <>
          <p>
            {check.status === 'invalid'
              ? '対応元に不整合があります。修正するまで採用できません。'
              : check.status === 'incomplete'
                ? '対応元が未指定の移動額があります。未対応として残しています。'
                : '記録した残高段階間の金額対応に不整合はありません。'}
          </p>
          <p>
            期首の原価内訳・税務条件の確認ではありません。複数原価を含む残高の一部を使う場合の内訳は推測しません。
          </p>
          {check.issues.length > 0 && (
            <ul>
              {check.issues.map((issue, index) => (
                <li key={index}>
                  移動ID {issue.movementId}: {issue.message}
                </li>
              ))}
            </ul>
          )}
          {check.uses.map((row) => {
            const movement = snapshot?.movements.find((m) => m.id === row.movementId)
            return (
              <article key={row.movementId}>
                <h4>
                  {movement?.occurredOn || '日付未収録'} /{' '}
                  {movement
                    ? {
                        addition: '増加',
                        expense: '費用化',
                        reduction: 'その他減少',
                        transfer: '振替',
                      }[movement.kind]
                    : '移動'}{' '}
                  / 移動ID {row.movementId}
                </h4>
                <p>
                  移動額 {yen(row.amountJpy)} / 対応額 {yen(row.linkedJpy)} / 未対応額{' '}
                  {yen(row.unlinkedJpy)}
                </p>
                <ul>
                  {movement?.balanceAllocations?.map((link) => (
                    <li key={link.sourceKind + ':' + link.sourceId}>
                      {link.sourceKind === 'opening' ? '期首' : '増加・振替受入'} / 対応元ID{' '}
                      {link.sourceId} / {yen(link.amountJpy)}
                      {link.costAllocations !== undefined && (
                        <>
                          <p>原価内訳: 明示指定。未指定の残りは原価未追跡です。</p>
                          <ul>
                            {link.costAllocations.map((lot) => (
                              <li key={JSON.stringify([lot.costYear, lot.contributionId])}>
                                {costLotLabel(lot, descriptions)} / 使用額 {yen(lot.amountJpy)}
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </article>
            )
          })}
          <details>
            <summary>対応元ごとの使用額と残り</summary>
            {check.sources.map((source) => (
              <p key={source.sourceKind + ':' + source.sourceId}>
                {name(source.accountId)} /{' '}
                {source.sourceKind === 'opening' ? '期首' : '増加・振替受入'} / 対応元ID{' '}
                {source.sourceId} / 元額 {yen(source.amountJpy)} / 使用額 {yen(source.claimedJpy)} /
                残り {yen(source.remainingJpy)}
              </p>
            ))}
          </details>
        </>
      )}
    </section>
  )
}
