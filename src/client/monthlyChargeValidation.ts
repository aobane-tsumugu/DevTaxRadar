import type { LocalConfiguration } from './types'
import { displayMonth } from './monthLabel'

export function monthlyChargeInputIssue(
  row: LocalConfiguration['monthlyCharges'][number],
): string | null {
  const target =
    displayMonth(row.month) + 'の' + (row.provider === 'claude' ? 'Claude' : 'Codex') + '料金'
  if (row.amountJpy === null) {
    if (!row.unknownAmountReason?.trim()) return target + 'が不明な理由を入力してください。'
    if (row.unknownAmountReason.trim().length > 2000)
      return target + 'が不明な理由は2000文字以内で入力してください。'
  } else if (!Number.isSafeInteger(row.amountJpy) || row.amountJpy < 0) {
    return (
      target +
      'は0以上の整数円で入力してください。金額が分からない場合は「料金不明」を選んでください。'
    )
  } else if (row.unknownAmountReason !== undefined) {
    return target + 'の金額を確認した場合は、不明の理由を取り除いてください。'
  }
  return null
}
