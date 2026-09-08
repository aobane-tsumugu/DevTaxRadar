import { useEffect, useState } from 'react'
import type { BalanceReview } from '../../accounting/balanceWorkspace'
import { getBalanceReviews, getBalanceReview } from '../api'
import { yen } from './shared'
import ReviewComparisonAction from './ReviewComparisonAction'

export default function AnnualReviewSummary({
  year,
  local,
  onOpenBalances,
}: {
  year: number
  local: boolean
  onOpenBalances: () => void
}) {
  const [refresh, setRefresh] = useState(0)
  const [state, setState] = useState<{
    year: number
    review?: BalanceReview
    changed?: boolean
    error?: string
    loading: boolean
  }>({ year, loading: true })
  useEffect(() => {
    let active = true
    if (!local)
      return () => {
        active = false
      }
    setState({ year, loading: true })
    void (async () => {
      try {
        const list = await getBalanceReviews()
        const records = list.reviews.filter((row) => row.year === year && row.active)
        if (records.length > 1)
          throw new Error('同じ年の採用版を一つに特定できません。残高画面で確認してください。')
        const head = records[0]
        const review = head ? (await getBalanceReview(head.id)).review : undefined
        if (
          review &&
          (review.id !== head!.id || review.year !== year || review.projection.year !== year)
        )
          throw new Error('対象年と取得した資料が一致しません。読み直してください。')
        if (active) setState({ year, review, changed: head?.previousYearChanged, loading: false })
      } catch (cause) {
        if (active)
          setState({
            year,
            loading: false,
            error: cause instanceof Error ? cause.message : '採用済み資料を取得できませんでした。',
          })
      }
    })()
    return () => {
      active = false
    }
  }, [year, local, refresh])
  if (!local) return null
  const current = state.year === year ? state : { year, loading: true }
  const review = current.review
  return (
    <section className="panel cost-overview" aria-label="対象年の採用済み記録">
      <h2>{year}年の採用済み記録</h2>
      <p>
        一覧を読み込んだ時点の採用版です。上の作業中の費用基礎とは別の資料で、現在の入力との一致を示すものではありません。
      </p>
      {current.loading ? (
        <p role="status">採用済み資料を確認しています。</p>
      ) : current.error ? (
        <p role="alert">資料を取得できませんでした：{current.error}</p>
      ) : !review ? (
        <p>この年の採用済み年度資料はありません。費用や残高が0円と確認した状態ではありません。</p>
      ) : (
        <>
          <p>
            資料ID {review.id} / 採用日時 {review.createdAt}
          </p>
          <p>採用・訂正理由：{review.reason}</p>
          <ReviewComparisonAction key={review.id} reviewId={review.id} year={year} />
          {current.changed && (
            <p role="alert">
              前年資料が訂正されています。この版への反映状況を残高画面で確認してください。
            </p>
          )}
          <dl className="cost-totals">
            <div>
              <dt>記録した当年の費用化額</dt>
              <dd>{yen.format(review.projection.totals.expensesJpy)}</dd>
            </div>
            <div>
              <dt>記録した期末残高の既知額</dt>
              <dd>{yen.format(review.projection.totals.knownClosingJpy)}</dd>
            </div>
            <div>
              <dt>金額不明の期末残高</dt>
              <dd>{review.projection.totals.unknownAccountIds.length}件（既知額に含めない）</dd>
            </div>
            <div>
              <dt>残っている未判断事項</dt>
              <dd>{review.projection.pendingDecisions.length}件</dd>
            </div>
          </dl>
          {!review.projection.accounts.length && (
            <p>この資料の残高は未登録です。残高なしの確認ではありません。</p>
          )}
          {review.projection.accounts.map((row) => (
            <p key={row.accountId}>
              {row.name} /{' '}
              {{ construction: '制作中原価', asset: '資産等', prepaid: '前払等' }[row.kind]} / 期末{' '}
              {row.closing.status === 'known'
                ? yen.format(row.closing.amountJpy)
                : '不明：' + row.closing.reasons.join(' / ')}
            </p>
          ))}
          <p>
            記録した費用化・残高の結果です。全費用の税務処理や適用条件が確認済みになったことを意味しません。
          </p>
        </>
      )}
      <button
        className="secondary-button"
        type="button"
        disabled={current.loading}
        onClick={() => setRefresh((value) => value + 1)}
      >
        採用済み記録を読み直す
      </button>{' '}
      <button className="secondary-button" type="button" onClick={onOpenBalances}>
        残高・原価・保存版の差分を確認
      </button>
    </section>
  )
}
