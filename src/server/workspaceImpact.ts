import { createHash } from 'node:crypto'
import { getDatabase } from './database.js'
import { readWorkspace, workspaceSaveSchema, WorkspaceConflict } from './workspaceRepository.js'
import { projectWorkspaceYears, readDashboardObservation } from './dashboard.js'
import { resolveSessionAssignment } from './sessionAssignment.js'
import { resolvedTimeZone } from '../adapters/localTime.js'
import { mergeWorkspaceDrafts } from '../core/workspaceMerge.js'
import type { WorkspaceImpact } from '../planning/workspace.js'

export const workspacePreviewSchema = workspaceSaveSchema.omit({
  requestId: true,
  previewHash: true,
})

export class WorkspacePreviewChanged extends Error {
  constructor() {
    super('確認した内容または利用記録が変わっています。変更の影響をもう一度確認してください。')
  }
}
export class WorkspacePreviewRangeError extends Error {}

function yearsIn(input: unknown, years: Set<number>): void {
  if (!input || typeof input !== 'object') return
  if (Array.isArray(input)) {
    for (const item of input) yearsIn(item, years)
    return
  }
  for (const [key, value] of Object.entries(input)) {
    if (key === 'taxYear' && typeof value === 'number') years.add(value)
    else if (
      /^(month|startedOn|endedOn|serviceStartedOn|serviceEndedOn|billedOn|activityStartedOn|effectiveFrom|effectiveTo|occurredOn|orderedOn|deliveredOn|acquiredOn|businessUseStartedOn|incurredOn)$/.test(
        key,
      ) &&
      typeof value === 'string' &&
      /^\d{4}-/.test(value)
    )
      years.add(Number(value.slice(0, 4)))
    else if (value && typeof value === 'object') yearsIn(value, years)
  }
}

/** Read-only preview. Calculations use captured observations and never stage writes in SQLite. */
export function previewWorkspace(input: unknown): WorkspaceImpact {
  const db = getDatabase()
  const parsed = workspacePreviewSchema.parse(input)
  const proposed = {
    planning: parsed.planning,
    configuration: { ...parsed.configuration, chargePeriods: parsed.configuration.chargePeriods! },
  }
  return readWorkspace((base) => {
    if (base.revision !== parsed.expectedRevision) throw new WorkspaceConflict(base.revision)
    const observation = readDashboardObservation()
    const dates = new Set<number>()
    yearsIn(base, dates)
    yearsIn(parsed, dates)
    for (const row of observation.sessions) yearsIn({ month: row.month }, dates)
    const fromYear = Math.min(...dates),
      toYear = Math.max(...dates)
    if (fromYear < 1900 || toYear > 9999 || toYear - fromYear >= 200)
      throw new WorkspacePreviewRangeError(
        '確認対象の年・日付を確認してください。この版の影響確認は1900〜9999年内、連続200年までです。期間を省略して表示してはいません。',
      )
    const years = Array.from({ length: toYear - fromYear + 1 }, (_, index) => fromYear + index)
    const before = projectWorkspaceYears(base, observation, years)
    const after = projectWorkspaceYears(proposed, observation, years)
    const aiTotals = (months: typeof before.dashboard.months, year: number) =>
      months
        .filter((month) => month.label.startsWith(`${year}年`))
        .reduce(
          (sum, month) => ({
            current: sum.current + month.current,
            future: sum.future + month.future,
            review: sum.review + month.review,
          }),
          { current: 0, future: 0, review: 0 },
        )
    const groups = new Map<string, WorkspaceImpact['assignmentChanges'][number]>()
    for (const session of observation.sessions) {
      const old = resolveSessionAssignment(session, base.planning.projectRules)
      const next = resolveSessionAssignment(session, parsed.planning.projectRules)
      if (JSON.stringify(old) === JSON.stringify(next)) continue
      const key = JSON.stringify([session.provider, session.month, old, next])
      const group = groups.get(key)
      if (group) group.count++
      else
        groups.set(key, {
          provider: session.provider,
          month: session.month,
          count: 1,
          before: old,
          after: next,
        })
    }
    const records = mergeWorkspaceDrafts(base, proposed, base).changes.map((row) => ({
      key: row.key,
      label: row.label,
      operation:
        row.local === undefined
          ? ('removed' as const)
          : row.base === undefined
            ? ('added' as const)
            : ('changed' as const),
    }))
    const previewHash = createHash('sha256')
      .update(
        JSON.stringify({
          engine: 'workspace-impact/1',
          timeZone: resolvedTimeZone(),
          base,
          input: parsed,
          observation,
          calculated: {
            before: before.projections,
            after: after.projections,
            aiBefore: before.dashboard.months,
            aiAfter: after.dashboard.months,
          },
        }),
      )
      .digest('hex')
    return {
      engineVersion: 'workspace-impact/1',
      expectedRevision: base.revision,
      previewHash,
      scope: {
        fromYear,
        toYear,
        description:
          '保存済み・入力中の対象年、登録日付、取得済み利用記録の最古年から最新年まで。間の年も含みます。未登録の将来期間を予測するものではありません。',
      },
      records,
      assignmentChanges: [...groups.values()],
      years: years.map((year, index) => {
        const old = before.projections[index]!,
          next = after.projections[index]!
        const aiBefore = aiTotals(before.dashboard.months, year),
          aiAfter = aiTotals(after.dashboard.months, year)
        return {
          year,
          before: old,
          after: next,
          aiBefore,
          aiAfter,
          changed: JSON.stringify([old, aiBefore]) !== JSON.stringify([next, aiAfter]),
        }
      }),
      limitations: [
        '金額は作業中の費用基礎と配分です。税務上の当年費用・採用済み残高の変化ではありません。',
        '設備の方法・適用条件・前年残高は未接続のため、原額と未算定理由を残しています。未知の額を0円で補っていません。',
        'AIの当年処理候補・将来分候補・要確認は現在の分類による比較です。全費用の税務判断・繰越計算・採用版への後年度影響は未接続です。',
        '変更件数は取得済みの利用記録単位です。捕捉外・未取得の履歴件数を推定していません。',
      ],
    }
  }, db)
}

export function verifyWorkspacePreview(input: {
  expectedRevision: number
  configuration: unknown
  planning: unknown
  previewHash?: string
}): void {
  if (!input.previewHash) return
  const { expectedRevision, configuration, planning } = input
  const fresh = previewWorkspace({ expectedRevision, configuration, planning })
  if (fresh.previewHash !== input.previewHash) throw new WorkspacePreviewChanged()
}
