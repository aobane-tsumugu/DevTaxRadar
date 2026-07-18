import type {
  LocalConfiguration,
  ProviderKey,
  RuntimeData,
  ScanResult,
} from './types'

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
      const payload = await response.json() as { error?: string }
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

export function scanHistory(
  csrfToken: string,
  providers: ProviderKey[],
): Promise<ScanResult> {
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
