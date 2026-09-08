import type {
  BalanceFlowAllocation,
  BalanceMovement,
  BalanceSnapshot,
} from '../../accounting/types'
import BalanceLotUseEditor from './BalanceLotUseEditor'
import type { CostLotDescription } from '../../core/costLotLabel'

export default function BalanceFlowEditor({
  movement,
  snapshot,
  descriptions,
  onChange,
}: {
  movement: BalanceMovement
  snapshot: BalanceSnapshot
  descriptions?: CostLotDescription[]
  onChange: (links: BalanceFlowAllocation[]) => void
}) {
  if (movement.kind === 'addition') return null
  const accountId = movement.kind === 'transfer' ? movement.fromAccountId : movement.accountId
  const account = snapshot.accounts.find((row) => row.id === accountId)
  const links = movement.balanceAllocations ?? []
  const candidates: (Pick<BalanceFlowAllocation, 'sourceKind' | 'sourceId'> & {
    label: string
    amount: number | null
  })[] = []
  if (account && `${account.openingYear}-01-01` <= movement.occurredOn)
    candidates.push({
      sourceKind: 'opening',
      sourceId: account.id,
      label: `${account.openingYear}年期首 / ${account.name}`,
      amount: account.opening.amountJpy,
    })
  for (const row of snapshot.movements) {
    if (row.id === movement.id || row.occurredOn > movement.occurredOn) continue
    if (
      (row.kind === 'addition' && row.accountId === accountId) ||
      (row.kind === 'transfer' && row.toAccountId === accountId)
    )
      candidates.push({
        sourceKind: 'movement',
        sourceId: row.id,
        label: `${row.occurredOn} / ${row.kind === 'addition' ? '増加' : '振替受入'} / ${row.reason} / ID ${row.id}`,
        amount: row.amountJpy,
      })
  }
  const key = (row: Pick<BalanceFlowAllocation, 'sourceKind' | 'sourceId'>) =>
    JSON.stringify([row.sourceKind, row.sourceId])
  return (
    <fieldset style={{ minWidth: 0 }}>
      <legend>費用化・減少・振替の対応元</legend>
      <p>
        どの期首・増加・振替受入から使ったかを選び、使用額を入力してください。元額は他の移動での使用を引く前の額です。重複使用と循環は年度資料の確認時に照合します。未指定分は未対応として残します。
      </p>
      {links.map((link, index) => {
        const source = candidates.find((row) => key(row) === key(link))
        const label =
          source?.label ??
          `${link.sourceKind === 'opening' ? '期首' : '増加・振替受入'} / ID ${link.sourceId}（現在の候補外）`
        const update = (input: HTMLInputElement) => {
          const amountJpy = input.valueAsNumber
          if (!Object.is(link.amountJpy, amountJpy))
            onChange(links.map((row, i) => (i === index ? { ...row, amountJpy } : row)))
        }
        return (
          <div key={key(link)}>
            <label>
              {label} の使用額（円）
              <input
                aria-label={`${movement.id}の対応元${link.sourceId}の使用額`}
                type="number"
                min="0"
                step="1"
                value={Number.isFinite(link.amountJpy) ? link.amountJpy : ''}
                onInput={(e) => update(e.currentTarget)}
                onChange={(e) => update(e.currentTarget)}
              />
            </label>
            {!source && (
              <p>元の参照を保持しています。残高・日付・対応元を確認して修正してください。</p>
            )}
            {source?.amount === null && <p>期首額が不明なため照合できません。</p>}
            <BalanceLotUseEditor
              descriptions={descriptions}
              snapshot={snapshot}
              link={link}
              label={`${movement.id}の対応元${link.sourceId}`}
              onChange={(costAllocations) =>
                onChange(links.map((row, i) => (i === index ? { ...row, costAllocations } : row)))
              }
            />
            <button
              type="button"
              aria-label={`${movement.id}の対応元${link.sourceId}を外す`}
              onClick={() => onChange(links.filter((_, i) => i !== index))}
            >
              この対応を外す
            </button>
          </div>
        )
      })}
      <label>
        対応元を追加
        <select
          aria-label={`${movement.id}の残高対応元を追加`}
          value=""
          disabled={links.length >= 100}
          onChange={(e) => {
            const source = candidates.find((row) => key(row) === e.target.value)
            if (source && !links.some((row) => key(row) === key(source)))
              onChange([
                ...links,
                { sourceKind: source.sourceKind, sourceId: source.sourceId, amountJpy: NaN },
              ])
          }}
        >
          <option value="">選択してください</option>
          {candidates
            .filter((source) => !links.some((row) => key(row) === key(source)))
            .map((source) => (
              <option key={key(source)} value={key(source)} disabled={source.amount === null}>
                {source.label} / 元額{' '}
                {source.amount === null
                  ? '不明・照合不能'
                  : source.amount.toLocaleString('ja-JP') + '円'}
              </option>
            ))}
        </select>
      </label>
    </fieldset>
  )
}
