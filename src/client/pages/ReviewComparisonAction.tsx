import { useEffect, useRef, useState } from 'react'
import type { ReviewComparison } from '../../core/reviewComparison'
import { getReviewComparison } from '../api'
import ReviewComparisonPanel from './ReviewComparisonPanel'

export default function ReviewComparisonAction({
  reviewId,
  year,
}: {
  reviewId: string
  year: number
}) {
  const generation = useRef({ value: 0 })
  const [value, setValue] = useState<ReviewComparison | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const lifetime = generation.current
    lifetime.value++
    setValue(null)
    setError('')
    setBusy(false)
    return () => {
      lifetime.value++
    }
  }, [reviewId, year])
  async function compare() {
    const request = ++generation.current.value
    setBusy(true)
    setError('')
    setValue(null)
    try {
      const result = await getReviewComparison(reviewId)
      if (result.reviewId !== reviewId || result.year !== year)
        throw new Error('対象の保存版と比較結果が一致しません。読み直してください。')
      if (request === generation.current.value) setValue(result)
    } catch (cause) {
      if (request === generation.current.value)
        setError(cause instanceof Error ? cause.message : '比較資料を取得できませんでした。')
    } finally {
      if (request === generation.current.value) setBusy(false)
    }
  }
  return (
    <div>
      <button
        className="secondary-button"
        type="button"
        disabled={busy}
        onClick={() => void compare()}
      >
        {busy ? '保存版との差を確認中' : 'この採用版と現在の保存入力との差を確認'}
      </button>
      <p>比較操作時にDBへ保存されている内容を確認します。編集中の未保存入力は含みません。</p>
      {error && (
        <p role="alert">比較できませんでした：{error} 差がないと確認した状態ではありません。</p>
      )}
      {value?.reviewId === reviewId && value.year === year && (
        <ReviewComparisonPanel value={value} />
      )}
    </div>
  )
}
