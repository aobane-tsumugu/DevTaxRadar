import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { homedir, platform } from 'node:os'
import { isAbsolute, join, normalize, resolve } from 'node:path'

export function getAppDataDirectory(): string {
  if (process.env.DEVTAX_RADAR_DATA_DIR) {
    return process.env.DEVTAX_RADAR_DATA_DIR
  }

  if (platform() === 'win32') {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'DevTaxRadar')
  }

  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'DevTaxRadar')
  }

  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'devtax-radar')
}

/** A restored dataset must reconnect its original sources before any new scan. */
export function restoreRequiresReconnect(): boolean {
  return existsSync(join(getAppDataDirectory(), 'restore-reconnect-required.json'))
}

export function getDefaultHistoryPaths(): { claude: string; codex: string } {
  return {
    claude: join(homedir(), '.claude', 'projects'),
    codex: join(homedir(), '.codex', 'sessions'),
  }
}

/**
 * Converts a user-selected local, UNC, or OS-mounted history root into the
 * exact absolute path DevTax will read. Share authentication and mounting stay
 * with the operating system; DevTax only receives a filesystem path.
 */
export function normalizeHistoryRoot(root: string): string {
  const trimmed = root.trim()
  if (!trimmed || !isAbsolute(trimmed)) {
    throw new Error('履歴フォルダには絶対パスを指定してください。')
  }
  return normalize(resolve(trimmed))
}

/** A comparison key only. It never leaves the local source-settings boundary. */
export function historyRootKey(root: string): string {
  const normalized = normalizeHistoryRoot(root)
  return platform() === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
}

/**
 * Keep an unchanged disabled source as an opaque record, even after an OS change.
 * New or enabled bindings still have to be valid local absolute paths.
 */
export function resolveRestoreHistoryRoot(
  choice: { root: string; enabled: boolean },
  previous: { root_path: string; root_key: string },
): { root: string; rootKey: string } {
  if (!choice.enabled && choice.root === previous.root_path)
    return { root: previous.root_path, rootKey: previous.root_key }
  const root = normalizeHistoryRoot(choice.root)
  return { root, rootKey: historyRootKey(root) }
}

export function getClaudeSettingsPath(): string {
  // Overridable so the write path can be exercised against a temporary copy.
  // Never point this at a real settings.json in a test.
  return process.env.DEVTAX_RADAR_CLAUDE_SETTINGS ?? join(homedir(), '.claude', 'settings.json')
}

// There is intentionally no getCodexSettingsPath(): Codex has no transcript
// retention/cleanup setting today. The request for one is open as
// openai/codex issue #6015. When that lands, add a settings path and a
// reader alongside readCleanupPeriod in retention.ts.

export function getIdentifierSalt(): string {
  const directory = getAppDataDirectory()
  const path = join(directory, 'identifier-salt')
  mkdirSync(directory, { recursive: true })
  if (existsSync(path)) {
    return readFileSync(path, 'utf8').trim()
  }

  const salt = randomBytes(32).toString('base64url')
  writeFileSync(path, `${salt}\n`, { encoding: 'utf8', mode: 0o600 })
  return salt
}
