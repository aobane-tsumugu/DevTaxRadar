import { useEffect, useRef, useState } from 'react'
import type { AnnualCostProjection } from '../../accounting/costs'
import type { BalanceDraft } from '../../accounting/balanceWorkspace'
import type { EvidenceRecord } from '../../planning/types'
import { convertedYen, sourceAdjustmentBasis, validateSourceAdjustments, type SourceAdjustmentRecord, type CurrencyConversion } from '../../core/sourceAdjustments'
import { getBalanceDraft } from '../api'
import SourceAdjustmentDetails, { adjustmentEffects } from './SourceAdjustmentDetails'
import DateInput from './DateInput'
import { yen } from './shared'

export type AdjustmentReview = (next: SourceAdjustmentRecord | null, previous: SourceAdjustmentRecord | null) => Promise<boolean>

export default function SourceAdjustmentsEditor({ projection, records, evidence, datasetId, disabled, onReview }: {
  projection: AnnualCostProjection
  records: readonly SourceAdjustmentRecord[]
  evidence: readonly EvidenceRecord[]
  datasetId: string
  disabled: boolean
  onReview: AdjustmentReview
}) {
  const [draft, setDraft] = useState<SourceAdjustmentRecord | null>(null)
  const previous = useRef<SourceAdjustmentRecord | null>(null)
  const [balances, setBalances] = useState<BalanceDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (!draft) return
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', preventLoss)
    return () => window.removeEventListener('beforeunload', preventLoss)
  }, [draft])
  const source = projection.sources.find((row) => row.id === draft?.sourceId)
  function edit(patch: Partial<SourceAdjustmentRecord>) {
    setDraft((current) => current && { ...current, ...patch, recordedAt: new Date().toISOString() })
  }
  function newRecord(sourceId: string) {
    const selected = projection.sources.find((row) => row.id === sourceId)
    if (!selected) return
    previous.current = null
    setDraft({
      id: crypto.randomUUID(), sourceId, sourceYear: projection.year,
      sourceBasis: sourceAdjustmentBasis(selected), kind: 'refund', amountJpy: NaN,
      occurredOn: '', recordedAt: new Date().toISOString(), effect: 'undetermined', reason: '', evidenceIds: [],
    })
    setMessage('まだ保存していません。対象期間・金額・根拠を確認してください。')
  }
  async function review(next: SourceAdjustmentRecord | null, old: SourceAdjustmentRecord | null) {
    setBusy(true)
    try {
      if (next) validateSourceAdjustments([next])
      const saved = await onReview(next, old)
      if (saved) {
        setDraft(null)
        previous.current = null
        setMessage('返金・訂正を料金・計画と一緒に保存しました。年度資料の採用は別の操作です。')
      } else setMessage('保存していません。入力は保持しています。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存できませんでした。入力は保持しています。')
    } finally { setBusy(false) }
  }
  async function readReductions() {
    setBusy(true)
    try {
      const next = await getBalanceDraft()
      if (next.datasetId !== datasetId) throw new Error('接続先の資料が変わっています。再読込してください。')
      setBalances(next)
      setMessage('保存済みの残高減少を読みました。選択だけでは残高を書き換えません。')
    } catch (error) { setMessage(error instanceof Error ? error.message : '残高減少を読み込めませんでした。') }
    finally { setBusy(false) }
  }
  const reductions = balances?.snapshot.movements.filter((row) => row.kind === 'reduction' && row.sourceIds.includes(draft?.sourceId ?? '')) ?? []
  function conversionChange(patch: Partial<CurrencyConversion>) {
    if (draft?.conversion) edit({ conversion: { ...draft.conversion, ...patch } })
  }
  return <section className="panel cost-editor" aria-label="返金と訂正の入力">
    <h2>返金・訂正を元の費用へ結び付ける</h2>
    <p>元の請求額を消さず、返金・訂正の額、対象期間、根拠を別に残します。扱いが未定でも保存できます。</p>
    <p>現在の選択肢は{projection.year}年の費用です。別の年の費用は上の年を変更して表示してください。保存済みの返金記録は年をまたいで一覧に残ります。</p>
    {message && <p role="status">{message}</p>}
    <fieldset disabled={disabled || busy}>
      <legend>元の費用を選ぶ</legend>
      <label>返金・訂正する支払
        <select value="" disabled={Boolean(draft)} onChange={(event) => newRecord(event.target.value)}>
          <option value="">選択してください</option>
          {projection.sources.map((row) => <option key={row.id} value={row.id}>{row.label} / {row.originalAmountJpy === null ? '原額不明' : yen.format(row.originalAmountJpy)}</option>)}
        </select>
      </label>
      {draft && <>
        <h3>{source?.label ?? '別の対象年または現在の費用一覧にない記録'}</h3>
        <p>確認した原額：{draft.sourceBasis.originalAmountJpy === null ? '不明' : yen.format(draft.sourceBasis.originalAmountJpy)} / 参照年：{draft.sourceYear}</p>
        <label>記録の種類<select value={draft.kind} onChange={(event) => edit({ kind: event.target.value as SourceAdjustmentRecord['kind'] })}><option value="refund">返金</option><option value="correction">金額の訂正</option></select></label>
        <label>増減する円額（返金・減額は負数）<input type="number" step="1" value={Number.isFinite(draft.amountJpy) ? draft.amountJpy : ''} onChange={(event) => edit({ amountJpy: event.target.valueAsNumber })} /></label>
        <label>返金・訂正の発生日<DateInput value={draft.occurredOn} onValueChange={(occurredOn) => edit({ occurredOn })} /></label>
        <label>確認した扱い<select value={draft.effect} onChange={(event) => edit({ effect: event.target.value as SourceAdjustmentRecord['effect'], balanceMovementId: undefined })}>
          {Object.entries(adjustmentEffects).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        {draft.effect === 'restate-original-cost' && <p>元費用の利用期間へ訂正額を反映し、期間・利用量から配分をやり直します。返金受領年の費用へ機械的に加減算しません。設備・旧版残高の単純減算は未対応として保留します。</p>}
        {draft.effect === 'balance-reduction' && <>
          <p>原額は変えず、既存の「その他減少」と対応させます。先に残高画面で原価と判断を確認してください。同じ減少を複数の返金へ結び付けません。</p>
          <button type="button" onClick={() => void readReductions()}>保存済みの残高減少を読む</button>
          <label>対応する残高減少<select value={draft.balanceMovementId ?? ''} onChange={(event) => edit({ balanceMovementId: event.target.value || undefined })}>
            <option value="">選択してください</option>
            {reductions.map((row) => <option key={row.id} value={row.id}>{row.occurredOn} / {yen.format(row.amountJpy)} / {row.reason}</option>)}
            {draft.balanceMovementId && !reductions.some((row) => row.id === draft.balanceMovementId) && <option value={draft.balanceMovementId}>保存された参照（最新との照合が必要）</option>}
          </select></label>
        </>}
        <label>対象期間と扱いの理由<textarea value={draft.reason} maxLength={2000} onChange={(event) => edit({ reason: event.target.value })} /></label>
        <fieldset><legend>根拠となる証拠（1件以上）</legend>
          {evidence.map((row) => <label key={row.id} className="balance-source-choice"><input type="checkbox" checked={draft.evidenceIds.includes(row.id)} onChange={(event) => edit({ evidenceIds: event.target.checked ? [...draft.evidenceIds, row.id] : draft.evidenceIds.filter((id) => id !== row.id) })} />{row.note}</label>)}
          {draft.evidenceIds.filter((id) => !evidence.some((row) => row.id === id)).map((id) => <p key={id}>現在の一覧にない証拠参照：{id}。自動で削除していません。</p>)}
        </fieldset>
        <label><input type="checkbox" checked={Boolean(draft.conversion)} onChange={(event) => edit({ conversion: event.target.checked ? { currency: 'USD', foreignAmount: '', jpyPerUnit: '', rounding: 'nearest-yen', convertedOn: '', reference: '' } : undefined })} />外貨の換算根拠を記録する</label>
        {draft.conversion && <fieldset><legend>円換算の確認内容</legend>
          <label>通貨コード<input value={draft.conversion.currency} maxLength={3} onChange={(event) => conversionChange({ currency: event.target.value.toUpperCase() })} /></label>
          <label>外貨額（正数）<input inputMode="decimal" value={draft.conversion.foreignAmount} onChange={(event) => conversionChange({ foreignAmount: event.target.value })} /></label>
          <label>1通貨単位あたりの円<input inputMode="decimal" value={draft.conversion.jpyPerUnit} onChange={(event) => conversionChange({ jpyPerUnit: event.target.value })} /></label>
          <label>円未満の処理<select value={draft.conversion.rounding} onChange={(event) => conversionChange({ rounding: event.target.value as CurrencyConversion['rounding'] })}><option value="nearest-yen">四捨五入</option><option value="floor-yen">切捨て</option><option value="ceiling-yen">切上げ</option></select></label>
          <label>換算日<DateInput value={draft.conversion.convertedOn} onValueChange={(convertedOn) => conversionChange({ convertedOn })} /></label>
          <label>換算率と方法の確認先<textarea value={draft.conversion.reference} onChange={(event) => conversionChange({ reference: event.target.value })} /></label>
          <button type="button" onClick={() => {
            try { edit({ amountJpy: convertedYen(draft.conversion!) * (draft.kind === 'refund' || draft.amountJpy < 0 ? -1 : 1) }) }
            catch (error) { setMessage(error instanceof Error ? error.message : '換算条件を確認してください。') }
          }}>確認した換算根拠から円額を入力</button>
        </fieldset>}
        <button type="button" disabled={!source} onClick={() => {
          if (!source) return
          edit({ sourceBasis: sourceAdjustmentBasis(source), sourceYear: projection.year })
          setMessage('表示中の原額と期間を新しい確認内容にしました。まだ保存していません。')
        }}>表示中の原額・期間を確認して結び直す</button>
        <button type="button" className="primary-button" onClick={() => void review(draft, previous.current)}>変更の影響を確認して保存へ進む</button>
        <button type="button" onClick={() => {
          if (!window.confirm('編集中の返金・訂正だけを破棄します。保存済みの記録は変更しません。')) return
          setDraft(null); previous.current = null
        }}>この入力を破棄</button>
        <p>編集中の入力はこの画面に保持します。保存前にタブを閉じないでください。変更の影響画面でのキャンセルでは入力を残します。</p>
      </>}
      <h3>保存済みの返金・訂正 {records.length}件</h3>
      {!records.length && <p>返金・訂正の記録はありません。</p>}
      {records.map((row) => <article key={row.id}>
        <SourceAdjustmentDetails records={[row]} />
        <button type="button" disabled={Boolean(draft)} onClick={() => { previous.current = structuredClone(row); setDraft(structuredClone(row)); setMessage('保存済み記録を入力へ読みました。保存するまで変更しません。') }}>この記録を見直す</button>
        <button type="button" disabled={Boolean(draft)} onClick={() => void review(null, row)}>この訂正の削除による影響を確認</button>
      </article>)}
    </fieldset>
  </section>
}
