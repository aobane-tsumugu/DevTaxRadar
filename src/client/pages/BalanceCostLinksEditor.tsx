import { useEffect, useRef, useState } from 'react'
import type { AnnualCostProjection } from '../../accounting/costs'
import type { BalanceMovement, BalanceSnapshot } from '../../accounting/types'
import { applyCostLinkSuggestion, suggestCostLink } from '../../core/balanceCostDraft'
import { getCostProjection } from '../api'
import { yen } from './shared'

export default function BalanceCostLinksEditor({
  movement,
  snapshot,
  taxUnitId,
  onChange,
}: {
  movement: Extract<BalanceMovement, { kind: 'addition' }>
  snapshot?: BalanceSnapshot
  taxUnitId: string | undefined
  onChange: (links: NonNullable<typeof movement.costAllocations>, sourceIds: string[], amountJpy?: number) => void
}) {
  const [year, setYear] = useState(movement.occurredOn.slice(0, 4))
  const [costs, setCosts] = useState<AnnualCostProjection | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(0)
  useEffect(() => () => { request.current++ }, [])
  const links = movement.costAllocations ?? []
  async function load() {
    const generation = ++request.current
    setBusy(true)
    setError('')
    try {
      const result = await getCostProjection(Number(year))
      if (generation !== request.current) return
      if (result.year !== Number(year)) throw new Error('取得した費用資料の対象年が一致しません。')
      setCosts(result)
    } catch (cause) {
      if (generation === request.current) {
        setCosts(null)
        setError(cause instanceof Error ? cause.message : '費用配分を取得できませんでした。')
      }
    } finally {
      if (generation === request.current) setBusy(false)
    }
  }
  const candidates = costs?.contributions.filter((row) =>
    !row.consumedByBasisId && row.target.kind === 'tax-unit' && row.target.taxUnitId === taxUnitId,
  ) ?? []
  return (
    <fieldset>
      <legend>増加額と費用配分の対応</legend>
      <p>
        費用を選ぶと、編集中の全年度の増加でまだ使っていない額と原額の参照を入力できます。
        「残額で入力」は増加額を金額対応の合計に揃えます。未算定分は補いません。
        保存・判断の確認・年度採用は別操作です。最新の費用との一致は年度採用時にも照合します。
      </p>
      {links.map((link, index) => (
        <div key={JSON.stringify([link.costYear, link.contributionId])}>
          <label>
            {link.costYear}年 / {link.contributionId} の対応額（円）
            <input type="number" min="0" step="1"
              value={Number.isFinite(link.amountJpy) ? link.amountJpy : ''}
              onChange={(event) => onChange(
                links.map((row, i) => i === index ? { ...row, amountJpy: event.target.valueAsNumber } : row),
                movement.sourceIds,
              )}
            />
          </label>
          <button type="button" onClick={() => onChange(links.filter((_, i) => i !== index), movement.sourceIds)}>
            この金額対応を外す
          </button>
        </div>
      ))}
      <label>
        費用配分の年
        <input type="number" min="1900" max="9999" value={year}
          onChange={(event) => {
            request.current++
            setYear(event.target.value)
            setCosts(null)
            setBusy(false)
            setError('')
          }}
        />
      </label>
      <button type="button"
        disabled={busy || !/^\d{4}$/.test(year) || Number(year) < 1900 || Number(year) > 9999}
        onClick={() => void load()}
      >この年の費用配分を確認</button>
      {error && <p role="alert">{error} 登録済みの金額対応は保持しています。</p>}
      {costs && <>
        <p>{costs.year}年 / この残高と同じ制作物への最終配分 {candidates.length}件。未算定の費用は選択肢に含みません。</p>
        {candidates.map((cost) => {
          const suggestion = snapshot ? suggestCostLink(snapshot, movement, costs, cost.id) : { available: false as const, reason: '全残高の入力を取得できないため、残額の自動入力は利用できません。' }
          return <div key={cost.id}>
            <p>
              {cost.sourceIds.map((id) => costs.sources.find((row) => row.id === id)?.label ?? id).join(' / ')}
              {' / '}{cost.reason}{' / '}配分額 {yen.format(cost.amountJpy)}
            </p>
            <p>{suggestion.available ? `未使用額 ${yen.format(suggestion.amountJpy)}` : suggestion.reason}</p>
            <button type="button" disabled={busy || !suggestion.available}
              onClick={() => {
                try {
                  if (!snapshot) throw new Error('残高の入力を確認できません。')
                  const next = applyCostLinkSuggestion(snapshot, movement, costs, cost.id)
                  onChange(next.costAllocations!, next.sourceIds, next.amountJpy)
                  setError('')
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : '金額対応を入力できませんでした。')
                }
              }}
            >残額で入力し、増加額を合計に揃える</button>
            <button type="button" disabled={busy || links.some((link) => link.costYear === costs.year && link.contributionId === cost.id)}
              onClick={() => onChange(
                [...links, { costYear: costs.year, contributionId: cost.id, amountJpy: 0 }],
                [...new Set([...movement.sourceIds, ...cost.sourceIds])],
              )}
            >この配分との金額対応を追加</button>
          </div>
        })}
      </>}
    </fieldset>
  )
}
