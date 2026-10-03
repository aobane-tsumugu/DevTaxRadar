import { useEffect, useRef, useState } from 'react'
import {
  extractReceiptJson,
  extractReceiptText,
  type ReceiptExtraction,
} from '../../core/receiptExtraction'
import { originalChargeDigest, type OriginalChargeCategory } from '../../planning/originalCharges'
import { readReceiptFile } from '../receiptFileReader'

const labels = {
  issuer: '発行元',
  billedOn: '請求日',
  paidOn: '支払日',
  currency: '原通貨',
  total: '合計額',
  startedOn: '利用期間の開始日',
  endedOn: '利用期間の終了日',
  invoiceNumber: '請求書番号',
} as const
export type ReceiptSelection = Partial<Record<keyof typeof labels, string>> & {
  category: OriginalChargeCategory
  sourceKey: string
}
/** Unreviewed extraction and source bytes live only in this component's memory. */
export default function ReceiptCandidateIntake({
  disabled,
  revision,
  onUse,
}: {
  disabled: boolean
  revision: number
  onUse: (selection: ReceiptSelection) => void
}) {
  const [result, setResult] = useState<{ fields: ReceiptExtraction; sourceKey: string } | null>(
    null,
  )
  const [selected, setSelected] = useState<Partial<Record<keyof typeof labels, string>>>({})
  const [category, setCategory] = useState<OriginalChargeCategory | ''>('')
  const [reviewed, setReviewed] = useState(false)
  const [reading, setReading] = useState(false)
  const [message, setMessage] = useState('')
  const controller = useRef<AbortController | null>(null)
  const epoch = useRef(0)
  function stopParsing() {
    epoch.current++
    controller.current?.abort()
  }
  function cancel(message = '') {
    stopParsing()
    controller.current = null
    setReading(false)
    setResult(null)
    setSelected({})
    setCategory('')
    setReviewed(false)
    setMessage(message)
  }
  useEffect(() => {
    const navigate = () =>
      cancel('画面移動のため読み取り候補を破棄しました。必要なら再選択してください。')
    window.addEventListener('popstate', navigate)
    return () => {
      stopParsing()
      window.removeEventListener('popstate', navigate)
    }
  }, [])
  useEffect(() => {
    cancel()
  }, [revision, disabled])
  async function read(file: File) {
    if (disabled) return
    cancel()
    const token = ++epoch.current
    const abort = new AbortController()
    controller.current = abort
    setReading(true)
    try {
      const parsed = await readReceiptFile(file, abort.signal)
      if (abort.signal.aborted || token !== epoch.current) return
      const fields =
        parsed.format === 'json' ? extractReceiptJson(parsed.text) : extractReceiptText(parsed.text)
      // A document fingerprint is not a path, filename, invoice number, or retained document body.
      const sourceKey = `receipt:${originalChargeDigest(parsed.text)}`
      setResult({ fields, sourceKey })
      setMessage(
        '読み取りは未確認の候補です。使う値を一つずつ選んでください。候補がない項目は次の画面で手入力できます。',
      )
    } catch {
      if (!abort.signal.aborted && token === epoch.current)
        setMessage(
          '読み取れませんでした。UTF-8テキスト・指定形式のJSON・文字を持つPDFが対象です。破損・暗号化・画像のみ・上限超過の資料は手入力してください。',
        )
    } finally {
      if (token === epoch.current) {
        setReading(false)
        controller.current = null
      }
    }
  }
  return (
    <section aria-label="領収書から未確認候補を読み取る">
      <h3>領収書・請求書から候補を読み取る</h3>
      <p>
        このブラウザ内で処理します。外部AI・OCRへ送信しません。画像・スキャンPDFのOCRは未対応です。原文・ファイル名・パスは保存せず、原本の参照は証拠画面で登録してください。
      </p>
      <label>
        領収書のテキスト・JSON・文字付きPDF
        <input
          type="file"
          accept=".txt,.json,.pdf,text/plain,application/json,application/pdf"
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void read(file)
          }}
        />
      </label>
      {message && <p role="status">{message}</p>}
      {reading && (
        <p role="status">ローカルで読み取り中です。取り消し・別ファイルへの変更ができます。</p>
      )}
      {(reading || result) && (
        <button
          type="button"
          onClick={() => cancel('読み取りを取り消しました。保存済みの費用は変更していません。')}
        >
          領収書の読み取りを取り消す
        </button>
      )}
      {result && (
        <fieldset disabled={disabled}>
          <legend>読み取り候補から使う値を選ぶ</legend>
          {result.fields.warnings.map((warning) => (
            <p role="note" key={warning}>
              {warning}
            </p>
          ))}
          <p>
            原本で税抜・税込、請求総額・支払総額、通貨と期間を確認してください。請求書番号は契約番号として扱いません。種類・配分・税務処理・業務利用開始日は読み取りから決めません。
          </p>
          {Object.entries(labels).map(([name, label]) => {
            const key = name as keyof typeof labels
            return (
              <label key={key}>
                {label}の候補
                <select
                  value={selected[key] ?? ''}
                  onChange={(event) => {
                    setSelected({ ...selected, [key]: event.target.value })
                    setReviewed(false)
                  }}
                >
                  <option value="">使わない・手入力で確認</option>
                  {result.fields[key].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            )
          })}
          <label>
            確認して選ぶ支払の種類
            <select
              value={category}
              onChange={(event) => {
                setCategory(event.target.value as OriginalChargeCategory | '')
                setReviewed(false)
              }}
            >
              <option value="">種類を選択してください</option>
              <option value="subscription">AIサブスクリプション</option>
              <option value="equipment">設備・機材</option>
              <option value="home">自宅の共用費</option>
              <option value="direct">制作物の直接費</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(event) => setReviewed(event.target.checked)}
            />
            選んだ候補を原本と照合した（保存前に追加入力・確認が必要）
          </label>
          <button
            type="button"
            disabled={!category || !reviewed}
            onClick={() => {
              if (!category || !reviewed) return
              onUse({ ...selected, category, sourceKey: result.sourceKey })
              cancel()
            }}
          >
            選んだ候補で支払の入力を始める
          </button>
        </fieldset>
      )}
    </section>
  )
}
