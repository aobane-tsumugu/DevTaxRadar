import { useState } from 'react'
import { EDITOR_FILE_LIMIT } from '../editorRecovery'
import type { PlanningSnapshot } from '../../planning/types'
import {
  activeUnitLinks,
  activityFactSchema,
  activityLedgerSchema,
  emptyActivityLedger,
  activityKindLabels,
  activityPurposeLabels,
  activityStateLabels,
  type ActivityFact,
  type ActivityLedger,
} from '../../planning/activityFacts'
import { useEditorRecovery } from '../useEditorRecovery'

type Input = {
  id: string
  productId: string
  taxUnitId: string
  kind: string
  purpose: string
  state: string
  timeKind: string
  from: string
  to: string
  scope: string
  reason: string
  evidenceIds: string[]
  correctsId: string
  correctionReason: string
  productName: string
  linkId: string
  linkProductId: string
  linkReason: string
}
const blank = (): Input => ({
  id: crypto.randomUUID(),
  productId: '',
  taxUnitId: '',
  kind: 'development',
  purpose: 'unknown',
  state: 'unknown',
  timeKind: 'unknown',
  from: '',
  to: '',
  scope: '',
  reason: '',
  evidenceIds: [],
  correctsId: '',
  correctionReason: '',
  productName: '',
  linkId: '',
  linkProductId: '',
  linkReason: '',
})
function valid(value: unknown): value is Input {
  if (!value || typeof value !== 'object') return false
  const row = value as Input
  if (Object.keys(value).sort().join(',') !== Object.keys(blank()).sort().join(',')) return false
  return Object.keys(blank()).every((key) =>
    key === 'evidenceIds'
      ? Array.isArray(row.evidenceIds) && row.evidenceIds.every((id) => typeof id === 'string')
      : typeof row[key as keyof Input] === 'string',
  )
}
export default function ActivityFactsEditor({
  planning,
  onChange,
  datasetId,
  revision,
}: {
  planning: PlanningSnapshot
  onChange: (ledger: ActivityLedger) => void
  datasetId: string
  revision: number
}) {
  const recovery = useEditorRecovery<Input>(datasetId, 'activity-facts', revision, valid)
  const [message, setMessage] = useState('')
  const ledger = planning.activityLedger ?? emptyActivityLedger()
  const draft = recovery.value
  function edit(patch: Partial<Input>) {
    recovery.change({ ...(draft ?? blank()), ...patch })
    setMessage('')
  }
  function append() {
    if (!draft) return
    try {
      const fact = activityFactSchema.parse({
        id: draft.id,
        productId: draft.productId,
        ...(draft.taxUnitId ? { taxUnitId: draft.taxUnitId } : {}),
        kind: draft.kind,
        purpose: draft.purpose,
        state: draft.state,
        time:
          draft.timeKind === 'date'
            ? { kind: 'date', occurredOn: draft.from }
            : draft.timeKind === 'period'
              ? {
                  kind: 'period',
                  startedOn: draft.from,
                  ...(draft.to ? { endedOn: draft.to } : {}),
                }
              : { kind: 'unknown' },
        scope: draft.scope,
        reason: draft.reason,
        evidenceIds: draft.evidenceIds,
        recordedAt: new Date().toISOString(),
        ...(draft.correctsId
          ? { correctsId: draft.correctsId, correctionReason: draft.correctionReason }
          : {}),
      })
      const next = activityLedgerSchema.parse({
        ...ledger,
        facts: [...ledger.facts.filter((row) => row.id !== fact.id), fact],
      })
      onChange(next)
      recovery.close()
      setMessage(
        '活動記録を保存前の計画へ追加しました。画面下の「変更の影響を確認」から保存してください。',
      )
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '入力を確認してください。')
    }
  }
  function correct(fact: ActivityFact) {
    recovery.change({
      ...blank(),
      productId: fact.productId,
      taxUnitId: fact.taxUnitId ?? '',
      kind: fact.kind,
      purpose: fact.purpose,
      state: 'unknown',
      timeKind: fact.time.kind,
      from:
        fact.time.kind === 'date'
          ? fact.time.occurredOn
          : fact.time.kind === 'period'
            ? fact.time.startedOn
            : '',
      to: fact.time.kind === 'period' ? (fact.time.endedOn ?? '') : '',
      scope: fact.scope,
      reason: fact.reason,
      evidenceIds: fact.evidenceIds,
      correctsId: fact.id,
    })
  }
  return (
    <section className="panel activity-editor" aria-label="制作物の活動記録">
      <h4>作っているものと、活動の期間</h4>
      <p>
        履歴が0件でも制作物を登録できます。旧版の利用と改良版の開発を別々に記録できます。公開・売上・終了から税務処理を自動判定しません。
      </p>
      {draft && (
        <button type="button" onClick={recovery.exportCopy}>
          活動入力の控えをファイルに保存
        </button>
      )}
      <label>
        活動入力の控えを読み込む
        <input
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            if (file.size > EDITOR_FILE_LIMIT) {
              setMessage('控えファイルが大きすぎます。')
              return
            }
            void file
              .text()
              .then((raw) => recovery.restore(raw, true))
              .catch(() => setMessage('控えを読み込めません。'))
          }}
        />
      </label>
      {recovery.warning && <p role="alert">{recovery.warning}</p>}
      {recovery.unreadable > 0 && (
        <p role="alert">読めない入力控えがあります。削除せず保持しています。</p>
      )}
      {recovery.copies.map(({ copy, raw }) => (
        <button type="button" key={copy.id} onClick={() => recovery.restore(raw)}>
          入力控えを復旧（{copy.updatedAt}）
        </button>
      ))}
      <label>
        作っているものの名前
        <input
          value={draft?.productName ?? ''}
          onChange={(event) => edit({ productName: event.target.value })}
          maxLength={160}
        />
      </label>
      <button
        type="button"
        disabled={!draft?.productName.trim()}
        onClick={() => {
          if (!draft?.productName.trim()) return
          const id = `product-${draft.id}`
          onChange({
            ...ledger,
            products: ledger.products.some((row) => row.id === id)
              ? ledger.products
              : [...ledger.products, { id, name: draft.productName.trim() }],
          })
          edit({ id: crypto.randomUUID(), productId: id, productName: '' })
        }}
      >
        制作物を計画へ追加
      </button>
      {ledger.products.map((product) => (
        <div key={product.id}>
          <strong>{product.name}</strong>
          <p>制作物ID: {product.id}</p>
          {activeUnitLinks(ledger)
            .filter((link) => link.productId === product.id)
            .map((link) => (
              <p key={link.id}>
                費用単位：{planning.taxUnits.find((unit) => unit.id === link.taxUnitId)?.name} /{' '}
                {link.taxUnitId}
              </p>
            ))}
          <label>
            既存の費用単位を結ぶ
            <select
              value=""
              onChange={(event) => {
                if (event.target.value)
                  onChange({
                    ...ledger,
                    unitLinks: [
                      ...ledger.unitLinks,
                      {
                        id: crypto.randomUUID(),
                        productId: product.id,
                        taxUnitId: event.target.value,
                      },
                    ],
                  })
              }}
            >
              <option value="">単位を選択</option>
              {planning.taxUnits
                .filter(
                  (unit) => !activeUnitLinks(ledger).some((link) => link.taxUnitId === unit.id),
                )
                .map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
      ))}
      {ledger.products.length > 0 && (
        <>
          <button
            type="button"
            disabled={Boolean(draft)}
            onClick={() => edit({ productId: ledger.products[0]!.id })}
          >
            活動事実を入力
          </button>
          {draft && (
            <div className="simple-form-grid">
              <label>
                対象の制作物
                <select
                  value={draft.productId}
                  onChange={(event) => edit({ productId: event.target.value, taxUnitId: '' })}
                >
                  <option value="">選択</option>
                  {ledger.products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                対象の費用単位
                <select
                  value={draft.taxUnitId}
                  onChange={(event) => edit({ taxUnitId: event.target.value })}
                >
                  <option value="">制作物全体（税務上の資産単位を確定しません）</option>
                  {activeUnitLinks(ledger)
                    .filter((link) => link.productId === draft.productId)
                    .map((link) => (
                      <option key={link.id} value={link.taxUnitId}>
                        {planning.taxUnits.find((unit) => unit.id === link.taxUnitId)?.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                活動
                <select value={draft.kind} onChange={(event) => edit({ kind: event.target.value })}>
                  {Object.entries(activityKindLabels).map(([key, title]) => (
                    <option key={key} value={key}>
                      {title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                用途
                <select
                  value={draft.purpose}
                  onChange={(event) => edit({ purpose: event.target.value })}
                >
                  {Object.entries(activityPurposeLabels).map(([key, title]) => (
                    <option key={key} value={key}>
                      {title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                確認状態
                <select
                  value={draft.state}
                  onChange={(event) => edit({ state: event.target.value })}
                >
                  {Object.entries(activityStateLabels).map(([key, title]) => (
                    <option key={key} value={key}>
                      {title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                日付の形式
                <select
                  value={draft.timeKind}
                  onChange={(event) => edit({ timeKind: event.target.value })}
                >
                  <option value="unknown">日時不明</option>
                  <option value="date">出来事の日</option>
                  <option value="period">活動の期間</option>
                </select>
              </label>
              {draft.timeKind !== 'unknown' && (
                <label>
                  発生日・開始日
                  <input
                    type="date"
                    value={draft.from}
                    onChange={(event) => edit({ from: event.target.value })}
                  />
                </label>
              )}
              {draft.timeKind === 'period' && (
                <label>
                  終了日（未指定も可）
                  <input
                    type="date"
                    value={draft.to}
                    onChange={(event) => edit({ to: event.target.value })}
                  />
                </label>
              )}
              <label>
                範囲（版・機能・一部中止など）
                <input
                  value={draft.scope}
                  onChange={(event) => edit({ scope: event.target.value })}
                  maxLength={2000}
                />
              </label>
              <label>
                確認・推定・不明・矛盾の理由
                <textarea
                  value={draft.reason}
                  onChange={(event) => edit({ reason: event.target.value })}
                  maxLength={2000}
                />
              </label>
              <fieldset>
                <legend>根拠（任意・証拠画面で登録）</legend>
                {planning.evidence.map((proof) => (
                  <label key={proof.id}>
                    <input
                      type="checkbox"
                      checked={draft.evidenceIds.includes(proof.id)}
                      onChange={(event) =>
                        edit({
                          evidenceIds: event.target.checked
                            ? [...draft.evidenceIds, proof.id]
                            : draft.evidenceIds.filter((id) => id !== proof.id),
                        })
                      }
                    />
                    {proof.note}
                  </label>
                ))}
              </fieldset>
              {draft.correctsId && (
                <label>
                  訂正理由（元の記録 {draft.correctsId} を保持）
                  <textarea
                    value={draft.correctionReason}
                    onChange={(event) => edit({ correctionReason: event.target.value })}
                    maxLength={2000}
                  />
                </label>
              )}
              <button type="button" onClick={append}>
                活動記録を計画へ追加
              </button>
              <button type="button" onClick={() => recovery.close()}>
                この入力を取り消す
              </button>
            </div>
          )}
        </>
      )}
      {activeUnitLinks(ledger).map((link) => (
        <details key={link.id}>
          <summary>費用単位 {link.taxUnitId} の制作物への対応を訂正</summary>
          <p>
            元の対応は保持します。事実の対象も誤っていた場合は、その事実の訂正を別途追加してください。
          </p>
          <label>
            訂正先の制作物
            <select
              value={draft?.linkId === link.id ? draft.linkProductId : link.productId}
              onChange={(event) => edit({ linkId: link.id, linkProductId: event.target.value })}
            >
              {ledger.products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            対応の訂正理由
            <input
              value={draft?.linkId === link.id ? draft.linkReason : ''}
              onChange={(event) =>
                edit({
                  linkId: link.id,
                  linkProductId: draft?.linkId === link.id ? draft.linkProductId : link.productId,
                  linkReason: event.target.value,
                })
              }
              maxLength={2000}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              const productId = draft?.linkId === link.id ? draft.linkProductId : link.productId
              const reason = draft?.linkId === link.id ? draft.linkReason.trim() : ''
              if (!reason || productId === link.productId) {
                setMessage('異なる訂正先と理由を指定してください。')
                return
              }
              onChange({
                ...ledger,
                unitLinks: [
                  ...ledger.unitLinks,
                  {
                    id: crypto.randomUUID(),
                    productId,
                    taxUnitId: link.taxUnitId,
                    correctsId: link.id,
                    correctionReason: reason,
                  },
                ],
              })
            }}
          >
            対応の訂正を計画へ追加
          </button>
        </details>
      ))}
      {ledger.facts.map((fact) => (
        <p key={fact.id}>
          {activityKindLabels[fact.kind]} / {activityStateLabels[fact.state]} / {fact.scope} /{' '}
          {fact.id}
          {!ledger.facts.some((row) => row.correctsId === fact.id) && (
            <button type="button" disabled={Boolean(draft)} onClick={() => correct(fact)}>
              訂正を追加
            </button>
          )}
        </p>
      ))}
      {message && <p role="status">{message}</p>}
    </section>
  )
}
