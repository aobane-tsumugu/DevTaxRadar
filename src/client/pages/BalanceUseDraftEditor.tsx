import { useEffect, useMemo, useRef, useState } from 'react'
import type { AnnualCostProjection } from '../../accounting/costs'
import type { BalanceSnapshot } from '../../accounting/types'
import type { PlanningSnapshot } from '../../planning/types'
import { balanceUseSources, draftBalanceUse, type BalanceUseInput } from '../../core/balanceUseDraft'
import { decisionIsConfirmed } from '../../core/decisionConfirmation'
import { getCostProjection } from '../api'
import DateInput from './DateInput'
import { yen } from './shared'

type Props = {
  snapshot: BalanceSnapshot
  planning: PlanningSnapshot
  busy: boolean
  edit: (change: (snapshot: BalanceSnapshot) => void) => void
}

/** Populate the existing draft only; its normal save, recovery and adoption gates remain authoritative. */
export default function BalanceUseDraftEditor({ snapshot, planning, busy, edit }: Props) {
  const [occurredOn, setOccurredOn] = useState('')
  const [kind, setKind] = useState<BalanceUseInput['kind']>('expense')
  const [selectedSource, setSelectedSource] = useState('')
  const [toAccountId, setToAccountId] = useState('')
  const [decisionId, setDecisionId] = useState('')
  const [amountText, setAmountText] = useState('')
  const [reason, setReason] = useState('')
  const [evidenceIds, setEvidenceIds] = useState<string[]>([])
  const [explicitLots, setExplicitLots] = useState(false)
  const [lotAmounts, setLotAmounts] = useState<Record<string, string>>({})
  const [costs, setCosts] = useState<AnnualCostProjection[]>()
  const [loadedYears, setLoadedYears] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [appliedSignature, setAppliedSignature] = useState('')
  const sequence = useRef(0)
  const request = useRef<{ signature: string; id: string } | undefined>(undefined)
  useEffect(() => () => { sequence.current++ }, [])

  const year = Number(occurredOn.slice(0, 4))
  const years = [...new Set([
    ...(Number.isInteger(year) && year >= 1900 && year <= 9999 ? [year] : []),
    ...snapshot.movements.flatMap((row) => row.kind === 'addition' ? (row.costAllocations ?? []).map((lot) => lot.costYear) : []),
  ])].sort((a, b) => a - b)
  const yearsKey = years.join(',')
  const available = useMemo(() => {
    if (!costs || loadedYears !== yearsKey || !occurredOn) return { sources: [], error: '' }
    try { return { sources: balanceUseSources(snapshot, costs, occurredOn), error: '' } }
    catch (cause) { return { sources: [], error: cause instanceof Error ? cause.message : '対応元を確認できません。' } }
  }, [costs, snapshot, occurredOn, loadedYears, yearsKey])
  const source = available.sources.find((row) => JSON.stringify([row.sourceKind, row.sourceId]) === selectedSource)
  const fromAccount = snapshot.accounts.find((row) => row.id === source?.accountId)
  const targetUnitId = kind === 'transfer'
    ? snapshot.accounts.find((row) => row.id === toAccountId)?.taxUnitId : fromAccount?.taxUnitId
  const decisions = planning.decisions.filter((row) => decisionIsConfirmed(row) && row.taxYear === year && row.taxUnitId === targetUnitId)
  const signature = JSON.stringify({ occurredOn, kind, selectedSource, toAccountId, decisionId, amountText, reason, evidenceIds, explicitLots, lotAmounts })

  async function loadCosts() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn) || year < 1900 || year > 9999) {
      setError('実際の移動日を入力してください。日付は自動で決めません。')
      return
    }
    const generation = ++sequence.current
    setLoading(true)
    setCosts(undefined)
    setError('')
    try {
      const results: AnnualCostProjection[] = []
      // Bound simultaneous reads; no persistent worker or background polling.
      for (let index = 0; index < years.length; index += 4) {
        const batch = years.slice(index, index + 4)
        const fetched = await Promise.all(batch.map(getCostProjection))
        fetched.forEach((value, position) => {
          if (value.year !== batch[position]) throw new Error('要求した年度と費用の応答が一致しません。')
        })
        results.push(...fetched)
      }
      if (generation !== sequence.current) return
      setCosts(results)
      setLoadedYears(yearsKey)
      setNotice('保存されている費用を読み込みました。下の操作は編集中の残高への入力補助で、保存・年度採用ではありません。')
    } catch (cause) {
      if (generation === sequence.current) setError(cause instanceof Error ? cause.message : '元費用を読み込めませんでした。')
    } finally { if (generation === sequence.current) setLoading(false) }
  }

  if (!snapshot.accounts.length) return null
  return (
    <details aria-label="原価の残額から移動を入力">
      <summary>原価の残額から費用化・減少・振替を入力する</summary>
      <p>
        未使用額、元の費用、消費する原価内訳をまとめて入力します。返金等は確認した扱いに応じて「その他減少」を使えますが、請求原額の訂正や過年度税務処理を自動判断する機能ではありません。
        未算定を0円にせず、複数原価の一部使用は内訳を指定します。
      </p>
      <fieldset disabled={busy || loading}>
        <legend>既存の残高・判断から移動案を作る</legend>
        <label>実際の移動日 <DateInput value={occurredOn} onValueChange={setOccurredOn} /></label>
        <button type="button" onClick={() => void loadCosts()}>対応する年度の元費用を読み込む</button>
        <label>移動の種類 <select value={kind} onChange={(event) => setKind(event.target.value as BalanceUseInput['kind'])}>
          <option value="expense">確認した方法による費用化</option>
          <option value="reduction">その他減少（返金等）</option>
          <option value="transfer">残高間の振替</option>
        </select></label>
        <label>使用する期首・増加・振替受入 <select value={selectedSource} onChange={(event) => {
          setSelectedSource(event.target.value); setLotAmounts({}); setExplicitLots(false)
        }}>
          <option value="">対応元を選択してください</option>
          {available.sources.map((row) => <option key={JSON.stringify([row.sourceKind, row.sourceId])} value={JSON.stringify([row.sourceKind, row.sourceId])}>
            {row.name} / {row.availableOn} / {row.sourceKind === 'opening' ? '期首' : '増加・振替受入'} / {row.amountJpy === null ? '使用可能額が不明' : yen.format(row.amountJpy)}
          </option>)}
        </select></label>
        {kind === 'transfer' && <label>振替の受入先 <select value={toAccountId} onChange={(event) => setToAccountId(event.target.value)}>
          <option value="">受入先の残高を選択してください</option>
          {snapshot.accounts.filter((row) => row.id !== source?.accountId).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select></label>}
        <label>使用する金額（空欄は確認できる未使用額の全額） <input type="number" min="1" step="1" value={amountText} onChange={(event) => setAmountText(event.target.value)} /></label>
        <label>対象年・制作物の確認済み判断 <select value={decisionId} onChange={(event) => setDecisionId(event.target.value)}>
          <option value="">判断を選択してください</option>
          {decisions.map((row) => <option value={row.id} key={row.id}>{row.taxYear}年 / {row.selectedCandidate} / {row.reason}</option>)}
        </select></label>
        <label>今回の移動の理由 <textarea maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <details>
          <summary>追加の証拠を選ぶ（期首の出典や返金明細など）</summary>
          {planning.evidence.map((row) => <label key={row.id} className="balance-source-choice">
            <input type="checkbox" checked={evidenceIds.includes(row.id)} onChange={(event) => setEvidenceIds(event.target.checked ? [...evidenceIds, row.id] : evidenceIds.filter((id) => id !== row.id))} />{row.note}
          </label>)}
        </details>
        {source && source.lots.length > 0 && <>
          <label><input type="checkbox" checked={explicitLots} onChange={(event) => setExplicitLots(event.target.checked)} />使用する原価内訳を指定する</label>
          {explicitLots && source.lots.filter((lot) => lot.remainingJpy !== 0).map((lot) => {
            const key = JSON.stringify([lot.costYear, lot.contributionId])
            const projection = costs?.find((value) => value.year === lot.costYear)
            const contribution = projection?.contributions.find((value) => value.id === lot.contributionId)
            const labels = contribution?.sourceIds.map((id) => projection?.sources.find((value) => value.id === id)?.label ?? '現在の費用にない参照').join(' / ')
            return <label key={key}>{lot.costYear}年 / {labels ?? '原価の参照を確認'} / 残額 {lot.remainingJpy === null ? '不明' : yen.format(lot.remainingJpy)}
              <input type="number" min="0" step="1" disabled={lot.remainingJpy === null} value={lotAmounts[key] ?? ''} onChange={(event) => setLotAmounts({ ...lotAmounts, [key]: event.target.value })} />
            </label>
          })}
        </>}
        {source && (source.untracedJpy === null || source.untracedJpy > 0) && <p>原価まで遡れない部分があります。金額が既知でも、出典確認済みとは扱いません。</p>}
        <button type="button" disabled={!source || source.amountJpy === null || appliedSignature === signature || loadedYears !== yearsKey} onClick={() => {
          if (!source || !costs) return
          setError(''); setNotice('')
          try {
            const attempt = request.current?.signature === signature ? request.current : { signature, id: crypto.randomUUID() }
            request.current = attempt
            const input: BalanceUseInput = {
              requestId: attempt.id, sourceKind: source.sourceKind, sourceId: source.sourceId,
              kind, occurredOn, decisionId, reason, evidenceIds,
              ...(amountText === '' ? {} : { amountJpy: Number(amountText) }),
              ...(kind === 'transfer' ? { toAccountId } : {}),
              ...(explicitLots ? { costAllocations: source.lots.flatMap((lot) => {
                const value = lotAmounts[JSON.stringify([lot.costYear, lot.contributionId])]
                return value === undefined || value === '' || Number(value) === 0 ? [] : [{ costYear: lot.costYear, contributionId: lot.contributionId, amountJpy: Number(value) }]
              }) } : {}),
            }
            edit((current) => { current.movements = draftBalanceUse(current, planning, costs, input).movements })
            setAppliedSignature(signature)
            setNotice('移動1件と原価の対応を編集中の入力へ反映しました。DB・採用済み年度資料・元の請求は変更していません。既存の保存ボタンで内容を確認して保存してください。')
          } catch (cause) { setError(cause instanceof Error ? cause.message : '移動案を入力できませんでした。') }
        }}>この対応と金額を作業中の入力へ反映</button>
      </fieldset>
      {loading && <p role="status">元費用を読み込んでいます。</p>}
      {notice && <p role="status">{notice}</p>}
      {(error || available.error) && <p role="alert">{error || available.error} 入力済みの内容は保持しています。</p>}
    </details>
  )
}
