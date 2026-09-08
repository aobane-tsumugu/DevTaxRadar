import type { PendingBalanceDecision } from '../../accounting/types'
import type { ConsultationNavigation } from '../consultationNavigation'
import DateInput from './DateInput'

type Answer = NonNullable<PendingBalanceDecision['answers']>[number]
export default function ConsultationAnswersEditor({
  value,
  year,
  onChange,
  onReview,
}: {
  value: PendingBalanceDecision
  year: number
  onChange: (answers: Answer[]) => void
  onReview?: (context: ConsultationNavigation) => void
}) {
  const answers = value.answers ?? []
  const edit = (id: string, patch: Partial<Answer>) =>
    onChange(answers.map((answer) => (answer.id === id ? { ...answer, ...patch } : answer)))
  return (
    <fieldset>
      <legend>この確認事項への相談回答</legend>
      <p>
        事実の回答と方法の回答を分けて記録します。対象年は回答を反映する年度、受領日は実際に回答を得た日です。回答を入力しただけでは解消しません。必要な事実・方法を見直し、確認済みの判断を「解消の記録」で選んでください。
      </p>
      <button
        type="button"
        onClick={() =>
          onChange([
            ...answers,
            {
              id: crypto.randomUUID(),
              taxYear: Math.max(year, value.taxYear),
              receivedOn: '',
              kind: 'fact',
              answer: '',
              source: '',
            },
          ])
        }
      >
        この問いへの回答を追加
      </button>
      {answers.map((answer) => (
        <fieldset key={answer.id}>
          <legend>回答の内容</legend>
          <label>
            回答の種類{' '}
            <select
              value={answer.kind}
              onChange={(event) => edit(answer.id, { kind: event.target.value as Answer['kind'] })}
            >
              <option value="fact">事実についての回答</option>
              <option value="method">方法についての回答</option>
            </select>
          </label>
          <label>
            回答を反映する対象年{' '}
            <input
              type="number"
              min={value.taxYear}
              max="9999"
              value={Number.isFinite(answer.taxYear) ? answer.taxYear : ''}
              onChange={(event) => edit(answer.id, { taxYear: event.target.valueAsNumber })}
            />
          </label>
          <label>
            回答を受け取った日{' '}
            <DateInput
              value={answer.receivedOn}
              onValueChange={(receivedOn) => edit(answer.id, { receivedOn })}
            />
          </label>
          <label>
            回答内容{' '}
            <textarea
              value={answer.answer}
              onChange={(event) => edit(answer.id, { answer: event.target.value })}
            />
          </label>
          <label>
            回答の確認先・根拠{' '}
            <textarea
              value={answer.source}
              onChange={(event) => edit(answer.id, { source: event.target.value })}
            />
          </label>
          <button
            type="button"
            onClick={() => onChange(answers.filter((item) => item.id !== answer.id))}
          >
            誤登録した回答を取り除く
          </button>
          <p>編集・削除は作業入力に反映します。採用済み資料の回答は元版に保持されます。</p>
          {onReview && (
            <button
              type="button"
              onClick={() =>
                onReview({
                  pendingId: value.id,
                  taxUnitId: value.taxUnitId,
                  question: value.reasons.join('\n'),
                  answer: structuredClone(answer),
                })
              }
            >
              この回答を見ながら事実・判断を見直す
            </button>
          )}
        </fieldset>
      ))}
    </fieldset>
  )
}
