import { monthlyChargeInputIssue } from '../monthlyChargeValidation'
import { useState } from 'react'
import type { LocalConfiguration } from '../types'
import { displayMonth } from '../monthLabel'

export default function MonthlyChargesEditor({
  charges,
  observedMonths,
  onChange,
}: {
  charges: LocalConfiguration['monthlyCharges']
  observedMonths: string[]
  onChange: (charges: LocalConfiguration['monthlyCharges']) => void
}) {
  const [month, setMonth] = useState('')
  const [added, setAdded] = useState<string[]>([])
  const months = [
    ...new Set([...observedMonths, ...charges.map((row) => row.month), ...added]),
  ].sort()
  return (
    <details className="monthly-charges">
      <summary>月別料金を編集（{months.length}か月）</summary>
      <p>
        保存済みの月と履歴の月を表示します。空欄は月別の上書きなしです。入力した月だけ保存します。0円を確認した場合は0を入力してください。料金が分からない月は「料金不明」を選び、理由を残します。通常月額では補いません。
      </p>
      <label>
        編集する月
        <input
          type="month"
          aria-label="追加する月別料金の月"
          value={month}
          onInput={(event) => setMonth(event.currentTarget.value)}
          onChange={(event) => setMonth(event.currentTarget.value)}
        />
      </label>
      <button
        type="button"
        disabled={!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)}
        onClick={() => {
          setAdded((current) => [...new Set([...current, month])])
          setMonth('')
        }}
      >
        この月の入力欄を追加
      </button>
      <p>入力欄の追加だけでは月額を保存しません。</p>
      <div className="monthly-charge-grid">
        {months.map((monthKey) => (
          <div className="monthly-charge-row" key={monthKey}>
            <strong>{displayMonth(monthKey)}</strong>
            {(['claude', 'codex'] as const).map((provider) => {
              const row = charges.find(
                (item) => item.provider === provider && item.month === monthKey,
              )
              const issue = row ? monthlyChargeInputIssue(row) : null
              const unknown = row?.amountJpy === null
              const label = `${displayMonth(monthKey)} ${provider}`
              const update = (replacement: LocalConfiguration['monthlyCharges'][number] | null) =>
                onChange([
                  ...charges.filter(
                    (item) => item.provider !== provider || item.month !== monthKey,
                  ),
                  ...(replacement ? [replacement] : []),
                ])
              return (
                <div key={provider}>
                  <label>
                    <span>{provider === 'claude' ? 'Claude' : 'Codex'}</span>
                    <input
                      aria-label={`${displayMonth(monthKey)} ${provider}料金`}
                      type="number"
                      disabled={unknown}
                      min={0}
                      value={
                        charges.find((row) => row.provider === provider && row.month === monthKey)
                          ?.amountJpy ?? ''
                      }
                      placeholder={unknown ? '料金不明' : '月別の上書きなし'}
                      onChange={(event) => {
                        const amount = event.target.value === '' ? null : event.target.valueAsNumber
                        onChange([
                          ...charges.filter(
                            (row) => row.provider !== provider || row.month !== monthKey,
                          ),
                          ...(amount === null
                            ? []
                            : [{ provider, month: monthKey, amountJpy: amount }]),
                        ])
                      }}
                    />
                    <span>円</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      aria-label={label + '料金不明'}
                      checked={unknown}
                      onChange={(event) =>
                        update(
                          event.target.checked
                            ? {
                                provider,
                                month: monthKey,
                                amountJpy: null,
                                unknownAmountReason: '',
                              }
                            : null,
                        )
                      }
                    />
                    料金不明
                  </label>
                  {unknown && (
                    <label>
                      不明の理由
                      <input
                        aria-label={label + '料金不明の理由'}
                        aria-invalid={Boolean(issue)}
                        value={row.unknownAmountReason ?? ''}
                        onChange={(event) =>
                          update({ ...row, unknownAmountReason: event.target.value })
                        }
                      />
                    </label>
                  )}
                  {issue && <p role="alert">{issue}</p>}
                  {unknown && (
                    <p>
                      この月の金額は未算定です。料金不明を解除すると月別の上書きなしへ戻ります。
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </details>
  )
}
