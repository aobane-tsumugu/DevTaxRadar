import type { OpeningLotCarry } from '../../core/openingLotCarry'
import type { AmountState } from '../../accounting/types'

export default function OpeningLotCarryPanel({ carry }: { carry?: OpeningLotCarry }) {
  const amount = (value: AmountState) =>
    value.status === 'known'
      ? value.amountJpy.toLocaleString('ja-JP') + '円'
      : '不明：' + value.reasons.join(' / ')
  return (
    <section aria-label="前年からの原価繰越し">
      <h3>前年からの原価繰越し</h3>
      {!carry ? (
        <p>この資料には原価繰越しの照合が未収録です。現在の資料から補完しません。</p>
      ) : carry.status === 'not-linked' ? (
        <p>直前年度の採用資料が未接続です。期首原価の由来を確認したことにはなりません。</p>
      ) : (
        <>
          <p>
            {carry.year}年 / 前年の採用資料ID {carry.previousReviewId}
          </p>
          <p>
            {carry.status === 'invalid'
              ? '前年原価との繰越しに不整合があります。採用前に確認してください。'
              : carry.status === 'incomplete'
                ? '前年から引き継ぐ原価に未追跡・未収録があります。'
                : '前年の採用期末から当年期首への原価内訳を照合しました。'}
          </p>
          <p>
            過去の増減を保持した台帳の期首説明です。新しい支払・増加を追加する処理ではなく、税務上の適用確認ではありません。名称は前年採用時の資料によります。
          </p>
          {carry.issues.map((issue, i) => (
            <p key={i}>{issue}</p>
          ))}
          {carry.accounts.map((row) => (
            <article key={row.accountId}>
              <h4>
                {row.name} / 残高ID {row.accountId}
              </h4>
              <p>
                前年期末 {amount(row.previousClosing)} / 当年期首 {amount(row.opening)} / 原価未追跡{' '}
                {row.untracedJpy === null
                  ? '未確定'
                  : row.untracedJpy.toLocaleString('ja-JP') + '円'}
              </p>
              {row.lots.map((lot) => (
                <p key={JSON.stringify([lot.costYear, lot.contributionId])}>
                  {lot.label} / 繰越額 {lot.amountJpy.toLocaleString('ja-JP')}円
                </p>
              ))}
            </article>
          ))}
        </>
      )}
    </section>
  )
}
