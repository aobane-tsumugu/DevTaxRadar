import { useState } from 'react'
import type { AnnualCostProjection } from '../../accounting/costs'
import type { PlanningSnapshot } from '../../planning/types'
import { projectCostTreatments } from '../../core/costTreatments'
import { decisionIsConfirmed } from '../../core/decisionConfirmation'
import { treatmentDecisionBindingMatches } from '../../core/treatmentDecisionBinding'
import { treatmentCandidateLabels } from '../../core/costTreatmentFacts'
import { yen } from './shared'
export default function TreatmentHandoffPanel({ costs, planning, disabled, onDecision, onBalance }: {
  costs: AnnualCostProjection
  planning: PlanningSnapshot
  disabled: boolean
  onDecision: (costs: AnnualCostProjection, contributionId: string, existingId?: string) => Promise<boolean>
  onBalance: (year: number, contributionId: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  let report
  try { report = projectCostTreatments(costs, planning) }
  catch { return <p role="status">費用と条件の対応を確認できません。最新の保存資料を読み直してください。</p> }
  const eligible = report.items.filter((row) => row.status === 'conditional' && row.taxUnitId)
  if (!eligible.length) return null
  async function draft(id: string, existingId?: string) {
    setBusy(true)
    try {
      const saved = await onDecision(costs, id, existingId)
      setMessage(saved ? '未確認の判断案を保存しました。費用入力の「処理の判断記録」で内容を確認してください。' : '判断案は保存していません。')
    } catch (error) { setMessage(error instanceof Error ? error.message : '判断案を保存できませんでした。') }
    finally { setBusy(false) }
  }
  return <section className="panel" aria-label="処理候補から判断と残高へ">
    <h3>候補を判断・残高の入力へつなぐ</h3>
    <p>判断案は未確認で保存します。既存の判断画面で確認後、残高の増加案へ進めます。通常経費を架空の資産へ増減させず、供用・費用化には既存の残額使用操作を使います。</p>
    {message && <p role="status">{message}</p>}
    {eligible.map((item) => {
      const decision = planning.decisions.find((row) => row.treatmentBinding?.costYear === costs.year && row.treatmentBinding.contributionId === item.contributionId)
      const current = decision && treatmentDecisionBindingMatches(decision, costs, planning)
      const ready = decision && current && decisionIsConfirmed(decision)
      return <article key={item.contributionId}>
        <p>{item.label} / {treatmentCandidateLabels[item.candidate]} / {yen.format(item.amountJpy)}</p>
        <button disabled={disabled || busy} onClick={() => void draft(item.contributionId, decision?.id)}>
          {decision ? '候補元を更新した判断案を確認・保存（未確認へ戻す）' : '未確認の判断案を確認・保存へ進む'}
        </button>
        {decision && <p>判断ID：{decision.id} / {ready ? '候補元一致・本人確認済み' : current ? '本人の判断確認待ち' : '候補元の再確認が必要'}</p>}
        {['software-acquisition-cost', 'production-cost', 'prepaid-expense'].includes(item.candidate) &&
          <button disabled={disabled || busy || !ready} onClick={() => onBalance(costs.year, item.contributionId)}>残高画面で未使用原価の増加案を作る</button>}
      </article>
    })}
  </section>
}
