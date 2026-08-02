import { useMemo, useState } from 'react'
import type {
  FolderAssignment,
  FolderSummary,
  ProviderKey,
  SessionDetail,
  SessionSummary,
} from '../types'
import type {
  PlanningSnapshot,
  ProjectClassification,
  ProjectRuleRecord,
} from '../../planning/types'
import { getSessionDetail, getSessions } from '../api'
import { CLASSIFICATION_LABELS, PanelHeading, ruleId } from './shared'

type SortKey = 'usage' | 'recent' | 'name'

const PROVIDER_LABELS: Record<ProviderKey, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
}

// The "まとめて設定..." placeholder option already uses the empty string, so
// "指定しない" (no product) needs a distinct sentinel value.
const NO_TAX_UNIT = '__none__'

function shiftDay(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + days))
  return shifted.toISOString().slice(0, 10)
}
const nextDay = (date: string) => shiftDay(date, 1)
const previousDay = (date: string) => shiftDay(date, -1)

export default function FolderAssignmentPage({
  folders,
  planning,
  busy,
  error,
  onSaveRules,
}: {
  folders: FolderSummary[]
  planning: PlanningSnapshot
  busy: boolean
  error: string | null
  onSaveRules: (rules: ProjectRuleRecord[]) => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [unassignedOnly, setUnassignedOnly] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('usage')
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const selectedKeys = Object.keys(selected).filter((key) => selected[key])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Record<string, SessionSummary[]>>({})
  const [details, setDetails] = useState<Record<string, SessionDetail>>({})

  async function toggleFolder(projectKey: string) {
    if (expanded === projectKey) {
      setExpanded(null)
      return
    }
    setExpanded(projectKey)
    if (!sessions[projectKey]) {
      const result = await getSessions(projectKey)
      setSessions((current) => ({ ...current, [projectKey]: result.sessions }))
    }
  }

  async function loadDetail(provider: ProviderKey, sessionKey: string) {
    const key = `${provider}:${sessionKey}`
    if (details[key]) return
    const detail = await getSessionDetail(provider, sessionKey)
    setDetails((current) => ({ ...current, [key]: detail }))
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = folders.filter((folder) => {
      if (unassignedOnly && folder.unassignedSessionCount === 0) return false
      if (!needle) return true
      return folder.label.toLowerCase().includes(needle)
    })
    return [...filtered].sort((left, right) => {
      if (sortKey === 'name') return left.label.localeCompare(right.label, 'ja')
      if (sortKey === 'recent') return left.lastUsedOn < right.lastUsedOn ? 1 : -1
      return right.sessionCount - left.sessionCount
    })
  }, [folders, query, sortKey, unassignedOnly])

  const unassignedFolders = folders.filter((folder) => folder.unassignedSessionCount > 0).length

  async function assignRule(
    folder: FolderSummary,
    target: FolderAssignment | undefined,
    patch: { taxUnitId?: string; classification?: ProjectClassification; effectiveFrom?: string },
  ) {
    const effectiveFrom = patch.effectiveFrom ?? target?.effectiveFrom ?? folder.firstUsedOn
    const next: ProjectRuleRecord = {
      id: target?.ruleId ?? ruleId(folder.projectKey, effectiveFrom),
      projectKey: folder.projectKey,
      effectiveFrom,
      effectiveTo: target?.effectiveTo,
      provider: target?.provider,
      taxUnitId:
        patch.taxUnitId === NO_TAX_UNIT ? undefined : (patch.taxUnitId ?? target?.taxUnitId),
      classification: patch.classification ?? target?.classification ?? 'unclassified',
      reason: '割当画面で登録',
    }
    const others = planning.projectRules.filter((rule) => rule.id !== next.id)
    await onSaveRules([...others, next])
  }

  async function assignSelected(patch: {
    taxUnitId?: string
    classification?: ProjectClassification
  }) {
    const targets = folders.filter((folder) => selected[folder.projectKey])
    if (targets.length === 0) return

    const nextById = new Map(planning.projectRules.map((rule) => [rule.id, rule]))
    for (const folder of targets) {
      const existing = folder.assignments[0]
      const effectiveFrom = existing?.effectiveFrom ?? folder.firstUsedOn
      const id = existing?.ruleId ?? ruleId(folder.projectKey, effectiveFrom)
      nextById.set(id, {
        id,
        projectKey: folder.projectKey,
        effectiveFrom,
        effectiveTo: existing?.effectiveTo,
        provider: existing?.provider,
        taxUnitId:
          patch.taxUnitId === NO_TAX_UNIT ? undefined : (patch.taxUnitId ?? existing?.taxUnitId),
        classification: patch.classification ?? existing?.classification ?? 'unclassified',
        reason: '割当画面で一括登録',
      })
    }

    await onSaveRules([...nextById.values()])
    setSelected({})
  }

  async function deletePeriod(assignment: FolderAssignment) {
    await onSaveRules(planning.projectRules.filter((rule) => rule.id !== assignment.ruleId))
  }

  async function splitPeriod(folder: FolderSummary) {
    const last = folder.assignments.at(-1)
    const from = last?.effectiveTo
      ? nextDay(last.effectiveTo)
      : new Date().toISOString().slice(0, 10)
    const id = ruleId(folder.projectKey, from)
    if (planning.projectRules.some((rule) => rule.id === id)) return

    const updated = planning.projectRules.map((rule) =>
      rule.id === last?.ruleId && !rule.effectiveTo
        ? { ...rule, effectiveTo: previousDay(from) }
        : rule,
    )
    await onSaveRules([
      ...updated,
      {
        id,
        projectKey: folder.projectKey,
        effectiveFrom: from,
        taxUnitId: last?.taxUnitId,
        classification: 'unclassified',
        reason: '割当画面で期間を分割',
      },
    ])
  }

  return (
    <>
      {error && (
        <div className="setup-notice error" role="alert" aria-live="polite">
          <span>!</span>
          {error}
        </div>
      )}
      <section className="assignment-toolbar" aria-label="フォルダの絞り込み">
        <div className="assignment-counts">
          <strong>
            未割当 {unassignedFolders} / {folders.length}件
          </strong>
          {unassignedFolders > 0 && (
            <span className="assignment-warning">
              未割当のフォルダは配賦額が「対象外・要確認」に残ります
            </span>
          )}
        </div>
        <label>
          <span>フォルダを探す</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="フォルダ名の一部"
          />
        </label>
        <label className="assignment-toggle">
          <input
            type="checkbox"
            checked={unassignedOnly}
            onChange={(event) => setUnassignedOnly(event.target.checked)}
          />
          <span>未割当のみ表示</span>
        </label>
        <label>
          <span>並び順</span>
          <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
            <option value="usage">利用量が多い順</option>
            <option value="recent">最近使った順</option>
            <option value="name">名前順</option>
          </select>
        </label>
      </section>

      <section className="panel assignment-panel">
        <PanelHeading
          title="フォルダの割当"
          subtitle={`${visible.length}件を表示 · AI履歴の作業フォルダを制作物と作業内容へ結び付けます`}
        />
        {visible.length === 0 ? (
          <p className="assignment-empty">
            {folders.length === 0
              ? 'まだ履歴を取り込んでいません。「設定を確認」からAI履歴を走査してください。'
              : '条件に一致するフォルダがありません。'}
          </p>
        ) : (
          <ul className="assignment-list">
            {visible.map((folder) => (
              <li key={folder.projectKey}>
                <input
                  type="checkbox"
                  checked={Boolean(selected[folder.projectKey])}
                  disabled={busy}
                  onChange={(event) =>
                    setSelected((current) => ({
                      ...current,
                      [folder.projectKey]: event.target.checked,
                    }))
                  }
                  aria-label={`${folder.label}を選択`}
                />
                <div className="assignment-folder">
                  <strong>{folder.label}</strong>
                  <small>
                    {folder.sessionCount}セッション · {folder.firstUsedOn}〜{folder.lastUsedOn} ·{' '}
                    {folder.providers.map((provider) => PROVIDER_LABELS[provider]).join('・')}
                  </small>
                </div>
                {folder.assignments.length <= 1 && (
                  <div className="assignment-fields">
                    <label>
                      <span>制作物</span>
                      <select
                        value={folder.assignments[0]?.taxUnitId ?? NO_TAX_UNIT}
                        disabled={busy}
                        onChange={(event) =>
                          assignRule(folder, folder.assignments[0], {
                            taxUnitId: event.target.value,
                          })
                        }
                      >
                        <option value={NO_TAX_UNIT}>指定しない</option>
                        {planning.taxUnits.map((unit) => (
                          <option key={unit.id} value={unit.id}>
                            {unit.name || '名前未入力'}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>この期間にしたこと</span>
                      <select
                        value={folder.assignments[0]?.classification ?? 'unclassified'}
                        disabled={busy}
                        onChange={(event) =>
                          assignRule(folder, folder.assignments[0], {
                            classification: event.target.value as ProjectClassification,
                          })
                        }
                      >
                        {Object.entries(CLASSIFICATION_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
                <div className="assignment-row-actions">
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy || folder.assignments.length === 0}
                    title={
                      folder.assignments.length === 0
                        ? '先に制作物か作業内容を割り当ててください'
                        : undefined
                    }
                    onClick={() => splitPeriod(folder)}
                  >
                    期間を分ける
                  </button>
                  {folder.unassignedSessionCount > 0 && (
                    <span className="assignment-status warning">
                      未割当 {folder.unassignedSessionCount}件
                    </span>
                  )}
                </div>
                {folder.assignments.length > 1 ? (
                  <ul className="assignment-periods">
                    {folder.assignments.map((assignment) => (
                      <li key={assignment.ruleId}>
                        <span className="period-range">
                          {assignment.effectiveFrom}〜{assignment.effectiveTo ?? '（継続中）'}
                        </span>
                        <label>
                          <span>制作物</span>
                          <select
                            value={assignment.taxUnitId ?? NO_TAX_UNIT}
                            disabled={busy}
                            onChange={(event) =>
                              assignRule(folder, assignment, { taxUnitId: event.target.value })
                            }
                          >
                            <option value={NO_TAX_UNIT}>指定しない</option>
                            {planning.taxUnits.map((unit) => (
                              <option key={unit.id} value={unit.id}>
                                {unit.name || '名前未入力'}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>この期間にしたこと</span>
                          <select
                            value={assignment.classification}
                            disabled={busy}
                            onChange={(event) =>
                              assignRule(folder, assignment, {
                                classification: event.target.value as ProjectClassification,
                              })
                            }
                          >
                            {Object.entries(CLASSIFICATION_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <small>{assignment.sessionCount}セッション</small>
                        <button
                          type="button"
                          className="text-button"
                          disabled={busy}
                          onClick={() => deletePeriod(assignment)}
                        >
                          この期間を削除
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <button
                  className="text-button assignment-expand"
                  onClick={() => toggleFolder(folder.projectKey)}
                  aria-expanded={expanded === folder.projectKey}
                >
                  {expanded === folder.projectKey ? 'セッションを閉じる' : 'セッションを見る'}
                </button>
                {expanded === folder.projectKey && (
                  <div className="assignment-sessions">
                    {(sessions[folder.projectKey] ?? []).map((session) => {
                      const key = `${session.provider}:${session.sessionKey}`
                      const detail = details[key]
                      return (
                        <article key={key}>
                          <div className="session-head">
                            <strong>{session.startedAt.slice(0, 10)}</strong>
                            <span>{PROVIDER_LABELS[session.provider]}</span>
                            <span>{session.messageCount}メッセージ</span>
                            <span>{session.model ?? 'モデル不明'}</span>
                            {!detail && (
                              <button
                                className="text-button"
                                onClick={() => loadDetail(session.provider, session.sessionKey)}
                              >
                                内容を確認
                              </button>
                            )}
                          </div>
                          {detail && (
                            <div className="session-detail">
                              {detail.available === false ? (
                                <p className="session-missing">
                                  この履歴の参照情報がありません。再度スキャンすると復元されます。
                                </p>
                              ) : detail.transcriptExists === false ? (
                                <p className="session-missing">
                                  元の履歴は削除済みです。集計値だけが残っています。
                                </p>
                              ) : (
                                <p className="session-preview">
                                  {detail.preview ?? '内容を取得できませんでした。'}
                                </p>
                              )}
                              {detail.resume && (
                                <div className="session-resume">
                                  <code>{detail.resume.command}</code>
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      navigator.clipboard?.writeText(detail.resume!.command)
                                    }
                                  >
                                    コピー
                                  </button>
                                  {detail.resume.changeDirectoryOmittedReason === 'not-found' && (
                                    <small>作業フォルダが見つかりません</small>
                                  )}
                                  {detail.resume.changeDirectoryOmittedReason ===
                                    'unquotable-path' && (
                                    <small>
                                      作業フォルダのパスに引用符が含まれるため、移動コマンドを省いています
                                    </small>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </article>
                      )
                    })}
                    {(sessions[folder.projectKey] ?? []).length === 0 && (
                      <p className="assignment-empty">セッションを読み込んでいます…</p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {selectedKeys.length > 0 && (
        <div className="assignment-bulk" role="status">
          <strong>{selectedKeys.length}件を選択中</strong>
          <label>
            <span>制作物</span>
            <select
              value=""
              disabled={busy}
              onChange={(event) => assignSelected({ taxUnitId: event.target.value })}
            >
              <option value="">まとめて設定...</option>
              <option value={NO_TAX_UNIT}>指定しない</option>
              {planning.taxUnits.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name || '名前未入力'}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>作業内容</span>
            <select
              value=""
              disabled={busy}
              onChange={(event) =>
                assignSelected({ classification: event.target.value as ProjectClassification })
              }
            >
              <option value="">まとめて設定...</option>
              {Object.entries(CLASSIFICATION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button className="text-button" disabled={busy} onClick={() => setSelected({})}>
            選択を解除
          </button>
        </div>
      )}
    </>
  )
}
