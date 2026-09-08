import { useEffect, useRef, useState } from 'react'
import { getBalanceReview, getBalanceReviews, getReviewComparison, getReviewImpact } from '../api'
import ReviewComparisonPanel from './ReviewComparisonPanel'
import StoredReviewPanel from './StoredReviewPanel'

export default function ReviewRecordsPanel() {
  const [records, setRecords] = useState<
    Awaited<ReturnType<typeof getBalanceReviews>>['reviews'] | null
  >(null)
  const [error, setError] = useState('')
  const [stored, setStored] = useState<
    Awaited<ReturnType<typeof getBalanceReview>>['review'] | null
  >(null)
  const [busy, setBusy] = useState(false)
  const [impact, setImpact] = useState<Awaited<ReturnType<typeof getReviewImpact>> | null>(null)
  const [comparison, setComparison] = useState<Awaited<
    ReturnType<typeof getReviewComparison>
  > | null>(null)
  const lifetime = useRef({ generation: 0 })
  useEffect(() => {
    const state = lifetime.current
    return () => {
      state.generation++
    }
  }, [])
  async function load() {
    setStored(null)
    const generation = ++lifetime.current.generation
    setBusy(true)
    setError('')
    setComparison(null)
    setImpact(null)
    try {
      const result = await getBalanceReviews()
      if (generation === lifetime.current.generation) setRecords(result.reviews)
    } catch (cause) {
      if (generation === lifetime.current.generation)
        setError(cause instanceof Error ? cause.message : '資料一覧を取得できませんでした。')
    } finally {
      if (generation === lifetime.current.generation) setBusy(false)
    }
  }
  async function compare(id: string) {
    setStored(null)
    const generation = ++lifetime.current.generation
    setBusy(true)
    setError('')
    setComparison(null)
    setImpact(null)
    try {
      const result = await getReviewComparison(id)
      if (generation === lifetime.current.generation) setComparison(result)
    } catch (cause) {
      if (generation === lifetime.current.generation)
        setError(cause instanceof Error ? cause.message : '比較資料を取得できませんでした。')
    } finally {
      if (generation === lifetime.current.generation) setBusy(false)
    }
  }
  async function inspectImpact() {
    setStored(null)
    const generation = ++lifetime.current.generation
    setBusy(true)
    setError('')
    setComparison(null)
    setImpact(null)
    try {
      const result = await getReviewImpact()
      if (generation === lifetime.current.generation) setImpact(result)
    } catch (cause) {
      if (generation === lifetime.current.generation)
        setError(cause instanceof Error ? cause.message : '年度別の影響を取得できませんでした。')
    } finally {
      if (generation === lifetime.current.generation) setBusy(false)
    }
  }
  async function inspectStored(id: string) {
    const generation = ++lifetime.current.generation
    setBusy(true)
    setError('')
    setStored(null)
    setComparison(null)
    setImpact(null)
    try {
      const result = await getBalanceReview(id)
      if (result.review.id !== id) throw new Error('要求した保存版と取得した資料IDが一致しません。')
      if (generation === lifetime.current.generation) setStored(result.review)
    } catch (cause) {
      if (generation === lifetime.current.generation)
        setError(cause instanceof Error ? cause.message : '保存版を取得できませんでした。')
    } finally {
      if (generation === lifetime.current.generation) setBusy(false)
    }
  }
  return (
    <section className="panel" aria-label="保存済み年度資料の持ち出し">
      <h2>保存済みの年度資料</h2>
      <p>
        指定した保存版の費用・判断・残高を出力します。旧版に含まれない資料を最新の入力で補いません。同じ年の年度資料を保存し直すと、元の版を残した訂正版になります。
      </p>
      <button disabled={busy} onClick={() => void load()}>
        {busy ? '資料一覧を読込中' : '資料一覧を読み込む'}
      </button>
      {error && <p role="alert">{error} 資料の取得に失敗しました。再度読み込んでください。</p>}
      {records?.length === 0 && (
        <p>保存済みの年度資料はありません。作業中の残高とは別の記録です。</p>
      )}
      {records && records.length > 0 && (
        <ul>
          {records.map((record) => (
            <li key={record.id}>
              <strong>
                {record.year}年 / {record.active ? '読込時の現行版' : '過去の保存版'}
              </strong>
              <p>
                資料ID：{record.id}
                {record.previousYearChanged && ' / 前年資料の変更が未反映です。'}
              </p>
              <button disabled={busy} onClick={() => void compare(record.id)}>
                現在の保存入力との差を確認
              </button>
              <button disabled={busy} onClick={() => void inspectStored(record.id)}>
                この保存版を読む
              </button>
              <a
                href={
                  '/api/balances/reviews/' +
                  encodeURIComponent(record.id) +
                  '/export?format=markdown'
                }
                download
              >
                説明と全データをMarkdownで保存
              </a>
              {' / '}
              <a
                href={
                  '/api/balances/reviews/' + encodeURIComponent(record.id) + '/export?format=json'
                }
                download
              >
                全データをJSONで保存
              </a>
            </li>
          ))}
        </ul>
      )}
      <button disabled={busy} onClick={() => void inspectImpact()}>
        保存済み各年への影響を確認
      </button>
      {impact && (
        <section aria-label="保存済み各年への影響">
          <h3>現在の保存入力による年度別の差</h3>
          <p>
            各年の現行版と一度取得した現在の入力を比較します。古い版と訂正版を合算せず、保存済み資料を自動更新しません。
          </p>
          {impact.years.length === 0 && <p>比較対象の保存済み年度資料はありません。</p>}
          {impact.years.map((value) => (
            <div key={value.reviewId}>
              {value.priorChainChanged && (
                <p role="status">
                  {value.year}年は過年度の訂正が未反映です。古い年度から順に差を確認してください。
                </p>
              )}
              <ReviewComparisonPanel value={value} />
            </div>
          ))}
        </section>
      )}
      {comparison && <ReviewComparisonPanel value={comparison} />}
      {stored && <StoredReviewPanel key={stored.id} review={stored} />}
    </section>
  )
}
