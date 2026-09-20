import { useEffect, useRef, useState } from 'react'
import type { AnnualCostProjection } from '../../accounting/costs'
import type { BalanceSnapshot } from '../../accounting/types'
import type { PlanningSnapshot } from '../../planning/types'
import { draftTreatmentAddition } from '../../core/costTreatmentDraft'
import { getCostProjection, getRuntime } from '../api'
import { readTreatmentProjection } from '../treatmentProjectionRead'
import DateInput from './DateInput'
export type TreatmentBalanceRequest = { year: number; contributionId: string; request: number; datasetId?: string }
export default function TreatmentBalanceDraftPanel({ request, datasetId, snapshot, planning, disabled, onApply }: {
  request?: TreatmentBalanceRequest
  datasetId?: string
  snapshot: BalanceSnapshot
  planning: PlanningSnapshot
  disabled: boolean
  onApply: (snapshot: BalanceSnapshot) => void
}) {
  const [costs, setCosts] = useState<AnnualCostProjection | null>(null)
  const [accountId, setAccountId] = useState('')
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const generation = useRef(0)
  useEffect(() => { generation.current++; setCosts(null); setAccountId(''); setDate(''); setBusy(false); setMessage('')
    return () => { generation.current++ }
  }, [request?.request, request?.contributionId, request?.year, request?.datasetId, datasetId])
  if (!request || request.datasetId !== datasetId) return null
  const activeRequest = request
  async function load() {
    if (disabled || busy) return
    const token = ++generation.current
    setBusy(true)
    setCosts(null)
    try {
      const result = await readTreatmentProjection(datasetId, activeRequest.year, getRuntime, getCostProjection)
      if (token === generation.current) { setCosts(result); setMessage('最新の費用を読みました。まだ入力へ追加していません。') }
    } catch (error) { if (token === generation.current) setMessage(error instanceof Error ? error.message : '読込みに失敗しました。') }
    finally { if (token === generation.current) setBusy(false) }
  }
  function apply() {
    if (disabled || busy) return
    try {
      if (!costs) throw new Error('最新の費用を読み取ってください。')
      const decisions = planning.decisions.filter((row) => row.treatmentBinding?.costYear === activeRequest.year && row.treatmentBinding.contributionId === activeRequest.contributionId)
      if (decisions.length !== 1) throw new Error('対応する判断を一つに確認してください。')
      const next = draftTreatmentAddition(costs, planning, snapshot, {
        contributionId: activeRequest.contributionId, decisionId: decisions[0]!.id,
        accountId, occurredOn: date, id: crypto.randomUUID(),
      })
      onApply(next)
      setCosts(null)
      setMessage('増加案をこの画面の未保存入力へ追加しました。原価と参照を確認し、既存の保存操作で保存してください。')
    } catch (error) { setMessage(error instanceof Error ? error.message : '案を作れませんでした。元の入力は保持しています。') }
  }
  return <section className="panel" aria-label="処理候補から残高増加案">
    <h3>{request.year}年の候補から、未使用原価を取り込む</h3>
    <p>元の残高入力を保持して追加します。保存・年度採用ではありません。途中の振替や費用化は既存の残額使用で確認します。</p>
    {message && <p role="status">{message}</p>}
    <fieldset disabled={disabled || busy}>
      <legend>増加案の対象</legend>
      <button onClick={() => void load()}>最新の費用と候補元を読む</button>
      <label>既存の残高<select value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">選択してください</option>
        {snapshot.accounts.map((account) => <option key={account.id} value={account.id}>{account.name} / {account.kind}</option>)}</select></label>
      <label>増加日<DateInput value={date} onValueChange={setDate} /></label>
      <button disabled={!costs} onClick={apply}>原価上限を確認して、未保存の増加案へ追加</button>
    </fieldset>
  </section>
}
