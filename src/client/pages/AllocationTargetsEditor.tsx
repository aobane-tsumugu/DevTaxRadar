import type { AllocationTarget } from '../../planning/allocationTargets'
import { allocationTargetsSchema } from '../../planning/allocationTargets'

export default function AllocationTargetsEditor({
  name,
  targets,
  units,
  onChange,
}: {
  name: string
  targets: AllocationTarget[]
  units: { id: string; name: string }[]
  onChange: (targets: AllocationTarget[]) => void
}) {
  const validation = allocationTargetsSchema.safeParse(targets)
  const sum = targets.reduce((value, row) => value + (row.shareBps ?? 0), 0)
  const updateShare = (index: number, field: HTMLInputElement) => {
    const value = field.valueAsNumber * 100
    const bps = Math.abs(value - Math.round(value)) < 1e-8 ? Math.round(value) : value
    const shareBps = field.value === '' ? null : bps
    if (Object.is(targets[index]?.shareBps, shareBps)) return
    onChange(
      targets.map((target, position) => (position === index ? { ...target, shareBps } : target)),
    )
  }
  return (
    <fieldset style={{ minWidth: 0 }}>
      <legend>業務分の制作物別配分</legend>
      <p>
        この費用基礎の業務分を100%として、制作物ごとの割合を0.01%単位で入力します。空欄は未確認、0%は確認したゼロです。残りは未配分として保持します。
      </p>
      {targets.map((row, index) => (
        <div key={row.taxUnitId}>
          <label>
            {units.find((unit) => unit.id === row.taxUnitId)?.name ??
              `存在しない制作物: ${row.taxUnitId}`}
            （%）
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              aria-label={`${name}の制作物${row.taxUnitId}への割合`}
              value={
                row.shareBps === null || !Number.isFinite(row.shareBps) ? '' : row.shareBps / 100
              }
              onInput={(event) => updateShare(index, event.currentTarget)}
              onChange={(event) => updateShare(index, event.currentTarget)}
              style={{ display: 'block', minHeight: 44, width: '100%' }}
            />
          </label>
          <button
            type="button"
            aria-label={`${name}の制作物${row.taxUnitId}への割合を未確認に戻す`}
            onClick={() =>
              onChange(
                targets.map((target, position) =>
                  position === index ? { ...target, shareBps: null } : target,
                ),
              )
            }
          >
            割合を未確認に戻す
          </button>
          <button
            type="button"
            aria-label={`${name}の制作物${row.taxUnitId}への配分を削除`}
            onClick={() => onChange(targets.filter((_, position) => position !== index))}
          >
            この配分先を削除
          </button>
        </div>
      ))}
      <label>
        制作物を追加
        <select
          aria-label={`${name}の配分先を追加`}
          value=""
          disabled={targets.length >= 100}
          onChange={(event) => {
            if (event.target.value)
              onChange([...targets, { taxUnitId: event.target.value, shareBps: null }])
          }}
        >
          <option value="">選択してください</option>
          {units
            .filter((unit) => !targets.some((row) => row.taxUnitId === unit.id))
            .map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
        </select>
      </label>
      {validation.success ? (
        <p>
          入力済み割合の合計: {sum / 100}% / 未配分割合: {(10000 - sum) / 100}%
          {targets.some((row) => row.shareBps === null) ? '（割合が未確認の制作物を含みます）' : ''}
        </p>
      ) : (
        <p role="alert">
          配分割合は0〜100%の0.01%単位、合計100%以内にしてください。同じ制作物は重複できません。修正するまで保存できません。
        </p>
      )}
    </fieldset>
  )
}
