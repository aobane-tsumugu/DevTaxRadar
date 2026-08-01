import type { LocalConfiguration, ProviderKey, RuntimeData, ScanResult } from './types'
import type { Diagnosis, PlanningLedger, PlanningSnapshot } from '../planning/types'

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
      const payload = (await response.json()) as { error?: string }
      if (payload.error) detail = payload.error
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

export function getDiagnosis(): Promise<Diagnosis> {
  return requestJson('/api/diagnosis')
}

export function getLedger(year: number): Promise<PlanningLedger> {
  return requestJson(`/api/ledger?year=${encodeURIComponent(String(year))}`)
}

export async function getPlanningExport(format: 'markdown' | 'csv' = 'markdown'): Promise<Blob> {
  const response = await fetch(`/api/export?format=${format}`, {
    headers: { Accept: format === 'csv' ? 'text/csv' : 'text/markdown' },
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.blob()
}
