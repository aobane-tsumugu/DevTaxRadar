import { useEffect, useRef, useState } from 'react'
import type { BalanceSnapshot } from '../../accounting/types'
import type { BalancePreview } from '../../accounting/balanceWorkspace'
import type { PlanningSnapshot } from '../../planning/types'
import type { SoftwareMethod } from '../../core/softwareMethod'
import { canonicalSoftwareValue } from '../../core/softwareMethod'
import { chooseSoftwareMethod, draftSoftwareYearExpense, endSoftwareOrdinaryMethod } from '../../core/softwareMethodDraft'
import { decisionIsConfirmed } from '../../core/decisionConfirmation'
import { getBalanceDraft, getBalancePreview, getRuntime, getWorkspace } from '../api'
import { readSoftwareMethodPreview } from '../softwareMethodRead'
import { useEditorRecovery } from '../useEditorRecovery'
import { EDITOR_FILE_LIMIT } from '../editorRecovery'
import { validSoftwareMethodForm, softwareMethodAlternatives, type SoftwareMethodForm } from '../softwareMethodForm'
import DateInput from './DateInput'
import { yen } from './shared'

const labels = { 'straight-line': '通常の定額法', 'immediate-expense': '供用年の全額費用', 'three-year-pool': '3年一括償却' }
type Context = { preview: BalancePreview; signature: string; accountId: string; year: number }
export default function SoftwareMethodPanel({ datasetId, snapshot, planning, busy, edit }: {
  datasetId?: string; snapshot: BalanceSnapshot; planning: PlanningSnapshot; busy: boolean
  edit: (change: (snapshot: BalanceSnapshot) => void) => void
}) {
  const [accountId, setAccountId] = useState('')
  const [year, setYear] = useState(String(planning.profile.taxYear))
  const [context, setContext] = useState<Context>()
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [showComparison, setShowComparison] = useState(false)
  const recovery = useEditorRecovery<SoftwareMethodForm>(datasetId ?? 'unconnected', 'software-method', context?.preview.draftRevision ?? 0, validSoftwareMethodForm)
  const form = recovery.value
  const sequence = useRef(0)
  const latest = useRef({ snapshot, datasetId, busy })
  latest.current = { snapshot, datasetId, busy }
  const request = useRef<{ key: string; id: string } | undefined>(undefined)
  useEffect(() => () => { sequence.current++ }, [])
  function invalidate() { sequence.current++; setContext(undefined); setLoading(false); setShowComparison(false); setMessage('') }
  async function load(selectedId = accountId, selectedYear = Number(year)) {
    if (!datasetId || busy || loading || !selectedId) return
    const token = ++sequence.current
    setLoading(true); setContext(undefined); setMessage(''); setShowComparison(false)
    try {
      const saved = await getBalanceDraft()
      if (saved.datasetId !== datasetId) throw new Error('接続先が変わりました。入力は保持しています。')
      const preview = await readSoftwareMethodPreview(datasetId, saved.revision, snapshot, selectedYear, getRuntime, getBalancePreview)
      if (token !== sequence.current || latest.current.datasetId !== datasetId || canonicalSoftwareValue(latest.current.snapshot) !== canonicalSoftwareValue(snapshot)) return
      const account = snapshot.accounts.find((row) => row.id === selectedId)
      if (!account || account.kind !== 'asset') throw new Error('ソフトウェアの資産を選択してください。')
      const source = account.softwareMethod
      const incoming = snapshot.movements.filter((row) => row.kind === 'transfer' && row.toAccountId === account.id)
      const decisions = preview.materials!.planning.decisions.filter((row) => row.taxUnitId === account.taxUnitId && row.taxYear === selectedYear && decisionIsConfirmed(row) && !row.treatmentBinding && row.selectedCandidate === 'ordinary-expense')
      const initial: SoftwareMethodForm = {
        accountId: account.id, acquisitionMovementId: source?.acquisitionMovementId ?? (incoming.length === 1 ? incoming[0]!.id : ''),
        method: source?.method ?? '', usedOn: source?.usedOn ?? '', life: source?.usefulLifeYears ? String(source.usefulLifeYears) : '',
        rental: source?.rentalUse ?? '', business: source?.businessOnly === true, ordinary: source?.ordinaryConditions === true,
        rounding: source?.roundingConfirmed ?? false, evidenceIds: [...(source?.evidenceIds ?? [])], reason: source?.reason ?? '',
        year: String(selectedYear), decisionId: decisions.length === 1 ? decisions[0]!.id : '', ordinaryYear: false,
        endYear: source?.ordinaryThroughYear === undefined ? '' : String(source.ordinaryThroughYear), endReason: source?.terminationReason ?? '',
      }
      setContext({ preview, signature: canonicalSoftwareValue(snapshot), accountId: account.id, year: selectedYear })
      if (!recovery.value) recovery.change(initial, preview.draftRevision)
    } catch (error) { if (token === sequence.current) setMessage(error instanceof Error ? error.message : '同じ保存版を読めません。') }
    finally { if (token === sequence.current) setLoading(false) }
  }
  function change(patch: Partial<SoftwareMethodForm>) { if (form) recovery.change({ ...form, ...patch }) }
  const ready = context && form && context.accountId === form.accountId && context.year === Number(form.year) && context.signature === canonicalSoftwareValue(snapshot)
  const sourcePlanning = context?.preview.materials?.planning
  const eligibility = (() => {
    if (!ready || !form || !sourcePlanning) return { alternatives: [], reason: '' }
    const origin = snapshot.movements.find((row) => row.id === form.acquisitionMovementId)
    if (!origin) return { alternatives: [], reason: '全体取得原価の振替を確認してください。' }
    try { return { alternatives: softwareMethodAlternatives(form, origin.amountJpy, origin.occurredOn, sourcePlanning.profile), reason: '' } }
    catch (error) { return { alternatives: [], reason: error instanceof Error ? error.message : '方法の条件を確認してください。' } }
  })()
  const selectedScenario = eligibility.alternatives.find((row) => row.method === form?.method)
  function selection() {
    if (!ready || !form || !sourcePlanning || !form.business || !form.ordinary || selectedScenario?.status !== 'conditional')
      throw new Error('対象方法の適用条件と保存版を確認してください。')
    const retained = snapshot.accounts.find((row) => row.id === form.accountId)?.softwareMethod
    return chooseSoftwareMethod(snapshot, sourcePlanning, form.accountId, {
      ...(retained?.ordinaryThroughYear === undefined ? {} : { ordinaryThroughYear: retained.ordinaryThroughYear, terminationReason: retained.terminationReason }),
      acquisitionMovementId: form.acquisitionMovementId, method: form.method as SoftwareMethod['method'], usedOn: form.usedOn,
      usefulLifeYears: form.method === 'straight-line' ? Number(form.life) as 3 | 5 : null,
      businessOnly: true, ordinaryConditions: true, rentalUse: form.rental as SoftwareMethod['rentalUse'],
      roundingConfirmed: form.rounding, allocationPolicy: 'proportional-largest-remainder',
      evidenceIds: form.evidenceIds, reason: form.reason, confirmedAt: new Date().toISOString(),
    })
  }
  async function apply(kind: 'method' | 'expense' | 'end') {
    if (!ready || !context || !form || !sourcePlanning || busy || loading) return
    const token = ++sequence.current, signature = context.signature
    setLoading(true); setMessage('')
    try {
      if ((await getRuntime()).datasetId !== datasetId || (await getWorkspace()).revision !== context.preview.materials!.workspaceRevision ||
          (await getBalanceDraft()).revision !== context.preview.draftRevision || (await getRuntime()).datasetId !== datasetId)
        throw new Error('接続先か保存版が変わりました。入力を保持して再読取りしてください。')
      if (token !== sequence.current || latest.current.datasetId !== datasetId || latest.current.busy || canonicalSoftwareValue(latest.current.snapshot) !== signature) return
      let next: BalanceSnapshot
      if (kind === 'method') next = selection()
      else if (kind === 'end') next = endSoftwareOrdinaryMethod(snapshot, form.accountId, Number(form.endYear), form.endReason)
      else {
        const key = JSON.stringify([signature, form.accountId, form.year, form.decisionId])
        request.current = request.current?.key === key ? request.current : { key, id: crypto.randomUUID() }
        next = draftSoftwareYearExpense(snapshot, sourcePlanning, context.preview.materials!.costLinks!.costs, {
          accountId: form.accountId, year: Number(form.year), decisionId: form.decisionId,
          requestId: request.current.id, ordinaryYearConfirmed: form.ordinaryYear,
        })
      }
      if (canonicalSoftwareValue(next) === signature) { setMessage('変更や追加すべき年額はありません。0円だけの記録や同じ方法の再登録は行いません。'); return }
      edit((current) => {
        if (canonicalSoftwareValue(current) !== signature) throw new Error('入力が変わりました。元の入力を保持して再読取りしてください。')
        current.accounts = next.accounts; current.movements = next.movements
      })
      setContext(undefined); setMessage('未保存の残高入力へ反映しました。上の「作業中の残高を保存」と年度確認へ進んでください。方法の編集控えも保持しています。')
    } catch (error) { if (token === sequence.current) { setContext(undefined); setMessage(error instanceof Error ? error.message : '反映できません。入力は保持しています。') } }
    finally { if (token === sequence.current) setLoading(false) }
  }
  if (!datasetId || !snapshot.accounts.some((row) => row.kind === 'asset')) return null
  const account = snapshot.accounts.find((row) => row.id === form?.accountId)
  const decisions = (sourcePlanning?.decisions ?? []).filter((row) => row.taxUnitId === account?.taxUnitId && row.taxYear === Number(form?.year) && decisionIsConfirmed(row) && !row.treatmentBinding && row.selectedCandidate === 'ordinary-expense')
  return <details className="panel" aria-label="ソフトウェアの方法と年額">
    <summary>取得原価から、方法を選んで年額を残高入力へつなぐ</summary>
    <p>原価は資産振替から読み、金額を転記しません。試算は保存済みの方法・年度資料を変更しません。青色特例や特殊調整の年額採用は、この通常経路の対象外です。</p>
    {message && <p role="status">{message}</p>}{recovery.warning && <p role="alert">{recovery.warning}</p>}
    {recovery.unreadable > 0 && <p role="alert">読めない控え{recovery.unreadable}件は保持しています。</p>}
    {!form && recovery.copies.map(({ copy, raw }) => <p key={copy.id}>{copy.updatedAt} / 保存元{copy.parentRevision}版{' '}<button type="button" disabled={busy || loading} onClick={() => recovery.restore(raw)}>方法の入力を復旧</button></p>)}
    {!form && <label>個人用の編集控えを復旧<input type="file" disabled={busy || loading} accept="application/json,.json" onChange={(event) => {
      const file = event.target.files?.[0]; event.currentTarget.value = ''
      if (!file) return
      if (file.size > EDITOR_FILE_LIMIT) { setMessage('控えの上限を超えています。元ファイルは保持してください。'); return }
      void file.text().then((raw) => recovery.restore(raw, true)).catch(() => setMessage('ファイルを読み取れません。'))
    }} /></label>}
    {!form && <fieldset disabled={busy || loading}><legend>保存済みのソフトウェア資産</legend>
      <select aria-label="方法を選ぶ資産" value={accountId} onChange={(event) => { invalidate(); setAccountId(event.target.value) }}>
        <option value="">選択してください</option>{snapshot.accounts.filter((row) => row.kind === 'asset' && planning.taxUnits.some((unit) => unit.id === row.taxUnitId && ['new-software', 'improvement-plan'].includes(unit.unitType))).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select><label>確認年<input inputMode="numeric" value={year} onChange={(event) => { invalidate(); setYear(event.target.value) }} /></label>
      <button type="button" onClick={() => void load()}>同じ保存版から原価と条件を読む</button>
    </fieldset>}
    {form && <fieldset disabled={busy || loading}><legend>{account?.name ?? form.accountId}の方法・年額</legend>
      <label>対象年<input inputMode="numeric" value={form.year} onChange={(event) => { invalidate(); change({ year: event.target.value }) }} /></label>
      <button type="button" onClick={() => void load(form.accountId, Number(form.year))}>保存版を再読取り</button>
      <p>原価振替：{form.acquisitionMovementId}。未保存の残高変更がある場合は、先に保存してください。</p>
      <label>方法<select value={form.method} onChange={(event) => change({ method: event.target.value })}>
        <option value="">選択してください</option>{Object.entries(labels).map(([method, label]) => <option key={method} value={method} disabled={eligibility.alternatives.some((row) => row.method === method && ['not-eligible','unsupported'].includes(row.status))}>{label}</option>)}
      </select></label>
      {eligibility.reason && <p role="status">{eligibility.reason}</p>}
      {selectedScenario?.reasons.map((reason) => <p key={reason}>{reason}</p>)}
      <label>実際の供用日<DateInput value={form.usedOn} onValueChange={(usedOn) => change({ usedOn })} /></label>
      {form.method === 'straight-line' && <label>法定耐用年数<select value={form.life} onChange={(event) => change({ life: event.target.value })}><option value="">用途と根拠を確認</option><option value="3">3年</option><option value="5">5年</option></select></label>}
      <label>貸付用途<select value={form.rental} onChange={(event) => change({ rental: event.target.value })}><option value="">未確認</option><option value="none">貸付ではない</option><option value="primary-business">主要業務の貸付</option><option value="other">それ以外の貸付</option></select></label>
      <label><input type="checkbox" checked={form.business} onChange={(event) => change({ business: event.target.checked })} />業務専用の資産全体額を確認した</label>
      <label><input type="checkbox" checked={form.ordinary} onChange={(event) => change({ ordinary: event.target.checked })} />個人の通常条件で、転用・特殊調整を含まない</label>
      {form.method !== 'immediate-expense' && <label><input type="checkbox" checked={form.rounding} onChange={(event) => change({ rounding: event.target.checked })} />円未満切上げ・最終年上限の計算条件を確認した</label>}
      <label>選択理由<textarea value={form.reason} maxLength={1800} onChange={(event) => change({ reason: event.target.value })} /></label>
      <fieldset><legend>方法・用途・供用の根拠</legend>{(sourcePlanning?.evidence ?? planning.evidence).map((row) => <label key={row.id}><input type="checkbox" checked={form.evidenceIds.includes(row.id)} onChange={(event) => change({ evidenceIds: event.target.checked ? [...form.evidenceIds, row.id] : form.evidenceIds.filter((id) => id !== row.id) })} />{row.note}</label>)}</fieldset>
      <button type="button" disabled={!ready} onClick={() => setShowComparison(true)}>保存せず方法別の年額を比較</button>
      {showComparison && <div className="table-scroll"><table><thead><tr><th>方法</th><th>年</th><th>費用</th><th>期末</th></tr></thead><tbody>{eligibility.alternatives.flatMap((alternative) => (alternative.years ?? []).map((row) => <tr key={alternative.method + row.year}><td>{labels[alternative.method as keyof typeof labels]}</td><td>{row.year}</td><td>{yen.format(row.expenseJpy)}</td><td>{yen.format(row.closingJpy)}</td></tr>))}</tbody></table></div>}
      <button type="button" disabled={!ready || selectedScenario?.status !== 'conditional'} onClick={() => void apply('method')}>選択方法を未保存の残高入力へ反映</button>
      {account?.softwareMethod && <>
        <h4>保存済みの方法から当年額を作る</h4><p>上の試算ではなく、保存済みの方法を使います。金額0円の年には判断・0円の記録を要求しません。</p>
        {!decisions.length && <p>設定の「判断記録」で、この制作物・対象年の「通常経費（ordinary-expense）」を確認して保存してください。取得原価の判断は流用しません。</p>}
        <label>対象年の確認済み判断<select value={form.decisionId} onChange={(event) => change({ decisionId: event.target.value })}><option value="">判断を選択</option>{decisions.map((row) => <option key={row.id} value={row.id}>{row.reason}</option>)}</select></label>
        <label><input type="checkbox" checked={form.ordinaryYear} onChange={(event) => change({ ordinaryYear: event.target.checked })} />この年も継続使用し、特殊調整がない</label>
        <button type="button" disabled={!ready} onClick={() => void apply('expense')}>計算した年額を未保存入力へ追加</button>
        <details><summary>中止・転用等で通常計算を終了する</summary><label>通常計算の最終年<input value={form.endYear} onChange={(event) => change({ endYear: event.target.value })} /></label><label>以後の別処理の理由<textarea value={form.endReason} maxLength={1800} onChange={(event) => change({ endReason: event.target.value })} /></label><button type="button" disabled={!ready} onClick={() => void apply('end')}>終了条件を未保存入力へ反映</button></details>
      </>}
      <button type="button" onClick={recovery.exportCopy}>個人用の編集控えを保存</button>
      <button type="button" onClick={() => { if (window.confirm('この方法の編集控えだけを破棄します。残高入力・採用資料は変更しません。') && recovery.close()) invalidate() }}>編集控えを破棄</button>
    </fieldset>}
  </details>
}
