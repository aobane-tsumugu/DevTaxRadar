import { describe, expect, it } from 'vitest'
import {
  extractReceiptJson,
  extractReceiptText,
  receiptExtractionSchema,
  RECEIPT_CANDIDATE_LIMIT,
  RECEIPT_EXTRACTION_WARNINGS as warnings,
  RECEIPT_TEXT_BYTE_LIMIT,
  RECEIPT_TEXT_LINE_LENGTH_LIMIT,
  RECEIPT_TEXT_LINE_LIMIT,
} from '../../src/core/receiptExtraction.js'

const candidateKeys = [
  'issuer',
  'billedOn',
  'paidOn',
  'currency',
  'total',
  'startedOn',
  'endedOn',
  'invoiceNumber',
] as const

describe('local receipt candidate extraction', () => {
  it('extracts only labelled Japanese facts, with all values still unconfirmed', () => {
    const output = extractReceiptText(`発行元: 株式会社サンプル
請求日: 2026年10月2日
支払日: 2026/10/03
請求通貨: JPY
合計金額(税込): 1,100円
利用期間: 2026-10-01 ～ 2026-10-31
請求書番号: INV-2026-10`)
    expect(output).toMatchObject({
      issuer: ['株式会社サンプル'],
      billedOn: ['2026-10-02'],
      paidOn: ['2026-10-03'],
      currency: ['JPY'],
      total: ['1100'],
      startedOn: ['2026-10-01'],
      endedOn: ['2026-10-31'],
      invoiceNumber: ['INV-2026-10'],
    })
    expect(output.warnings).toEqual([
      warnings.unconfirmed,
      warnings.noOcr,
      warnings.tax,
      warnings.period,
    ])
    expect(Object.keys(output).sort()).toEqual([...candidateKeys, 'warnings'].sort())
    expect(receiptExtractionSchema.parse(output)).toEqual(output)
  })

  it('extracts English labels, English calendar dates, and explicitly marked currencies', () => {
    const output = extractReceiptText(`Issuer: Example Cloud, Inc.
Invoice date: Oct 2, 2026
Paid on: 3 October 2026
Total: US$ 1,234.50
Service period start: 2026-10-1
Service period end: 2026-10-31
Invoice no.: INV_123.45`)
    expect(output).toMatchObject({
      issuer: ['Example Cloud, Inc.'],
      billedOn: ['2026-10-02'],
      paidOn: ['2026-10-03'],
      currency: ['USD'],
      total: ['1234.50'],
      invoiceNumber: ['INV_123.45'],
      startedOn: ['2026-10-01'],
      endedOn: ['2026-10-31'],
    })
  })

  it('does not infer unlabeled issuers, dates, currency, totals, or service commencement', () => {
    const output = extractReceiptText(`Example Vendor
October 2, 2026
$1,000
Business started: 2026-01-01
Service commencement: 2026-01-01
Acquired on: 2026-01-02
Date: 2026-01-03
Income: 10000
Tax classification: expense`)
    for (const key of candidateKeys) expect(output[key]).toEqual([])
    expect(output.warnings).toContain(warnings.none)
    expect(output.warnings).toContain(warnings.noOcr)
  })

  it('preserves multiple competing totals and currencies without choosing or pairing them', () => {
    const output = extractReceiptText(`Issuer: One Vendor
Invoice date: 2026-10-02
Total: USD 100.00
Total: EUR 90.00
Total: USD 100.00
Currency: GBP`)
    expect(output.total).toEqual(['100.00', '90.00'])
    expect(output.currency).toEqual(['USD', 'EUR', 'GBP'])
    expect(output.warnings).toContain(warnings.multiple)
  })

  it('detects multi-page ambiguity, deduplicates page headers, and never crosses a page for a value', () => {
    const output = extractReceiptText(
      'Issuer: Same Vendor\nTotal: USD 100\fIssuer: Same Vendor\nTotal: USD 200',
    )
    expect(output.issuer).toEqual(['Same Vendor'])
    expect(output.total).toEqual(['100', '200'])
    expect(output.warnings).toContain(warnings.pages)
    expect(output.warnings).toContain(warnings.multiple)
    expect(extractReceiptText('Issuer:\fOther Page').issuer).toEqual([])
  })

  it('supports a directly following value, but never joins arbitrary lines or blank paragraphs', () => {
    const output = extractReceiptText(
      'Issuer:\nExample Vendor\nInvoice date:\n2026-10-02\nTotal:\nUSD 10',
    )
    expect(output.issuer).toEqual(['Example Vendor'])
    expect(output.billedOn).toEqual(['2026-10-02'])
    expect(output.total).toEqual(['10'])
    expect(extractReceiptText('Issuer:\n\nOther paragraph').issuer).toEqual([])
    expect(extractReceiptText('Total: 10\n.50').total).toEqual(['10'])
  })

  it.each([
    '2026-02-29',
    '2026-13-01',
    '2026-04-31',
    '02/10/2026',
    '2026/2-3',
    '2O26-10-02',
    '2026-10-02T12:00:00Z',
  ])('does not repair an invalid or ambiguous date: %s', (value) => {
    const output = extractReceiptText(`Invoice date: ${value}`)
    expect(output.billedOn).toEqual([])
    expect(output.warnings).toContain(warnings.invalid)
  })

  it('validates leap days and explicitly warns about reversed periods', () => {
    expect(extractReceiptText('Invoice date: 2024-2-29').billedOn).toEqual(['2024-02-29'])
    const output = extractReceiptText('Service period: 2026-10-31 to 2026-10-01')
    expect(output.startedOn).toEqual(['2026-10-31'])
    expect(output.endedOn).toEqual(['2026-10-01'])
    expect(output.warnings).toContain(warnings.periodOrder)
    expect(output.warnings).toContain(warnings.period)
  })

  it.each([
    '-100',
    '(100)',
    '−100',
    '100-',
    '+100',
    '1,23',
    '1.234,56',
    '12,34.56',
    '1 234,56',
    '1O0.00',
    '1e3',
    'NaN',
    '1000000000000000',
    '1.123456789',
    'USD 10 / EUR 9',
  ])('does not adopt a negative, misread, malformed, or ambiguous total: %s', (value) => {
    const output = extractReceiptText(`Total: ${value}`)
    expect(output.total).toEqual([])
    expect(
      output.warnings.some(
        (warning) => warning === warnings.amount || warning === warnings.invalid,
      ),
    ).toBe(true)
  })

  it('keeps zero distinct from missing and normalizes decimals without floating point arithmetic', () => {
    expect(extractReceiptText('Total: USD 0').total).toEqual(['0'])
    expect(extractReceiptText('Total: USD 000.10').total).toEqual(['0.10'])
    expect(extractReceiptText('Total: 123,456,789,012,345.12345678').total).toEqual([
      '123456789012345.12345678',
    ])
    expect(extractReceiptText('Total:').total).toEqual([])
  })

  it.each(['$', '¥', '€', '£'])('does not infer a currency from %s alone', (symbol) => {
    const output = extractReceiptText(`Total: ${symbol} 100`)
    expect(output.total).toEqual(['100'])
    expect(output.currency).toEqual([])
    expect(output.warnings).toContain(warnings.currency)
  })

  it('never promotes subtotal, tax-exclusive totals or tax amounts to the total', () => {
    const output = extractReceiptText(`Subtotal: USD 100
Tax amount: USD 10
Total (excluding tax): USD 100
税抜合計: 100
合計(税別): 100
合計: 110円`)
    expect(output.total).toEqual(['110'])
    expect(output.warnings).toContain(warnings.subtotal)
    expect(output.warnings).toContain(warnings.tax)
    expect(extractReceiptText('Total: USD 100 (excluding tax)').total).toEqual([])
    expect(extractReceiptText('Total: USD 110 (including tax)').total).toEqual(['110'])
  })

  it('keeps HTML, formulas, source paths and raw bodies out of candidates and diagnostics', () => {
    const secret = 'PRIVATE_SECRET_DO_NOT_COPY'
    const source = `Issuer: <script>${secret}</script>
Issuer: =HYPERLINK("https://example.com/${secret}")
Issuer: /home/user/${secret}/receipt.pdf
Issuer: C:\\Users\\${secret}\\receipt.pdf
Issuer: ../${secret}
Issuer: receipt.pdf
Invoice number: /tmp/${secret}
Invoice number: ${secret}.pdf
Total: =SUM(1,2)
Unknown field: ${secret}`
    const output = extractReceiptText(source)
    expect(output.issuer).toEqual([])
    expect(output.total).toEqual([])
    expect(output.warnings).toContain(warnings.invalid)
    expect(output.warnings.every((warning) => Object.values(warnings).includes(warning))).toBe(true)
    // An identifier may contain a dot, but paths/source document names are never identifiers.
    expect(output.invoiceNumber).toEqual([])
    expect(JSON.stringify(output)).not.toContain(secret)
    expect(Object.keys(output)).not.toContain('rawText')
  })

  it('does not preserve malformed Unicode control characters or neighboring labelled fields', () => {
    const output = extractReceiptText(
      'Issuer: Safe\u202Eevil\nIssuer: Safe\u0000evil\nIssuer: Safe Total: USD 999\nInvoice number: abc\u0000def',
    )
    expect(output.issuer).toEqual([])
    expect(output.invoiceNumber).toEqual([])
  })

  it('returns empty controlled candidates for empty, missing, or image-only/OCR-unavailable input', () => {
    for (const source of ['', '   ', '画像のみ / OCR unavailable', '\uFFFD\uFFFD\uFFFD']) {
      const output = extractReceiptText(source)
      for (const key of candidateKeys) expect(output[key]).toEqual([])
      expect(output.warnings).toContain(warnings.unconfirmed)
      expect(output.warnings).toContain(warnings.none)
      expect(output.warnings).toContain(warnings.missing)
      expect(output.warnings).toContain(warnings.noOcr)
    }
  })

  it('bounds candidates without hiding that more candidates existed', () => {
    const output = extractReceiptText(
      Array.from({ length: 25 }, (_, index) => `Invoice number: INV-${index}`).join('\n'),
    )
    expect(output.invoiceNumber).toHaveLength(RECEIPT_CANDIDATE_LIMIT)
    expect(output.warnings).toContain(warnings.candidateLimit)
    expect(output.warnings).toContain(warnings.multiple)
    expect(extractReceiptText(`Issuer: ${'x'.repeat(161)}`).issuer).toEqual([])
  })

  it('bounds UTF-8 size, number of lines and line length before extraction', () => {
    const utf8 = Array.from({ length: 100 }, () => 'あ'.repeat(1800)).join('\n')
    expect(utf8.length).toBeLessThan(RECEIPT_TEXT_BYTE_LIMIT)
    expect(() => extractReceiptText(utf8)).toThrow('512 KiB')
    expect(() => extractReceiptText('a'.repeat(RECEIPT_TEXT_BYTE_LIMIT + 1))).toThrow('512 KiB')
    expect(() => extractReceiptText('\n'.repeat(RECEIPT_TEXT_LINE_LIMIT))).toThrow('10,000行')
    expect(() => extractReceiptText('a'.repeat(RECEIPT_TEXT_LINE_LENGTH_LIMIT + 1))).toThrow(
      '2,048文字',
    )
  })

  it('uses a strict output allowlist and requires controlled unconfirmed warnings', () => {
    const output = extractReceiptText('Total: USD 10')
    expect(receiptExtractionSchema.safeParse({ ...output, rawText: 'secret' }).success).toBe(false)
    expect(receiptExtractionSchema.safeParse({ ...output, category: 'direct' }).success).toBe(false)
    expect(
      receiptExtractionSchema.safeParse({ ...output, warnings: ['source: /secret'] }).success,
    ).toBe(false)
    expect(receiptExtractionSchema.safeParse({ ...output, warnings: [] }).success).toBe(false)
    expect(
      receiptExtractionSchema.safeParse({
        ...output,
        issuer: Array.from({ length: 21 }, (_, index) => `Issuer ${index}`),
      }).success,
    ).toBe(false)
  })
})

