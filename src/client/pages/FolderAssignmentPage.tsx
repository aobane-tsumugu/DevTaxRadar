import { useMemo, useState } from 'react'
import type { FolderSummary, ProviderKey } from '../types'
import type {
  PlanningSnapshot,
  ProjectClassification,
  ProjectRuleRecord,
} from '../../planning/types'
import { PanelHeading } from './shared'

type SortKey = 'usage' | 'recent' | 'name'

const CLASSIFICATION_LABELS: Record<ProjectClassification, string> = {
  'new-development': '新しく作った',
  maintenance: '保守・バグ修正',
  'feature-addition': '機能を大きく追加した',
  'general-learning': '一般的な学習',
  private: '趣味・私用',
  unclassified: 'あとで確認',
}

const PROVIDER_LABELS: Record<ProviderKey, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
}

function ruleId(projectKey: string, effectiveFrom: string): string {
  return `rule-${projectKey.slice(-12)}-${effectiveFrom}`
}

export default function FolderAssignmentPage({
  folders,
  planning,
  busy,
  onSaveRules,
}: {
  folders: FolderSummary[]
  planning: PlanningSnapshot
  busy: boolean
  onSaveRules: (rules: ProjectRuleRecord[]) => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [unassignedOnly, setUnassignedOnly] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('usage')

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

  async function assign(
    folder: FolderSummary,
    patch: { taxUnitId?: string; classification?: ProjectClassification },
  ) {
    const existing = folder.assignments[0]
    const effectiveFrom = existing?.effectiveFrom ?? folder.firstUsedOn
    const next: ProjectRuleRecord = {
      id: existing?.ruleId ?? ruleId(folder.projectKey, effectiveFrom),
      projectKey: folder.projectKey,
      effectiveFrom,
      effectiveTo: existing?.effectiveTo,
      provider: existing?.provider,
      taxUnitId: patch.taxUnitId ?? existing?.taxUnitId,
      classification: patch.classification ?? existing?.classification ?? 'unclassified',
      reason: '割当画面で登録',
    }
    if (patch.taxUnitId === '') next.taxUnitId = undefined

    const others = planning.projectRules.filter((rule) => rule.id !== next.id)
    await onSaveRules([...others, next])
  }

  return (
    <>
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
                <div className="assignment-folder">
                  <strong>{folder.label}</strong>
                  <small>
                    {folder.sessionCount}セッション · {folder.firstUsedOn}〜{folder.lastUsedOn} ·{' '}
                    {folder.providers.map((provider) => PROVIDER_LABELS[provider]).join('・')}
                  </small>
                </div>
                <div className="assignment-fields">
                  <label>
                    <span>制作物</span>
                    <select
                      value={folder.assignments[0]?.taxUnitId ?? ''}
                      disabled={busy}
                      onChange={(event) => assign(folder, { taxUnitId: event.target.value })}
                    >
                      <option value="">指定しない</option>
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
                        assign(folder, {
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
                {folder.unassignedSessionCount > 0 && (
                  <span className="assignment-status warning">
                    未割当 {folder.unassignedSessionCount}件
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
