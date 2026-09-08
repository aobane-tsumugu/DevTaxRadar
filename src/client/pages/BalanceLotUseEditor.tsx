import type {
  BalanceSnapshot,
  BalanceFlowAllocation,
  BalanceCostAllocation,
} from '../../accounting/types'
import { costLotLabel, type CostLotDescription } from '../../core/costLotLabel'

export default function BalanceLotUseEditor({
  snapshot,
  descriptions,
  link,
  label,
  onChange,
}: {
  snapshot: BalanceSnapshot
  descriptions?: CostLotDescription[]
  link: BalanceFlowAllocation
  label: string
  onChange: (lots: BalanceCostAllocation[] | undefined) => void
}) {
  const key = (lot: BalanceCostAllocation) => JSON.stringify([lot.costYear, lot.contributionId])
  const candidates = new Map<string, BalanceCostAllocation>()
  const byId = new Map(snapshot.movements.map((m) => [m.id, m]))
  const queue = link.sourceKind === 'movement' ? [link.sourceId] : []
  const visited = new Set<string>()
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!
    if (visited.has(id)) continue
    visited.add(id)
    const m = byId.get(id)
    if (m?.kind === 'addition')
      for (const lot of m.costAllocations ?? []) candidates.set(key(lot), lot)
    else
      for (const source of m?.balanceAllocations ?? [])
        if (source.sourceKind === 'movement') queue.push(source.sourceId)
  }
  const lots = link.costAllocations
  if (lots === undefined)
    return (
      <div>
        <p>
          原価内訳は一意に決まる場合だけ追跡します。混在原価の一部使用は、内訳を指定してください。
        </p>
        <button type="button" onClick={() => onChange([])} aria-label={`${label}の使用原価を指定`}>
          使用する原価内訳を指定
        </button>
      </div>
    )
  return (
    <fieldset style={{ minWidth: 0 }}>
      <legend>使用する原価内訳</legend>
      <p>
        費用名・対象期間は残高画面の読込時の資料によります。料金・計画を変更した後は、残高を保存してから「保存済みを読み直す」で更新してください。未収録の名称をIDから推測しません。
      </p>
      <p>
        対応元の使用額{' '}
        {Number.isFinite(link.amountJpy) ? link.amountJpy.toLocaleString('ja-JP') + '円' : '未入力'}{' '}
        の内訳です。指定しない残りは未追跡。候補は上流の記録から表示し、実際の使用可能額は年度確認時に照合します。
      </p>
      {lots.map((lot, index) => (
        <div key={key(lot)}>
          <label>
            {costLotLabel(lot, descriptions)} の使用額（円）
            <input
              type="number"
              min="0"
              step="1"
              aria-label={`${label}の原価${lot.contributionId}の使用額`}
              value={Number.isFinite(lot.amountJpy) ? lot.amountJpy : ''}
              onInput={(e) => {
                const amountJpy = e.currentTarget.valueAsNumber
                if (!Object.is(lot.amountJpy, amountJpy))
                  onChange(lots.map((row, i) => (i === index ? { ...row, amountJpy } : row)))
              }}
              onChange={(e) => {
                const amountJpy = e.currentTarget.valueAsNumber
                if (!Object.is(lot.amountJpy, amountJpy))
                  onChange(lots.map((row, i) => (i === index ? { ...row, amountJpy } : row)))
              }}
            />
          </label>
          {!candidates.has(key(lot)) && (
            <p>元の原価参照を保持しています。現在の上流候補にはありません。</p>
          )}
          <button
            type="button"
            aria-label={`${label}の原価${lot.contributionId}を外す`}
            onClick={() => onChange(lots.filter((_, i) => i !== index))}
          >
            この原価指定を外す
          </button>
        </div>
      ))}
      <label>
        原価を追加
        <select
          value=""
          disabled={lots.length >= 100}
          aria-label={`${label}の原価を追加`}
          onChange={(e) => {
            const lot = candidates.get(e.target.value)
            if (lot && !lots.some((row) => key(row) === key(lot)))
              onChange([...lots, { ...lot, amountJpy: NaN }])
          }}
        >
          <option value="">選択してください</option>
          {[...candidates.values()]
            .filter((lot) => !lots.some((row) => key(row) === key(lot)))
            .map((lot) => (
              <option key={key(lot)} value={key(lot)}>
                {costLotLabel(lot, descriptions)}
              </option>
            ))}
        </select>
      </label>
      {!candidates.size && (
        <p>
          上流の増加に原価の対応がありません。増加の費用配分との対応を確認してください。期首原価の指定は未対応です。
        </p>
      )}
      <button
        type="button"
        onClick={() => onChange(undefined)}
        aria-label={`${label}の原価指定を解除`}
      >
        明示指定を解除し、一意に決まる場合の追跡へ戻す
      </button>
    </fieldset>
  )
}