describe('strict receipt JSON adapter', () => {
  it('accepts only the documented versioned string schema with the same candidate rules', () => {
    const input = {
      version: 1,
      issuer: 'Example Inc.',
      billedOn: '2026/10/2',
      paidOn: '2026-10-03',
      currency: 'usd',
      total: '1,234.50',
      startedOn: '2026-10-01',
      endedOn: '2026-10-31',
      invoiceNumber: 'INV-1',
    }
    const output = extractReceiptJson(JSON.stringify(input))
    expect(output).toMatchObject({
      issuer: ['Example Inc.'],
      billedOn: ['2026-10-02'],
      paidOn: ['2026-10-03'],
      currency: ['USD'],
      total: ['1234.50'],
      startedOn: ['2026-10-01'],
      endedOn: ['2026-10-31'],
      invoiceNumber: ['INV-1'],
    })
    expect(output.warnings).toContain(warnings.unconfirmed)
    expect(output).not.toHaveProperty('version')
  })

  it.each([
    '',
    '{',
    'null',
    '[]',
    '"receipt"',
    '{}',
    '{"version":2}',
    '{"version":"1"}',
    '{"version":1,"total":10}',
    '{"version":1,"total":["10"]}',
    '{"version":1,"issuer":null}',
    '{"version":1,"rawText":"PRIVATE_SECRET"}',
    '{"version":1,"category":"direct"}',
    '{"version":1,"original":{"amount":"10"}}',
    '{"version":1,"__proto__":{"total":"10"}}',
    '{"version":1,"total":"10",}',
    '{"version":1,"total":"10","total":"20"}',
    '{"version":1,"total":"10","to\\u0074al":"20"}',
  ])('rejects unsupported or malformed input with a controlled error: %s', (input) => {
    expect(() => extractReceiptJson(input)).toThrow(
      '領収書JSONはversion: 1と対応する文字列項目だけを指定してください。',
    )
    try {
      extractReceiptJson(input)
    } catch (error) {
      expect(String(error)).not.toContain('PRIVATE_SECRET')
    }
  })

  it('does not mistake quoted JSON syntax within a value for duplicate properties', () => {
    const output = extractReceiptJson(
      JSON.stringify({ version: 1, issuer: 'Example Inc.', invoiceNumber: 'INV-1', total: '10' }),
    )
    expect(output.total).toEqual(['10'])
    expect(() => extractReceiptJson('{"version":1,"issuer":"\\\"version\\\": 2"}')).not.toThrow()
  })

  it('represents absent/invalid values as absent candidates, never substitutes a default', () => {
    const output = extractReceiptJson(
      JSON.stringify({ version: 1, billedOn: '2026-02-30', total: '-100', currency: '$' }),
    )
    expect(output.total).toEqual([])
    expect(output.currency).toEqual([])
    expect(output.billedOn).toEqual([])
    expect(output.warnings).toContain(warnings.missing)
    expect(output.warnings).toContain(warnings.invalid)
    expect(extractReceiptJson('{"version":1}').total).toEqual([])
  })

  it('rejects overlong JSON candidates and never leaks raw JSON paths or executable-looking data', () => {
    expect(() =>
      extractReceiptJson(JSON.stringify({ version: 1, issuer: 'x'.repeat(161) })),
    ).toThrow('領収書JSON')
    const output = extractReceiptJson(
      JSON.stringify({
        version: 1,
        issuer: 'C:\\private\\secret.pdf',
        invoiceNumber: '=IMPORTDATA("https://example.com")',
        total: '<script>alert(1)</script>',
      }),
    )
    for (const key of candidateKeys) expect(output[key]).toEqual([])
    expect(JSON.stringify(output)).not.toContain('secret')
    expect(JSON.stringify(output)).not.toContain('script')
  })
})
