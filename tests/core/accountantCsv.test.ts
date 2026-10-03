import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { BalanceReview } from '../../src/accounting/balanceWorkspace.js'
import {
  accountantCsvCell,
  accountantCsvFiles,
  accountantCsvPreview,
  accountantCsvZip,
} from '../../src/core/accountantCsv.js'
import { accountantZip } from '../../src/core/accountantZip.js'
const fixture = () =>
  JSON.parse(
    readFileSync('fixtures/archive/stored-review-materials-v1.json', 'utf8'),
  ) as BalanceReview
const content = (review: BalanceReview, name: string) =>
  accountantCsvFiles(review).find((file) => file.name === name)!.content

describe('fixed accountant transfer CSV v1', () => {
  it('keeps numeric machine cells separate from protected text, Japanese, quoting and newlines', () => {
    for (const value of [
      '=1+1',
      '+cmd',
      '-2+3',
      '@SUM(1)',
      '\t=1',
      ' \u200b=1',
      '\rplain',
      '\nplain',
    ])
      expect(accountantCsvCell(value)).toBe('"\'' + value + '"')
    expect(accountantCsvCell('日本語,"引用"\n改行')).toBe('"日本語,""引用""\n改行"')
    expect(accountantCsvCell(-250)).toBe('-250')
    expect(accountantCsvCell(0)).toBe('0')
    expect(accountantCsvCell(null)).toBe('')
    expect(() => accountantCsvCell(NaN)).toThrow()
    expect(() => accountantCsvCell(1.5)).toThrow()
  })
  it('exports only explicitly selected saved fields, never logs/evidence locations', () => {
    const review = fixture()
    const before = JSON.stringify(review)
    const text = accountantCsvPreview(review)
    expect(JSON.stringify(review)).toBe(before)
    expect(text).toContain('direct:known')
    expect(text).toContain('basis-known')
    expect(text).toContain('contribution-known')
    expect(text).toContain('addition-a')
    ;(review.materials!.planning.evidence[0] as unknown as Record<string, unknown>).localReference =
      'PRIVATE_PATH_SENTINEL'
    ;(review.materials! as unknown as Record<string, unknown>).rawReceiptText =
      'PRIVATE_RECEIPT_SENTINEL'
    review.materials!.observations = [{ sourceRef: 'PRIVATE_LOG_SENTINEL' } as never]
    expect(accountantCsvPreview(review)).toBe(text)
  })
  it('keeps unknown amounts blank and confirmed zero numeric', () => {
    const review = fixture()
    const unknown = review.materials!.costs.sources.find((row) => row.originalAmountJpy === null)!
    expect(content(review, 'sources.csv')).toContain('"unknown",,"')
    expect(content(review, 'unresolved.csv')).toContain(unknown.id)
    review.materials!.costs.sources[0]!.originalAmountJpy = 0
    expect(content(review, 'sources.csv')).toContain('"known",0,')
  })
  it('separates prior years and avoids duplicate current costs; marks movements across years', () => {
    const review = fixture()
    const previous = structuredClone(review.materials!.costs)
    previous.year = 2025
    review.materials!.costLinks = { costs: [previous, review.materials!.costs], check: {} as never }
    const sources = content(review, 'sources.csv')
    expect(sources.match(/"direct:known"/g)).toHaveLength(2)
    expect(sources).toContain(',2025,"direct:known"')
    expect(sources).toContain(',2026,"direct:known"')
    review.snapshot.movements[0]!.occurredOn = '2025-12-31'
    expect(content(review, 'balance_movements.csv')).toContain(',2025,"false","2025-12-31"')
    review.materials!.costLinks.costs.push(previous)
    expect(() => accountantCsvFiles(review)).toThrow('重複')
  })
  it('retains correction revision identity without replacing the original', () => {
    const original = fixture(),
      prior = accountantCsvZip(original)
    const draft = structuredClone(original)
    draft.id = 'corrected'
    draft.correctsReviewId = original.id
    draft.reason = '訂正理由'
    draft.materials!.costs.sources[0]!.originalAmountJpy = 990
    expect(accountantCsvZip(original)).toEqual(prior)
    expect(content(draft, 'review.csv')).toContain('訂正理由')
    expect(content(draft, 'review.csv')).toContain(original.id)
    expect(accountantCsvZip(draft)).not.toEqual(prior)
  })
  it('supports legacy missing sections without reconstructing them; rejects future versions', () => {
    const review = fixture()
    delete review.materials
    expect(content(review, 'sources.csv').split('\r\n')).toHaveLength(2)
    expect(content(review, 'unresolved.csv')).toContain('not-recorded-in-legacy-review')
    ;(review as unknown as Record<string, unknown>).schemaVersion = 2
    expect(() => accountantCsvFiles(review)).toThrow('未対応')
  })
  it('writes deterministic safe flat ZIP entries with exact previewed BOM bytes and valid CRC32', () => {
    const review = fixture(),
      files = accountantCsvFiles(review),
      bytes = accountantCsvZip(review)
    expect(bytes).toEqual(accountantCsvZip(review))
    const view = new DataView(bytes.buffer),
      decode = new TextDecoder('utf-8', { ignoreBOM: true })
    let offset = 0
    for (const file of files) {
      expect(view.getUint32(offset, true)).toBe(0x04034b50)
      expect(view.getUint16(offset + 8, true)).toBe(0)
      const length = view.getUint32(offset + 18, true),
        nameLength = view.getUint16(offset + 26, true)
      const name = decode.decode(bytes.slice(offset + 30, offset + 30 + nameLength))
      expect(name).toBe(file.name)
      const start = offset + 30 + nameLength,
        data = bytes.slice(start, start + length)
      expect(decode.decode(data)).toBe(file.content)
      let crc = 0xffffffff
      for (const byte of data) {
        crc ^= byte
        for (let n = 0; n < 8; n++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
      }
      expect(view.getUint32(offset + 14, true)).toBe((crc ^ 0xffffffff) >>> 0)
      offset = start + length
    }
    expect(view.getUint32(offset, true)).toBe(0x02014b50)
    expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50)
    for (const name of ['../evil.csv', '/evil.csv', 'x\\evil.csv', 'x.csv\n', 'a.csv/../../x'])
      expect(() => accountantZip([{ name, content: '' }])).toThrow()
    expect(() =>
      accountantZip([
        { name: 'a.csv', content: '' },
        { name: 'a.csv', content: '' },
      ]),
    ).toThrow()
  })
})
