import type { EquipmentRecord } from '../../planning/types'
import type { EquipmentAnnualMethod } from '../../planning/equipmentMethods'
import { validMethodDate } from '../../core/annualMethodComparison'

export default function EquipmentPoolConditions({
  equipment,
  row,
  rows,
  onChange,
}: {
  equipment: EquipmentRecord
  row: EquipmentAnnualMethod
  rows: EquipmentAnnualMethod[]
  onChange: (change: Partial<EquipmentAnnualMethod>) => void
}) {
  const serviceYear = validMethodDate(equipment.businessUseStartedOn)
    ? Number(equipment.businessUseStartedOn.slice(0, 4))
    : null
  const election = row.poolElection ?? { serviceYear: null, reference: '', roundingConfirmed: null }
  const previous = rows
    .filter(
      (candidate) =>
        candidate.equipmentId === equipment.id &&
        candidate.taxYear < row.taxYear &&
        candidate.method === 'three-year-pool' &&
        candidate.poolElection?.serviceYear === serviceYear &&
        candidate.poolElection.reference.trim(),
    )
    .sort((a, b) => b.taxYear - a.taxYear)[0]
  return (
    <fieldset>
      <legend>供用年の一括償却選択</legend>
      <p>
        設備全体で10万円以上20万円未満かを判定し、供用年から3年間の費用基礎を計算します。月割り・法定耐用年数・残存1円は使いません。前年の実際の残額は下の既存入力で確認します。
      </p>
      <p>
        保存された供用年：{serviceYear ?? '未確認'}。この選択資料の対象年：
        {election.serviceYear ?? '未確認'}。
      </p>
      <button
        type="button"
        disabled={serviceYear === null || serviceYear < 2007 || serviceYear > 2100}
        onClick={() => onChange({ poolElection: { ...election, serviceYear } })}
      >
        保存された供用年の選択として結び付ける
      </button>
      {previous && (
        <button
          type="button"
          onClick={() => onChange({ poolElection: structuredClone(previous.poolElection) })}
        >
          {previous.taxYear}年に保存した同じ設備の選択資料を再利用
        </button>
      )}
      <label style={{ display: 'block' }}>
        供用年の選択を説明する資料・明細の参照
        <textarea
          aria-label={`${equipment.name}の一括償却選択資料`}
          value={election.reference}
          maxLength={2000}
          onChange={(event) =>
            onChange({ poolElection: { ...election, reference: event.target.value } })
          }
        />
      </label>
      <label style={{ display: 'block' }}>
        設備別の円未満切上げ・最終年の残額上限と、申告明細の合計との整合を確認
        <select
          aria-label={`${equipment.name}の一括償却端数確認`}
          value={
            election.roundingConfirmed === null ? 'unknown' : String(election.roundingConfirmed)
          }
          onChange={(event) =>
            onChange({
              poolElection: {
                ...election,
                roundingConfirmed:
                  event.target.value === 'unknown' ? null : event.target.value === 'true',
              },
            })
          }
        >
          <option value="unknown">未確認</option>
          <option value="true">確認した</option>
          <option value="false">一致しない・別計算が必要</option>
        </select>
      </label>
      <p>
        個々の設備の譲渡・除却だけを理由に、残額を一度に費用化しません。廃業・相続などは別処理です。制作へ使っていない期間を制作原価へ配分しないでください。
      </p>
    </fieldset>
  )
}
