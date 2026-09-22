import { useEffect, useMemo, useState } from 'react'
import type { DecisionRecord, TaxUnitRecord } from '../../planning/types'
import type { ConsultationNavigation } from '../consultationNavigation'
import {
  decisionIsConfirmed,
  MANUAL_DECISION_VERSION,
  reviseDecision,
} from '../../core/decisionConfirmation'
import { EDITOR_FILE_LIMIT, restoreEditorCopy } from '../editorRecovery'
import { useEditorRecovery } from '../useEditorRecovery'
import { treatmentCandidateLabels } from '../../core/costTreatmentFacts'
import {
  canonicalDecisionEditorValue,
  validDecisionEditorValue,
  type DecisionEditorValue,
} from '../decisionEditorValue'

const RECOVERY_EDITOR = 'decision-records'
const CANDIDATE_OPTIONS = 'decision-candidate-options'
// The calculations recognise stored codes such as software-acquisition-cost; offer them by their
// Japanese names so nobody has to know the code, while still accepting other wording.
const candidateName = (value: string | undefined) =>
  value ? (treatmentCandidateLabels as Record<string, string>)[value] : undefined

export default function DecisionEditor({
  value,
  savedValue,
  units,
  year,
  onChange,
  consultation,
  datasetId,
  parentRevision = 0,
}: {
  value: DecisionRecord[]
  savedValue?: DecisionRecord[]
  units: TaxUnitRecord[]
  year: number
  onChange: (value: DecisionRecord[]) => void
  consultation?: ConsultationNavigation
  datasetId?: string
  parentRevision?: number
}) {
  const recoveryEnabled = Boolean(datasetId)
  const recoveryDataset = datasetId ?? 'unconnected'
  const recovery = useEditorRecovery<DecisionEditorValue>(
    recoveryDataset,
    RECOVERY_EDITOR,
    parentRevision,
    validDecisionEditorValue,
  )
  const saved = savedValue ?? value
  const editor = recoveryEnabled ? recovery.value : null
  const rows = editor?.decisions ?? value
  const [volatileYears, setVolatileYears] = useState<Array<{ id: string; raw: string }>>([])
  const [message, setMessage] = useState('')

  function baseValue(): DecisionEditorValue {
    return editor ? structuredClone(editor) : {
      decisions: structuredClone(rows),
      originals: [],
      yearInputs: [],
    }
  }
  function markOriginal(next: DecisionEditorValue, id: string) {
    if (next.originals.some((row) => row.id === id)) return
    const original = saved.find((row) => row.id === id)
    next.originals.push({ id, value: original ? structuredClone(original) : null })
  }
  function write(next: DecisionEditorValue) {
    if (recoveryEnabled) recovery.change(next, parentRevision)
    onChange(structuredClone(next.decisions))
  }
  function edit(index: number, patch: Parameters<typeof reviseDecision>[1]) {
    const next = baseValue()
    const row = next.decisions[index]
    if (!row) return
    markOriginal(next, row.id)
    next.decisions[index] = reviseDecision(row, patch)
    write(next)
  }
  function editYear(index: number, raw: string) {
    const next = baseValue()
    const row = next.decisions[index]
    if (!row) return
    markOriginal(next, row.id)
    next.yearInputs = [...next.yearInputs.filter((item) => item.id !== row.id), { id: row.id, raw }]
    setVolatileYears((current) => [...current.filter((item) => item.id !== row.id), { id: row.id, raw }])
    const parsed = /^\d{4}$/.test(raw) ? Number(raw) : null
    next.decisions[index] = reviseDecision(
      row,
      parsed !== null && parsed >= 2000 && parsed <= 2100 ? { taxYear: parsed } : {},
    )
    write(next)
  }
  function addDecision(taxUnitId: string, taxYear: number) {
    const next = baseValue()
    const id = crypto.randomUUID()
    const row: DecisionRecord = {
      id,
      taxUnitId,
      taxYear,
      engineVersion: MANUAL_DECISION_VERSION,
      candidate: '',
      status: 'pending',
      createdAt: new Date().toISOString(),
    }
    next.decisions.push(row)
    next.originals.push({ id, value: null })
    next.yearInputs.push({ id, raw: String(taxYear) })
    write(next)
  }
  const savedHash = canonicalDecisionEditorValue(saved)
  const editorHash = editor ? canonicalDecisionEditorValue(editor.decisions) : ''
  useEffect(() => {
    if (!editor || parentRevision <= recovery.parentRevision || savedHash !== editorHash) return
    recovery.close()
  }, [editorHash, parentRevision, recovery.parentRevision, savedHash])

  const conflicts = useMemo(() => {
    if (!editor) return [] as Array<{
      id: string
      original: DecisionRecord | null
      current: DecisionRecord | null
      editing: DecisionRecord | null
    }>
    return editor.originals.flatMap((origin) => {
      const current = saved.find((row) => row.id === origin.id) ?? null
      if (canonicalDecisionEditorValue(origin.value) === canonicalDecisionEditorValue(current)) return []
      return [{
        id: origin.id,
        original: origin.value,
        current,
        editing: editor.decisions.find((row) => row.id === origin.id) ?? null,
      }]
    })
  }, [editor, saved])
  const conflictIds = new Set(conflicts.map((row) => row.id))

  function rebase() {
    if (!editor) return
    const next = structuredClone(editor)
    next.originals = next.originals.map((origin) => ({
      id: origin.id,
      value: structuredClone(saved.find((row) => row.id === origin.id) ?? null),
    }))
    recovery.rebase(next, parentRevision)
    onChange(structuredClone(next.decisions))
    setMessage('現在の保存内容を新しい比較元にしました。この操作だけではworkspaceへ保存しません。')
  }
  function restore(raw: string, imported = false) {
    try {
      const copy = restoreEditorCopy(raw, recoveryDataset, RECOVERY_EDITOR, validDecisionEditorValue)
      if (recovery.restore(raw, imported)) {
        onChange(structuredClone(copy.value.decisions))
        setMessage('判断案を復旧しました。まだworkspaceへ保存・送信・本人確認していません。')
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '判断案を復旧できませんでした。')
    }
  }

  return (
    <section className="cost-editor" aria-label="処理の判断記録">
      <h4>扱いを判断した記録</h4>
      {message && <p role="status">{message}</p>}
      {recoveryEnabled && recovery.warning && <p role="alert">{recovery.warning}</p>}
      {recoveryEnabled && recovery.unreadable > 0 && (
        <p role="alert">
          読めない判断案の控えが{recovery.unreadable}件あります。自動削除していません。
        </p>
      )}
      {recoveryEnabled && !editor && recovery.copies.length > 0 && (
        <section aria-label="未送信の判断案">
          <h5>未送信の判断案を再開</h5>
          <p>
            同じデータセットの控えだけを表示します。復旧だけではHTTP送信・workspace保存・本人確認を行いません。
          </p>
          {recovery.copies.map(({ copy, raw }) => (
            <p key={copy.id}>
              編集対象{copy.value.originals.length}件 / 保存元{copy.parentRevision}版 / {copy.updatedAt}{' '}
              <button type="button" onClick={() => restore(raw)}>この内容を復旧</button>
            </p>
          ))}
        </section>
      )}
      {recoveryEnabled && !editor && (
        <label>
          個人用の判断案控えを復旧
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.currentTarget.value = ''
              if (!file) return
              if (file.size > EDITOR_FILE_LIMIT) {
                setMessage('判断案の控えが大きすぎます。元ファイルは保持してください。')
                return
              }
              void file.text().then((raw) => restore(raw, true))
                .catch(() => setMessage('判断案の控えを読み取れません。'))
            }}
          />
        </label>
      )}
      {conflicts.length > 0 && (
        <section className="panel" aria-label="判断案の競合">
          <p role="alert">
            入力開始後に同じ判断の保存内容が変わっています。現在の保存と編集中の判断案を両方保持し、勝手に上書きしません。
          </p>
          <details>
            <summary>競合した判断を比較</summary>
            <pre>{JSON.stringify(conflicts, null, 2)}</pre>
          </details>
          <button type="button" onClick={rebase}>
            現在の保存を比較元にして、この判断案を続ける
          </button>
        </section>
      )}
      {consultation && (
        <div>
          <p>
            回答の対象：
            {units.find((unit) => unit.id === consultation.taxUnitId)?.name ?? '制作物未確認'} /{' '}
            {consultation.answer.taxYear}
            年。既存の判断を見直すか、この対象に未確認の判断を追加できます。
          </p>
          <button
            type="button"
            disabled={
              !units.some((unit) => unit.id === consultation.taxUnitId) ||
              !Number.isInteger(consultation.answer.taxYear) ||
              consultation.answer.taxYear < 2000 ||
              consultation.answer.taxYear > 2100
            }
            onClick={() => addDecision(consultation.taxUnitId, consultation.answer.taxYear)}
          >
            この回答の対象に判断記録を追加
          </button>
        </div>
      )}
      <p>
        検討した扱い、確認した扱い、根拠・確認先を残します。本人による確認の記録であり、DevTaxが適用条件を自動検証した結果ではありません。内容を変えると未確認へ戻ります。
      </p>
      <button type="button" className="secondary-button" onClick={() => addDecision('', year)}>
        判断記録を追加
      </button>
      <datalist id={CANDIDATE_OPTIONS}>
        {Object.entries(treatmentCandidateLabels)
          .filter(([value]) => value !== 'unclassified')
          .map(([value, name]) => (
            <option key={value} value={value} label={name} />
          ))}
      </datalist>
      {rows.map((row, index) => {
        if (row.softwareAnnualBinding) return (
          <article className="cost-source panel" key={row.id}
            data-consultation-decision={row.taxUnitId + ':' + row.taxYear}>
            <h5>ソフトウェア年額の本人確認</h5>
            <p>
              {row.taxYear}年 / {row.reason}
            </p>
            <p>
              方法画面で確認して保存した判断です。ここでは内部候補名や確認元を手入力で変更せず、
              方法・取得価額・根拠・供用・対象年が変わる場合は方法画面で再確認します。
            </p>
          </article>
        )
        const rawYear = editor?.yearInputs.find((item) => item.id === row.id)?.raw ??
          volatileYears.find((item) => item.id === row.id)?.raw ??
          (Number.isFinite(row.taxYear) ? String(row.taxYear) : '')
        const parsedYear = /^\d{4}$/.test(rawYear) ? Number(rawYear) : null
        const ready = Boolean(
          row.taxUnitId &&
          units.some((unit) => unit.id === row.taxUnitId) &&
          row.candidate.trim() &&
          row.selectedCandidate?.trim() &&
          row.reason?.trim() &&
          parsedYear !== null &&
          parsedYear === row.taxYear &&
          parsedYear >= 2000 &&
          parsedYear <= 2100,
        )
        return (
          <article
            className="cost-source panel"
            key={row.id}
            data-consultation-decision={row.taxUnitId + ':' + row.taxYear}
          >
            <div className="cost-toolbar">
              <label>
                判断する制作物{' '}
                <select value={row.taxUnitId} onChange={(e) => edit(index, { taxUnitId: e.target.value })}>
                  <option value="">選択してください</option>
                  {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                </select>
              </label>
              <label>
                判断の対象年{' '}
                <input inputMode="numeric" value={rawYear} onChange={(e) => editYear(index, e.target.value)} />
              </label>
              <label>
                検討した扱い{' '}
                <input
                  list={CANDIDATE_OPTIONS}
                  value={row.candidate}
                  onChange={(e) => edit(index, { candidate: e.target.value })}
                />
                {candidateName(row.candidate) && <small>＝{candidateName(row.candidate)}</small>}
              </label>
              <label>
                確認した扱い{' '}
                <input
                  list={CANDIDATE_OPTIONS}
                  value={row.selectedCandidate ?? ''}
                  onChange={(e) => edit(index, { selectedCandidate: e.target.value || undefined })}
                />
                {candidateName(row.selectedCandidate) && (
                  <small>＝{candidateName(row.selectedCandidate)}</small>
                )}
              </label>
              <label>
                判断の根拠・確認先{' '}
                <textarea
                  value={row.reason ?? ''}
                  onChange={(e) => edit(index, { reason: e.target.value || undefined })}
                />
              </label>
            </div>
            <p>
              {decisionIsConfirmed(row)
                ? '本人確認済み'
                : '未確認：必要な項目を記入して確認してください。'}
            </p>
            <button
              type="button"
              className="secondary-button"
              disabled={!ready || decisionIsConfirmed(row) || conflictIds.has(row.id)}
              onClick={() => {
                const next = baseValue()
                const item = next.decisions[index]
                if (!item) return
                markOriginal(next, item.id)
                next.decisions[index] = {
                  ...item,
                  engineVersion: MANUAL_DECISION_VERSION,
                  status: item.candidate === item.selectedCandidate ? 'confirmed' : 'overridden',
                  confirmedAt: new Date().toISOString(),
                }
                write(next)
              }}
            >
              この判断内容を確認した
            </button>
            <button
              type="button"
              disabled={!decisionIsConfirmed(row) || conflictIds.has(row.id)}
              onClick={() => edit(index, {})}
            >
              判断を未確認に戻す
            </button>
            <p>
              この記録は「ここまで保存」または最終保存で料金・計画と一緒に保存します。残高の採用版とは別の記録です。
            </p>
          </article>
        )
      })}
      {recoveryEnabled && editor && (
        <p>
          <button type="button" onClick={recovery.exportCopy}>
            個人用の判断案控えをファイルへ保存
          </button>{' '}
          <button
            type="button"
            onClick={() => {
              if (!window.confirm('未送信の判断案だけを破棄し、現在の保存済み判断へ戻します。')) return
              if (recovery.close()) onChange(structuredClone(saved))
            }}
          >
            この判断案を破棄
          </button>
        </p>
      )}
    </section>
  )
}
