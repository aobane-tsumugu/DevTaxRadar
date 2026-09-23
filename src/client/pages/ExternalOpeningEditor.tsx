import { useState } from 'react'
import type { BalanceAccount, BalanceSnapshot } from '../../accounting/types'
import type { PlanningSnapshot } from '../../planning/types'
import { decisionIsConfirmed } from '../../core/decisionConfirmation'
import {
  externalOpeningMeaning,
  externalOpeningRecord,
  recordExternalOpening,
} from '../../core/externalOpening'
import { yen } from './shared'

type Props = {
  snapshot: BalanceSnapshot
  planning: PlanningSnapshot
  busy: boolean
  edit: (change: (snapshot: BalanceSnapshot) => void) => void
}

/** Uses the parent's unsaved draft and save/recovery boundary, never a second API. */
export default function ExternalOpeningEditor(props: Props) {
  const [accountId, setAccountId] = useState('')
  const accounts = props.snapshot.accounts.filter((row) => !row.openingRevisionId)
  const account = accounts.find((row) => row.id === accountId)
  if (!accounts.length) return null
  return (
    <details aria-label="導入前の外部期首資料">
      <summary>DevTax導入前の期首を外部資料に結び付ける</summary>
      <p>
        過去の全年度を再入力する必要はありません。上で入力した期首額の意味と出典を記録します。
        購入額をそのまま転記せず、制作中原価・未償却残高・前払残額を区別してください。
        この操作は残高を増額せず、税務上の正しさも自動認定しません。
      </p>
      <label>
        外部資料と対応する期首
        <select
          value={accountId}
          disabled={props.busy}
          onChange={(event) => setAccountId(event.target.value)}
        >
          <option value="">残高を選択してください</option>
          {accounts.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name || '名前未入力'} / {row.openingYear}年
            </option>
          ))}
        </select>
      </label>
      {account && <OpeningForm key={account.id} {...props} account={account} />}
    </details>
  )
}

function OpeningForm({
  snapshot,
  planning,
  busy,
  edit,
  account,
}: Props & { account: BalanceAccount }) {
  // An imported duplicate is shown as a repair issue, not silently overwritten.
  let existing: ReturnType<typeof externalOpeningRecord> | undefined
  let readError = ''
  try {
    existing = externalOpeningRecord(snapshot, account.id)
  } catch (error) {
    readError = error instanceof Error ? error.message : '期首の確認を読み取れません。'
  }
  const [reference, setReference] = useState(existing?.answers?.[0]?.answer ?? '')
  const [evidenceIds, setEvidenceIds] = useState<string[]>(existing?.sourceIds ?? [])
  const [decisionId, setDecisionId] = useState(existing?.resolution?.decisionId ?? '')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const decisions = planning.decisions.filter(
    (row) =>
      decisionIsConfirmed(row) &&
      row.taxUnitId === account.taxUnitId &&
      row.taxYear === account.openingYear,
  )
  const selectedIsKnown = account.opening.status === 'known'
  return (
    <fieldset disabled={busy || Boolean(readError)}>
      <legend>{account.name}の期首根拠</legend>
      {readError && <p role="alert">{readError}</p>}
      <p>
        {account.openingYear}年期首 / {externalOpeningMeaning(account.kind)} /{' '}
        {selectedIsKnown ? yen.format(account.opening.amountJpy!) : '金額不明（0円ではありません）'}
      </p>
      <label>
        外部資料の名称・対象年・残高の意味
        <textarea
          maxLength={2000}
          value={reference}
          onChange={(event) => setReference(event.target.value)}
        />
      </label>
      <fieldset>
        <legend>期首の外部資料として登録した証拠</legend>
        {planning.evidence.map((row) => (
          <label className="balance-source-choice" key={row.id}>
            <input
              type="checkbox"
              checked={evidenceIds.includes(row.id)}
              onChange={(event) =>
                setEvidenceIds(
                  event.target.checked
                    ? [...evidenceIds, row.id]
                    : evidenceIds.filter((id) => id !== row.id),
                )
              }
            />
            {row.note} / {row.strength === 'external' ? '外部資料' : '本人記録・その他'}
          </label>
        ))}
        {evidenceIds
          .filter((id) => !planning.evidence.some((row) => row.id === id))
          .map((id) => (
            <p key={id}>
              一覧にない証拠参照：{id}{' '}
              <button
                type="button"
                onClick={() => setEvidenceIds(evidenceIds.filter((value) => value !== id))}
              >
                この参照を外す
              </button>
            </p>
          ))}
        {!planning.evidence.length && <p>設定の証拠欄で外部資料を登録してください。</p>}
      </fieldset>
      {selectedIsKnown && (
        <label>
          同じ制作物・期首年の確認済み判断
          <select value={decisionId} onChange={(event) => setDecisionId(event.target.value)}>
            <option value="">判断を選択してください</option>
            {decisions.map((row) => (
              <option key={row.id} value={row.id}>
                {row.selectedCandidate} / {row.reason}
              </option>
            ))}
          </select>
        </label>
      )}
      {selectedIsKnown && !decisions.length && (
        <p>設定の判断欄で、この制作物・期首年の残高確認を記録してください。</p>
      )}
      <button
        type="button"
        onClick={() => {
          setError('')
          setMessage('')
          try {
            const next = recordExternalOpening(snapshot, planning, {
              accountId: account.id,
              requestId: crypto.randomUUID(),
              reference,
              evidenceIds,
              decisionId,
              recordedAt: new Date().toISOString(),
            })
            edit((value) => {
              value.pendingDecisions = next.pendingDecisions
            })
            setMessage(
              '期首の根拠を作業中入力へ反映しました。期首額は変更していません。「作業中の残高を保存」で保存してください。',
            )
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : '期首根拠を記録できませんでした。')
          }
        }}
      >
        {selectedIsKnown
          ? 'この金額の意味と外部資料を確認して記録'
          : '金額不明のまま外部資料の確認事項を記録'}
      </button>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error} 入力と保存済み記録は変更していません。</p>}
    </fieldset>
  )
}
