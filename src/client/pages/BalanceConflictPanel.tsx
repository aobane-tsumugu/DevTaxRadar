import { useMemo, useState } from 'react'
import type { BalanceDraft } from '../../accounting/balanceWorkspace'
import type { BalanceSnapshot } from '../../accounting/types'
import { mergeBalanceDrafts, type BalanceMergeChoice } from '../../core/balanceMerge'
import { balanceSnapshotSchema } from '../../accounting/balanceSchema'
import { buildAnnualBalances } from '../../core/annualBalances'

const labels: Record<string, string> = {
  id: '記録ID',
  taxUnitId: '制作物ID',
  name: '名前',
  kind: '種類',
  openingYear: '記録開始年',
  opening: '期首',
  status: '金額の状態',
  amountJpy: '金額',
  reasons: '確認事項・不明理由',
  openingRevisionId: '期首の元資料',
  occurredOn: '発生日',
  sourceIds: '根拠の参照',
  decisionId: '判断の参照',
  reason: '理由',
  accountId: '対象残高',
  fromAccountId: '振替元',
  toAccountId: '振替先',
  taxYear: '対象年',
  accountIds: '関係する残高',
  resolution: '解消の記録',
  costAllocations: '費用配分との金額対応',
  costYear: '費用配分の年',
  contributionId: '費用配分ID',
}
const values: Record<string, string> = {
  construction: '制作中',
  asset: '資産',
  prepaid: '前払',
  addition: '増加',
  expense: '費用化',
  reduction: 'その他減少',
  transfer: '振替',
  known: '既知',
  unknown: '不明',
}
function RecordValue({ value, field = '' }: { value: unknown; field?: string }) {
  if (value === undefined) return <p>記録なし・削除</p>
  if (value === null) return <p>不明</p>
  if (Array.isArray(value))
    return value.length ? (
      <ul>
        {value.map((v, i) => (
          <li key={i}>
            <RecordValue value={v} />
          </li>
        ))}
      </ul>
    ) : (
      <p>登録なし</p>
    )
  if (typeof value === 'object')
    return (
      <dl>
        {Object.entries(value)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => (
            <div key={k}>
              <dt>{labels[k] ?? k}</dt>
              <dd>
                <RecordValue value={v} field={k} />
              </dd>
            </div>
          ))}
      </dl>
    )
  return (
    <p>
      {field === 'amountJpy' && typeof value === 'number'
        ? value.toLocaleString('ja-JP') + '円'
        : field === 'kind' || field === 'status'
          ? (values[String(value)] ?? String(value))
          : String(value)}
    </p>
  )
}
export default function BalanceConflictPanel({
  base,
  local,
  latest,
  year,
  onApply,
  onCancel,
}: {
  base: BalanceDraft
  local: BalanceSnapshot
  latest: BalanceDraft
  year: number
  onApply: (snapshot: BalanceSnapshot) => void
  onCancel: () => void
}) {
  const [choices, setChoices] = useState<Record<string, BalanceMergeChoice>>({})
  const comparison = useMemo(() => {
    try {
      const merged = mergeBalanceDrafts(base.snapshot, local, latest.snapshot, choices)
      let validation: string | null = null
      if (merged.snapshot) {
        try {
          buildAnnualBalances(balanceSnapshotSchema.parse(merged.snapshot), year)
        } catch (error) {
          validation =
            error instanceof Error && error.name !== 'ZodError'
              ? error.message
              : '選択結果の入力項目を確認してください。'
        }
      }
      return { ...merged, validation, error: null }
    } catch (error) {
      return {
        snapshot: null,
        changes: [],
        validation: null,
        error: error instanceof Error ? error.message : '比較できません。',
      }
    }
  }, [base, local, latest, choices, year])
  return (
    <section className="panel" aria-label="残高の競合比較">
      <h2>この画面の入力と最新の残高を比較</h2>
      <p>
        編集を始めた保存版 {base.revision} ／ 読み取った最新の保存版 {latest.revision}
        。別々の記録の変更は両方を残し、同じ記録の異なる変更は一件ずつ選びます。振替の両側・金額・理由・解消情報は一つの記録として扱います。
      </p>
      {comparison.error && <p role="alert">{comparison.error}</p>}
      {comparison.changes.map((change) => (
        <article key={change.key}>
          <h3>{change.label}</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>編集を始めた内容</th>
                  <th>この画面の入力</th>
                  <th>最新の保存内容</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  {[change.base, change.local, change.latest].map((v, i) => (
                    <td key={i}>
                      <RecordValue value={v} />
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          {change.conflict ? (
            <fieldset>
              <legend>{change.label}の選択</legend>
              {(['local', 'latest'] as const).map((choice) => (
                <label key={choice}>
                  <input
                    type="radio"
                    name={change.key}
                    checked={choices[change.key] === choice}
                    onChange={() => setChoices((old) => ({ ...old, [change.key]: choice }))}
                  />
                  {choice === 'local' ? 'この画面の入力を残す' : '最新の保存内容を残す'}
                </label>
              ))}
            </fieldset>
          ) : (
            <p>
              {change.choice === 'local'
                ? 'この画面の変更を反映します。'
                : '最新の保存内容を反映します。'}
            </p>
          )}
        </article>
      ))}
      {comparison.validation && (
        <p role="alert">{comparison.validation} 選択を見直すか、編集へ戻して修正してください。</p>
      )}
      {!comparison.snapshot && !comparison.error && (
        <p>異なる変更がある記録をすべて選択してください。</p>
      )}
      <p>
        この操作では保存しません。選択結果を編集画面で確認し、「作業中の残高を保存」で保存します。保存時にも版を照合します。
      </p>
      <button
        disabled={!comparison.snapshot}
        onClick={() => comparison.snapshot && onApply(comparison.snapshot)}
      >
        選択結果を編集へ戻す
      </button>
      <button onClick={onCancel}>比較を閉じて元の入力へ戻る</button>
    </section>
  )
}
