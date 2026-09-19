import type { AnnualCostProjection } from '../accounting/costs.js'
import type { BalanceReview } from '../accounting/balanceWorkspace.js'
import { readTreatmentProjection } from './treatmentProjectionRead.js'

/** Bounded explicit reads for an editor proposal; adoption retains its server snapshot checks. */
export async function readSoftwareAcquisitionInputs(
  datasetId: string | undefined,
  years: number[],
  reviewIds: string[],
  readers: {
    runtime: () => Promise<{ datasetId?: string }>
    workspace: () => Promise<{ revision: number }>
    projection: (year: number) => Promise<AnnualCostProjection>
    review: (id: string) => Promise<{ review: BalanceReview }>
  },
): Promise<{ costs: AnnualCostProjection[]; openingReviews: BalanceReview[]; workspaceRevision: number }> {
  if (!datasetId || !years.length || years.length > 200 || new Set(years).size !== years.length ||
      years.some((year) => !Number.isInteger(year) || year < 1900 || year > 9999) ||
      reviewIds.length > 1 || reviewIds.some((id) => !id.trim()))
    throw new Error('原価を読む対象年・採用版・接続先を確認してください。')
  const mismatch = () => new Error('読取り中に接続先または保存済み入力が変わりました。入力を保持して読み直してください。')
  if ((await readers.runtime()).datasetId !== datasetId) throw mismatch()
  const before = (await readers.workspace()).revision
  if (!Number.isSafeInteger(before) || before < 0) throw mismatch()
  const costs: AnnualCostProjection[] = []
  const ordered = [...years].sort((a, b) => a - b)
  for (let index = 0; index < ordered.length; index += 4) {
    costs.push(...await Promise.all(ordered.slice(index, index + 4).map((year) =>
      readTreatmentProjection(datasetId, year, readers.runtime, readers.projection))))
  }
  const openingReviews: BalanceReview[] = []
  for (const id of reviewIds) {
    const { review } = await readers.review(id)
    if (review.id !== id) throw new Error('指定した期首の採用版と応答が一致しません。')
    openingReviews.push(review)
  }
  if ((await readers.workspace()).revision !== before || (await readers.runtime()).datasetId !== datasetId)
    throw mismatch()
  return { costs, openingReviews, workspaceRevision: before }
}
