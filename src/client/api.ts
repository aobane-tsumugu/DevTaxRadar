import type {
  LocalConfiguration,
  ProviderKey,
  RuntimeData,
  ScanProgress,
  ScanResult,
  FolderSummary,
  SessionSummary,
  SessionDetail,
} from './types'
import type {
  Diagnosis,
  PlanningLedger,
  PlanningSnapshot,
  ProjectRuleRecord,
} from '../planning/types'

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
    try {
      const payload = (await response.json()) as { error?: string; message?: string }
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
    throw new Error(detail)
  }
  return response.json() as Promise<T>
}

export function getRuntime(): Promise<RuntimeData> {
  return requestJson('/api/runtime')
}

export function getConfiguration(): Promise<LocalConfiguration> {
  return requestJson('/api/config')
}

export function scanHistory(csrfToken: string, providers: ProviderKey[]): Promise<ScanResult> {
  return requestJson('/api/scan', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-DevTax-CSRF': csrfToken,
    },
    body: JSON.stringify({ providers }),
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
): Promise<{ saved: true; days: number; previousDays?: number }> {
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

export function getLedger(): Promise<PlanningLedger> {
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
): Promise<SessionDetail> {
  return requestJson(
    `/api/sessions/detail?provider=${provider}&sessionKey=${encodeURIComponent(sessionKey)}`,
  )
}
