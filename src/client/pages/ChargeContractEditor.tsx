import { chargeContractBasis, chargeContractStatus, chargePeriodIsValid, type ProviderChargePeriod } from '../../core/chargePeriods'
import { recordedTime } from '../recordedTime'
import ChargeUsageEditor from './ChargeUsageEditor'

export default function ChargeContractEditor({ period, index, onChange }: {
  period: ProviderChargePeriod
  index: number
  onChange: (period: ProviderChargePeriod) => void
}) {
  const record = period.contractConfirmation
  const status = chargeContractStatus(period)
  function edit(field: 'reference' | 'reason', value: string) {
    onChange({ ...period, contractConfirmation: {
      ...record,
      reference: record?.reference ?? '', reason: record?.reason ?? '',
      basis: chargeContractBasis(period), confirmedAt: undefined,
      [field]: value,
    } })
  }
  return <fieldset>
    <legend>請求{index + 1}と契約の対応</legend>
    <p>{status === 'confirmed' ? '契約との対応を確認済み' : status === 'changed' ? '請求内容が変わりました。契約との対応を再確認してください。' : '契約との対応は未確認です。入力途中の内容も請求と一緒に保存できます。'}</p>
    <label>契約の呼び名<input aria-label={`請求${index + 1} 契約の呼び名`} maxLength={160} value={record?.reference ?? ''} onChange={(event) => edit('reference', event.target.value)} /></label>
    <p>同じ契約には同じ呼び名を使ってください。アカウントの秘密情報や認証情報は不要です。</p>
    <label>対応を確認した理由<textarea aria-label={`請求${index + 1} 契約確認の理由`} maxLength={2000} value={record?.reason ?? ''} onChange={(event) => edit('reason', event.target.value)} /></label>
    {record?.confirmedAt && <p>前回の確認日時：{recordedTime(record.confirmedAt)} / 対象：{record.basis.planName || 'プラン名未入力'} / {record.basis.serviceStartedOn}～{record.basis.serviceEndedOn} / {record.basis.amountJpy === null ? '原額不明' : `${record.basis.amountJpy}円`}</p>}
    <button type="button" disabled={!record?.reference.trim() || !record?.reason.trim() || !chargePeriodIsValid(period)} onClick={() => onChange({ ...period, contractConfirmation: {
      ...record!,
      reference: record!.reference.trim(), reason: record!.reason.trim(),
      confirmedAt: new Date().toISOString(), basis: chargeContractBasis(period),
    } })}>請求{index + 1}の契約対応を確認</button>
    <ChargeUsageEditor period={period} index={index} onChange={onChange} />
    <p>この操作は編集中の記録へ反映します。「ここまで保存」から保存してください。金額の除外や税務処理の確定は行いません。</p>
  </fieldset>
}
