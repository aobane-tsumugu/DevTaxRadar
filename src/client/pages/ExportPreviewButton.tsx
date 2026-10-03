import { useEffect, useId, useRef, useState } from 'react'
import { createFocusTrap } from '../focusTrap.js'

/** Load preview and download together, including prepared archive contents; no second API read. */
export default function ExportPreviewButton({
  label,
  filename,
  load,
  disabled = false,
}: {
  label: string
  filename: string
  load: () => Promise<Blob | { blob: Blob; text: string }>
  disabled?: boolean
}) {
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<{ blob: Blob; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sequence = useRef(0)
  useEffect(
    () => () => {
      sequence.current++
    },
    [],
  )
  useEffect(() => {
    if (!preview || !panel.current) return
    return createFocusTrap(panel.current, () => setPreview(null))
  }, [preview])

  async function open() {
    const current = ++sequence.current
    setBusy(true)
    setError('')
    try {
      const loaded = await load()
      const blob = 'blob' in loaded ? loaded.blob : loaded
      const text = 'blob' in loaded ? loaded.text : await loaded.text()
      if (current === sequence.current) setPreview({ blob, text })
    } catch (cause) {
      if (current === sequence.current)
        setError(
          cause instanceof Error
            ? cause.message
            : '出力を読み込めませんでした。保存済みの資料は変更していません。',
        )
    } finally {
      if (current === sequence.current) setBusy(false)
    }
  }
  function download() {
    if (!preview) return
    const url = URL.createObjectURL(preview.blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    try {
      link.click()
    } finally {
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }
  return (
    <>
      <button
        type="button"
        className="export-button"
        disabled={disabled || busy}
        onClick={() => void open()}
      >
        {busy ? '出力内容を読込中' : label}
      </button>
      {error && <p role="alert">{error}</p>}
      {preview && (
        <div
          className="onboarding-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background: 'rgb(0 0 0 / 40%)',
            display: 'grid',
            placeItems: 'center',
            padding: '1rem',
          }}
        >
          <div
            className="onboarding-dialog"
            style={{
              background: 'white',
              borderRadius: '1rem',
              padding: '1.5rem',
              width: 'min(70rem, 100%)',
              maxHeight: '95vh',
              overflow: 'auto',
            }}
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={id}
            tabIndex={-1}
          >
            <h2 id={id}>渡す前に出力内容を確認</h2>
            <p>
              この資料の金額・対象年・保存版と、名称・相談内容・自由記述を確認してください。自動匿名化はしていません。
            </p>
            <p>
              これは説明用の出力です。元の証拠・履歴ファイルや、個人用の復元バックアップとは異なります。読込み・確認だけでは送信もダウンロードもしません。
            </p>
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                maxHeight: '60vh',
                overflow: 'auto',
              }}
            >
              {preview.text}
            </pre>
            <div className="cost-toolbar">
              <button type="button" className="primary-button" onClick={download}>
                確認した内容を保存する
              </button>
              <button type="button" onClick={() => setPreview(null)}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
