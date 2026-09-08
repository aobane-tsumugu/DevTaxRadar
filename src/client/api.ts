import type { BalanceDraft, BalancePreview, BalanceReview } from '../accounting/balanceWorkspace'

export function adoptReview(
  csrfToken: string,
  input: {
    year: number
    expectedDraftRevision: number
    projectionHash: string
    idempotencyKey: string
    expectedDatasetId?: string
    reason: string
  },
): Promise<{ review: BalanceReview }> {
  return requestJson('/api/balances/reviews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-DevTax-CSRF': csrfToken },
    body: JSON.stringify(input),
  })
}
import type { ReviewComparison } from '../core/reviewComparison'

export function getReviewImpact(): Promise<{
  kind: 'current-input-vs-saved-years'
  years: Array<ReviewComparison & { priorChainChanged: boolean }>
}> {
  return requestJson('/api/balances/impact')
}

export function getReviewComparison(id: string): Promise<ReviewComparison> {
  return requestJson('/api/balances/reviews/' + encodeURIComponent(id) + '/compare')
}

export function getBalanceReviews(): Promise<{
  reviews: Array<{ id: string; year: number; active: boolean; previousYearChanged: boolean }>
}> {
  return requestJson('/api/balances/reviews')
}
export function getBalanceReview(id: string): Promise<{ review: BalanceReview }> {
  return requestJson('/api/balances/reviews/' + encodeURIComponent(id))
}
import type { BalanceSnapshot } from '../accounting/types'
import type { RestoreSourcePlan, previewRestoreSources } from '../server/restoreSources'
export type RestoreSourcePreview = ReturnType<typeof previewRestoreSources>
export function getRestoreSources(): Promise<RestoreSourcePreview> {
  return requestJson('/api/restore/sources')
}
export function saveRestoreSources(
  csrfToken: string,
  plan: RestoreSourcePlan,
): Promise<{ reconnected: boolean; scanStarted: boolean }> {
  return requestJson('/api/restore/sources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-DevTax-CSRF': csrfToken },
    body: JSON.stringify(plan),
  })
}
import type {
  HistorySource,
  HistorySourceInput,
  HistorySourceTestResult,
  LocalConfiguration,
  ProviderKey,
  RuntimeData,
  ScanProgress,
  ScanResult,
  FolderSummary,
  SessionSummary,
  SessionDetail,
} from './types'
import type { Diagnosis, PlanningSnapshot, ProjectRuleRecord } from '../planning/types'
import type { AnnualCostProjection } from '../accounting/costs'
import type {
  WorkspaceSave,
  WorkspaceView,
  WorkspacePreviewInput,
  WorkspaceImpact,
} from '../planning/workspace'

export function previewWorkspace(
  csrfToken: string,
  input: WorkspacePreviewInput,
): Promise<WorkspaceImpact> {
  return requestJson('/api/workspace/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-DevTax-CSRF': csrfToken },
    body: JSON.stringify(input),
  })
}

export function getWorkspace(): Promise<WorkspaceView> {
  return requestJson('/api/workspace')
}

export function saveWorkspace(csrfToken: string, draft: WorkspaceSave): Promise<WorkspaceView> {
  return requestJson('/api/workspace', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-DevTax-CSRF': csrfToken },
    body: JSON.stringify(draft),
  })
}

export function getCostProjection(year: number): Promise<AnnualCostProjection> {
  return requestJson(`/api/projections?year=${encodeURIComponent(year)}`)
}

export class ApiRequestError extends Error {
  readonly status: number
  readonly code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...init?.headers,
    },
  })
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`
    let code: string | undefined
    try {
      const payload = (await response.json()) as { error?: string; message?: string }
      code = payload.error
      // `message` is the specific, human-readable reason (e.g. a dangling
      // taxUnitId or a reversed period from PUT /api/planning/rules).
      // `error` is a machine-readable code (e.g. "invalid_request") meant
      // for branching, not for showing to the user -- fall back to it only
      // when the server had nothing more specific to say.
      if (payload.message) detail = payload.message
      else if (payload.error) detail = payload.error
    } catch {
      // Keep the HTTP status when the response is not JSON.
    }
    throw new ApiRequestError(response.status, detail, code)
  }
  return response.json() as Promise<T>
}

export function getRuntime(): Promise<RuntimeData> {
  return requestJson('/api/runtime')
}

export function getConfiguration(): Promise<LocalConfiguration> {
  return requestJson('/api/config')
}

export function getHistorySources(): Promise<{ sources: HistorySource[] }> {
  return requestJson('/api/sources')
}

export function createHistorySource(
  csrfToken: string,
  source: HistorySourceInput,
): Promise<{ saved: true; sourceId: string }> {
  return requestJson('/api/sources', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-DevTax-CSRF': csrfToken,
    },
    body: JSON.stringify(source),
  })
}

export function updateHistorySource(
  csrfToken: string,
  sourceId: string,
  source: HistorySourceInput,
): Promise<{ saved: true; sourceId: string }> {
  return requestJson(`/api/sources/${encodeURIComponent(sourceId)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-DevTax-CSRF': csrfToken,
    },
    body: JSON.stringify(source),
  })
}

