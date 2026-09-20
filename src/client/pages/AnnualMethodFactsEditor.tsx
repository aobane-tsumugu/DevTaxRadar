import type { MethodNumberKey } from '../treatmentEditorValue'
import type { AnnualCostProjection } from '../../accounting/costs'
import type { PlanningSnapshot } from '../../planning/types'
import type { CostTreatmentFacts } from '../../core/costTreatmentFacts'
import type { AnnualMethodFacts } from '../../core/annualMethodComparison'
import { methodComparisonScope, newAnnualMethodFacts } from '../../core/costMethodConnection'
import { costTreatmentBasis } from '../../core/costTreatments'
import { useState } from 'react'
import DateInput from './DateInput'

export default function AnnualMethodFactsEditor({ costs, planning, facts, onChange, numericInputs, onNumericInput }: {
  costs: AnnualCostProjection; planning: PlanningSnapshot; facts: CostTreatmentFacts;
  onChange: (method: AnnualMethodFacts | undefined) => void
  numericInputs?: Partial<Record<MethodNumberKey, string>>
  onNumericInput?: (key: MethodNumberKey, raw: string) => void
}) {
  const [error, setError] = useState('')
  const method = facts.methodComparison
  const edit = (patch: Partial<AnnualMethodFacts>) => { if (method) onChange({ ...method, ...patch }) }
  const yesNo = (key: 'completeCostConfirmed' | 'businessOnly' | 'ordinaryConditions' | 'eligibleSmallBusiness' | 'statementReady' | 'roundingConfirmed', label: string) =>
    <label>{label}<select value={method?.[key] === null ? 'unknown' : String(method?.[key])} onChange={(event) => edit({ [key]: event.target.value === 'unknown' ? null : event.target.value === 'true' })}>
      <option value="unknown">未確認</option><option value="true">はい</option><option value="false">いいえ</option>
    </select></label>
  const numberInput = (key: MethodNumberKey, label: string) => <label>{label}<input inputMode="numeric" maxLength={120}
    value={numericInputs?.[key] ?? method?.[key] ?? ''} onChange={(event) => {
      const raw = event.target.value
      if (onNumericInput) onNumericInput(key, raw)
      else if (raw === '' && key !== 'throughYear') edit({ [key]: null })
      else if (/^\d+$/.test(raw) && Number.isSafeInteger(Number(raw))) edit({ [key]: Number(raw) })
    }} /></label>
  return <fieldset><legend>任意：資産全体の方法別年次比較</legend>
    <p>購入原額と年額の配分、ソフトの資産全体原価を区別します。数値は同じ費用資料から取得し、別の費用台帳には転記しません。</p>
    {!method ? <button type="button" onClick={() => onChange(newAnnualMethodFacts(facts.costYear, facts.contributionId))}>方法比較の条件を追加</button> : <>
      <label>比較対象<select value={method.assetKind} onChange={(e) => edit({ assetKind: e.target.value as AnnualMethodFacts['assetKind'], scopeBasis: '' })}>
        <option value="unknown">未確認</option><option value="software">業務専用ソフトの製作原価</option><option value="tangible-equipment">一つの有形設備の購入原額</option>
      </select></label>
      <fieldset><legend>この資産の原価に含めた最終配分（同じ年・制作物）</legend>
        {costs.contributions.filter((row) => !row.consumedByBasisId && row.target.kind === 'tax-unit').map((row) => <label key={row.id}>
          <input type="checkbox" checked={method.contributionIds.includes(row.id)} disabled={row.id === facts.contributionId}
            onChange={(e) => edit({ contributionIds: e.target.checked ? [...method.contributionIds, row.id] : method.contributionIds.filter((id) => id !== row.id), scopeBasis: '' })} />
          {row.sourceIds.map((id) => costs.sources.find((source) => source.id === id)?.label ?? id).join(' + ')} / {row.amountJpy}円 / {row.id}
        </label>)}
      </fieldset>
      {yesNo('completeCostConfirmed', '購入付随費用や過年度の未算入原価がなく、この範囲が資産全体原価である')}
      {yesNo('businessOnly', '比較対象資産は業務専用で、私用を含む取得原価の一部を抜き出していない')}
      <label>納税者<select value={method.taxpayer} onChange={(e) => edit({ taxpayer: e.target.value as AnnualMethodFacts['taxpayer'] })}><option value="unknown">未確認</option><option value="individual">個人</option><option value="corporation">法人（この方法では未対応）</option></select></label>
      <label>取得・製作完了日<DateInput value={method.acquiredOn ?? ''} onValueChange={(date) => edit({ acquiredOn: date || null })} /></label>
      <label>業務供用開始日<DateInput value={method.usedOn ?? ''} onValueChange={(date) => edit({ usedOn: date || null })} /></label>
      {numberInput('usefulLifeYears', '確認した法定耐用年数')}
      {numberInput('throughYear', '比較を表示する最終年')}
      {yesNo('ordinaryConditions', '表示期間の継続使用を仮定する。私用転用・方法変更・特殊調整・中断は含まない')}
      <label>貸付用途<select value={method.rentalUse} onChange={(e) => edit({ rentalUse: e.target.value as AnnualMethodFacts['rentalUse'] })}><option value="unknown">未確認</option><option value="none">貸付用ではない</option><option value="primary-business">主要業務の貸付</option><option value="other">それ以外の貸付</option></select></label>
      <p>青色／白色と所得区分は保存済みの基本情報を使います。比較だけで申告区分を変更しません。</p>
      {yesNo('eligibleSmallBusiness', '取得時期の青色少額資産特例の事業者要件を満たす')}
      {numberInput('annualSpecialUsedJpy', '供用年の他資産分の特例使用額')}
      {numberInput('businessMonths', '供用年の事業月数')}
      {yesNo('statementReady', '特例対象の明細等を準備している')}
      {yesNo('roundingConfirmed', 'この比較では円未満切上げ、最終年は残額を上限とする端数方法を使う')}
      <label>全体原価・耐用年数・方法条件の根拠<textarea value={method.reason} maxLength={2000} onChange={(e) => edit({ reason: e.target.value })} /></label>
      <p>根拠参照はこの処理条件で選んだ証拠を使用します。比較額は自動記帳しません。既存設備の前年額は保存済みの年度条件から読みます。</p>
      <button type="button" onClick={() => {
        try { edit({ scopeBasis: methodComparisonScope(costs, planning, facts, costTreatmentBasis) }); setError('比較する全原価と根拠を結び直しました。まだ保存していません。') }
        catch (cause) { setError(cause instanceof Error ? cause.message : '範囲を確認できません。') }
      }}>比較する資産全体の範囲を確認して結ぶ</button>
      <button type="button" onClick={() => { if (window.confirm('編集中の方法比較条件を外します。保存済み資料は変更しません。')) onChange(undefined) }}>方法比較を外す</button>
    </>}
    {error && <p role="status">{error}</p>}
  </fieldset>
}
