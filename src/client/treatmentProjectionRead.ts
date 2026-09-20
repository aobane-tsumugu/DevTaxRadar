import type { AnnualCostProjection } from '../accounting/costs.js'

type RuntimeIdentity = { datasetId?: string }

/** A read guard only. Saving and adopting still use their existing server checks. */
export async function readTreatmentProjection(
  datasetId: string | undefined,
  year: number,
  readRuntime: () => Promise<RuntimeIdentity>,
  readProjection: (year: number) => Promise<AnnualCostProjection>,
): Promise<AnnualCostProjection> {
  if (!datasetId || !Number.isInteger(year) || year < 1900 || year > 9999)
    throw new Error('接続先と対象年を確認してください。')
  const changed = () => new Error('読取り中に接続先の資料が変わりました。再読込してください。')
  if ((await readRuntime()).datasetId !== datasetId) throw changed()
  const projection = await readProjection(year)
  // The runtime can be restarted/restored between the first check and the
  // projection request. Do not attach those bytes to the old editor dataset.
  if ((await readRuntime()).datasetId !== datasetId) throw changed()
  if (projection.year !== year)
    throw new Error('読取り結果の対象年が一致しません。表示中の入力は変更していません。')
  return projection
}
