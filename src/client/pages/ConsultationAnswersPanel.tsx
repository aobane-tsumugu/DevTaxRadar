import type { BalanceSnapshot } from '../../accounting/types'
import { consultationResolutionMatches } from '../../core/consultationResolution'

export default function ConsultationAnswersPanel({
  snapshot,
  year,
  requireQuestionBasis = false,
}: {
  snapshot: BalanceSnapshot
  year: number
  requireQuestionBasis?: boolean
}) {
  const rows = snapshot.pendingDecisions.flatMap((pending) =>
    (pending.answers ?? [])
      .filter((answer) => answer.taxYear <= year)
      .map((answer) => ({ pending, answer })),
  )
  return (
    <section aria-label="記録した相談回答">
      <h3>確認事項に対する回答</h3>
      {!rows.length && (
        <p>この対象年までの回答は未収録です。相談不要・確認完了の意味ではありません。</p>
      )}
      {rows.map(({ pending, answer }) => (
        <article key={pending.id + ':' + answer.id}>
          <h4>
            {answer.kind === 'fact' ? '事実についての回答' : '方法についての回答'} /{' '}
            {answer.taxYear}年
          </h4>
          <p>
            元の問い：{pending.reasons.join(' / ')} / 確認事項ID：{pending.id} / 制作物ID：
            {pending.taxUnitId}
          </p>
          <p>
            受領日：{answer.receivedOn} / 確認先・根拠：{answer.source}
          </p>
          <p style={{ whiteSpace: 'pre-wrap' }}>{answer.answer}</p>
          <p>
            {pending.resolution &&
            pending.resolution.taxYear <= year &&
            !consultationResolutionMatches(pending, requireQuestionBasis)
              ? '解消時の問い・対象額・回答・判断の対応が現在と一致しないため、解消の再確認が必要です。'
              : pending.resolution && pending.resolution.taxYear <= year
                ? `解消の判断：${pending.resolution.decisionId} / 解消理由：${pending.resolution.reason}`
                : 'この年までの解消判断は未登録です。回答だけでは金額や扱いを変更しません。'}
          </p>
        </article>
      ))}
    </section>
  )
}
