import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'

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

export function getDefaultHistoryPaths(): { claude: string; codex: string } {
  return {
    claude: join(homedir(), '.claude', 'projects'),
    codex: join(homedir(), '.codex', 'sessions'),
  }
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
