import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { localDateFromTimestamp } from '../adapters/localTime.js'

// Claude Code deletes transcripts older than cleanupPeriodDays. The key is
// absent by default, and the documented default is 30 days -- which means a
// user who never touched it has already lost anything older than a month.
const CLAUDE_DEFAULT_CLEANUP_PERIOD_DAYS = 30

export type CleanupPeriod =
  | { status: 'explicit'; days: number }
  | { status: 'default'; days: number }
  | { status: 'unreadable'; reason: string }

export function readCleanupPeriod(settingsPath: string): CleanupPeriod {
  if (!existsSync(settingsPath)) {
    return { status: 'default', days: CLAUDE_DEFAULT_CLEANUP_PERIOD_DAYS }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(settingsPath, 'utf8'))
  } catch {
    return { status: 'unreadable', reason: '設定ファイルのJSONを解析できませんでした。' }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { status: 'unreadable', reason: '設定ファイルの中身がオブジェクトではありません。' }
  }

  const value = (parsed as Record<string, unknown>).cleanupPeriodDays
  if (value === undefined) {
    return { status: 'default', days: CLAUDE_DEFAULT_CLEANUP_PERIOD_DAYS }
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return {
      status: 'unreadable',
      reason: 'cleanupPeriodDays が正の整数ではありません。手で確認してください。',
    }
  }
  return { status: 'explicit', days: value }
}

export type HistoryAge = {
  oldestModifiedOn?: string
  fileCount: number
}

export function readHistoryAge(rootDirectory: string): HistoryAge {
  let oldestMs: number | undefined
  let fileCount = 0
  // On Windows a directory junction reports isDirectory() === true, so a
  // junction pointing at an ancestor would recurse forever. Track resolved
  // paths and visit each real directory once.
  const visited = new Set<string>()

  function walk(directory: string): void {
    let resolved: string
    try {
      resolved = realpathSync(directory)
    } catch {
      return
    }
    if (visited.has(resolved)) return
    visited.add(resolved)

    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const entryPath = join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(entryPath)
        continue
      }
      if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.jsonl') continue
      let stats
      try {
        stats = statSync(entryPath)
      } catch {
        continue
      }
      fileCount += 1
      // mtime is the closest signal available. Claude Code is closed source, so
      // whether its cleanup keys off mtime cannot be verified from here -- the
      // forecast is an estimate, and the screen says so.
      if (oldestMs === undefined || stats.mtimeMs < oldestMs) oldestMs = stats.mtimeMs
    }
  }

  walk(rootDirectory)

  if (oldestMs === undefined) return { fileCount }
  return {
    fileCount,
    oldestModifiedOn: localDateFromTimestamp(new Date(oldestMs).toISOString()),
  }
}

// GET /api/runtime is fetched on every page load, and readHistoryAge walks
// the whole history tree synchronously. Measured against a real ~/.claude
// history of 3,738 .jsonl files (~910 MiB), a single call takes roughly
// 130-155ms; the ~/.codex equivalent (442 files) takes roughly 30-40ms. Since
// /api/runtime calls this once per provider, that is ~170-190ms of Fastify's
// single event loop thread blocked on every load -- well over the ~100ms
// budget. Cache each root's result for a short time so repeated page loads
// within that window are served from memory instead of re-walking the disk.
const HISTORY_AGE_CACHE_TTL_MS = 60_000

type HistoryAgeCacheEntry = { computedAtMs: number; age: HistoryAge }

const historyAgeCache = new Map<string, HistoryAgeCacheEntry>()

/**
 * Cached wrapper around readHistoryAge, keyed by root directory. Recomputes
 * only when the cached entry is older than HISTORY_AGE_CACHE_TTL_MS. `now` is
 * injectable so tests can exercise the TTL without waiting on a real clock.
 */
export function readHistoryAgeCached(rootDirectory: string, now: number = Date.now()): HistoryAge {
  const cached = historyAgeCache.get(rootDirectory)
  if (cached && now - cached.computedAtMs < HISTORY_AGE_CACHE_TTL_MS) {
    return cached.age
  }
  const age = readHistoryAge(rootDirectory)
  historyAgeCache.set(rootDirectory, { computedAtMs: now, age })
  return age
}

/** Test-only escape hatch: clears the cache so tests don't leak state into each other. */
export function clearHistoryAgeCacheForTests(): void {
  historyAgeCache.clear()
}

export type RetentionForecast = {
  nextLossOn?: string
  daysUntilNextLoss?: number
  alreadyLosing: boolean
}

const MILLISECONDS_PER_DAY = 86_400_000

