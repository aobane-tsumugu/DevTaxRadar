import type { BalancePreview } from '../accounting/balanceWorkspace.js'
import type { BalanceSnapshot } from '../accounting/types.js'
import { canonicalSoftwareValue } from '../core/softwareMethod.js'

/** The existing annual preview already captures planning, balances and linked costs together. */
export async function readSoftwareMethodPreview(
  datasetId: string | undefined,
  revision: number,
  snapshot: BalanceSnapshot,
  year: number,
  runtime: () => Promise<{ datasetId?: string }>,
  preview: (year: number) => Promise<BalancePreview>,
): Promise<BalancePreview> {
  const original = canonicalSoftwareValue(snapshot)
  if (
    !datasetId ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    !Number.isInteger(year) ||
    year < 2007 ||
    year > 2100
  )
    throw new Error('接続先・残高版・対象年を確認してください。')
  if ((await runtime()).datasetId !== datasetId) throw new Error('接続先が変わっています。')
  const result = await preview(year)
  if ((await runtime()).datasetId !== datasetId) throw new Error('読取り中に接続先が変わりました。')
  if (result.draftRevision !== revision || canonicalSoftwareValue(result.snapshot) !== original)
    throw new Error(
      '保存版と残高入力が一致しません。先に入力を保存するか、最新の残高を読み直してください。',
    )
  if (
    result.projection.year !== year ||
    !result.materials ||
    result.materials.year !== year ||
    result.materials.costs.year !== year ||
    !result.materials.costLinks
  )
    throw new Error('対象年の入力・原価を同じ資料から確認できませんでした。')
  return result
}
