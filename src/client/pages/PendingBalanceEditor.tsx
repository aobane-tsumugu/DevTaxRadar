import type { BalanceSnapshot, PendingBalanceDecision } from '../../accounting/types'
import type { PlanningSnapshot } from '../../planning/types'
import type { ConsultationNavigation } from '../consultationNavigation'
import { decisionIsConfirmed } from '../../core/decisionConfirmation'
import ConsultationAnswersEditor from './ConsultationAnswersEditor'
import {
  consultationAnswersForYear,
  consultationQuestionBasis,
  consultationResolutionMatches,
} from '../../core/consultationResolution'

export default function PendingBalanceEditor({
  snapshot,
  planning,
  sources,
  year,
  busy,
  edit,
  onReviewAnswer,
}: {
  snapshot: BalanceSnapshot
  planning: PlanningSnapshot
  sources: { id: string; label: string }[]
  year: number
  busy: boolean
  edit: (change: (snapshot: BalanceSnapshot) => void) => void
  onReviewAnswer?: (context: ConsultationNavigation) => void
}) {
  const change = (index: number, update: (row: PendingBalanceDecision) => void) =>
    edit((s) => update(s.pendingDecisions[index]!))
  return (
    <fieldset disabled={busy}>
      <legend>未判断の記録と解消</legend>
      <p>
        扱いを決められない費用と確認事項を記録します。不明額は空欄のまま保持し、残高へ自動加算しません。解消した記録も元の問いと一緒に残します。
      </p>
      <button
        type="button"
        onClick={() =>
          edit((s) =>
            s.pendingDecisions.push({
              id: crypto.randomUUID(),
              taxYear: year,
              taxUnitId: '',
              amount: { status: 'unknown', amountJpy: null, reasons: ['金額の確認待ち'] },
              accountIds: [],
              reasons: [''],
              sourceIds: [],
            }),
          )
        }
      >
        未判断を追加
      </button>
      {snapshot.pendingDecisions.map((row, index) => (
        <article className="panel cost-source" key={row.id}>
          <h3>
            {row.resolution && consultationResolutionMatches(row, true)
              ? row.resolution.taxYear + '年から解消として記録'
              : '確認が必要な事項'}
          </h3>
          <div className="cost-toolbar">
            <label>
              未判断の制作物{' '}
              <select
                value={row.taxUnitId}
                onChange={(e) =>
                  change(index, (p) => {
                    p.taxUnitId = e.target.value
                  })
                }
              >
                <option value="">選択してください</option>
                {planning.taxUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
                {row.taxUnitId && !planning.taxUnits.some((u) => u.id === row.taxUnitId) && (
                  <option value={row.taxUnitId}>現在の一覧にない制作物</option>
                )}
              </select>
            </label>
            <label>
              未判断の発生年{' '}
              <input
                type="number"
                min="1900"
                max="9999"
                value={Number.isFinite(row.taxYear) ? row.taxYear : ''}
                onChange={(e) =>
                  change(index, (p) => {
                    p.taxYear = e.target.valueAsNumber
                  })
                }
              />
            </label>
            <label>
              確認対象の金額{' '}
              <input
                type="number"
                min="0"
                step="1"
                placeholder="不明"
                value={row.amount.status === 'known' ? row.amount.amountJpy : ''}
                onChange={(e) =>
                  change(index, (p) => {
                    p.amount =
                      e.target.value === ''
                        ? { status: 'unknown', amountJpy: null, reasons: ['金額の確認待ち'] }
                        : { status: 'known', amountJpy: e.target.valueAsNumber }
                  })
                }
              />
            </label>
            <button
              type="button"
              onClick={() =>
                change(index, (p) => {
                  p.amount = { status: 'unknown', amountJpy: null, reasons: ['金額の確認待ち'] }
                })
              }
            >
              対象額を不明に戻す
            </button>
            {row.amount.status === 'unknown' && (
              <label>
                対象額が不明な理由{' '}
                <textarea
                  value={row.amount.reasons.join('\n')}
                  onChange={(e) =>
                    change(index, (p) => {
                      p.amount = {
                        status: 'unknown',
                        amountJpy: null,
                        reasons: e.target.value.split('\n'),
                      }
                    })
                  }
                />
              </label>
            )}
            <label>
              判断できない理由・確認すること{' '}
              <textarea
                value={row.reasons.join('\n')}
                onChange={(e) =>
                  change(index, (p) => {
                    p.reasons = e.target.value.split('\n')
                  })
                }
              />
            </label>
          </div>
          <fieldset>
            <legend>関係する残高（未登録なら選択不要）</legend>
            {snapshot.accounts.map((a) => (
              <label className="balance-source-choice" key={a.id}>
                <input
                  type="checkbox"
                  checked={row.accountIds.includes(a.id)}
                  onChange={(e) =>
                    change(index, (p) => {
                      p.accountIds = e.target.checked
                        ? [...p.accountIds, a.id]
                        : p.accountIds.filter((id) => id !== a.id)
                    })
                  }
                />
                {a.name || '名前未入力'}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>未判断の根拠となる費用・資料</legend>
            {[
              ...sources,
              ...row.sourceIds
                .filter((id) => !sources.some((s) => s.id === id))
                .map((id) => ({ id, label: '現在の一覧にない根拠参照：' + id })),
            ].map((source) => (
              <label className="balance-source-choice" key={source.id}>
                <input
                  type="checkbox"
                  checked={row.sourceIds.includes(source.id)}
                  onChange={(e) =>
                    change(index, (p) => {
                      p.sourceIds = e.target.checked
                        ? [...p.sourceIds, source.id]
                        : p.sourceIds.filter((id) => id !== source.id)
                    })
                  }
                />
                {source.label}
              </label>
            ))}
          </fieldset>
          <ConsultationAnswersEditor
            onReview={onReviewAnswer}
            value={row}
            year={year}
            onChange={(answers) =>
              change(index, (p) => {
                p.answers = answers
              })
            }
          />
          {row.resolution ? (
            <fieldset>
              <legend>解消の記録</legend>
              {!consultationResolutionMatches(row, true) && (
                <p role="alert">
                  現在の回答を使った解消は未確認です。元の問い・対象額・回答と判断の対応を見直してから、下の確認ボタンを押してください。
                </p>
              )}
              <p>
                解消年より前の年度では未判断として表示します。必要な費用化・振替などは増減欄に記録してください。
              </p>
              <label>
                解消した年{' '}
                <input
                  type="number"
                  min={row.taxYear}
                  max="9999"
                  value={Number.isFinite(row.resolution.taxYear) ? row.resolution.taxYear : ''}
                  onChange={(e) =>
                    change(index, (p) => {
                      p.resolution!.taxYear = e.target.valueAsNumber
                    })
                  }
                />
              </label>
              <label>
                解消の判断記録{' '}
                <select
                  value={row.resolution.decisionId}
                  onChange={(e) =>
                    change(index, (p) => {
                      p.resolution!.decisionId = e.target.value
                    })
                  }
                >
                  <option value="">選択してください</option>
                  {planning.decisions
                    .filter(
                      (d) =>
                        decisionIsConfirmed(d) &&
                        d.taxYear === row.resolution!.taxYear &&
                        d.taxUnitId === row.taxUnitId,
                    )
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.taxYear}年 / {d.selectedCandidate ?? d.candidate} / {d.reason}
                      </option>
                    ))}
                  {row.resolution.decisionId &&
                    !planning.decisions.some(
                      (d) =>
                        d.id === row.resolution!.decisionId &&
                        decisionIsConfirmed(d) &&
                        d.taxYear === row.resolution!.taxYear &&
                        d.taxUnitId === row.taxUnitId,
                    ) && (
                      <option value={row.resolution.decisionId}>
                        現在の対象年・制作物の確認済み判断にない参照
                      </option>
                    )}
                </select>
              </label>
              <label>
                解消とする理由{' '}
                <textarea
                  value={row.resolution.reason}
                  onChange={(e) =>
                    change(index, (p) => {
                      p.resolution!.reason = e.target.value
                    })
                  }
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  change(index, (p) => {
                    delete p.resolution
                  })
                }
              >
                解消の入力を取り消す
              </button>
              <button
                type="button"
                disabled={
                  !row.resolution.reason.trim() ||
                  !planning.decisions.some(
                    (d) =>
                      d.id === row.resolution!.decisionId &&
                      decisionIsConfirmed(d) &&
                      d.taxYear === row.resolution!.taxYear &&
                      d.taxUnitId === row.taxUnitId,
                  )
                }
                onClick={() =>
                  change(index, (p) => {
                    p.resolution!.answerBasis = consultationAnswersForYear(p, p.resolution!.taxYear)
                    p.resolution!.questionBasis = consultationQuestionBasis(p)
                  })
                }
              >
                この回答と判断で解消を確認
              </button>
            </fieldset>
          ) : (
            <button
              type="button"
              onClick={() =>
                change(index, (p) => {
                  p.resolution = { taxYear: Math.max(p.taxYear, year), decisionId: '', reason: '' }
                })
              }
            >
              判断結果を記録して解消する
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              edit((s) => {
                s.pendingDecisions.splice(index, 1)
              })
            }
          >
            誤登録した未判断を削除
          </button>
          <p>
            削除・変更は作業中の入力に反映します。保存済み年度資料を訂正する場合、元の年度資料は残ります。
          </p>
        </article>
      ))}
    </fieldset>
  )
}
