import { EDITOR_FILE_LIMIT } from '../editorRecovery'
import { useState } from 'react'
import type { AnnualCostProjection } from '../../accounting/costs'
import type { PlanningSnapshot } from '../../planning/types'
import { canonicalTreatmentValue, treatmentPurposeLabels, validateCostTreatmentFacts, type CostTreatmentFacts } from '../../core/costTreatmentFacts'
import { costTreatmentBasis, newCostTreatmentFacts } from '../../core/costTreatments'
import { yen } from './shared'
import AnnualMethodFactsEditor from './AnnualMethodFactsEditor'
import { useEditorRecovery } from '../useEditorRecovery'
import { reusableTreatmentFacts, proposeCommonTreatmentFacts } from '../../core/treatmentFactsReuse'
import { validTreatmentEditorValue, editTreatmentMethodNumber, assertTreatmentEditorSave, type TreatmentEditorValue } from '../treatmentEditorValue'

export type CostTreatmentReview = (
  next: CostTreatmentFacts | null, previous: CostTreatmentFacts | null,
) => Promise<boolean>

export default function CostTreatmentFactsEditor({ projection, planning, disabled, onReview, datasetId, parentRevision }: {
  datasetId: string
  parentRevision: number
  projection: AnnualCostProjection
  planning: PlanningSnapshot
  disabled: boolean
  onReview: CostTreatmentReview
}) {
  const recovery = useEditorRecovery<TreatmentEditorValue>(datasetId, 'cost-treatment', parentRevision, validTreatmentEditorValue)
  const draft = recovery.value?.draft ?? null
  const previous = recovery.value?.previous ?? null
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const records = planning.costTreatmentFacts ?? []
  const rows = projection.contributions.filter((row) => !row.consumedByBasisId &&
    (row.target.kind === 'tax-unit' || row.target.kind === 'general'))
  function edit(patch: Partial<CostTreatmentFacts>) {
    if (draft) recovery.change({ ...recovery.value, previous,
      numericInputs: 'methodComparison' in patch && (!patch.methodComparison || !draft.methodComparison)
        ? undefined : recovery.value?.numericInputs,
      draft: { ...draft, ...patch, recordedAt: new Date().toISOString() } })
  }
  /**
   * Choosing evidence is itself part of confirming the displayed allocation. When nothing but the
   * evidence differs from the confirmed basis, re-anchor it so the saved condition is not stale on
   * arrival; a changed amount, period or target still needs the explicit re-binding below.
   */
  function selectEvidence(evidenceIds: string[]) {
    if (!draft) return
    try {
      const unchangedOtherwise =
        draft.costYear === projection.year &&
        costTreatmentBasis(projection, planning, draft.contributionId, draft.evidenceIds) === draft.costBasis
      edit(unchangedOtherwise
        ? { evidenceIds, costBasis: costTreatmentBasis(projection, planning, draft.contributionId, evidenceIds) }
        : { evidenceIds })
    } catch { edit({ evidenceIds }) }
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
      recovery.change({ previous: saved ? structuredClone(saved) : null,
        draft: saved ? structuredClone(saved) : newCostTreatmentFacts(projection, planning, id, crypto.randomUUID(), new Date().toISOString()) })
      setMessage('まだ保存していません。金額は費用配分から読み取り、再入力しません。')
    } catch (error) { setMessage(error instanceof Error ? error.message : '条件を読み込めませんでした。') }
  }
  const latestRecord = draft ? records.find((record) => record.id === draft.id ||
    (record.costYear === draft.costYear && record.contributionId === draft.contributionId)) ?? null : null
  const conflicting = Boolean(draft && canonicalTreatmentValue(previous) !== canonicalTreatmentValue(latestRecord))
  const sameYear = draft?.costYear === projection.year
  const available = sameYear && rows.some((row) => row.id === draft?.contributionId)
  async function review(next: CostTreatmentFacts | null, old: CostTreatmentFacts | null) {
    setBusy(true)
    try {
      if (next) {
        if (recovery.value) assertTreatmentEditorSave({ ...recovery.value, draft: next })
        else validateCostTreatmentFacts([next])
      }
      const saved = await onReview(next, old)
      if (saved) { recovery.close(); setMessage('条件をworkspaceへ保存しました。年度資料の採用と残高記録は別の操作です。') }
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
    {recovery.warning && <p role="alert">{recovery.warning}</p>}
    {recovery.unreadable > 0 && <p role="alert">読めない編集控えが{recovery.unreadable}件あります。削除していません。</p>}
    {!draft && recovery.copies.length > 0 && <section aria-label="未送信の編集控え">
      <h3>未送信の条件・方法比較を再開</h3>
      <p>同じデータセットの控えだけ表示します。復旧しても自動保存・自動送信しません。</p>
      {recovery.copies.map(({ copy, raw }) => <p key={copy.id}>{copy.value.draft.costYear}年 / 保存元{copy.parentRevision}版 / {copy.updatedAt}{' '}
        <button type="button" disabled={disabled || busy} onClick={() => recovery.restore(raw)}>内容を復旧する</button></p>)}
    </section>}
    {!draft && <label>個人用の編集控えを復旧<input type="file" disabled={disabled || busy} accept="application/json,.json" onChange={(event) => {
      const file = event.target.files?.[0]
      event.currentTarget.value = ''
      if (!file) return
      if (file.size > EDITOR_FILE_LIMIT) { setMessage('編集控えが大きすぎます。元ファイルは保持してください。'); return }
      void file.text().then((raw) => recovery.restore(raw, true)).catch(() => setMessage('編集控えファイルを読み取れません。'))
    }} /></label>}
    <fieldset disabled={disabled || busy}>
      <legend>{projection.year}年の最終配分</legend>
      <label>条件を記録する費用<select value="" disabled={Boolean(draft)} onChange={(event) => select(event.target.value)}>
        <option value="">選択してください</option>
        {rows.map((row) => <option key={row.id} value={row.id}>{label(row.id)}</option>)}
      </select></label>
      {draft && <>
        <h3>{label(draft.contributionId)}</h3>
        {conflicting && <section className="panel" aria-label="処理条件の競合">
          <p role="alert">入力開始後に同じ条件が保存・削除されています。現在の保存と編集中の内容を両方保持しています。</p>
          <p>現在の保存：{latestRecord ? `${treatmentPurposeLabels[latestRecord.workPurpose]} / ${latestRecord.reason || '理由未入力'}` : 'この条件は削除済み'}</p>
          <p>編集中：{treatmentPurposeLabels[draft.workPurpose]} / {draft.reason || '理由未入力'}</p>
          <details><summary>両方の条件を比較</summary><pre>{JSON.stringify({ current: latestRecord, editing: draft }, null, 2)}</pre></details>
          <button type="button" onClick={() => recovery.rebase({ ...recovery.value!,
            draft: { ...draft, id: latestRecord?.id ?? draft.id }, previous: latestRecord ? structuredClone(latestRecord) : null,
          }, parentRevision)}>現在の保存を基準に、この編集内容の影響確認へ進む</button>
          <p>この操作だけでは保存しません。削除済みの条件を再登録する場合も、次の保存操作で確認します。</p>
        </section>}
        <p>対象年：{draft.costYear}年。以下は編集中の条件で、上の保存済み候補にはまだ反映していません。</p>
        {available && <details><summary>同じ制作物の共通事実を再利用する</summary>
          <p>既存の作業目的・資産種類・直接対応・理由・根拠を、この期間の編集案へ写します。支払・提供・年末の状態、金額、確認済み判断は流用しません。</p>
          {reusableTreatmentFacts(projection, planning, draft).map((source) => <p key={source.id}>
            {source.costYear}年 / {treatmentPurposeLabels[source.workPurpose]} / {source.reason}{' '}
            <button type="button" onClick={() => {
              try { edit(proposeCommonTreatmentFacts(projection, planning, draft, source)); setMessage('共通事実を編集案へ反映しました。この期間の例外を確認してください。保存・判断確認はまだ行っていません。') }
              catch (error) { setMessage(error instanceof Error ? error.message : '共通事実を再利用できません。') }
            }}>この共通事実を使う</button></p>)}
        </details>}
        <label>実際の作業目的<select value={draft.workPurpose} onChange={(event) => edit({ workPurpose: event.target.value as CostTreatmentFacts['workPurpose'] })}>
          {Object.entries(treatmentPurposeLabels).map(([value, title]) => <option key={value} value={value}>{title}</option>)}
        </select></label>
        {draft.workPurpose !== 'ordinary-operation' && <><label>対象資産の種類<select value={draft.assetKind} onChange={(event) => edit({ assetKind: event.target.value as CostTreatmentFacts['assetKind'] })}>
          <option value="unknown">未確認</option><option value="software">ソフトウエア</option><option value="other">それ以外の資産</option><option value="none">資産の製作・改良ではない</option>
        </select></label>
        <label>この費用に対応する作業時点の供用状態<select value={draft.placedInService} onChange={(event) => edit({ placedInService: event.target.value as CostTreatmentFacts['placedInService'] })}>
          <option value="unknown">未確認</option><option value="before">未供用</option><option value="after">供用済み</option>
        </select></label>
        <p>対象期間の途中で供用状態が変わる場合は、一つの状態で全額を扱わず、期間と配分を先に見直してください。</p></>}
        {yesNo('serviceProvidedInCurrentPeriod', '対象年末までに当該サービスの提供を受けた')}
        {draft.serviceProvidedInCurrentPeriod === false && yesNo('paidByYearEnd', '対象年末までに当該サービスの対価を支払済みである')}
        {(draft.workPurpose === 'new-development' || draft.workPurpose === 'sales-production') && yesNo('directlyAttributable', '対象の製作へ直接対応する')}
        {draft.workPurpose === 'sales-production' && yesNo('workInProgressAtPeriodEnd', '対象年末に制作中の販売物である')}
        {['ordinary-operation', 'maintenance', 'bug-fix', 'restoration'].includes(draft.workPurpose) && yesNo('liabilityFixedAtYearEnd', '対象年末までに債務が確定している（減価償却は別途確認）')}
        <label>作業実態と確認した条件の理由<textarea value={draft.reason} maxLength={2000} onChange={(event) => edit({ reason: event.target.value })} /></label>
        <fieldset><legend>処理条件の根拠</legend>
          {planning.evidence.map((evidence) => <label key={evidence.id} className="balance-source-choice">
            <input type="checkbox" checked={draft.evidenceIds.includes(evidence.id)} onChange={(event) => selectEvidence(event.target.checked ? [...draft.evidenceIds, evidence.id] : draft.evidenceIds.filter((id) => id !== evidence.id))} />{evidence.note}
          </label>)}
          {draft.evidenceIds.filter((id) => !planning.evidence.some((row) => row.id === id)).map((id) => <p key={id}>現在の一覧にない根拠：{id}。自動削除していません。</p>)}
        </fieldset>
        {available && <AnnualMethodFactsEditor costs={projection} planning={planning} facts={draft}
          numericInputs={recovery.value?.numericInputs}
          onNumericInput={(key, raw) => {
            if (recovery.value) recovery.change(editTreatmentMethodNumber(recovery.value, key, raw))
          }} onChange={(methodComparison) => edit({ methodComparison })} />}
        <button type="button" disabled={!available} onClick={() => {
          try { edit({ costBasis: costTreatmentBasis(projection, planning, draft.contributionId, draft.evidenceIds) }); setMessage('表示中の配分・方法・根拠を確認元にしました。まだ保存していません。') }
          catch (error) { setMessage(error instanceof Error ? error.message : '確認元を結べませんでした。') }
        }}>表示中の配分と根拠を確認して結び直す</button>
        {!available && <p>対象年または配分が表示中の資料と異なります。元の年に戻して確認してください。</p>}
        <button type="button" className="primary-button" disabled={conflicting} onClick={() => void review(draft, previous)}>変更の影響を確認して保存へ進む</button>
        <button type="button" onClick={() => {
          if (window.confirm('編集中の処理条件だけを破棄します。保存済みの資料は変更しません。')) { recovery.close() }
        }}>この入力を破棄</button>
        <button type="button" onClick={recovery.exportCopy}>個人用の編集控えをファイルへ保存</button>
        <p>未送信の入力と元の条件をブラウザ内に保存します。容量・権限エラー時は画面の入力を保持し、上の警告を表示します。控えには自由記述が含まれます。影響確認のキャンセルでは入力を残します。</p>
      </>}
      <h3>保存済みの条件 {records.length}件</h3>
      {records.map((record) => <p key={record.id}>
        {record.costYear}年 / {treatmentPurposeLabels[record.workPurpose]} / {record.reason || '理由未入力'}{' '}
        <button type="button" disabled={Boolean(draft)} onClick={() => { recovery.change({ previous: structuredClone(record), draft: structuredClone(record) }) }}>見直す</button>{' '}
        <button type="button" disabled={Boolean(draft)} onClick={() => void review(null, record)}>削除の影響を確認</button>
      </p>)}
    </fieldset>
  </details>
}
