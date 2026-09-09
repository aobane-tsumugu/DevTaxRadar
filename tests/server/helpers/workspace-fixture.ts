import { randomUUID } from 'node:crypto'
import type { WorkspaceView } from '../../../src/planning/workspace.js'

/** Prepare fixtures through the real versioned API. Never fabricate a response. */
export async function saveWorkspaceFixture(
  server: { port: number; csrfToken?: string },
  patch: { configuration?: unknown; planning?: unknown; projectRules?: unknown },
): Promise<Response> {
  const origin = `http://127.0.0.1:${server.port}`
  const response = await fetch(origin + '/api/workspace')
  if (!response.ok) throw new Error(`Cannot read fixture workspace: ${response.status}`)
  const current = (await response.json()) as WorkspaceView
  const has = (key: keyof typeof patch) => Object.hasOwn(patch, key)
  const planning = has('projectRules')
    ? { ...current.planning, projectRules: patch.projectRules }
    : has('planning') ? patch.planning : current.planning
  return fetch(origin + '/api/workspace', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      origin,
      ...(server.csrfToken ? { 'X-DevTax-CSRF': server.csrfToken } : {}),
    },
    body: JSON.stringify({
      requestId: randomUUID(),
      expectedRevision: current.revision,
      configuration: has('configuration') ? patch.configuration : current.configuration,
      planning,
    }),
  })
}

export function savePlanningFixture(
  planning: unknown,
  server: { port: number; csrfToken?: string },
): Promise<Response> {
  return saveWorkspaceFixture(server, { planning })
}

export function saveRulesFixture(
  input: { rules: unknown },
  server: { port: number; csrfToken?: string },
): Promise<Response> {
  return saveWorkspaceFixture(server, { projectRules: input.rules })
}

export function saveConfigurationFixture(
  configuration: unknown,
  server: { port: number; csrfToken?: string },
): Promise<Response> {
  return saveWorkspaceFixture(server, { configuration })
}
