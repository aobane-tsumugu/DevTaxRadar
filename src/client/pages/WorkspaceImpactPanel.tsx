import { useEffect, useRef, useState } from 'react'
import type {
  WorkspaceDraft,
  WorkspaceImpact,
  WorkspacePreviewInput,
} from '../../planning/workspace.js'
import CostsPage from './CostsPage.js'
import { createFocusTrap } from '../focusTrap.js'
import { CLASSIFICATION_LABELS, yen } from './shared.js'
import type { ProjectClassification } from '../../planning/types.js'

export type WorkspaceImpactState = {
  base: WorkspaceDraft
  input: WorkspacePreviewInput
  report: WorkspaceImpact | null
  error?: string
  stale?: boolean
}

export default function WorkspaceImpactPanel({
  impact,
  onSave,
  onRefresh,
  onCancel,
}: {
  impact: WorkspaceImpactState
  onSave: () => Promise<void>
  onRefresh: () => void
  onCancel: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLElement>(null),
    close = useRef(onCancel)
  close.current = busy ? () => {} : onCancel
  useEffect(
    () => (ref.current ? createFocusTrap(ref.current, () => close.current()) : undefined),
    [],
  )
  async function save() {
    if (busy || !impact.report || impact.stale) return
    setBusy(true)
    setError(null)
    try {
      await onSave()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存結果を確認できませんでした。')
    } finally {
      setBusy(false)
    }
  }
  const report = impact.report
  const name = (id: string | null, side: 'before' | 'after') =>
    id
      ? ((side === 'before' ? impact.base.planning : impact.input.planning).taxUnits.find(
          (unit) => unit.id === id,
        )?.name ?? id)
      : '制作物の指定なし'
  return (
    <div className="modal-backdrop">
      <section
        className="workspace-comparison workspace-impact"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-impact-title"
        ref={ref}
      >
        <h2 id="workspace-impact-title">保存前に変更の影響を確認</h2>
        <p>
          この表示では保存していません。保存済みの内容と、この画面の入力を同じ利用記録で比較しています。
        </p>
        {impact.error && <p role="alert">{impact.error}</p>}
        {!report && !impact.error && <p role="status">各年の費用と配分を確認しています。</p>}
        {report && (
          <>
            <p>
              {report.scope.fromYear}〜{report.scope.toYear}年 / 変更する記録{' '}
              {report.records.length}件 / 分類・対応先・適用ルールが変わる取得済み利用記録{' '}
              {report.assignmentChanges.reduce((sum, row) => sum + row.count, 0)}件
            </p>
            <p>{report.scope.description}</p>
            <ul>
              {report.limitations.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
            <h3>各年の算定済み費用基礎</h3>
            <div className="impact-table">
              <table>
                <thead>
                  <tr>
                    <th>年</th>
                    <th>保存前</th>
                    <th>入力後</th>
                    <th>算定済み分の差</th>
                    <th>未算定の基礎</th>
                  </tr>
                </thead>
                <tbody>
                  {report.years.map((row) => (
                    <tr key={row.year}>
                      <th>
                        {row.year}年{row.changed ? '（変更あり）' : ''}
                      </th>
                      <td>{yen.format(row.before.totals.knownBasisJpy)}</td>
                      <td>{yen.format(row.after.totals.knownBasisJpy)}</td>
                      <td>
                        {yen.format(
                          row.after.totals.knownBasisJpy - row.before.totals.knownBasisJpy,
                        )}
                      </td>
                      <td>
                        {row.before.totals.unknownBasisIds.length}件 →{' '}
                        {row.after.totals.unknownBasisIds.length}件
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {report.years.map((row) => (
              <details key={row.year}>
                <summary>{row.year}年の制作物別配分・原額・未算定理由・分類候補を確認</summary>
                <h3>AI利用の分類による候補</h3>
                <p>全費用の税務処理額とは区別してください。</p>
                <div className="impact-table">
                  <table>
                    <thead>
                      <tr>
                        <th>分類候補</th>
                        <th>保存前</th>
                        <th>入力後</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        [
                          ['current', '当年処理候補'],
                          ['future', '将来分候補'],
                          ['review', '要確認・対象外'],
                        ] as const
                      ).map(([key, label]) => (
                        <tr key={key}>
                          <th>{label}</th>
                          <td>{yen.format(row.aiBefore[key])}</td>
                          <td>{yen.format(row.aiAfter[key])}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="impact-columns">
                  <article>
                    <h3>保存前</h3>
                    <CostsPage initial={row.before} local={false} readOnly onEdit={() => {}} />
                  </article>
                  <article>
                    <h3>入力後</h3>
                    <CostsPage initial={row.after} local={false} readOnly onEdit={() => {}} />
                  </article>
                </div>
              </details>
            ))}
            <h3>分類・制作物・適用ルールが変わる利用記録</h3>
            {report.assignmentChanges.length ? (
              <div className="impact-table">
                <table>
                  <thead>
                    <tr>
                      <th>月・AIサービス</th>
                      <th>件数</th>
                      <th>保存前</th>
                      <th>入力後</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.assignmentChanges.map((row, index) => (
                      <tr key={index}>
                        <th>
                          {row.month} / {row.provider === 'claude' ? 'Claude Code' : 'Codex'}
                        </th>
                        <td>{row.count}</td>
                        <td>
                          {CLASSIFICATION_LABELS[
                            row.before.classification as ProjectClassification
                          ] ?? row.before.classification}{' '}
                          / {name(row.before.taxUnitId, 'before')}
                          <p>適用ルール：{row.before.ruleId ?? '指定なし'}</p>
                        </td>
                        <td>
                          {CLASSIFICATION_LABELS[
                            row.after.classification as ProjectClassification
                          ] ?? row.after.classification}{' '}
                          / {name(row.after.taxUnitId, 'after')}
                          <p>適用ルール：{row.after.ruleId ?? '指定なし'}</p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>取得済みの利用記録では分類・対応先・適用ルールの変更はありません。</p>
            )}
            <h3>変更する入力記録</h3>
            <ul>
              {report.records.map((row) => (
                <li key={row.key}>
                  {row.label}：
                  {row.operation === 'added'
                    ? '追加'
                    : row.operation === 'removed'
                      ? '削除'
                      : '変更'}
                </li>
              ))}
            </ul>
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="comparison-actions">
          <button className="secondary-button" disabled={busy} onClick={onCancel}>
            保存せずに戻る
          </button>
          <button className="secondary-button" disabled={busy} onClick={onRefresh}>
            影響をもう一度確認
          </button>
          <button
            className="primary-button"
            disabled={busy || !report || impact.stale}
            onClick={() => void save()}
          >
            {busy ? '保存を確認中…' : '確認した内容を保存'}
          </button>
        </div>
      </section>
    </div>
  )
}
