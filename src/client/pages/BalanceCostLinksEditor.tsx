import { useEffect, useRef, useState } from 'react'
import type { AnnualCostProjection } from '../../accounting/costs'
import type { BalanceMovement } from '../../accounting/types'
import { getCostProjection } from '../api'
import { yen } from './shared'

export default function BalanceCostLinksEditor({
  movement,
  taxUnitId,
  onChange,
}: {
  movement: Extract<BalanceMovement, { kind: 'addition' }>
  taxUnitId: string | undefined
  onChange: (links: NonNullable<typeof movement.costAllocations>, sourceIds: string[]) => void
}) {
  const [year, setYear] = useState(movement.occurredOn.slice(0, 4))
  const [costs, setCosts] = useState<AnnualCostProjection | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(0)
  useEffect(
    () => () => {
      request.current++
    },
    [],
  )
  const links = movement.costAllocations ?? []
  async function load() {
    const generation = ++request.current
    setBusy(true)
    setError('')
    try {
      const result = await getCostProjection(Number(year))
      if (generation === request.current) setCosts(result)
    } catch (cause) {
      if (generation === request.current)
        setError(cause instanceof Error ? cause.message : '費用配分を取得できませんでした。')
    } finally {
      if (generation === request.current) setBusy(false)
    }
  }
  const candidates =
    costs?.contributions.filter(
      (row) =>
        !row.consumedByBasisId &&
        row.target.kind === 'tax-unit' &&
        row.target.taxUnitId === taxUnitId,
    ) ?? []
  return (
    <fieldset>
      <legend>増加額と費用配分の対応</legend>
      <p>
        対応額を入力してください。複数年・複数残高への重複は年度資料の確認時に照合します。未対応分を自動で補いません。
      </p>
      {links.map((link, index) => (
        <div key={JSON.stringify([link.costYear, link.contributionId])}>
          <label>
            {link.costYear}年 / {link.contributionId} の対応額（円）
            <input
              type="number"
              min="0"
              step="1"
              value={Number.isFinite(link.amountJpy) ? link.amountJpy : ''}
              onChange={(event) =>
                onChange(
                  links.map((row, i) =>
                    i === index ? { ...row, amountJpy: event.target.valueAsNumber } : row,
                  ),
                  movement.sourceIds,
                )
              }
            />
          </label>
          <button
            type="button"
            onClick={() =>
              onChange(
                links.filter((_, i) => i !== index),
                movement.sourceIds,
              )
            }
          >
            この金額対応を外す
          </button>
        </div>
      ))}
      <label>
        費用配分の年
        <input
          type="number"
          min="1900"
          max="9999"
          value={year}
          onChange={(event) => {
            request.current++
            setYear(event.target.value)
            setCosts(null)
            setBusy(false)
            setError('')
          }}
        />
      </label>
      <button
        type="button"
        disabled={busy || !/^\d{4}$/.test(year) || Number(year) < 1900 || Number(year) > 9999}
        onClick={() => void load()}
      >
        この年の費用配分を確認
      </button>
      {error && <p role="alert">{error} 登録済みの金額対応は保持しています。</p>}
      {costs && (
        <>
          <p>
            {costs.year}年 / この残高と同じ制作物への最終配分 {candidates.length}
            件。金額が未算定の費用は選択肢に含みません。
          </p>
          {candidates.map((cost) => (
            <div key={cost.id}>
              <p>
                {cost.sourceIds
                  .map((id) => costs.sources.find((row) => row.id === id)?.label ?? id)
                  .join(' / ')}{' '}
                / {cost.reason} / {yen.format(cost.amountJpy)}
              </p>
              <button
                type="button"
                disabled={links.some(
                  (link) => link.costYear === costs.year && link.contributionId === cost.id,
                )}
                onClick={() =>
                  onChange(
                    [...links, { costYear: costs.year, contributionId: cost.id, amountJpy: 0 }],
                    [...new Set([...movement.sourceIds, ...cost.sourceIds])],
                  )
                }
              >
                この配分との金額対応を追加
              </button>
            </div>
          ))}
        </>
      )}
    </fieldset>
  )
}
