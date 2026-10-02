import type { DatabaseSync } from 'node:sqlite'
import { readWorkspace } from './workspaceRepository.js'
import { readDashboardObservation, projectWorkspaceYears } from './dashboard.js'
import { getBalanceDraft } from './balanceRepository.js'
import { projectProductTimeline } from '../core/productTimeline.js'
import { buildAnnualBalances } from '../core/annualBalances.js'
import { datasetIdentity } from './datasetIdentity.js'
import { yearsIn } from './workspaceImpact.js'

export function readProductTimeline(db: DatabaseSync) {
  return readWorkspace((workspace) => {
    const observation = readDashboardObservation(db)
    const balances = getBalanceDraft(db).snapshot
    const years = new Set<number>([workspace.planning.profile.taxYear])
    yearsIn(workspace, years)
    yearsIn(balances, years)
    for (const account of balances.accounts) years.add(account.openingYear)
    for (const row of observation.sessions) yearsIn({ month: row.month }, years)
    const first = Math.min(...years),
      last = Math.max(...years)
    if (first < 1900 || last > 9999 || last - first >= 200)
      throw new Error('活動タイムラインの対象期間は連続200年未満です。日付を確認してください。')
    const range = Array.from({ length: last - first + 1 }, (_, index) => first + index)
    const costs = projectWorkspaceYears(workspace, observation, range).projections
    return {
      datasetId: datasetIdentity(db),
      workspaceRevision: workspace.revision,
      products: projectProductTimeline(workspace.planning, costs, balances),
      balances: range.map((year) => buildAnnualBalances(balances, year)),
      years: range,
      evidence: workspace.planning.evidence.map(({ localReference: _private, ...row }) => row),
    }
  }, db)
}
export type ProductTimelineView = ReturnType<typeof readProductTimeline>
