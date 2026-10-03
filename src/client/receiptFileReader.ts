import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

export const RECEIPT_FILE_LIMITS = Object.freeze({
  fileBytes: 5 * 1024 * 1024,
  textBytes: 512 * 1024,
  pages: 20,
  textItems: 20_000,
  timeoutMs: 15_000,
})

export interface ReceiptFileText {
  text: string
  format: 'text' | 'json'
}

export type ReceiptFileErrorCode =
  | 'unsupported'
  | 'too-large'
  | 'invalid-text'
  | 'invalid-json'
  | 'invalid-pdf'
  | 'encrypted-pdf'
  | 'no-text'
  | 'too-many-pages'
  | 'too-much-text'
  | 'timeout'
  | 'unavailable'

const messages: Record<ReceiptFileErrorCode, string> = {
  unsupported: '対応形式はテキスト付きPDF・UTF-8のTXT・JSONです。画像は手入力してください。',
  'too-large': 'ファイルは5 MiB以下にしてください。必要な項目を手入力することもできます。',
  'invalid-text': 'テキストを読み取れませんでした。UTF-8のTXTファイルを選ぶか手入力してください。',
  'invalid-json': 'JSONの形式を確認できませんでした。内容を修正するか手入力してください。',
  'invalid-pdf': 'PDFを読み取れませんでした。別のファイルを選ぶか手入力してください。',
  'encrypted-pdf': '暗号化されたPDFには対応していません。必要な項目を手入力してください。',
  'no-text': '文字を読み取れないPDFです。スキャン画像には対応していないため手入力してください。',
  'too-many-pages': 'PDFは20ページ以下にしてください。必要な項目を手入力することもできます。',
  'too-much-text': '文字数が読み取り上限を超えました。必要な項目を手入力してください。',
  timeout: '読み取りが時間内に終わりませんでした。別のファイルを選ぶか手入力してください。',
  unavailable: 'この環境ではPDFを読み取れません。TXTファイルを選ぶか手入力してください。',
}

/** Only fixed messages leave this boundary; parser errors may contain receipt text or paths. */
export class ReceiptFileError extends Error {
  readonly code: ReceiptFileErrorCode

  constructor(code: ReceiptFileErrorCode) {
    super(messages[code])
    this.name = 'ReceiptFileError'
    this.code = code
  }
}

interface PdfTextItem {
  str?: unknown
  hasEOL?: boolean
}

export interface ReceiptPdfDocument {
  numPages: number
  getMetadata(): Promise<{ info: object }>
  getPage(pageNumber: number): Promise<{
    streamTextContent(options: {
      includeMarkedContent: boolean
      disableNormalization: boolean
    }): ReadableStream<{ items: PdfTextItem[] }>
    cleanup(): unknown
  }>
}

export interface ReceiptPdfSession {
  promise: Promise<ReceiptPdfDocument>
  /** Must immediately terminate the owned worker, even if graceful destruction stalls. */
  destroy(): void
}

export interface ReceiptPdfBackend {
  start(data: Uint8Array): ReceiptPdfSession
}

/** Reject every optional font/CMap/wasm request; no document-dependent URL is fetched. */
export class ReceiptNoNetworkDataFactory {
  async fetch(): Promise<never> {
    throw new Error('PDF auxiliary resources are disabled')
  }
}

export const RECEIPT_PDF_OPTIONS = Object.freeze({
  verbosity: 0,
  useWorkerFetch: false,
  BinaryDataFactory: ReceiptNoNetworkDataFactory,
  disableFontFace: true,
  useSystemFonts: false,
  useWasm: false,
  enableXfa: false,
  isOffscreenCanvasSupported: false,
  isImageDecoderSupported: false,
  maxImageSize: 0,
  disableRange: true,
  disableStream: true,
  disableAutoFetch: true,
  stopAtErrors: true,
})

async function loadBrowserPdf(): Promise<ReceiptPdfBackend> {
  if (typeof Worker === 'undefined') throw new ReceiptFileError('unavailable')
  const { getDocument, PDFWorker } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  return {
    start(data) {
      // Both library and worker are version-pinned, bundled local assets. Supplying a
      // native port avoids PDF.js's fake-worker fallback and remote worker wrapper.
      const workerUrl = new URL(pdfWorkerUrl, window.location.href)
      if (workerUrl.origin !== window.location.origin) throw new ReceiptFileError('unavailable')
      const nativeWorker = new Worker(workerUrl, { type: 'module' })
      let worker: InstanceType<typeof PDFWorker> | undefined
      let task: ReturnType<typeof getDocument> | undefined
      let destroyed = false
      const destroy = () => {
        if (destroyed) return
        destroyed = true
        // Never wait for an untrusted parser's graceful shutdown before terminating it.
        try {
          if (task) void task.destroy().catch(() => undefined)
        } catch {
          // Cleanup must not expose a parser's diagnostic or block worker termination.
        }
        try {
          worker?.destroy()
        } catch {
          // Native termination below is the final resource boundary.
        }
        nativeWorker.terminate()
      }
      try {
        worker = PDFWorker.create({ port: nativeWorker, verbosity: 0 })
        // PDF.js 6 removed eval and the former isEvalSupported option entirely.
        // Only text/metadata APIs are called: no viewer, JavaScript sandbox,
        // annotation links, embedded attachments, rendering, or network URL input.
        task = getDocument({ ...RECEIPT_PDF_OPTIONS, data, worker })
        return { promise: task.promise, destroy }
      } catch {
        destroy()
        throw new ReceiptFileError('unavailable')
      }
    },
  }
}

function abortError(): DOMException {
  return new DOMException('読み取りを中止しました。', 'AbortError')
}

