import { useEffect, useRef, useState } from 'react'
import type { AnnualCostProjection } from '../../accounting/costs'
import type { PlanningSnapshot } from '../../planning/types'
import { treatmentPurposeLabels, validateCostTreatmentFacts, type CostTreatmentFacts } from '../../core/costTreatmentFacts'
import { costTreatmentBasis, newCostTreatmentFacts } from '../../core/costTreatments'
import { yen } from './shared'
import AnnualMethodFactsEditor from './AnnualMethodFactsEditor'

export type CostTreatmentReview = (
  next: CostTreatmentFacts | null, previous: CostTreatmentFacts | null,
) => Promise<boolean>

export default function CostTreatmentFactsEditor({ projection, planning, disabled, onReview }: {
  projection: AnnualCostProjection
  planning: PlanningSnapshot
  disabled: boolean
  onReview: CostTreatmentReview
}) {
  const [draft, setDraft] = useState<CostTreatmentFacts | null>(null)
  const previous = useRef<CostTreatmentFacts | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const records = planning.costTreatmentFacts ?? []
  const rows = projection.contributions.filter((row) => !row.consumedByBasisId &&
    (row.target.kind === 'tax-unit' || row.target.kind === 'general'))
  useEffect(() => {
    if (!draft) return
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', preventLoss)
    return () => window.removeEventListener('beforeunload', preventLoss)
  }, [draft])
  function edit(patch: Partial<CostTreatmentFacts>) {
    setDraft((value) => value && { ...value, ...patch, recordedAt: new Date().toISOString() })
  }
  function label(id: string): string {
    const row = projection.contributions.find((item) => item.id === id)
    if (!row) return '現在の対象年にない保存条件 / ' + id
    const source = row.sourceIds.map((sourceId) => projection.sources.find((s) => s.id === sourceId)?.label ?? '費用名未収録').join(' + ')
    const target = row.target.kind === 'tax-unit'
      ? planning.taxUnits.find((unit) => row.target.kind === 'tax-unit' && unit.id === row.target.taxUnitId)?.name ?? '制作物未登録'
      : '通常業務'
    const period = projection.bases.find((basis) => basis.id === row.basisId)?.period
    return `${source} / ${target} / ${period?.startedOn ?? ''}〜${period?.endedOn ?? ''} / ${yen.format(row.amountJpy)}`
  }
  function select(id: string) {
    try {
      const saved = records.find((row) => row.costYear === projection.year && row.contributionId === id)
      previous.current = saved ? structuredClone(saved) : null
      setDraft(saved ? structuredClone(saved) : newCostTreatmentFacts(projection, planning, id, crypto.randomUUID(), new Date().toISOString()))
      setMessage('まだ保存していません。金額は費用配分から読み取り、再入力しません。')
    } catch (error) { setMessage(error instanceof Error ? error.message : '条件を読み込めませんでした。') }
  }
  const sameYear = draft?.costYear === projection.year
  const available = sameYear && rows.some((row) => row.id === draft?.contributionId)
  async function review(next: CostTreatmentFacts | null, old: CostTreatmentFacts | null) {
    setBusy(true)
    try {
      if (next) validateCostTreatmentFacts([next])
      const saved = await onReview(next, old)
      if (saved) { setDraft(null); previous.current = null; setMessage('条件をworkspaceへ保存しました。年度資料の採用と残高記録は別の操作です。') }
      else setMessage('保存していません。編集中の条件は保持しています。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存できませんでした。入力は保持しています。')
    } finally { setBusy(false) }
  }
  const yesNo = (key: 'directlyAttributable' | 'serviceProvidedInCurrentPeriod' | 'workInProgressAtPeriodEnd' | 'liabilityFixedAtYearEnd' | 'paidByYearEnd', title: string) =>
    <label>{title}<select value={draft?.[key] === null ? 'unknown' : String(draft?.[key])}
      onChange={(event) => edit({ [key]: event.target.value === 'unknown' ? null : event.target.value === 'true' })}>
      <option value="unknown">未確認</option><option value="true">はい</option><option value="false">いいえ</option>
    </select></label>
  return <details className="panel cost-editor">
    <summary>費用の作業実態を記録し、処理候補へつなぐ</summary>
    <p>最終配分額に条件を結び付けます。全員への一律確認ではありません。未確認の条件も保存でき、不足や矛盾がある額は未算定に残します。</p>
    {message && <p role="status">{message}</p>}
    <fieldset disabled={disabled || busy}>
      <legend>{projection.year}年の最終配分</legend>
      <label>条件を記録する費用<select value="" disabled={Boolean(draft)} onChange={(event) => select(event.target.value)}>
        <option value="">選択してください</option>
        {rows.map((row) => <option key={row.id} value={row.id}>{label(row.id)}</option>)}
      </select></label>
      {draft && <>
        <h3>{label(draft.contributionId)}</h3>
        <p>対象年：{draft.costYear}年。以下は編集中の条件で、上の保存済み候補にはまだ反映していません。</p>
        <label>実際の作業目的<select value={draft.workPurpose} onChange={(event) => edit({ workPurpose: event.target.value as CostTreatmentFacts['workPurpose'] })}>
          {Object.entries(treatmentPurposeLabels).map(([value, title]) => <option key={value} value={value}>{title}</option>)}
        </select></label>
        <label>対象資産の種類<select value={draft.assetKind} onChange={(event) => edit({ assetKind: event.target.value as CostTreatmentFacts['assetKind'] })}>
          <option value="unknown">未確認</option><option value="software">ソフトウエア</option><option value="other">それ以外の資産</option><option value="none">資産の製作・改良ではない</option>
        </select></label>
        <label>この費用に対応する作業時点の供用状態<select value={draft.placedInService} onChange={(event) => edit({ placedInService: event.target.value as CostTreatmentFacts['placedInService'] })}>
          <option value="unknown">未確認</option><option value="before">未供用</option><option value="after">供用済み</option>
        </select></label>
        <p>対象期間の途中で供用状態が変わる場合は、一つの状態で全額を扱わず、期間と配分を先に見直してください。</p>
        {yesNo('serviceProvidedInCurrentPeriod', '対象年末までに当該サービスの提供を受けた')}
        {draft.serviceProvidedInCurrentPeriod === false && yesNo('paidByYearEnd', '対象年末までに当該サービスの対価を支払済みである')}
        {(draft.workPurpose === 'new-development' || draft.workPurpose === 'sales-production') && yesNo('directlyAttributable', '対象の製作へ直接対応する')}
        {draft.workPurpose === 'sales-production' && yesNo('workInProgressAtPeriodEnd', '対象年末に制作中の販売物である')}
        {['ordinary-operation', 'maintenance', 'bug-fix', 'restoration'].includes(draft.workPurpose) && yesNo('liabilityFixedAtYearEnd', '対象年末までに債務が確定している（減価償却は別途確認）')}
        <label>作業実態と確認した条件の理由<textarea value={draft.reason} maxLength={2000} onChange={(event) => edit({ reason: event.target.value })} /></label>
        <fieldset><legend>処理条件の根拠</legend>
          {planning.evidence.map((evidence) => <label key={evidence.id} className="balance-source-choice">
            <input type="checkbox" checked={draft.evidenceIds.includes(evidence.id)} onChange={(event) => edit({ evidenceIds: event.target.checked ? [...draft.evidenceIds, evidence.id] : draft.evidenceIds.filter((id) => id !== evidence.id) })} />{evidence.note}
          </label>)}
          {draft.evidenceIds.filter((id) => !planning.evidence.some((row) => row.id === id)).map((id) => <p key={id}>現在の一覧にない根拠：{id}。自動削除していません。</p>)}
        </fieldset>
        {available && <AnnualMethodFactsEditor costs={projection} planning={planning} facts={draft} onChange={(methodComparison) => edit({ methodComparison })} />}
        <button type="button" disabled={!available} onClick={() => {
          try { edit({ costBasis: costTreatmentBasis(projection, planning, draft.contributionId, draft.evidenceIds) }); setMessage('表示中の配分・方法・根拠を確認元にしました。まだ保存していません。') }
          catch (error) { setMessage(error instanceof Error ? error.message : '確認元を結べませんでした。') }
        }}>表示中の配分と根拠を確認して結び直す</button>
        {!available && <p>対象年または配分が表示中の資料と異なります。元の年に戻して確認してください。</p>}
        <button type="button" className="primary-button" onClick={() => void review(draft, previous.current)}>変更の影響を確認して保存へ進む</button>
        <button type="button" onClick={() => {
          if (window.confirm('編集中の処理条件だけを破棄します。保存済みの資料は変更しません。')) { setDraft(null); previous.current = null }
        }}>この入力を破棄</button>
        <p>保存前の入力は画面に保持します。タブを閉じないでください。影響確認のキャンセルでは入力を残します。</p>
      </>}
      <h3>保存済みの条件 {records.length}件</h3>
      {records.map((record) => <p key={record.id}>
        {record.costYear}年 / {treatmentPurposeLabels[record.workPurpose]} / {record.reason || '理由未入力'}{' '}
        <button type="button" disabled={Boolean(draft)} onClick={() => { previous.current = structuredClone(record); setDraft(structuredClone(record)) }}>見直す</button>{' '}
        <button type="button" disabled={Boolean(draft)} onClick={() => void review(null, record)}>削除の影響を確認</button>
      </p>)}
    </fieldset>
  </details>
}
