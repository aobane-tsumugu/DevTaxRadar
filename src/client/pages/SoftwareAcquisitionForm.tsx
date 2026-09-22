import { useEffect, useMemo, useRef, useState } from 'react'
import type { BalanceSnapshot } from '../../accounting/types'
import type { PlanningSnapshot } from '../../planning/types'
import { decisionIsConfirmed } from '../../core/decisionConfirmation'
import { draftSoftwareAcquisition, inspectSoftwareAcquisition } from '../../core/softwareAcquisitionDraft'
import { getBalanceReview, getCostProjection, getRuntime, getWorkspace } from '../api'
import { readSoftwareAcquisitionInputs } from '../softwareAcquisitionRead'
import DateInput from './DateInput'
import { yen } from './shared'

type Loaded = Awaited<ReturnType<typeof readSoftwareAcquisitionInputs>> & { key: string }

/** One ordinary transfer into the existing draft/save/recovery/adoption workflow. */
export default function SoftwareAcquisitionPanel({ datasetId, snapshot, planning, busy, edit }: {
  datasetId?: string
  snapshot: BalanceSnapshot
  planning: PlanningSnapshot
  busy: boolean
  edit: (change: (snapshot: BalanceSnapshot) => void) => void
}) {
  const [constructionId, setConstructionId] = useState('')
  const [assetId, setAssetId] = useState('')
  const [occurredOn, setOccurredOn] = useState('')
  const [decisionId, setDecisionId] = useState('')
  const [reason, setReason] = useState('')
  const [evidenceIds, setEvidenceIds] = useState<string[]>([])
  const [confirmed, setConfirmed] = useState('')
  const [loaded, setLoaded] = useState<Loaded>()
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const generation = useRef(0)
  const latest = useRef({ snapshot, planning, busy, datasetId })
  latest.current = { snapshot, planning, busy, datasetId }
  const request = useRef<{ signature: string; id: string } | undefined>(undefined)
  useEffect(() => {
    generation.current++
    setLoaded(undefined); setConfirmed(''); setLoading(false)
    setConstructionId(''); setAssetId(''); setDecisionId(''); setEvidenceIds([]); setMessage('')
    return () => { generation.current++ }
  }, [datasetId])
  const construction = snapshot.accounts.find((row) => row.id === constructionId)
  const queryKey = JSON.stringify([datasetId, constructionId, occurredOn, construction?.openingYear,
    construction?.openingRevisionId, snapshot.movements.flatMap((row) =>
      row.kind === 'addition' ? (row.costAllocations ?? []).map((lot) => lot.costYear) : [])])
  const inspection = useMemo(() => {
    if (!loaded || loaded.key !== queryKey) return { report: undefined, error: '' }
    try {
      return { report: inspectSoftwareAcquisition(snapshot, planning, loaded.costs,
        constructionId, occurredOn, loaded.openingReviews), error: '' }
    } catch (error) { return { report: undefined, error: error instanceof Error ? error.message : '原価を確認できません。' } }
  }, [loaded, queryKey, snapshot, planning, constructionId, occurredOn])
  const report = inspection.report
  const choices = planning.decisions.filter((row) => row.taxUnitId === construction?.taxUnitId &&
    row.taxYear === Number(occurredOn.slice(0, 4)) && decisionIsConfirmed(row) && !row.treatmentBinding &&
    ['software-acquisition-cost', 'capital-expenditure'].includes(row.selectedCandidate ?? ''))
  const decision = choices.find((row) => row.id === decisionId)
  const confirmedKey = JSON.stringify([queryKey, report, assetId, decision, evidenceIds, reason])
  function invalidate() {
    generation.current++; setLoaded(undefined); setConfirmed(''); setLoading(false); setMessage('')
  }
  async function load() {
    if (busy || loading) return
    const year = Number(occurredOn.slice(0, 4))
    if (!construction || !/^\d{4}-\d{2}-\d{2}$/.test(occurredOn) ||
        !Number.isInteger(year) || year < construction.openingYear || year - construction.openingYear >= 200) {
      setMessage('制作中残高と実際の製作完了・振替日を選択してください。対象期間は省略せず200年以内で読みます。')
      return
    }
    const token = ++generation.current
    setLoading(true); setLoaded(undefined); setConfirmed(''); setMessage('')
    try {
      const years = [...new Set([
        ...Array.from({ length: year - construction.openingYear + 1 }, (_, index) => construction.openingYear + index),
        ...snapshot.movements.flatMap((row) => row.kind === 'addition'
          ? (row.costAllocations ?? []).map((lot) => lot.costYear) : []),
      ])]
      const values = await readSoftwareAcquisitionInputs(datasetId, years,
        construction.openingRevisionId ? [construction.openingRevisionId] : [],
        { runtime: getRuntime, workspace: getWorkspace, projection: getCostProjection, review: getBalanceReview })
      if (token === generation.current) setLoaded({ ...values, key: queryKey })
    } catch (error) {
      if (token === generation.current) setMessage(error instanceof Error ? error.message : '原価の読取りに失敗しました。')
    } finally { if (token === generation.current) setLoading(false) }
  }
  async function apply() {
    if (busy || loading || !loaded || !report || report.status !== 'ready' ||
        confirmed !== confirmedKey || !decision) return
    const token = ++generation.current
    setLoading(true); setMessage('')
    try {
      if ((await getRuntime()).datasetId !== datasetId ||
          (await getWorkspace()).revision !== loaded.workspaceRevision ||
          (await getRuntime()).datasetId !== datasetId)
        throw new Error('接続先または保存済み入力が変わりました。原価を読み直してください。')
      if (token !== generation.current || latest.current.datasetId !== datasetId || latest.current.busy) return
      const signature = confirmedKey
      const attempt = request.current?.signature === signature ? request.current : { signature, id: crypto.randomUUID() }
      request.current = attempt
      edit((current) => {
        current.movements = draftSoftwareAcquisition(current, latest.current.planning, loaded.costs, {
          requestId: attempt.id, constructionAccountId: constructionId, toAccountId: assetId,
          occurredOn, decisionId, reason: reason || decision.reason!, evidenceIds,
          completeCostConfirmed: true, expectedAmountJpy: report.amountJpy!,
          expectedSources: report.sources.map((row) => ({ sourceKind: row.sourceKind,
            sourceId: row.sourceId, amountJpy: row.amountJpy! })),
        }, loaded.openingReviews).movements
      })
      setLoaded(undefined); setConfirmed('')
      setMessage('年度別原価と期首出典を持つ振替1件を、未保存の残高入力へ追加しました。金額の再入力は不要です。既存の保存・年度確認で確かめてください。')
    } catch (error) {
      if (token === generation.current) {
        setLoaded(undefined); setConfirmed('')
        setMessage(error instanceof Error ? error.message : '振替案を追加できません。元の入力は保持しています。')
      }
    } finally { if (token === generation.current) setLoading(false) }
  }
  if (!snapshot.accounts.some((row) => row.kind === 'construction')) return null
  return <details className="panel" aria-label="ソフトウェア全体の原価をまとめる">
    <summary>複数年度の製作費を、ソフトウェア全体の原価へまとめる</summary>
    <p>既存の制作中残高に組み入れた原価を年度別にたどり、一つの資産へ振り替えます。元の支払額と残高を二重に加算しません。これは供用日の決定・償却方法の採用ではありません。</p>
    <fieldset disabled={busy || loading}>
      <legend>対象ソフトウェアと実際の日付</legend>
      <label>制作中の原価<select value={constructionId} onChange={(event) => {
        invalidate(); setConstructionId(event.target.value); setAssetId(''); setDecisionId('')
      }}><option value="">制作中残高を選択</option>
        {snapshot.accounts.filter((row) => row.kind === 'construction' && planning.taxUnits.some((unit) =>
          unit.id === row.taxUnitId && ['new-software', 'improvement-plan'].includes(unit.unitType)))
          .map((row) => <option key={row.id} value={row.id}>{row.name} / {row.openingYear}年から</option>)}
      </select></label>
      <label>製作完了・振替の日付<DateInput value={occurredOn} onValueChange={(date) => { invalidate(); setOccurredOn(date) }} /></label>
      <button type="button" onClick={() => void load()}>対象期間の原価と、期首の出典を読む</button>
    </fieldset>
    {report && <>
      <h4>確認できた未費用化原価：{yen.format(report.knownSubtotalJpy)}</h4>
      <p>{report.amountJpy === null ? '未算定・未組入れ・出典不足を含むため、まだ資産全体額とは扱いません。' : '下の内訳と対象範囲を確認し、ソフトウェア全体の取得価額候補として使います。'}</p>
      <div className="table-scroll"><table><thead><tr><th>原価年</th><th>費用と出典</th><th>残額</th></tr></thead><tbody>
        {report.lots.map((row) => <tr key={JSON.stringify([row.costYear, row.contributionId])}>
          <td>{row.costYear}年</td><td>{row.label}</td><td>{yen.format(row.amountJpy)}</td></tr>)}
        {report.openingReferences.map((row) => <tr key={row.id}><td>引継ぎ期首</td>
          <td>{row.kind === 'external' ? '確認済みの外部資料' : '指定された採用版'}：{row.id}</td><td>{yen.format(row.amountJpy)}</td></tr>)}
      </tbody></table></div>
      {report.openingReferences.length > 0 && <p>期首に含まれる過去の支払は再加算しません。外部資料の額を、存在しない詳細な原価内訳へ置き換えません。</p>}
      {report.unresolved.map((text) => <p key={text} role="status">{text}</p>)}
      {report.unincorporated.map((row) => <p key={JSON.stringify([row.costYear, row.contributionId])}>
        未組入れ：{row.costYear}年 / {yen.format(row.amountJpy)} / {row.contributionId}</p>)}
      <fieldset disabled={busy || loading || report.status !== 'ready'}>
        <legend>既存の資産残高と判断へ接続</legend>
        <label>受入先の資産<select value={assetId} onChange={(event) => setAssetId(event.target.value)}>
          <option value="">同じソフトウェアの未使用の資産残高を選択</option>
          {snapshot.accounts.filter((row) => row.kind === 'asset' && row.taxUnitId === report.taxUnitId)
            .map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select></label>
        <label>全体の取得・改良について確認した判断<select value={decisionId} onChange={(event) => setDecisionId(event.target.value)}>
          <option value="">対象年の確認済み判断を選択</option>
          {choices.map((row) => <option key={row.id} value={row.id}>{row.taxYear}年 / {row.reason}</option>)}
        </select></label>
        {!choices.length && <p>対象年・同じソフトウェアの取得または改良を、既存の判断記録で確認してください。配分1件の判断は全体の判断へ自動転用しません。「＋ 月次確認」の「扱いを判断した記録」で、この制作物と振替日の年を選び、確認した扱いに「ソフトウエア製作原価の候補」（改良なら「資本的支出の候補」）を選んで確認済みにしてください。</p>}
        {decision && <p>記録済みの理由：{decision.reason}</p>}
        <label>補足理由（空欄なら上の判断理由を使用）<textarea value={reason} maxLength={1800} onChange={(event) => setReason(event.target.value)} /></label>
        <details><summary>追加の根拠（必要な場合のみ）</summary>
          {planning.evidence.map((row) => <label key={row.id} className="balance-source-choice">
            <input type="checkbox" checked={evidenceIds.includes(row.id)} onChange={(event) => setEvidenceIds(event.target.checked
              ? [...evidenceIds, row.id] : evidenceIds.filter((id) => id !== row.id))} />{row.note}</label>)}
        </details>
        <label><input type="checkbox" checked={confirmed === confirmedKey} onChange={(event) => setConfirmed(event.target.checked ? confirmedKey : '')} />
          このソフトウェアの製作に対応する全体の範囲を確認した。別資産・私用・費用化済み額を含めていない。</label>
        <button type="button" disabled={!assetId || !decision || confirmed !== confirmedKey} onClick={() => void apply()}>
          再計上せず、振替1件を未保存入力へ追加
        </button>
      </fieldset>
    </>}
    {(message || inspection.error) && <p role="status">{message || inspection.error}</p>}
  </details>
}