function fileFormat(file: File): 'pdf' | 'text' | 'json' {
  if (!Number.isSafeInteger(file.size) || file.size > RECEIPT_FILE_LIMITS.fileBytes) {
    throw new ReceiptFileError('too-large')
  }
  const extension = file.name.toLowerCase().split('.').at(-1)
  if (file.type.startsWith('image/')) throw new ReceiptFileError('unsupported')
  if (extension === 'pdf') return 'pdf'
  if (extension === 'txt') return 'text'
  if (extension === 'json') return 'json'
  throw new ReceiptFileError('unsupported')
}

/** The injection point is for isolated parser/resource-lifecycle tests, never a server API. */
export function createReceiptFileReader(
  loadPdf: () => Promise<ReceiptPdfBackend> = loadBrowserPdf,
) {
  return async (file: File, signal: AbortSignal): Promise<ReceiptFileText> => {
    if (signal.aborted) throw abortError()
    const format = fileFormat(file)
    let session: ReceiptPdfSession | undefined
    let sessionDestroyed = false
    const destroySession = () => {
      if (!session || sessionDestroyed) return
      sessionDestroyed = true
      session.destroy()
    }
    let reader: ReadableStreamDefaultReader<{ items: PdfTextItem[] }> | undefined
    let interrupted: Error | undefined
    let rejectStop!: (error: Error) => void
    const stopped = new Promise<never>((_, reject) => {
      rejectStop = reject
    })
    // A synchronous failure before the first await must not leave a rejected promise unobserved.
    void stopped.catch(() => undefined)
    const stop = (error: Error) => {
      if (interrupted) return
      interrupted = error
      rejectStop(error)
      destroySession()
    }
    const onAbort = () => stop(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(
      () => stop(new ReceiptFileError('timeout')),
      RECEIPT_FILE_LIMITS.timeoutMs,
    )
    const check = () => {
      if (interrupted) throw interrupted
    }
    const wait = async <T>(promise: Promise<T>): Promise<T> => {
      check()
      const result = await Promise.race([promise, stopped])
      check()
      return result
    }
    try {
      // File bytes stay in this invocation and its dedicated worker. Nothing is
      // uploaded, persisted, sent to an API, or read by a filesystem path.
      const buffer = await wait(file.arrayBuffer())
      if (buffer.byteLength > RECEIPT_FILE_LIMITS.fileBytes) throw new ReceiptFileError('too-large')
      if (format !== 'pdf') {
        if (buffer.byteLength > RECEIPT_FILE_LIMITS.textBytes) {
          throw new ReceiptFileError('too-much-text')
        }
        let text: string
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
          if (text.includes('\0')) throw new Error('binary')
        } catch {
          throw new ReceiptFileError('invalid-text')
        }
        if (format === 'json') {
          try {
            JSON.parse(text)
          } catch {
            throw new ReceiptFileError('invalid-json')
          }
        }
        check()
        return { text, format }
      }
      const bytes = new Uint8Array(buffer)
      if (new TextDecoder('ascii').decode(bytes.subarray(0, 5)) !== '%PDF-') {
        throw new ReceiptFileError('invalid-pdf')
      }
      const backend = await wait(loadPdf())
      check()
      session = backend.start(bytes)
      const document = await wait(session.promise)
      if (!Number.isSafeInteger(document.numPages) || document.numPages < 1) {
        throw new ReceiptFileError('invalid-pdf')
      }
      if (document.numPages > RECEIPT_FILE_LIMITS.pages) {
        throw new ReceiptFileError('too-many-pages')
      }
      const { info } = await wait(document.getMetadata())
      if ('EncryptFilterName' in info && info.EncryptFilterName) {
        throw new ReceiptFileError('encrypted-pdf')
      }
      let textBytes = 0
      let itemCount = 0
      const parts: string[] = []
      const encoder = new TextEncoder()
      const append = (text: string) => {
        if (text.length > RECEIPT_FILE_LIMITS.textBytes - textBytes) {
          throw new ReceiptFileError('too-much-text')
        }
        textBytes += encoder.encode(text).byteLength
        if (textBytes > RECEIPT_FILE_LIMITS.textBytes) throw new ReceiptFileError('too-much-text')
        parts.push(text)
      }
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const page = await wait(document.getPage(pageNumber))
        if (pageNumber > 1) append('\n\f\n')
        let pageHasText = false
        try {
          reader = page
            .streamTextContent({ includeMarkedContent: false, disableNormalization: false })
            .getReader()
          for (;;) {
            const chunk = await wait(reader.read())
            if (chunk.done) break
            itemCount += chunk.value.items.length
            if (itemCount > RECEIPT_FILE_LIMITS.textItems) {
              throw new ReceiptFileError('too-much-text')
            }
            for (const item of chunk.value.items) {
              if (typeof item.str !== 'string') continue
              pageHasText ||= item.str.trim().length > 0
              append(item.str)
              append(item.hasEOL ? '\n' : ' ')
            }
            check()
          }
          reader.releaseLock()
          reader = undefined
        } finally {
          page.cleanup()
        }
        // Conservatively refuse partially scanned PDFs instead of returning a
        // plausible-looking incomplete result that omits a page's receipt data.
        if (!pageHasText) throw new ReceiptFileError('no-text')
      }
      check()
      return { text: parts.join(''), format: 'text' }
    } catch (error) {
      if (interrupted) throw interrupted
      if (error instanceof ReceiptFileError) throw error
      if (error instanceof Error && error.name === 'PasswordException') {
        throw new ReceiptFileError('encrypted-pdf')
      }
      throw new ReceiptFileError(format === 'pdf' ? 'invalid-pdf' : 'invalid-text')
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      if (reader) void reader.cancel().catch(() => undefined)
      destroySession()
    }
  }
}

export const readReceiptFile = createReceiptFileReader()
