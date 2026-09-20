import type { ReviewMaterials } from '../accounting/reviewMaterials.js'

export type EquipmentCarryCheck = {
  engineVersion: 'equipment-carry/1'
  previousReviewId: string | null
  rows: Array<{
    equipmentId: string
    status: 'matched' | 'mismatch' | 'unavailable'
    enteredJpy: number
    previousClosingJpy: number | null
    reason: string
  }>
}

/** Matches recorded whole-asset arithmetic, never tax eligibility or an external reference's contents. */
export function checkEquipmentCarry(
  current: ReviewMaterials,
  previous: { id: string; year: number; materials?: ReviewMaterials } | null,
): EquipmentCarryCheck {
  return {
    engineVersion: 'equipment-carry/1',
    previousReviewId: previous?.id ?? null,
    rows: (current.planning.equipmentMethods ?? [])
      .filter((method) => method.taxYear === current.year && method.priorClosing !== null)
      .map((method) => {
        const entered = method.priorClosing!
        const row = {
          equipmentId: method.equipmentId,
          enteredJpy: entered.amountJpy,
          previousClosingJpy: null,
        }
        if (entered.taxYear !== current.year - 1)
          return {
            ...row,
            status: 'mismatch' as const,
            reason: '入力した前年残高の対象年が前年ではありません。',
          }
        if (!previous || previous.year !== current.year - 1)
          return {
            ...row,
            status: 'unavailable' as const,
            reason: '照合する前年の採用資料がありません。',
          }
        if (method.priorReviewId && method.priorReviewId !== previous.id)
          return {
            ...row,
            status: 'mismatch' as const,
            reason: `取り込んだ前年資料 ${method.priorReviewId} は現行版 ${previous.id} と異なります。金額が同じでも前年資料を読み直して確認してください。`,
          }
        const matches =
          previous.materials?.equipmentCalculations?.filter(
            (item) => item.equipmentId === method.equipmentId && item.taxYear === previous.year,
          ) ?? []
        if (matches.length !== 1 || !matches[0]!.result?.calculation)
          return {
            ...row,
            status: 'unavailable' as const,
            reason:
              '前年資料に一意な設備全体の期末計算が収録されていません。現在の入力で補完しません。',
          }
        const priorResult = matches[0]!.result!
        const currentPool = method.method === 'three-year-pool'
        const priorPool = priorResult.engineVersion === 'jp-individual-equipment-pool/1'
        if ((currentPool && method.poolElection?.serviceYear !== undefined && method.poolElection.serviceYear !== null &&
             previous.year >= method.poolElection.serviceYear && !priorPool) || (!currentPool && priorPool))
          return { ...row, previousClosingJpy: priorResult.calculation!.closingBasisJpy, status: 'mismatch' as const,
            reason: '前年の採用計算と一括償却の選択が異なります。金額だけの一致で方式変更を通さず、供用年の選択・訂正版を確認してください。' }
        const closing = priorResult.calculation!.closingBasisJpy
        return {
          ...row,
          previousClosingJpy: closing,
          status: closing === entered.amountJpy ? ('matched' as const) : ('mismatch' as const),
          reason:
            closing === entered.amountJpy
              ? '前年資料の設備全体の期末計算と入力額が一致します。税務適用や自由記述の参照先の確認完了ではありません。'
              : '前年資料の設備全体の期末計算と入力額が一致しません。前年資料または当年入力を確認してください。',
        }
      }),
  }
}
