import type { BalanceReview } from '../accounting/balanceWorkspace.js'
import { reviewExportMarkdown as renderStoredBody } from './reviewExportBody.js'
import { softwareMethodMarkdown } from './softwareMethodExport.js'
export * from './reviewExportBody.js'

/** Old/no-method output stays byte-identical. Only the supplied saved record is rendered. */
export function reviewExportMarkdown(review: BalanceReview): string {
  const body = renderStoredBody(review)
  const methods = softwareMethodMarkdown(review)
  return methods ? body + '\n' + methods + '\n' : body
}
