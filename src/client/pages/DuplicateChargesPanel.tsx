import ChargeContractEditor from './ChargeContractEditor'
import {
  chargeReviewGroups,
  distinctChargeContracts,
  type ProviderChargePeriod,
} from '../../core/chargePeriods'
import { yen } from './shared'

export default function DuplicateChargesPanel({
  periods,
  onChange,
}: {
  periods: readonly ProviderChargePeriod[]
  onChange?: (period: ProviderChargePeriod) => void
}) {
  const groups = chargeReviewGroups(periods)
  if (!groups.length && !periods.some((period) => period.contractConfirmation)) return null
  return (
    <section aria-label="請求の重複候補">
      <h4>請求の重複・期間の重なりを確認してください</h4>
      <p>
        別契約やプラン変更の場合もあるため、明細を見て確認してください。現在は各請求を合計に含めています。不明額は合計に含めず、未算定として保持します。
      </p>
      {groups.map(({ kind, ids }) => (
        <article key={kind + JSON.stringify(ids)}>
          <strong>
            {kind === 'duplicate'
              ? '同じサービス・利用期間・原額の重複候補'
              : '同じサービスで利用期間が重なる請求'}
          </strong>
          {kind === 'overlap' && (
            <p>
              この組の各請求は、少なくとも他の1件と利用期間が重なっています。すべての請求が同じ日に重なるとは限りません。終了日と次の開始日が同じ場合も、その1日が重なります。
            </p>
          )}
          {distinctChargeContracts(periods.filter((period) => ids.includes(period.id))) && (
            <p>各請求を異なる契約として確認済みです。各請求の金額を保持しています。</p>
          )}
          <ul>
            {ids.map((id) => {
              const period = periods.find((row) => row.id === id)!
              return (
                <li key={id}>
                  請求{periods.indexOf(period) + 1}：
                  {period.provider === 'claude' ? 'Claude Code' : 'Codex'} /{' '}
                  {period.planName || 'プラン名未入力'} / {period.serviceStartedOn}～
                  {period.serviceEndedOn} /{' '}
                  {period.amountJpy === null ? '原額不明' : yen.format(period.amountJpy)} / 請求日{' '}
                  {period.billedOn ?? '未入力'}
                </li>
              )
            })}
          </ul>
        </article>
      ))}
      {onChange &&
        periods.map((period, index) =>
          period.contractConfirmation || groups.some((group) => group.ids.includes(period.id)) ? (
            <ChargeContractEditor
              key={period.id}
              period={period}
              index={index}
              onChange={onChange}
            />
          ) : null,
        )}
      <p>
        誤入力なら該当する請求行を修正し、保存前に「変更の影響を確認」で差分を確認できます。自動統合や金額の除外は行いません。
      </p>
    </section>
  )
}