function addDays(date: string, days: number): string {
  // Anchored at midday UTC so daylight saving shifts cannot move the result
  // onto the neighbouring calendar day.
  const anchored = Date.parse(`${date}T12:00:00.000Z`)
  return new Date(anchored + days * MILLISECONDS_PER_DAY).toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T12:00:00.000Z`) - Date.parse(`${from}T12:00:00.000Z`)) /
      MILLISECONDS_PER_DAY,
  )
}

export function forecastNextLoss(
  age: HistoryAge,
  period: CleanupPeriod,
  today: string,
): RetentionForecast {
  // An empty `today` means the caller could not resolve the local date. Report
  // no forecast rather than arithmetic on an unparsable date, which would put
  // NaN into the API response.
  if (age.oldestModifiedOn === undefined || period.status === 'unreadable' || today === '') {
    return { alreadyLosing: false }
  }
  const nextLossOn = addDays(age.oldestModifiedOn, period.days)
  const remaining = daysBetween(today, nextLossOn)
  return {
    nextLossOn,
    daysUntilNextLoss: Math.max(0, remaining),
    alreadyLosing: remaining <= 0,
  }
}

export type RetentionWriteResult =
  // backupFileName is the file name only, never a path: the API surfaces it so
  // the screen can tell the user a backup exists without leaking where.
  // It is absent when there was no existing file to back up.
  | { ok: true; backupFileName?: string; previousDays?: number; days: number }
  | { ok: false; reason: string }

/**
 * Rewrites cleanupPeriodDays in the Claude Code settings file, preserving
 * every other key. Claude Code itself stops its own transcript cleanup when
 * this file fails to parse, so a broken write is doubly harmful -- a backup
 * is taken before the file is touched, and any parse failure aborts without
 * writing anything.
 */
export function writeCleanupPeriod(
  settingsPath: string,
  days: number,
  backupSuffix: string,
): RetentionWriteResult {
  const basePath = `${settingsPath}.devtax-backup-${backupSuffix}`
  let backupPath = basePath
  let backupFileName: string | undefined

  let existing: Record<string, unknown> = {}
  if (existsSync(settingsPath)) {
    let raw: string
    try {
      raw = readFileSync(settingsPath, 'utf8')
    } catch {
      return { ok: false, reason: '設定ファイルを読み取れませんでした。権限を確認してください。' }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      // Claude Code stops its own cleanup when this file fails to parse, so
      // overwriting a broken file would hide a problem the user needs to fix.
      return {
        ok: false,
        reason:
          '設定ファイルのJSONを解析できなかったため、書き換えを中止しました。手で修正してから、もう一度お試しください。',
      }
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {
        ok: false,
        reason: '設定ファイルの中身がオブジェクトではないため、書き換えを中止しました。',
      }
    }
    existing = parsed as Record<string, unknown>

    // COPYFILE_EXCL so a second write in the same second cannot overwrite the
    // first backup -- that would leave a "backup" of the already-changed file
    // and destroy the only copy of the original value.
    let created = false
    for (let attempt = 0; attempt < 100 && !created; attempt += 1) {
      backupPath = attempt === 0 ? basePath : `${basePath}-${attempt}`
      try {
        copyFileSync(settingsPath, backupPath, constants.COPYFILE_EXCL)
        created = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') break
      }
    }
    if (!created) {
      return { ok: false, reason: 'バックアップを作成できなかったため、書き換えを中止しました。' }
    }
    backupFileName = basename(backupPath)
  }

  const previous = existing.cleanupPeriodDays
  const previousDays = typeof previous === 'number' ? previous : undefined

  // Write to a sibling temp file and rename over the original. writeFileSync
  // truncates first, so a crash or a full disk partway through would leave a
  // half-written settings.json -- and Claude Code stops its own cleanup when
  // that file will not parse. A rename within the same directory replaces the
  // file in one step, so any failure leaves the original untouched.
  const temporaryPath = `${settingsPath}.devtax-tmp-${backupSuffix}`
  try {
    mkdirSync(dirname(settingsPath), { recursive: true })
    writeFileSync(
      temporaryPath,
      `${JSON.stringify({ ...existing, cleanupPeriodDays: days }, null, 2)}\n`,
      'utf8',
    )
    renameSync(temporaryPath, settingsPath)
  } catch {
    try {
      rmSync(temporaryPath, { force: true })
    } catch {
      // The temp file is already gone, or cannot be removed. Either way the
      // original is intact, which is what the message below promises.
    }
    return {
      ok: false,
      reason:
        '設定ファイルへ書き込めませんでした。元のファイルは変更していません。権限とディスクの空き容量を確認してください。',
    }
  }

  return { ok: true, backupFileName, previousDays, days }
}
