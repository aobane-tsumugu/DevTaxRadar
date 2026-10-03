// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readReceiptFile, RECEIPT_FILE_LIMITS } from '../../src/client/receiptFileReader'

const pdf = vi.hoisted(() => ({ getDocument: vi.fn(), create: vi.fn() }))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: pdf.getDocument,
  PDFWorker: { create: pdf.create },
}))

let workers: { url: URL; options: WorkerOptions; terminate: ReturnType<typeof vi.fn> }[]
let destroyTask: ReturnType<typeof vi.fn>
let destroyPdfWorker: ReturnType<typeof vi.fn>

function file() {
  const file = new File(['synthetic'], 'receipt.pdf')
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => new TextEncoder().encode('%PDF-1.7\nsynthetic').buffer,
  })
  return file
}

beforeEach(() => {
  workers = []
  vi.stubGlobal(
    'Worker',
    class {
      terminate = vi.fn()
      constructor(url: URL, options: WorkerOptions) {
        workers.push({ url, options, terminate: this.terminate })
      }
    },
  )
  destroyTask = vi.fn(async () => undefined)
  destroyPdfWorker = vi.fn()
  pdf.create.mockReturnValue({ destroy: destroyPdfWorker })
  pdf.getDocument.mockReturnValue({
    promise: Promise.resolve({
      numPages: 1,
      getMetadata: async () => ({ info: { EncryptFilterName: null } }),
      getPage: async () => ({
        streamTextContent: () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue({ items: [{ str: 'Total: JPY 1200', hasEOL: true }] })
              controller.close()
            },
          }),
        cleanup: vi.fn(),
      }),
    }),
    destroy: destroyTask,
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('browser PDF worker boundary (mocked native port)', () => {
  it('uses a same-origin module worker and byte-only input, and closes every resource', async () => {
    await expect(readReceiptFile(file(), new AbortController().signal)).resolves.toMatchObject({
      text: 'Total: JPY 1200\n',
    })
    expect(workers).toHaveLength(1)
    expect(workers[0]!.url.origin).toBe(window.location.origin)
    expect(workers[0]!.url.pathname).toContain('pdf.worker.min.mjs')
    expect(workers[0]!.options).toEqual({ type: 'module' })
    expect(pdf.create).toHaveBeenCalledWith({ port: expect.anything(), verbosity: 0 })
    const options = pdf.getDocument.mock.calls[0]![0]
    expect(options.data).toBeInstanceOf(Uint8Array)
    expect(options.worker).toBe(pdf.create.mock.results[0]!.value)
    expect(options).not.toHaveProperty('url')
    expect(options).not.toHaveProperty('password')
    expect(destroyTask).toHaveBeenCalledOnce()
    expect(destroyPdfWorker).toHaveBeenCalledOnce()
    expect(workers[0]!.terminate).toHaveBeenCalledOnce()
  })

  it('refuses unsupported worker environments instead of parsing on the UI thread', async () => {
    vi.stubGlobal('Worker', undefined)
    await expect(readReceiptFile(file(), new AbortController().signal)).rejects.toMatchObject({
      code: 'unavailable',
    })
    expect(pdf.getDocument).not.toHaveBeenCalled()
  })

  it('terminates immediately on timeout even when graceful parser shutdown never resolves', async () => {
    vi.useFakeTimers()
    pdf.getDocument.mockReturnValue({
      promise: new Promise(() => undefined),
      destroy: destroyTask.mockReturnValue(new Promise(() => undefined)),
    })
    const result = readReceiptFile(file(), new AbortController().signal)
    const assertion = expect(result).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(RECEIPT_FILE_LIMITS.timeoutMs)
    await assertion
    expect(destroyTask).toHaveBeenCalledOnce()
    expect(destroyPdfWorker).toHaveBeenCalledOnce()
    expect(workers[0]!.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('terminates immediately after cancellation and does not reuse a worker on retry', async () => {
    const controller = new AbortController()
    let started!: () => void
    const start = new Promise<void>((resolve) => {
      started = resolve
    })
    pdf.getDocument.mockImplementationOnce(() => {
      started()
      return { promise: new Promise(() => undefined), destroy: destroyTask }
    })
    const result = readReceiptFile(file(), controller.signal)
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await start
    controller.abort()
    await assertion
    await expect(readReceiptFile(file(), new AbortController().signal)).resolves.toMatchObject({
      format: 'text',
    })
    expect(workers).toHaveLength(2)
    for (const worker of workers) expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('still terminates when the library throws during startup or cleanup', async () => {
    pdf.getDocument.mockImplementationOnce(() => {
      throw new Error('PRIVATE parser diagnostic')
    })
    await expect(readReceiptFile(file(), new AbortController().signal)).rejects.toMatchObject({
      code: 'unavailable',
    })
    expect(workers[0]!.terminate).toHaveBeenCalledOnce()
    destroyPdfWorker.mockImplementation(() => {
      throw new Error('PRIVATE cleanup diagnostic')
    })
    await expect(readReceiptFile(file(), new AbortController().signal)).resolves.toMatchObject({
      format: 'text',
    })
    expect(workers[1]!.terminate).toHaveBeenCalledOnce()
  })
})
