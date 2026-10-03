import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createReceiptFileReader,
  readReceiptFile,
  ReceiptFileError,
  RECEIPT_FILE_LIMITS,
  RECEIPT_PDF_OPTIONS,
  ReceiptNoNetworkDataFactory,
  type ReceiptPdfBackend,
  type ReceiptPdfDocument,
} from '../../src/client/receiptFileReader'

const pdfFile = () => new File(['%PDF-1.7\nsynthetic'], 'receipt.pdf')
const signal = () => new AbortController().signal
const textItem = (str: string, hasEOL = true) => ({ str, hasEOL })
type TextChunk = { items: ReturnType<typeof textItem>[] }

function pending<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function fakePdf(pages: TextChunk[][] = [[{ items: [textItem('Total: JPY 1200')] }]]) {
  const cleanup = vi.fn()
  const getPage = vi.fn(async (page: number) => ({
    streamTextContent: vi.fn(
      () =>
        new ReadableStream<TextChunk>({
          start(controller) {
            for (const chunk of pages[page - 1]!) controller.enqueue(chunk)
            controller.close()
          },
        }),
    ),
    cleanup,
  }))
  const document: ReceiptPdfDocument = {
    numPages: pages.length,
    getMetadata: vi.fn(async () => ({ info: { EncryptFilterName: null } })),
    getPage,
  }
  const destroy = vi.fn()
  const start = vi.fn((_data: Uint8Array) => ({ promise: Promise.resolve(document), destroy }))
  const load = vi.fn(async () => ({ start }))
  return { document, cleanup, getPage, destroy, start, load, read: createReceiptFileReader(load) }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('local receipt file reader', () => {
  it('decodes UTF-8 TXT and validates JSON without starting PDF code or a worker', async () => {
    const fake = fakePdf()
    await expect(fake.read(new File(['合計: 1,200円'], '領収書.TXT'), signal())).resolves.toEqual({
      text: '合計: 1,200円',
      format: 'text',
    })
    await expect(
      fake.read(new File(['{"amount":1200}'], 'receipt.json'), signal()),
    ).resolves.toEqual({ text: '{"amount":1200}', format: 'json' })
    expect(fake.load).not.toHaveBeenCalled()
  })

  it('rejects invalid UTF-8, binary text, malformed JSON, images, and unsupported formats', async () => {
    const cases: [File, string][] = [
      [new File([new Uint8Array([0xc3, 0x28])], 'receipt.txt'), 'invalid-text'],
      [new File(['hello\0world'], 'receipt.txt'), 'invalid-text'],
      [new File(['{"amount":1200,}'], 'receipt.json'), 'invalid-json'],
      [new File(['synthetic'], 'receipt.png', { type: 'image/png' }), 'unsupported'],
      [new File(['synthetic'], 'receipt.pdf', { type: 'image/jpeg' }), 'unsupported'],
      [new File(['synthetic'], 'receipt.csv'), 'unsupported'],
      [new File(['not a PDF'], 'receipt.pdf'), 'invalid-pdf'],
    ]
    for (const [file, code] of cases) {
      await expect(readReceiptFile(file, signal())).rejects.toMatchObject({ code })
    }
  })

  it('rejects oversize files before reading any bytes and rechecks bytes after a read', async () => {
    const file = new File(['small'], 'receipt.txt')
    const read = vi.spyOn(file, 'arrayBuffer')
    Object.defineProperty(file, 'size', { value: RECEIPT_FILE_LIMITS.fileBytes + 1 })
    await expect(readReceiptFile(file, signal())).rejects.toMatchObject({ code: 'too-large' })
    expect(read).not.toHaveBeenCalled()
    const deceptive = new File(['small'], 'receipt.txt')
    vi.spyOn(deceptive, 'arrayBuffer').mockResolvedValue(
      new ArrayBuffer(RECEIPT_FILE_LIMITS.fileBytes + 1),
    )
    await expect(readReceiptFile(deceptive, signal())).rejects.toMatchObject({ code: 'too-large' })
  })

  it('bounds TXT and JSON input at 512 KiB before parsing', async () => {
    for (const extension of ['txt', 'json']) {
      await expect(
        readReceiptFile(
          new File(['a'.repeat(RECEIPT_FILE_LIMITS.textBytes + 1)], `receipt.${extension}`),
          signal(),
        ),
      ).rejects.toMatchObject({ code: 'too-much-text' })
    }
  })

  it('streams text in order, preserves line and page boundaries, then destroys resources', async () => {
    const fake = fakePdf([
      [{ items: [textItem('Vendor:', false), textItem('Synthetic merchant')] }],
      [{ items: [textItem('Total: JPY 1200')] }],
    ])
    await expect(fake.read(pdfFile(), signal())).resolves.toEqual({
      text: 'Vendor: Synthetic merchant\n\n\f\nTotal: JPY 1200\n',
      format: 'text',
    })
    expect(fake.start.mock.calls[0]).toHaveLength(1)
    expect(fake.start.mock.calls[0]![0]).toBeInstanceOf(Uint8Array)
    expect(fake.cleanup).toHaveBeenCalledTimes(2)
    expect(fake.destroy).toHaveBeenCalledTimes(1)
  })

  it('rejects page, streamed item, and UTF-8 text limits without partial results', async () => {
    const tooManyPages = fakePdf()
    tooManyPages.document.numPages = RECEIPT_FILE_LIMITS.pages + 1
    await expect(tooManyPages.read(pdfFile(), signal())).rejects.toMatchObject({
      code: 'too-many-pages',
    })
    expect(tooManyPages.getPage).not.toHaveBeenCalled()
    const tooManyItems = fakePdf([
      [{ items: Array.from({ length: RECEIPT_FILE_LIMITS.textItems + 1 }, () => textItem('')) }],
    ])
    await expect(tooManyItems.read(pdfFile(), signal())).rejects.toMatchObject({
      code: 'too-much-text',
    })
    const tooMuchText = fakePdf([
      [{ items: [textItem('領'.repeat(Math.ceil(RECEIPT_FILE_LIMITS.textBytes / 3)))] }],
    ])
    await expect(tooMuchText.read(pdfFile(), signal())).rejects.toMatchObject({
      code: 'too-much-text',
    })
    for (const fake of [tooManyPages, tooManyItems, tooMuchText]) {
      expect(fake.destroy).toHaveBeenCalledTimes(1)
    }
  })

  it('refuses image-only and partially scanned PDFs rather than returning missing pages', async () => {
    for (const pages of [
      [[{ items: [] }]],
      [[{ items: [textItem('Receipt')] }], [{ items: [] }]],
    ]) {
      const fake = fakePdf(pages)
      await expect(fake.read(pdfFile(), signal())).rejects.toMatchObject({ code: 'no-text' })
      expect(fake.destroy).toHaveBeenCalledOnce()
    }
  })

  it('rejects encryption, including documents whose empty user password opens automatically', async () => {
    const fake = fakePdf()
    fake.document.getMetadata = async () => ({ info: { EncryptFilterName: 'Standard' } })
    await expect(fake.read(pdfFile(), signal())).rejects.toMatchObject({ code: 'encrypted-pdf' })
    expect(fake.getPage).not.toHaveBeenCalled()
  })

  it('replaces parser errors containing private content with fixed messages', async () => {
    const fake = fakePdf()
    fake.document.getPage = async () => {
      throw new Error('SYNTHETIC_SECRET_TEXT /private/receipt.pdf')
    }
    let failure: unknown
    try {
      await fake.read(pdfFile(), signal())
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(ReceiptFileError)
    expect(failure).toMatchObject({ code: 'invalid-pdf' })
    expect(String(failure)).not.toContain('SYNTHETIC_SECRET_TEXT')
    expect(String(failure)).not.toContain('/private/')
    expect(fake.destroy).toHaveBeenCalledOnce()
  })

  it('does not read a file if already aborted', async () => {
    const controller = new AbortController()
    controller.abort('DO NOT LEAK THIS REASON')
    const file = pdfFile()
    const arrayBuffer = vi.spyOn(file, 'arrayBuffer')
    await expect(readReceiptFile(file, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  it('aborts during file reading and ignores late bytes', async () => {
    const controller = new AbortController()
    const bytes = pending<ArrayBuffer>()
    const file = pdfFile()
    vi.spyOn(file, 'arrayBuffer').mockReturnValue(bytes.promise)
    const fake = fakePdf()
    const result = fake.read(file, controller.signal)
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await assertion
    bytes.resolve(new TextEncoder().encode('%PDF-1.7').buffer)
    await Promise.resolve()
    expect(fake.load).not.toHaveBeenCalled()
  })

  it('does not start a worker when a cancelled lazy import resolves later', async () => {
    const controller = new AbortController()
    const backend = pending<ReceiptPdfBackend>()
    const loading = pending<boolean>()
    const start = vi.fn()
    const read = createReceiptFileReader(() => {
      loading.resolve(true)
      return backend.promise
    })
    const result = read(pdfFile(), controller.signal)
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await loading.promise
    controller.abort()
    await assertion
    backend.resolve({ start })
    await Promise.resolve()
    expect(start).not.toHaveBeenCalled()
  })

  it('destroys the worker on abort while PDF loading is pending', async () => {
    const controller = new AbortController()
    const document = pending<ReceiptPdfDocument>()
    const started = pending<boolean>()
    const destroy = vi.fn()
    const read = createReceiptFileReader(async () => ({
      start: () => {
        started.resolve(true)
        return { promise: document.promise, destroy }
      },
    }))
    const result = read(pdfFile(), controller.signal)
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await started.promise
    controller.abort()
    await assertion
    document.reject(new Error('late parser rejection'))
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('times out a stalled text stream and cancels/destroys resources', async () => {
    vi.useFakeTimers()
    const fake = fakePdf()
    const reading = pending<boolean>()
    const cancel = vi.fn()
    fake.document.getPage = async () => ({
      cleanup: fake.cleanup,
      streamTextContent: () =>
        new ReadableStream({
          start: () => reading.resolve(true),
          cancel,
        }),
    })
    const result = fake.read(pdfFile(), signal())
    const assertion = expect(result).rejects.toMatchObject({ code: 'timeout' })
    await reading.promise
    await vi.advanceTimersByTimeAsync(RECEIPT_FILE_LIMITS.timeoutMs)
    await assertion
    expect(cancel).toHaveBeenCalledOnce()
    expect(fake.destroy).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps concurrent reads independent when one is cancelled', async () => {
    const controller = new AbortController()
    const slow = pending<ArrayBuffer>()
    const first = pdfFile()
    vi.spyOn(first, 'arrayBuffer').mockReturnValue(slow.promise)
    const fake = fakePdf()
    const cancelled = fake.read(first, controller.signal)
    const assertion = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    const successful = fake.read(pdfFile(), signal())
    controller.abort()
    await assertion
    await expect(successful).resolves.toMatchObject({ format: 'text' })
    expect(fake.destroy).toHaveBeenCalledOnce()
  })

  it('disables asset fetches, rendering features, and all URL input options', async () => {
    await expect(new ReceiptNoNetworkDataFactory().fetch()).rejects.toThrow(
      'PDF auxiliary resources are disabled',
    )
    expect(RECEIPT_PDF_OPTIONS).toMatchObject({
      useWorkerFetch: false,
      disableFontFace: true,
      useSystemFonts: false,
      useWasm: false,
      enableXfa: false,
      disableRange: true,
      disableStream: true,
      disableAutoFetch: true,
      stopAtErrors: true,
    })
    for (const key of ['url', 'cMapUrl', 'standardFontDataUrl', 'wasmUrl', 'docBaseUrl']) {
      expect(RECEIPT_PDF_OPTIONS).not.toHaveProperty(key)
    }
    const workerSource = readFileSync(
      new URL('../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url),
      'utf8',
    )
    expect(workerSource).not.toMatch(/\bnew Function\s*\(|\beval\s*\(/)
    // The sole legacy core-js constructor is a fixed global-discovery fallback,
    // short-circuited by globalThis in supported environments, never document code.
    expect(workerSource.match(/(?<![A-Za-z])Function\s*\([^\n]*/g)).toEqual([
      "Function('return this')();",
    ])
  })
})

/** Minimal synthetic, uncompressed PDF with real page resources/xref offsets. */
function makePdf(pages: string[], catalogExtra = '', pageExtra = ''): Uint8Array<ArrayBuffer> {
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R ${catalogExtra} >>`,
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  pages.forEach((text, i) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R ${pageExtra} >>`,
    )
    const content = text ? `BT /F1 12 Tf 20 260 Td (${text}) Tj ET` : ''
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
  })
  let pdf = '%PDF-1.7\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(pdf)
}

describe('real PDF.js parsing of synthetic files', () => {
  async function realReader() {
    const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs')
    // Node's in-process test worker is an injected parser boundary only. The
    // production browser backend always supplies and owns a native Worker.
    return createReceiptFileReader(async () => ({
      start(data) {
        const task = pdf.getDocument({ ...RECEIPT_PDF_OPTIONS, data })
        return { promise: task.promise, destroy: () => void task.destroy().catch(() => undefined) }
      },
    }))
  }

  it('extracts a genuine multipage PDF locally with page boundaries and no fetch', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'))
    const read = await realReader()
    const result = await read(
      new File([makePdf(['Synthetic merchant', 'Total: JPY 1200'])], 'receipt.pdf'),
      signal(),
    )
    expect(result.text).toContain('Synthetic merchant')
    expect(result.text).toContain('\n\f\n')
    expect(result.text).toContain('Total: JPY 1200')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a corrupt PDF and a valid PDF with no text', async () => {
    const read = await realReader()
    await expect(read(pdfFile(), signal())).rejects.toMatchObject({ code: 'invalid-pdf' })
    await expect(read(new File([makePdf([''])], 'receipt.pdf'), signal())).rejects.toMatchObject({
      code: 'no-text',
    })
  })

  it('does not execute embedded JavaScript or follow PDF link annotations', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'))
    const read = await realReader()
    const bytes = makePdf(
      ['Total: JPY 1200'],
      '/OpenAction << /S /JavaScript /JS (globalThis.receiptPdfScriptExecuted = true) >>',
      '/Annots [<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /A << /S /URI /URI (https://example.invalid/receipt) >> >>]',
    )
    await expect(read(new File([bytes], 'receipt.pdf'), signal())).resolves.toMatchObject({
      text: expect.stringContaining('Total: JPY 1200'),
    })
    expect(globalThis).not.toHaveProperty('receiptPdfScriptExecuted')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects both password-required and empty-password encrypted PDFs', async () => {
    const read = await realReader()
    for (const filename of ['password-protected', 'encrypted-empty-password']) {
      const bytes = readFileSync(new URL(`../fixtures/receipt/${filename}.pdf`, import.meta.url))
      await expect(
        read(new File([new Uint8Array(bytes)], 'receipt.pdf'), signal()),
      ).rejects.toMatchObject({ code: 'encrypted-pdf' })
    }
  })
})
