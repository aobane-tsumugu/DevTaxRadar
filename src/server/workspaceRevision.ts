import type { DatabaseSync } from 'node:sqlite'

export function workspaceRevision(db: DatabaseSync): number {
  const row = db
    .prepare("SELECT value FROM app_settings WHERE key = 'workspace_revision'")
    .get() as { value: string } | undefined
  const revision = row ? Number(row.value) : 0
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid workspace revision')
  return revision
}

export function advanceWorkspaceRevision(db: DatabaseSync): void {
  const next = workspaceRevision(db) + 1
  if (!Number.isSafeInteger(next)) throw new Error('Workspace revision exhausted')
  db.prepare(
    "INSERT INTO app_settings(key, value) VALUES ('workspace_revision', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(String(next))
}
