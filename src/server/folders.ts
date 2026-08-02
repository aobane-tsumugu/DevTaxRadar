import { localDateFromTimestamp, resolvedTimeZone } from '../adapters/localTime.ts'
import type { UsageProvider } from '../adapters/types.ts'
import type { PlanningSnapshot, ProjectClassification } from '../planning/types.js'
import { safeLocalLabel } from './dashboard.js'
import { getUsageSessions, type UsageSessionRow } from './database.js'
import { resolveSessionAssignment } from './sessionAssignment.js'
import { getPlanningSnapshot } from './planningRepository.js'

export type FolderAssignment = {
  ruleId: string
  taxUnitId?: string
  taxUnitName?: string
  classification: ProjectClassification
  effectiveFrom: string
  effectiveTo?: string
  provider?: UsageProvider
  sessionCount: number
}

export type FolderSummary = {
  projectKey: string
  label: string
  sessionCount: number
  messageCount: number
  firstUsedOn: string
  lastUsedOn: string
  providers: UsageProvider[]
  assignments: FolderAssignment[]
  unassignedSessionCount: number
}

const providerOrder: Record<UsageProvider, number> = { claude: 0, codex: 1 }

function displayLabel(row: UsageSessionRow): string {
  return safeLocalLabel(row.projectLabel, `Project ${row.projectKey.slice(-6)}`)
}

/**
 * Builds the assignment screen's folder list. Rules are reported with how many
 * sessions each currently covers, so the user can see the effect of a period
 * split before changing it.
 */
export function summarizeFolders(
  sessions: UsageSessionRow[],
  planning: PlanningSnapshot,
  timeZone: string = resolvedTimeZone(),
): FolderSummary[] {
  const unitNameById = new Map(planning.taxUnits.map((unit) => [unit.id, unit.name]))
  const byProject = new Map<string, FolderSummary>()
  const ruleUsage = new Map<string, number>()

  for (const session of sessions) {
    const assignment = resolveSessionAssignment(session, planning.projectRules, timeZone)
    if (assignment.ruleId) {
      ruleUsage.set(assignment.ruleId, (ruleUsage.get(assignment.ruleId) ?? 0) + 1)
    }

    const day =
      localDateFromTimestamp(session.startedAt, timeZone) ?? session.startedAt.slice(0, 10)
    const current = byProject.get(session.projectKey)
    if (!current) {
      byProject.set(session.projectKey, {
        projectKey: session.projectKey,
        label: displayLabel(session),
        sessionCount: 1,
        messageCount: session.messageCount,
        firstUsedOn: day,
        lastUsedOn: day,
        providers: [session.provider],
        assignments: [],
        // A session only counts as handled once it has a real classification.
        // A rule can exist (non-null ruleId) yet still leave classification at
        // its default 'unclassified' -- that folder must keep counting as
        // outstanding, or this figure disagrees with dashboard classifiedRate.
        unassignedSessionCount: assignment.classification === 'unclassified' ? 1 : 0,
      })
      continue
    }

    current.sessionCount += 1
    current.messageCount += session.messageCount
    if (day < current.firstUsedOn) current.firstUsedOn = day
    if (day > current.lastUsedOn) current.lastUsedOn = day
    if (!current.providers.includes(session.provider)) current.providers.push(session.provider)
    if (assignment.classification === 'unclassified') current.unassignedSessionCount += 1
    if (session.projectLabel && current.label.startsWith('Project ')) {
      current.label = safeLocalLabel(session.projectLabel, current.label)
    }
  }

  for (const folder of byProject.values()) {
    folder.providers.sort((left, right) => providerOrder[left] - providerOrder[right])
    folder.assignments = planning.projectRules
      .filter((rule) => rule.projectKey === folder.projectKey)
      .map((rule) => ({
        ruleId: rule.id,
        taxUnitId: rule.taxUnitId,
        taxUnitName: rule.taxUnitId ? unitNameById.get(rule.taxUnitId) : undefined,
        classification: rule.classification,
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        provider: rule.provider,
        sessionCount: ruleUsage.get(rule.id) ?? 0,
      }))
      .sort((left, right) => {
        if (left.effectiveFrom !== right.effectiveFrom) {
          return left.effectiveFrom < right.effectiveFrom ? -1 : 1
        }
        return left.ruleId < right.ruleId ? -1 : 1
      })
  }

  return [...byProject.values()].sort((left, right) => {
    if (left.sessionCount !== right.sessionCount) return right.sessionCount - left.sessionCount
    return left.projectKey < right.projectKey ? -1 : 1
  })
}

export function buildFolderSummaries(): FolderSummary[] {
  return summarizeFolders(getUsageSessions(), getPlanningSnapshot())
}
