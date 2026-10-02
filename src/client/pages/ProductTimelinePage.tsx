import { useEffect, useState } from 'react'
import { getProductTimeline } from '../api'
import { projectProductTimeline } from '../../core/productTimeline'
import type { PlanningSnapshot } from '../../planning/types'
import type { ProductTimelineView } from '../../server/productTimeline'
import type { AnnualCostProjection } from '../../accounting/costs'
import ProductTimelinePanel from './ProductTimelinePanel'

export default function ProductTimelinePage({
  planning,
  local,
  datasetId,
  onEdit,
  onCosts,
  onBalances,
  costs,
}: {
  planning: PlanningSnapshot
  local: boolean
  datasetId?: string
  onEdit: () => void
  onCosts: (year?: number, contributionId?: string) => void
  onBalances: (year?: number) => void
  costs?: AnnualCostProjection
}) {
  const [view, setView] = useState<ProductTimelineView | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setView(null)
    setError('')
    if (local)
      void getProductTimeline()
        .then((next) => {
          if (!active) return
          if (next.datasetId !== datasetId) {
            setError('接続先が変わりました。画面全体を読み直してください。')
            return
          }
          setView(next)
        })
        .catch((error) => {
          if (active) setError(error instanceof Error ? error.message : '読み込めません。')
        })
    return () => {
      active = false
    }
  }, [local, datasetId, planning, attempt])
  return (
    <>
      <button type="button" onClick={onEdit}>
        制作物・活動事実・訂正を入力
      </button>
      {error ? (
        <div role="alert">
          {error}
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            再読込
          </button>
        </div>
      ) : local && !view ? (
        <p role="status">全期間の記録を読んでいます…</p>
      ) : (
        <>
          <p>
            {view
              ? `保存元 ${view.workspaceRevision}版 / ${view.years[0]}～${view.years.at(-1)}年の作業中の記録`
              : '合成データの例'}
          </p>
          <ProductTimelinePanel
            products={view?.products ?? projectProductTimeline(planning, costs ? [costs] : [])}
            evidence={view?.evidence ?? planning.evidence}
            onCosts={onCosts}
            onBalances={onBalances}
          />
          {view && (
            <details>
              <summary>全期間の記録残高（費用基礎とは別）</summary>
              {view.balances.map((year) => (
                <div key={year.year}>
                  <h4>{year.year}年</h4>
                  {year.accounts.map((row) => (
                    <p key={row.accountId}>
                      {row.name} / {row.accountId} / 期末{' '}
                      {row.closing.status === 'known'
                        ? `${row.closing.amountJpy.toLocaleString('ja-JP')}円`
                        : '不明'}
                    </p>
                  ))}
                </div>
              ))}
            </details>
          )}
        </>
      )}
    </>
  )
}
