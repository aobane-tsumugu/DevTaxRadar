/**
 * PDF.js 6.3.289, src/shared/internal_evt.js INTERNAL_EVT, shipped verbatim by
 * pdfjs-dist/legacy/build/pdf.mjs. This single public event sentinel is not a
 * user/session identifier. Exempt it only inside named bundled PDF assets;
 * retain every other UUID match, including additional matches in that asset.
 */
const pdfJsPublicEvent = '59968104-cc61-4cf9-b570-014b35b3709c'
export function containsUnexpectedUuid(content: string, relativePath: string): boolean {
  const approvedPdfAsset = /^dist\/assets\/pdf(?:\.worker\.min)?-[A-Za-z0-9_-]+\.(?:js|mjs)$/.test(
    relativePath,
  )
  const matches =
    content.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi) ?? []
  return matches.some((value) => !approvedPdfAsset || value.toLowerCase() !== pdfJsPublicEvent)
}
