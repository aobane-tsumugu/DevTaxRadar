import { useEffect, useRef, useState } from 'react'
import { getBalanceReview, getBalanceReviews } from '../api'
import type { EquipmentAnnualMethod } from '../../planning/equipmentMethods'

export default function PreviousEquipmentBalancePicker({
  year,
  equipmentId,
  onUse,
}: {
  year: number
  equipmentId: string
  onUse: (value: NonNullable<EquipmentAnnualMethod['priorClosing']>, reviewId: string) => void
}) {
  const [candidate, setCandidate] = useState<{ reviewId: string; amountJpy: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const lifetime = useRef({ generation: 0 })
  const latestUse = useRef(onUse)
  latestUse.current = onUse
  useEffect(() => {
    const state = lifetime.current
    return () => {
      state.generation++
    }
  }, [])
  async function inspect(apply = false) {
    const generation = ++lifetime.current.generation
    setBusy(true)
    setMessage('')
    try {
      const { reviews } = await getBalanceReviews()
      const heads = reviews.filter((row) => row.year === year - 1 && row.active)
      if (heads.length !== 1 || heads[0]!.previousYearChanged)
        throw new Error(
          '参照できる前年の現行資料がないか、さらに前の資料変更が未反映です。残高の年度資料を確認してください。',
        )
      const id = heads[0]!.id
      if (apply) {
        if (!candidate || candidate.reviewId !== id)
          throw new Error('前年の現行資料が変更されています。再度読み込んでください。')
        if (generation !== lifetime.current.generation) return
        latestUse.current(
          {
            taxYear: year - 1,
            amountJpy: candidate.amountJpy,
            reference: `年度資料 ${id} / 設備 ${equipmentId}`,
          },
          id,
        )
        setMessage('前年資料の計算額を編集内容へ反映しました。通常の保存操作で保存してください。')
        return
      }
      setCandidate(null)
      const { review } = await getBalanceReview(id)
      const rows =
        review.materials?.equipmentCalculations?.filter(
          (row) => row.equipmentId === equipmentId && row.taxYear === year - 1,
        ) ?? []
      if (
        review.id !== id ||
        review.year !== year - 1 ||
        rows.length !== 1 ||
        !rows[0]!.result?.calculation
      )
        throw new Error(
          '前年資料にこの設備の期末計算が収録されていません。取得額や現在の計算では補いません。',
        )
      if (generation === lifetime.current.generation)
        setCandidate({ reviewId: id, amountJpy: rows[0]!.result!.calculation!.closingBasisJpy })
    } catch (error) {
      if (generation === lifetime.current.generation) {
        setCandidate(null)
        setMessage(error instanceof Error ? error.message : '前年資料を読み込めませんでした。')
      }
    } finally {
      if (generation === lifetime.current.generation) setBusy(false)
    }
  }
  return (
    <section aria-label="前年資料から設備残高を確認">
      <button type="button" disabled={busy} onClick={() => void inspect()}>
        前年資料の設備計算を読み込む
      </button>
      {candidate && (
        <>
          <p>
            {year - 1}年 / 資料ID {candidate.reviewId} / 設備ID {equipmentId} / 設備全体の期末計算{' '}
            {candidate.amountJpy.toLocaleString('ja-JP')}円
          </p>
          <p>
            条件付きの計算額です。税務残高の確認済み額ではありません。反映すると、入力中の前年残高と参照先を置き換えます。
          </p>
          <button type="button" disabled={busy} onClick={() => void inspect(true)}>
            この前年計算額を編集内容に反映
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  )
}