export function testHistorySource(
  csrfToken: string,
  source: HistorySourceInput,
): Promise<HistorySourceTestResult> {
  return requestJson('/api/sources/test', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-DevTax-CSRF': csrfToken,
    },
    body: JSON.stringify(source),
  })
}

export function removeHistorySource(
  csrfToken: string,
  sourceId: string,
): Promise<{ removed: true }> {
  return requestJson(`/api/sources/${encodeURIComponent(sourceId)}`, {
    method: 'DELETE',
    headers: {
      'X-DevTax-CSRF': csrfToken,
    },
  })
}

export function scanHistory(
  csrfToken: string,
  providers: ProviderKey[],
  mode: 'incremental' | 'full' = 'incremental',
): Promise<ScanResult> {
  return requestJson('/api/scan', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-DevTax-CSRF': csrfToken,
    },
    body: JSON.stringify({ providers, mode }),
  })
}

export function getScanProgress(): Promise<ScanProgress> {
  return requestJson('/api/scan/progress')
}

export function saveConfiguration(
  csrfToken: string,
  configuration: LocalConfiguration,
): Promise<{ saved: true }> {
  return requestJson('/api/config', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-DevTax-CSRF': csrfToken,
    },
    body: JSON.stringify(configuration),
  })
}

export function saveRetention(
  csrfToken: string,
  days: number,
): Promise<{ saved: true; days: number; previousDays?: number; backupFileName?: string }> {
  return requestJson('/api/retention', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-DevTax-CSRF': csrfToken,
    },
    body: JSON.stringify({ days }),
  })
}

export function getPlanning(): Promise<PlanningSnapshot> {
  return requestJson('/api/planning')
}

export function savePlanning(
  csrfToken: string,
  planning: PlanningSnapshot,
): Promise<{ saved: true }> {
  return requestJson('/api/planning', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-DevTax-CSRF': csrfToken,
    },
    body: JSON.stringify(planning),
  })
}

export function savePlanningRules(
  csrfToken: string,
  rules: ProjectRuleRecord[],
): Promise<{ saved: true }> {
  return requestJson('/api/planning/rules', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-DevTax-CSRF': csrfToken,
    },
    body: JSON.stringify({ rules }),
  })
}

export function getDiagnosis(): Promise<Diagnosis> {
  return requestJson('/api/diagnosis')
}

export function getLedger(): Promise<AnnualCostProjection> {
  return requestJson('/api/ledger')
}

export async function getPlanningExport(format: 'markdown' | 'csv' = 'markdown'): Promise<Blob> {
  const response = await fetch(`/api/export?format=${format}`, {
    headers: { Accept: format === 'csv' ? 'text/csv' : 'text/markdown' },
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.blob()
}

export function getFolders(): Promise<{ folders: FolderSummary[] }> {
  return requestJson('/api/folders')
}

export function getSessions(projectKey: string): Promise<{ sessions: SessionSummary[] }> {
  return requestJson(`/api/sessions?projectKey=${encodeURIComponent(projectKey)}`)
}

export function getSessionDetail(
  provider: ProviderKey,
  sessionKey: string,
  sourceId?: string,
): Promise<SessionDetail> {
  return requestJson(
    `/api/sessions/detail?provider=${provider}&sessionKey=${encodeURIComponent(sessionKey)}${
      sourceId ? `&sourceId=${encodeURIComponent(sourceId)}` : ''
    }`,
  )
}

export function getBalanceDraft(): Promise<BalanceDraft> {
  return requestJson('/api/balances/draft')
}
export function getBalancePreview(year: number): Promise<BalancePreview> {
  return requestJson('/api/balances/preview?year=' + encodeURIComponent(year))
}
export function saveBalanceDraft(
  csrfToken: string,
  snapshot: BalanceSnapshot,
  expectedRevision: number,
  requestId?: string,
): Promise<BalanceDraft> {
  return requestJson('/api/balances/draft', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-DevTax-CSRF': csrfToken },
    body: JSON.stringify({ snapshot, expectedRevision, requestId }),
  })
}
