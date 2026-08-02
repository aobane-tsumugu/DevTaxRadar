# フェーズ3（履歴保全）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設計書7章「履歴保全」を実装する。Claude Code / Codex の利用履歴がいつ失われるかを検出して伝え、利用者の承認のもとで保持期間を延長できるようにする。あわせて取り込み時のハッシュ記録と、設計書12章がフェーズ3へ送った2項目（タイムゾーン差分の警告、`nonUtcTimestamps` の表示）を処理する。

**Architecture:** 検出はすべて純関数として `src/server/retention.ts` に置き、パスは引数で受け取る。API は読み取り（`GET /api/runtime` へ追加）と書き換え（`POST /api/retention`）に分ける。書き換えは「バックアップ → パース → 該当キーだけ差し替え → 書き戻し」の順で、どこかで失敗したら中止して理由を返す。画面は新設せず、オンボーディングのステップ1（履歴）へ状況表示と変更UIを置き、差し迫っている場合だけサマリー画面へ警告バナーを出す。ハッシュは走査中のストリームを `Transform` で通過させて計算し、ファイルを二度読まない。

**Tech Stack:** TypeScript 6 / React 19 / Fastify 5 / zod 4 / `node:sqlite` の `DatabaseSync` / `node:crypto` / vitest 4 / Prettier 3 / oxlint

## Global Constraints

- 絵文字を使わない。ファイルは UTF-8（BOM なし）、改行は LF。Windows 環境で文字化けしない文字だけを使う
- コードスタイルは Prettier 設定に従う（`singleQuote: true`、`semi: false`、`printWidth: 100`）。編集後に `npm run format` を実行する
- 各タスクのコミット前に `npm test`・`npm run typecheck`・`npm run lint`（error 0）・`npm run format:check`・`npm run privacy:check`・`npm run build` をすべて実行し、通ることを確認する
- 検証はコミット済みのテストで行う。使い捨てスクリプトを実行した結果を「テスト済み」と報告しない。テストが書けない場合は、書けない理由を報告する
- **利用者本人の `~/.claude/settings.json` を、開発中・テスト中に絶対に書き換えない。** テストは一時ディレクトリへ複製したファイルだけを対象にする。`DEVTAX_RADAR_CLAUDE_SETTINGS` 環境変数で対象パスを差し替えられるようにし、テストは必ずこれを使う
- ローカル参照（生セッションID・絶対パス・作業ディレクトリ）を `session_references` の外へ出さない。保持状況の応答にファイルパスを含めない。日付と件数だけを返す
- 配賦不変条件（provider×月の配賦合計＝その月の月額）を壊さない
- 画面文言は日本語の敬体。**保持期間の推奨値を製品側から提示しない**（設計書7.3）。判断材料だけを示し、日数は利用者が決める
- 日付は `YYYY-MM-DD`、画面表示は `YYYY年M月D日`。日付の比較はローカルタイム基準（`src/adapters/localTime.ts`）

---

## タスク一覧

| # | 内容 | 設計書 |
|---|---|---|
| 1 | 保持状況の検出（純関数） | 7.1 |
| 2 | `GET /api/runtime` への保持状況の追加 | 7.1 |
| 3 | `POST /api/retention`（承認制の書き換え） | 7.2 |
| 4 | 画面（ステップ1の状況表示と変更UI、サマリーの警告） | 7.1・7.3 |
| 5 | 取り込み時のハッシュ記録と変更検出 | 4.2 |
| 6 | タイムゾーン差分の警告と `nonUtcTimestamps` の表示 | 12章 |
| 7 | README と設計資料の更新 | — |

---

### Task 1: 保持状況の検出（純関数）

**Files:**
- Create: `src/server/retention.ts`
- Create: `tests/server/retention.test.ts`
- Modify: `src/server/paths.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  ```ts
  // src/server/paths.ts
  export function getClaudeSettingsPath(): string

  // src/server/retention.ts
  export type CleanupPeriod =
    | { status: 'explicit'; days: number }
    | { status: 'default'; days: number }   // キーが無い。Claude Code の既定は30日
    | { status: 'unreadable'; reason: string }

  export function readCleanupPeriod(settingsPath: string): CleanupPeriod

  export type HistoryAge = {
    oldestModifiedOn?: string // 'YYYY-MM-DD'（ローカル日付）
    fileCount: number
  }

  export function readHistoryAge(rootDirectory: string): HistoryAge

  export type RetentionForecast = {
    nextLossOn?: string      // 'YYYY-MM-DD'
    daysUntilNextLoss?: number
    alreadyLosing: boolean   // 最古の履歴が既に保持期間を超えている
  }

  export function forecastNextLoss(
    age: HistoryAge,
    period: CleanupPeriod,
    today: string,           // 'YYYY-MM-DD'。呼び出し側が渡す（テスト可能にするため）
  ): RetentionForecast
  ```

**背景:** Claude Code は `~/.claude/settings.json` の `cleanupPeriodDays` を過ぎた履歴を削除する。キーが無ければ既定30日である。つまり既定のまま使っている利用者は、走査した時点で1か月より前の記録を既に失っている。この事実は早く知るほど損失が小さい。

**Interfaces（詳細）:** `forecastNextLoss` は「最も古いファイルが、その更新日から `days` 日後に消える」という単純な規則で計算する。`nextLossOn = oldestModifiedOn + days`。それが `today` 以前なら `alreadyLosing: true` とし、`daysUntilNextLoss` は 0 とする。

- [ ] **Step 1: 失敗するテストを書く**

`tests/server/retention.test.ts` を作る。

```ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  forecastNextLoss,
  readCleanupPeriod,
  readHistoryAge,
} from '../../src/server/retention.ts'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'devtax-retention-'))
  temporaryDirectories.push(directory)
  return directory
}

function writeSettings(contents: string): string {
  const directory = temporaryDirectory()
  const path = join(directory, 'settings.json')
  writeFileSync(path, contents, 'utf8')
  return path
}

describe('readCleanupPeriod', () => {
  it('reads an explicit cleanupPeriodDays', () => {
    const path = writeSettings(JSON.stringify({ cleanupPeriodDays: 400, model: 'opus' }))
    expect(readCleanupPeriod(path)).toEqual({ status: 'explicit', days: 400 })
  })

  it("falls back to Claude Code's 30 day default when the key is absent", () => {
    const path = writeSettings(JSON.stringify({ model: 'opus' }))
    expect(readCleanupPeriod(path)).toEqual({ status: 'default', days: 30 })
  })

  it('treats a missing file as the default rather than an error', () => {
    const path = join(temporaryDirectory(), 'settings.json')
    expect(readCleanupPeriod(path)).toEqual({ status: 'default', days: 30 })
  })

  it('reports unparsable JSON instead of guessing', () => {
    const path = writeSettings('{ this is not json')
    const period = readCleanupPeriod(path)
    expect(period.status).toBe('unreadable')
  })

  it('reports a non-numeric or non-positive value instead of using it', () => {
    expect(readCleanupPeriod(writeSettings('{"cleanupPeriodDays":"400"}')).status).toBe('unreadable')
    expect(readCleanupPeriod(writeSettings('{"cleanupPeriodDays":0}')).status).toBe('unreadable')
    expect(readCleanupPeriod(writeSettings('{"cleanupPeriodDays":-5}')).status).toBe('unreadable')
  })
})

describe('readHistoryAge', () => {
  it('reports no files for a directory that does not exist', () => {
    expect(readHistoryAge(join(temporaryDirectory(), 'absent'))).toEqual({ fileCount: 0 })
  })

  it('finds the oldest jsonl file across nested directories', () => {
    const root = temporaryDirectory()
    mkdirSync(join(root, 'a', 'b'), { recursive: true })
    const older = join(root, 'a', 'old.jsonl')
    const newer = join(root, 'a', 'b', 'new.jsonl')
    writeFileSync(older, '{}\n', 'utf8')
    writeFileSync(newer, '{}\n', 'utf8')
    // 2026-03-20T12:00:00Z and 2026-06-01T12:00:00Z, midday so the local date
    // is the same in every timezone this project supports.
    utimesSync(older, new Date('2026-03-20T12:00:00Z'), new Date('2026-03-20T12:00:00Z'))
    utimesSync(newer, new Date('2026-06-01T12:00:00Z'), new Date('2026-06-01T12:00:00Z'))

    const age = readHistoryAge(root)
    expect(age.fileCount).toBe(2)
    expect(age.oldestModifiedOn).toBe('2026-03-20')
  })

  it('ignores files that are not jsonl', () => {
    const root = temporaryDirectory()
    writeFileSync(join(root, 'notes.txt'), 'x', 'utf8')
    expect(readHistoryAge(root)).toEqual({ fileCount: 0 })
  })
})

describe('forecastNextLoss', () => {
  const period = { status: 'explicit' as const, days: 30 }

  it('returns nothing to forecast when there is no history', () => {
    expect(forecastNextLoss({ fileCount: 0 }, period, '2026-08-02')).toEqual({
      alreadyLosing: false,
    })
  })

  it('counts the days until the oldest file passes the retention period', () => {
    const age = { oldestModifiedOn: '2026-07-20', fileCount: 3 }
    expect(forecastNextLoss(age, period, '2026-08-02')).toEqual({
      nextLossOn: '2026-08-19',
      daysUntilNextLoss: 17,
      alreadyLosing: false,
    })
  })

  it('reports that history is already being lost when the date has passed', () => {
    const age = { oldestModifiedOn: '2026-01-21', fileCount: 3 }
    expect(forecastNextLoss(age, period, '2026-08-02')).toEqual({
      nextLossOn: '2026-02-20',
      daysUntilNextLoss: 0,
      alreadyLosing: true,
    })
  })

  it('cannot forecast when the settings file is unreadable', () => {
    const age = { oldestModifiedOn: '2026-07-20', fileCount: 3 }
    const unreadable = { status: 'unreadable' as const, reason: 'JSONを解析できません' }
    expect(forecastNextLoss(age, unreadable, '2026-08-02')).toEqual({ alreadyLosing: false })
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run tests/server/retention.test.ts`
Expected: FAIL。`src/server/retention.ts` が存在しない。

- [ ] **Step 3: `getClaudeSettingsPath` を足す**

`src/server/paths.ts` の `getDefaultHistoryPaths` の下へ追加する。環境変数の上書きは、書き換え経路をテストするために要る。`DEVTAX_RADAR_DATA_DIR` と同じ趣旨である。

```ts
export function getClaudeSettingsPath(): string {
  // Overridable so the write path can be exercised against a temporary copy.
  // Never point this at a real settings.json in a test.
  return process.env.DEVTAX_RADAR_CLAUDE_SETTINGS ?? join(homedir(), '.claude', 'settings.json')
}
```

- [ ] **Step 4: `retention.ts` を実装する**

`src/server/retention.ts` を作る。

```ts
import { existsSync, readFileSync, statSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
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

  function walk(directory: string): void {
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
  if (age.oldestModifiedOn === undefined || period.status === 'unreadable') {
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
```

`addDays` と `daysBetween` は日付文字列を正午UTCへ固定して計算する。ISO文字列を `slice` して月日を取り出す禁止事項には該当しない（ここで扱うのは既に `YYYY-MM-DD` の日付であり、タイムスタンプからの日付抽出ではない）。

- [ ] **Step 5: テストが通ることを確認する**

Run: `npx vitest run tests/server/retention.test.ts`
Expected: PASS（13件）

- [ ] **Step 6: 全チェックを実行してコミット**

Run: `npm test && npm run typecheck && npm run lint && npm run format:check && npm run privacy:check && npm run build`

```bash
git add src/server/retention.ts src/server/paths.ts tests/server/retention.test.ts
git commit -m "feat: detect when Claude Code will delete the oldest transcripts"
```

---

### Task 2: `GET /api/runtime` への保持状況の追加

**Files:**
- Modify: `src/server/index.ts`（`/api/runtime`）
- Modify: `src/server/paths.ts`（Codex の設定パスは持たない。理由をコメントで残す）
- Modify: `src/client/types.ts`（`RuntimeData`）
- Modify: `tests/server/server.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 の `readCleanupPeriod` / `readHistoryAge` / `forecastNextLoss` / `getClaudeSettingsPath`
- Produces:
  ```ts
  // src/client/types.ts
  export type ProviderRetention = {
    detected: boolean
    fileCount: number
    oldestModifiedOn?: string
    autoDelete:
      | { kind: 'configured'; days: number; source: 'explicit' | 'default' }
      | { kind: 'unreadable'; reason: string }
      | { kind: 'none' }
    nextLossOn?: string
    daysUntilNextLoss?: number
    alreadyLosing: boolean
  }

  export type RuntimeData = {
    csrfToken: string
    providers: Record<ProviderKey, { detected: boolean }>
    retention: Record<ProviderKey, ProviderRetention>
    privacy?: { localOnly: boolean; promptBodiesExtracted: boolean; telemetry: boolean }
  }
  ```

**背景:** Codex には現時点で自動削除がない（保持期間設定は openai/codex issue #6015 で要望段階）。将来入る可能性があるため、検出結果は画面に出し続ける。Codex は `autoDelete: { kind: 'none' }` を返す。

- [ ] **Step 1: `/api/runtime` を拡張する**

`src/server/index.ts` の import へ足す。

```ts
import { getClaudeSettingsPath, getDefaultHistoryPaths, getIdentifierSalt } from './paths.js'
import { forecastNextLoss, readCleanupPeriod, readHistoryAge } from './retention.js'
import { localDateFromTimestamp } from '../adapters/localTime.js'
```

`/api/runtime` を差し替える。

```ts
app.get('/api/runtime', async () => {
  const historyPaths = getDefaultHistoryPaths()
  const today = localDateFromTimestamp(new Date().toISOString()) ?? ''

  const claudeAge = readHistoryAge(historyPaths.claude)
  const claudePeriod = readCleanupPeriod(getClaudeSettingsPath())
  const claudeForecast = forecastNextLoss(claudeAge, claudePeriod, today)

  // Codex has no retention setting today. Report the age anyway so the screen
  // keeps showing it if one ever lands.
  const codexAge = readHistoryAge(historyPaths.codex)

  return {
    csrfToken,
    providers: {
      claude: { detected: existsSync(historyPaths.claude) },
      codex: { detected: existsSync(historyPaths.codex) },
    },
    retention: {
      claude: {
        detected: existsSync(historyPaths.claude),
        fileCount: claudeAge.fileCount,
        oldestModifiedOn: claudeAge.oldestModifiedOn,
        autoDelete:
          claudePeriod.status === 'unreadable'
            ? { kind: 'unreadable' as const, reason: claudePeriod.reason }
            : { kind: 'configured' as const, days: claudePeriod.days, source: claudePeriod.status },
        nextLossOn: claudeForecast.nextLossOn,
        daysUntilNextLoss: claudeForecast.daysUntilNextLoss,
        alreadyLosing: claudeForecast.alreadyLosing,
      },
      codex: {
        detected: existsSync(historyPaths.codex),
        fileCount: codexAge.fileCount,
        oldestModifiedOn: codexAge.oldestModifiedOn,
        autoDelete: { kind: 'none' as const },
        alreadyLosing: false,
      },
    },
    privacy: {
      localOnly: true,
      promptBodiesExtracted: false,
      telemetry: false,
    },
  }
})
```

**応答にファイルパスを含めないこと。** 日付と件数だけを返す。

- [ ] **Step 2: クライアントの型を足す**

`src/client/types.ts` の `RuntimeData` を、上の Interfaces のとおりに差し替える。`retention` は必須プロパティにする。

- [ ] **Step 3: 統合テストを足す**

`tests/server/server.integration.test.ts` の最初の `describe` へ、`/api/runtime` の保持状況を確かめるケースを足す。テストサーバは `DEVTAX_RADAR_CLAUDE_SETTINGS` を一時ファイルへ向けて起動する。既存の起動処理が `env` を組み立てている箇所へ次を加える。

```ts
      DEVTAX_RADAR_CLAUDE_SETTINGS: join(dataDirectory, 'claude-settings.json'),
```

その一時ファイルへ、起動前に次を書く。

```ts
    writeFileSync(
      join(dataDirectory, 'claude-settings.json'),
      JSON.stringify({ cleanupPeriodDays: 400 }),
      'utf8',
    )
```

検証。

```ts
    expect(runtime.retention.claude.autoDelete).toEqual({
      kind: 'configured',
      days: 400,
      source: 'explicit',
    })
    expect(runtime.retention.codex.autoDelete).toEqual({ kind: 'none' })
    // The response must never carry a filesystem path.
    const serializedRuntime = JSON.stringify(runtime)
    expect(serializedRuntime).not.toContain('.claude')
    expect(serializedRuntime).not.toContain('.codex')
```

`writeFileSync` を `node:fs` の import へ加える。

- [ ] **Step 4: 全チェックを実行してコミット**

Run: `npm test && npm run typecheck && npm run lint && npm run format:check && npm run privacy:check && npm run build`

```bash
git add src/server/index.ts src/client/types.ts tests/server/server.integration.test.ts
git commit -m "feat: report transcript retention status from the runtime endpoint"
```

---

### Task 3: `POST /api/retention`（承認制の書き換え）

**Files:**
- Modify: `src/server/retention.ts`
- Modify: `src/server/index.ts`
- Create: `tests/server/retentionWrite.test.ts`

**Interfaces:**
- Consumes: Task 1 の `readCleanupPeriod`
- Produces:
  ```ts
  export type RetentionWriteResult =
    | { ok: true; backupPath: string; previousDays?: number; days: number }
    | { ok: false; reason: string }

  export function writeCleanupPeriod(
    settingsPath: string,
    days: number,
    backupSuffix: string, // 呼び出し側がタイムスタンプを渡す。テスト可能にするため
  ): RetentionWriteResult
  ```

**背景:** Claude Code 自身も設定ファイルのパースに失敗すると cleanup を停止する。壊すと二重に厄介になるため、バックアップを先に取り、パースできなければ何も書かない。既存の他のキーは必ず保持する。

- [ ] **Step 1: 失敗するテストを書く**

`tests/server/retentionWrite.test.ts` を作る。

```ts
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeCleanupPeriod } from '../../src/server/retention.ts'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

function settingsWith(contents: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'devtax-retention-write-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'settings.json')
  writeFileSync(path, contents, 'utf8')
  return path
}

describe('writeCleanupPeriod', () => {
  it('changes only cleanupPeriodDays and keeps every other key', () => {
    const path = settingsWith(
      JSON.stringify({ model: 'opus', permissions: { allow: ['Read'] }, cleanupPeriodDays: 30 }),
    )
    const result = writeCleanupPeriod(path, 400, '20260802T120000')

    expect(result.ok).toBe(true)
    const written = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    expect(written.cleanupPeriodDays).toBe(400)
    expect(written.model).toBe('opus')
    expect(written.permissions).toEqual({ allow: ['Read'] })
  })

  it('adds the key when it was absent', () => {
    const path = settingsWith(JSON.stringify({ model: 'opus' }))
    expect(writeCleanupPeriod(path, 180, '20260802T120000').ok).toBe(true)
    expect(
      (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>).cleanupPeriodDays,
    ).toBe(180)
  })

  it('writes a backup beside the original before touching it', () => {
    const path = settingsWith(JSON.stringify({ model: 'opus', cleanupPeriodDays: 30 }))
    const result = writeCleanupPeriod(path, 400, '20260802T120000')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.backupPath).toBe(`${path}.devtax-backup-20260802T120000`)
    expect(existsSync(result.backupPath)).toBe(true)
    const backup = JSON.parse(readFileSync(result.backupPath, 'utf8')) as Record<string, unknown>
    expect(backup.cleanupPeriodDays).toBe(30)
  })

  it('refuses to write when the JSON cannot be parsed, and leaves the file alone', () => {
    const path = settingsWith('{ this is not json')
    const before = readFileSync(path, 'utf8')

    const result = writeCleanupPeriod(path, 400, '20260802T120000')

    expect(result.ok).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe(before)
  })

  it('creates the file when it does not exist yet', () => {
    const directory = mkdtempSync(join(tmpdir(), 'devtax-retention-write-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'settings.json')

    const result = writeCleanupPeriod(path, 400, '20260802T120000')

    expect(result.ok).toBe(true)
    expect(
      (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>).cleanupPeriodDays,
    ).toBe(400)
  })

  it('reports the previous value so the screen can show what changed', () => {
    const path = settingsWith(JSON.stringify({ cleanupPeriodDays: 30 }))
    const result = writeCleanupPeriod(path, 400, '20260802T120000')
    expect(result.ok && result.previousDays).toBe(30)
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run tests/server/retentionWrite.test.ts`
Expected: FAIL。`writeCleanupPeriod` が存在しない。

- [ ] **Step 3: 実装する**

`src/server/retention.ts` の末尾へ追加する。import へ `copyFileSync`・`writeFileSync`・`mkdirSync` と `node:path` の `dirname` を足す。

```ts
export type RetentionWriteResult =
  | { ok: true; backupPath: string; previousDays?: number; days: number }
  | { ok: false; reason: string }

export function writeCleanupPeriod(
  settingsPath: string,
  days: number,
  backupSuffix: string,
): RetentionWriteResult {
  const backupPath = `${settingsPath}.devtax-backup-${backupSuffix}`

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

    try {
      copyFileSync(settingsPath, backupPath)
    } catch {
      return { ok: false, reason: 'バックアップを作成できなかったため、書き換えを中止しました。' }
    }
  }

  const previous = existing.cleanupPeriodDays
  const previousDays = typeof previous === 'number' ? previous : undefined

  try {
    mkdirSync(dirname(settingsPath), { recursive: true })
    writeFileSync(settingsPath, `${JSON.stringify({ ...existing, cleanupPeriodDays: days }, null, 2)}\n`, 'utf8')
  } catch {
    return { ok: false, reason: '設定ファイルへ書き込めませんでした。権限を確認してください。' }
  }

  return { ok: true, backupPath, previousDays, days }
}
```

ファイルが存在しない場合はバックアップを作らない。`backupPath` は返すが、その位置にファイルは無い。テストはファイルが存在する場合だけバックアップの実在を検査する。

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run tests/server/retentionWrite.test.ts`
Expected: PASS（6件）

- [ ] **Step 5: API を足す**

`src/server/index.ts` へ、`/api/scan` の定義の前に追加する。`protectMutation` は全ルートの `preHandler` で効いているため、CSRF と Origin の検査は自動で入る。

```ts
const retentionRequestSchema = z
  .object({
    // No upper bound suggestion is offered by the product: the right length
    // depends on the user's bookkeeping, not on anything we can infer.
    days: z.number().int().min(1).max(36500),
  })
  .strict()

app.post('/api/retention', async (request, reply) => {
  const parsed = retentionRequestSchema.safeParse(request.body)
  if (!parsed.success) {
    await reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() })
    return
  }

  const { getClaudeSettingsPath } = await import('./paths.js')
  const { writeCleanupPeriod } = await import('./retention.js')
  const suffix = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '')
  const result = writeCleanupPeriod(getClaudeSettingsPath(), parsed.data.days, suffix)

  if (!result.ok) {
    await reply.code(409).send({ error: 'retention_write_failed', message: result.reason })
    return
  }
  return { saved: true, days: result.days, previousDays: result.previousDays }
})
```

`getClaudeSettingsPath` は Task 2 で既に静的 import 済みであればそちらを使い、動的 import は書かない。

- [ ] **Step 6: API の統合テストを足す**

`tests/server/server.integration.test.ts` の最初の `describe` へ足す。Task 2 で `DEVTAX_RADAR_CLAUDE_SETTINGS` を一時ファイルへ向けてあるので、それを書き換える。

```ts
    const retentionResponse = await fetch(`http://127.0.0.1:${port}/api/retention`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${port}`,
        'x-devtax-csrf': runtime.csrfToken,
      },
      body: JSON.stringify({ days: 180 }),
    })
    expect(retentionResponse.status).toBe(200)
    expect(await retentionResponse.json()).toMatchObject({ saved: true, days: 180 })

    const settingsAfter = JSON.parse(
      readFileSync(join(dataDirectory, 'claude-settings.json'), 'utf8'),
    ) as Record<string, unknown>
    expect(settingsAfter.cleanupPeriodDays).toBe(180)

    const withoutCsrf = await fetch(`http://127.0.0.1:${port}/api/retention`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` },
      body: JSON.stringify({ days: 180 }),
    })
    expect(withoutCsrf.status).toBe(403)

    const invalidDays = await fetch(`http://127.0.0.1:${port}/api/retention`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${port}`,
        'x-devtax-csrf': runtime.csrfToken,
      },
      body: JSON.stringify({ days: 0 }),
    })
    expect(invalidDays.status).toBe(400)
```

`readFileSync` を `node:fs` の import へ加える。

- [ ] **Step 7: 全チェックを実行してコミット**

Run: `npm test && npm run typecheck && npm run lint && npm run format:check && npm run privacy:check && npm run build`

```bash
git add src/server/retention.ts src/server/index.ts tests/server/retentionWrite.test.ts tests/server/server.integration.test.ts
git commit -m "feat: extend the transcript retention period with an approved, backed-up write"
```

---

### Task 4: 画面（ステップ1の状況表示と変更UI、サマリーの警告）

**Files:**
- Modify: `src/client/api.ts`
- Modify: `src/client/pages/Onboarding.tsx`
- Modify: `src/App.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: Task 2 の `RuntimeData['retention']`、Task 3 の `POST /api/retention`
- Produces:
  ```ts
  // src/client/api.ts
  export async function saveRetention(
    csrfToken: string,
    days: number,
  ): Promise<{ saved: true; days: number; previousDays?: number }>
  ```

**背景（設計書7.3）:** 製品は推奨値を提示しない。適切な長さは事業形態、申告方式、ディスクの事情で変わる。ここを製品が決めると、根拠のない数字を押し付けることになる。画面では日数を自由に入力させ、判断材料だけを示す。

- [ ] **Step 1: API 関数を足す**

`src/client/api.ts` の既存の POST 関数と同じ書き方で追加する。

```ts
export async function saveRetention(
  csrfToken: string,
  days: number,
): Promise<{ saved: true; days: number; previousDays?: number }> {
  return requestJson('/api/retention', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-devtax-csrf': csrfToken },
    body: JSON.stringify({ days }),
  })
}
```

既存の `saveConfiguration` の実装を読み、ヘッダとエラー処理の書き方を合わせること。

- [ ] **Step 2: オンボーディングのステップ1へ保持状況を出す**

`src/client/pages/Onboarding.tsx` のステップ1で、`.detected-list` の直後（走査中の `<p className="scan-progress">` の前）へ挿入する。

まず state を足す。

```ts
  const [retentionDays, setRetentionDays] = useState<number | undefined>(undefined)
  const [retentionBusy, setRetentionBusy] = useState(false)
```

`configuration` を反映する `useEffect` の隣へ、runtime から初期値を入れる `useEffect` を足す。

```ts
  useEffect(() => {
    const autoDelete = runtime?.retention.claude.autoDelete
    if (autoDelete?.kind === 'configured') setRetentionDays(autoDelete.days)
  }, [runtime])
```

保存ハンドラ。

```ts
  async function applyRetention() {
    if (!runtime || retentionDays === undefined) return
    setRetentionBusy(true)
    setNotice(null)
    try {
      const result = await saveRetention(runtime.csrfToken, retentionDays)
      setNotice({
        kind: 'success',
        message: `Claude Codeの履歴の保持期間を${result.days}日にしました。変更前の設定は同じフォルダへバックアップしています。`,
      })
    } catch (error) {
      setNotice({
        kind: 'error',
        message: `保持期間を変更できませんでした。${error instanceof Error ? error.message : ''}`,
      })
    } finally {
      setRetentionBusy(false)
    }
  }
```

JSX。`runtime` が無い（公開デモ）ときは描画しない。

```tsx
                {runtime && (
                  <details className="retention-box">
                    <summary>
                      履歴がいつ消えるかを確認する
                      {runtime.retention.claude.alreadyLosing && (
                        <b className="retention-alert">すでに一部が失われています</b>
                      )}
                    </summary>
                    <div className="retention-body">
                      <p>
                        Claude Codeは、設定した日数を過ぎた履歴を削除します。削除された履歴は
                        DevTax Radarからも復元できません。ここでの配賦は、残っている履歴だけを
                        根拠にしています。
                      </p>
                      <dl className="retention-facts">
                        <div>
                          <dt>いまの設定</dt>
                          <dd>
                            {runtime.retention.claude.autoDelete.kind === 'configured'
                              ? `${runtime.retention.claude.autoDelete.days}日${
                                  runtime.retention.claude.autoDelete.source === 'default'
                                    ? '（未設定のため、Claude Codeの既定値）'
                                    : ''
                                }`
                              : runtime.retention.claude.autoDelete.kind === 'unreadable'
                                ? runtime.retention.claude.autoDelete.reason
                                : '自動削除の設定はありません'}
                          </dd>
                        </div>
                        <div>
                          <dt>残っている最も古い履歴</dt>
                          <dd>
                            {runtime.retention.claude.oldestModifiedOn ?? '履歴が見つかりません'}
                          </dd>
                        </div>
                        <div>
                          <dt>次に失われる日</dt>
                          <dd>
                            {runtime.retention.claude.alreadyLosing
                              ? `${runtime.retention.claude.nextLossOn} を過ぎており、これより古い履歴はすでにありません`
                              : runtime.retention.claude.nextLossOn
                                ? `${runtime.retention.claude.nextLossOn}（あと${runtime.retention.claude.daysUntilNextLoss}日）`
                                : '判定できません'}
                          </dd>
                        </div>
                        <div>
                          <dt>Codex</dt>
                          <dd>
                            自動削除の設定は見つかりません。最も古い履歴は
                            {runtime.retention.codex.oldestModifiedOn ?? '見つかりません'}です
                          </dd>
                        </div>
                      </dl>
                      <p className="retention-guidance">
                        何日にするかは、ご自身で決めてください。判断の材料は次のとおりです。
                      </p>
                      <ul className="retention-guidance-list">
                        <li>
                          帳簿書類の法定保存期間は原則7年（欠損金の繰越がある年は10年）です。ただし
                          これは帳簿書類についての定めで、AIの利用履歴そのものに保存義務があるわけ
                          ではありません
                        </li>
                        <li>
                          取り込んだあとも元の履歴には価値があります。DevTax
                          RadarのデータベースはこのPCの利用者が書き換えられるため、自動生成された
                          元履歴のほうが記録としての性質が強いです
                        </li>
                        <li>
                          長く残すほどディスクを使います。利用状況によっては2桁GBに達することが
                          あります
                        </li>
                      </ul>
                      <div className="retention-apply">
                        <label>
                          <span>保持する日数</span>
                          <input
                            aria-label="Claude Codeの履歴を保持する日数"
                            type="number"
                            min="1"
                            max="36500"
                            value={retentionDays ?? ''}
                            onChange={(event) =>
                              setRetentionDays(
                                Number.isNaN(event.target.valueAsNumber)
                                  ? undefined
                                  : event.target.valueAsNumber,
                              )
                            }
                          />
                          <span>日</span>
                        </label>
                        <button
                          className="secondary-button"
                          disabled={retentionBusy || retentionDays === undefined}
                          onClick={applyRetention}
                        >
                          {retentionBusy ? '変更中…' : 'この日数へ変更する'}
                        </button>
                      </div>
                      <p className="retention-caveat">
                        変更するのは`~/.claude/settings.json`の`cleanupPeriodDays`だけです。変更前の
                        ファイルは同じフォルダへバックアップします。ほかの設定は変更しません。
                      </p>
                    </div>
                  </details>
                )}
```

`saveRetention` を import する。

- [ ] **Step 3: サマリー画面へ警告を出す**

`src/App.tsx` の `SummaryPage` に `retention` を渡し、`.preparation-strip` の前へバナーを出す。差し迫っている場合だけ出す。

`SummaryPage` の props へ足す。

```ts
  retention: RuntimeData['retention'] | null
```

JSX の先頭（`<>` の直後）へ。

```tsx
      {retention &&
        retention.claude.autoDelete.kind === 'configured' &&
        (retention.claude.alreadyLosing ||
          (retention.claude.daysUntilNextLoss ?? Infinity) <= 30) && (
          <div className="retention-banner" role="status">
            <strong>
              {retention.claude.alreadyLosing
                ? 'Claude Codeの古い履歴は、すでに一部が削除されています'
                : `Claude Codeの最も古い履歴が、あと${retention.claude.daysUntilNextLoss}日で削除されます`}
            </strong>
            <span>
              削除された履歴は復元できません。保持する日数は「はじめの準備」の最初のステップで
              変更できます。
            </span>
            <button className="text-button" onClick={onOpenOnboarding}>
              はじめの準備を開く →
            </button>
          </div>
        )}
```

`App` から `retention={runtime?.retention ?? null}` を渡す。`onOpenOnboarding` は Task 7（フェーズ2b）で既に props にある。

- [ ] **Step 4: CSS を足す**

`src/index.css` へ、既存の変数（`--muted`・`--line`・`--coral-soft`・`--amber-soft` 等、実在するものを確認して）を使って追加する。

```css
.retention-banner {
  margin-bottom: 18px;
  padding: 14px 18px;
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  border: 1px solid var(--line-strong);
  border-radius: 9px;
  background: var(--amber-soft);
}
.retention-banner strong {
  font-size: 16px;
}
.retention-banner span {
  flex: 1 1 320px;
  color: var(--muted);
}
.retention-box {
  margin-top: 18px;
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: 9px;
}
.retention-box > summary {
  cursor: pointer;
  font-weight: 700;
}
.retention-alert {
  margin-left: 10px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--coral-soft);
  font-size: 13px;
}
.retention-body {
  margin-top: 12px;
  display: grid;
  gap: 12px;
}
.retention-facts {
  display: grid;
  gap: 8px;
}
.retention-facts > div {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  gap: 10px;
}
.retention-facts dt {
  color: var(--muted);
}
.retention-guidance-list {
  margin: 0;
  padding-left: 20px;
  display: grid;
  gap: 6px;
  color: var(--muted);
  line-height: 1.7;
}
.retention-apply {
  display: flex;
  gap: 12px;
  align-items: end;
  flex-wrap: wrap;
}
.retention-apply label {
  display: flex;
  gap: 8px;
  align-items: center;
}
.retention-caveat {
  color: var(--muted);
  font-size: 14px;
}
@media (max-width: 1100px) {
  .retention-facts > div {
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
  }
}
```

`--amber-soft` と `--coral-soft` が `:root` に無い場合は、実在する変数へ置き換え、報告に書くこと。

- [ ] **Step 5: 全チェックを実行する**

Run: `npm test && npm run typecheck && npm run lint && npm run format:check && npm run privacy:check && npm run build`

- [ ] **Step 6: 画面で確認する**

**利用者本人の `~/.claude/settings.json` を絶対に書き換えないこと。** 次の手順で隔離する。

1. 一時ディレクトリを作り、`~/.claude/settings.json` を**コピー**する
2. `DEVTAX_RADAR_DATA_DIR=<一時DB> DEVTAX_RADAR_CLAUDE_SETTINGS=<コピーしたファイル> PORT=4338 npm start`
3. 画面を開き、ステップ1で「履歴がいつ消えるかを確認する」を展開して、いまの設定・最古の履歴・次に失われる日が出ることを確認する
4. 日数を変えて「この日数へ変更する」を押し、成功メッセージが出ることを確認する
5. **コピーしたファイル**の `cleanupPeriodDays` が変わり、他のキーが残っていることを確認する
6. 同じフォルダに `settings.json.devtax-backup-...` ができていることを確認する
7. サーバを停止し、一時ディレクトリを削除する

確認後、`~/.claude/settings.json` の更新日時が変わっていないことを `ls -la` で確かめて報告すること。

- [ ] **Step 7: コミット**

```bash
git add src/client/api.ts src/client/pages/Onboarding.tsx src/App.tsx src/index.css
git commit -m "feat: show when transcripts will be deleted and let the user extend it"
```

---

### Task 5: 取り込み時のハッシュ記録と変更検出

**Files:**
- Modify: `src/adapters/jsonl.ts`
- Modify: `src/adapters/types.ts`
- Modify: `src/adapters/claude.ts`、`src/adapters/codex.ts`
- Modify: `src/server/database.ts`
- Modify: `src/server/index.ts`（`/api/scan` の応答）
- Create: `tests/adapters/contentHash.test.ts`
- Modify: `scripts/privacy-check.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  ```ts
  // src/adapters/types.ts
  export type LocalSessionReference = {
    nativeSessionId: string
    sourcePath: string
    workingDirectory: string
    contentHash: string   // ファイル全体の SHA-256（16進）
    byteSize: number
    fileMtime: string     // ISO
  }

  // src/server/database.ts
  export type ReferenceChange = {
    provider: 'claude' | 'codex'
    sessionKey: string
    previousHash: string
    currentHash: string
  }
  export function replaceProviderSessions(...): { changedReferences: ReferenceChange[] }
  ```

**背景（設計書4.2）:** `content_hash` は取り込み時点のファイルのSHA-256。再スキャン時に差分を検出し、「元履歴が取り込み後に変更されている」ことを警告できる。**この記録の限界は明記する。** 同じユーザー権限で動く以上、ハッシュ自体も書き換え可能であり、第三者に対する改ざん防止にはならない。外部の時刻証明があってはじめて第三者性が生じる。それでも、同一PC内で辻褄の合う記録が継続していることは示せる。

**性能上の要件:** 履歴は数GBになりうる。ハッシュのためにファイルを二度読まないこと。走査中のストリームを `Transform` で通過させて計算する。

- [ ] **Step 1: 失敗するテストを書く**

`tests/adapters/contentHash.test.ts` を作る。

```ts
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readJsonlObjects } from '../../src/adapters/jsonl.ts'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

function jsonlFile(contents: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'devtax-hash-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'session.jsonl')
  writeFileSync(path, contents, 'utf8')
  return path
}

function emptyDiagnostics() {
  return {
    filesDiscovered: 0,
    linesRead: 0,
    blankLines: 0,
    malformedJsonLines: 0,
    ioErrors: 0,
  }
}

describe('readJsonlObjects content hashing', () => {
  it('hashes every byte of the file while parsing it once', async () => {
    const contents = '{"a":1}\n{"b":2}\n'
    const path = jsonlFile(contents)
    const hash = createHash('sha256')
    const diagnostics = emptyDiagnostics()

    const rows = []
    for await (const row of readJsonlObjects(path, diagnostics, hash)) rows.push(row)

    expect(rows).toEqual([{ a: 1 }, { b: 2 }])
    expect(hash.digest('hex')).toBe(createHash('sha256').update(contents, 'utf8').digest('hex'))
  })

  it('produces a different hash when one byte changes', async () => {
    const first = createHash('sha256')
    const second = createHash('sha256')
    const diagnostics = emptyDiagnostics()

    for await (const _ of readJsonlObjects(jsonlFile('{"a":1}\n'), diagnostics, first));
    for await (const _ of readJsonlObjects(jsonlFile('{"a":2}\n'), diagnostics, second));

    expect(first.digest('hex')).not.toBe(second.digest('hex'))
  })

  it('still parses when no hash is supplied', async () => {
    const diagnostics = emptyDiagnostics()
    const rows = []
    for await (const row of readJsonlObjects(jsonlFile('{"a":1}\n'), diagnostics)) rows.push(row)
    expect(rows).toEqual([{ a: 1 }])
  })
})
```

`emptyDiagnostics` の形は `src/adapters/types.ts` の `AdapterDiagnostics` に合わせること。実際のフィールド名を読んで書くこと。

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run tests/adapters/contentHash.test.ts`
Expected: FAIL。`readJsonlObjects` が第3引数を取らない。

- [ ] **Step 3: `readJsonlObjects` へハッシュを通す**

`src/adapters/jsonl.ts` を変更する。`createReadStream` から `encoding` を外し、Buffer チャンクを `Transform` へ通す。`Transform` は `hash.update` してからそのまま流す。`createInterface` は Buffer ストリームを既定で utf8 として読むため、行分割の挙動は変わらない。

```ts
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { Transform } from 'node:stream'
import type { Hash } from 'node:crypto'

export async function* readJsonlObjects(
  filePath: string,
  diagnostics: AdapterDiagnostics,
  hash?: Hash,
): AsyncGenerator<Record<string, unknown>> {
  const source = createReadStream(filePath, { flags: 'r' })
  source.on('error', () => {
    diagnostics.ioErrors += 1
  })

  // A Transform in the pipe chain sees every byte without switching the source
  // into flowing mode, which a bare 'data' listener would do -- that would race
  // readline for the same chunks. This keeps the file read exactly once.
  const input = hash
    ? source.pipe(
        new Transform({
          transform(chunk, _encoding, callback) {
            hash.update(chunk)
            callback(null, chunk)
          },
        }),
      )
    : source

  const lines = createInterface({
    input,
    crlfDelay: Number.POSITIVE_INFINITY,
  })
  /* 以降のループは既存のまま */
}
```

既存の `stream` 変数を参照している箇所があれば `source` へ揃えること。

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run tests/adapters/contentHash.test.ts`
Expected: PASS（3件）

- [ ] **Step 5: アダプタでハッシュを計算し参照へ載せる**

`src/adapters/types.ts` の `LocalSessionReference` へ `contentHash`・`byteSize`・`fileMtime` を足す。

`src/adapters/claude.ts` と `src/adapters/codex.ts` のファイルループで、`createHash('sha256')` を作って `readJsonlObjects` へ渡し、ファイルを読み終えたら `digest('hex')` と `statSync` の結果を、そのファイルから作った参照へ入れる。既存の `localReference` を組み立てている箇所を読み、同じ形へ足すこと。

- [ ] **Step 6: DB へ列を足して差分を検出する**

`src/server/database.ts`：

- `CREATE TABLE IF NOT EXISTS session_references` へ `content_hash TEXT NOT NULL DEFAULT ''`、`byte_size INTEGER NOT NULL DEFAULT 0`、`file_mtime TEXT NOT NULL DEFAULT ''` を足す
- 既存DB向けに `PRAGMA table_info(session_references)` ガード付きの `ALTER TABLE` を3本足す（既存のマイグレーション群と同じ書き方）
- `replaceProviderSessions` で、参照を書き換える前に既存行の `content_hash` を読み、新しいハッシュと違うものを `changedReferences` として返す。**空文字（マイグレーション直後の既定値）だった場合は変更とみなさない**

- [ ] **Step 7: 走査の応答へ載せる**

`src/server/index.ts` の `/api/scan` の応答に、provider ごとの `changedReferences` の**件数**を足す。パスやセッションIDは載せない。

```ts
      diagnostics: {
        ...result.diagnostics,
        nonUtcTimestamps: aggregationDiagnostics.nonUtcTimestamps,
        changedSinceLastScan: changedReferences.length,
      },
```

- [ ] **Step 8: privacy-check を広げる**

`scripts/privacy-check.ts` の検査語へ `content_hash` を足す。設計書10章が求めている `native_session_id`・`source_path` の検査が既に入っているか確認し、無ければ足すこと。

- [ ] **Step 9: 全チェックを実行してコミット**

Run: `npm test && npm run typecheck && npm run lint && npm run format:check && npm run privacy:check && npm run build`

走査の所要時間が大きく延びていないことも確認する。隔離したデータディレクトリで実履歴を走査し、フェーズ2bの記録（約17秒、約1000セッション）と比べて報告すること。

```bash
git add src/adapters/ src/server/database.ts src/server/index.ts scripts/privacy-check.ts tests/adapters/contentHash.test.ts
git commit -m "feat: record a content hash per transcript and report later changes"
```

---

### Task 6: タイムゾーン差分の警告と `nonUtcTimestamps` の表示

**Files:**
- Modify: `src/server/database.ts`（直近スキャンのタイムゾーンを読む）
- Modify: `src/server/dashboard.ts`（guidance）
- Modify: `src/client/pages/Onboarding.tsx`（走査結果の表示）
- Modify: `tests/server/*`

**Interfaces:**
- Consumes: 既存の `scans.time_zone`、`AggregationDiagnostics.nonUtcTimestamps`
- Produces:
  ```ts
  // src/server/database.ts
  export function getLastScanTimeZone(): string | null
  ```

**背景（設計書12章）:** `scans.time_zone` は書き込んでいるが読み出していない。`AggregationDiagnostics.nonUtcTimestamps` はAPIレスポンスに含まれるが画面に出ていない。月の帰属はローカルタイム基準なので、走査時と現在のタイムゾーンが違えば帰属が変わりうる。

- [ ] **Step 1: 失敗するテストを書く**

`tests/server/` に、`getLastScanTimeZone` が直近の走査のタイムゾーンを返すことを確かめるテストを足す。`tests/server/database.test.ts` のプローブ方式に倣い、`replaceProviderSessions` を呼んだあとに読み出す。既存の `database-probe.ts` へ追記するか、新しいプローブを作るかは実装者が選ぶ。

`src/server/dashboard.ts` の guidance について、走査時と現在のタイムゾーンが違う場合に警告が出ることを検証するテストも足す。`tests/server/outOfContractAllocation.test.ts` のプローブ方式が使える（プローブ側で `process.env.TZ` を変えて2回目の集計を行う）。

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run tests/server/`
Expected: 追加したケースが FAIL

- [ ] **Step 3: `getLastScanTimeZone` を実装する**

`src/server/database.ts` へ足す。

```ts
export function getLastScanTimeZone(): string | null {
  const row = getDatabase()
    .prepare(
      `SELECT time_zone AS timeZone FROM scans
       WHERE time_zone IS NOT NULL
       ORDER BY started_at DESC LIMIT 1`,
    )
    .get() as { timeZone: string } | undefined
  return row?.timeZone ?? null
}
```

- [ ] **Step 4: guidance へ警告を足す**

`src/server/dashboard.ts` の guidance 配列へ、契約期間の案内と同じ書き方で足す。

```ts
      ...(lastScanTimeZone && lastScanTimeZone !== resolvedTimeZone()
        ? [
            {
              title: 'タイムゾーンが走査時と変わっています',
              description: `走査したときは${lastScanTimeZone}、いまは${resolvedTimeZone()}です。月の帰属はPCのローカルタイムで判定するため、月末・月初の利用が別の月へ移っている可能性があります。もう一度走査すると、現在のタイムゾーンで付け直します。`,
              severity: 'warning' as const,
            },
          ]
        : []),
```

`resolvedTimeZone` と `getLastScanTimeZone` を import する。

- [ ] **Step 5: `nonUtcTimestamps` を画面へ出す**

`src/client/pages/Onboarding.tsx` のステップ1で、走査が終わったあとの結果表示に、`nonUtcTimestamps` が0より大きい場合だけ注記を出す。走査結果は `onScan` の戻り値（`ScanResult`）で受け取っている。既存の受け取り方を読んで、結果を state へ保持する形にする。

```tsx
                {lastScanResult && (
                  <p className="scan-note" role="status">
                    {Object.entries(lastScanResult.providers).map(([provider, summary]) => {
                      const nonUtc = Number(summary?.diagnostics?.nonUtcTimestamps ?? 0)
                      if (nonUtc === 0) return null
                      return (
                        <span key={provider}>
                          {provider === 'codex' ? 'Codex' : 'Claude Code'}の履歴に、UTC表記でない
                          日時が{nonUtc}件ありました。月の帰属がずれる場合があります。
                        </span>
                      )
                    })}
                  </p>
                )}
```

`.scan-note` の CSS は `.scan-progress` と同じ形で足す。

- [ ] **Step 6: 全チェックを実行してコミット**

Run: `npm test && npm run typecheck && npm run lint && npm run format:check && npm run privacy:check && npm run build`

```bash
git add src/server/database.ts src/server/dashboard.ts src/client/pages/Onboarding.tsx src/index.css tests/
git commit -m "feat: warn when the timezone changed since the last scan"
```

---

### Task 7: README と設計資料の更新

**Files:**
- Modify: `README.md`
- Modify: `docs/SECURITY.md`
- Modify: `PRODUCT_SPEC.md`

**Interfaces:**
- Consumes: Task 1-6 のすべて
- Produces: なし

- [ ] **Step 1: README の「まだできないこと」から、実装した項目を外す**

現在の README には次の記述がある。

```
### 履歴が消えると、その期間の根拠は作れません
...
**保持期間の検出、警告、延長の適用はまだ実装していません。**
```

この節を、実装した内容に合わせて書き直す。**削除するのではなく、残る限界を正確に書く。** 残る限界は次のとおり。

- 既に削除された履歴は復元できない（これは変わらない）
- Codex には保持期間の設定が無いため、延長できるのは Claude Code だけ
- 保持期間を延ばしてもディスクを使う。容量は製品側で推定しない
- ハッシュ記録は同一PC内の整合性を示すだけで、第三者に対する改ざん防止にはならない

- [ ] **Step 2: README の「できること」へ追記する**

「履歴を読む」の節へ足す。

```
- 履歴がいつ削除されるかの検出と表示（Claude Codeの`cleanupPeriodDays`、最も古い履歴の日付、次に失われる日）
- バックアップを取ったうえでの、保持期間の変更（変更するのは`cleanupPeriodDays`だけ）
- 取り込み時のファイルのSHA-256記録と、再走査時の変更検出
- 走査時と現在のタイムゾーンが違う場合の警告
```

- [ ] **Step 3: `docs/SECURITY.md` へ、設定ファイルの書き換えについて書く**

現在の内容を読み、次を追記する。

- DevTax Radar が書き換える利用者のファイルは `~/.claude/settings.json` の `cleanupPeriodDays` ただ一つであること
- 書き換えは画面からの明示的な操作でのみ行い、必ず事前にバックアップを取ること
- JSONを解析できない場合は書き換えを中止すること
- ハッシュ記録は第三者に対する改ざん防止ではないこと

- [ ] **Step 4: `PRODUCT_SPEC.md` の実装状態を更新する**

「### 0.1 現在の実装状態」の実装済みリストへ、保持期間の検出・変更とハッシュ記録を足す。

- [ ] **Step 5: コミット**

```bash
git add README.md docs/SECURITY.md PRODUCT_SPEC.md
git commit -m "docs: describe transcript retention and its remaining limits"
```

---

## 自己レビュー結果

**1. 仕様の網羅**

| 設計書 | 対応タスク |
|---|---|
| 7.1 検出と表示 | Task 1（検出）・Task 2（API）・Task 4（画面） |
| 7.2 承認制の書き換え | Task 3（API）・Task 4（画面） |
| 7.3 期間はユーザーが決める | Task 4 Step 2（推奨値を出さず判断材料だけを示す） |
| 4.2 `content_hash` | Task 5 |
| 12章 `scans.time_zone` | Task 6 |
| 12章 `nonUtcTimestamps` | Task 6 |
| 10章 テスト方針（保持期間） | Task 1・Task 3 |
| 10章 テスト方針（ハッシュ） | Task 5 |

**2. 型の整合**

- `CleanupPeriod` / `HistoryAge` / `RetentionForecast` / `RetentionWriteResult` は `src/server/retention.ts` のみ
- `ProviderRetention` と `RuntimeData` は `src/client/types.ts` のみ。サーバは `/api/runtime` で同じ形を返すが型は共有しない（既存の構造に合わせる）
- `LocalSessionReference` の追加3フィールドは `src/adapters/types.ts` で定義し、`session_references` の3列と1対1で対応する

**3. 安全性の確認**

- `~/.claude/settings.json` への書き込みは `writeCleanupPeriod` ただ1箇所。パスは呼び出し側から渡す
- すべてのテストは一時ディレクトリのファイルだけを対象にする
- Task 4 Step 6 のブラウザ確認は、実ファイルの**コピー**に対して行い、実ファイルの更新日時が変わっていないことを確認して報告する
- `POST /api/retention` は `protectMutation` の CSRF・Origin 検査を通る。`createLoopbackHostGuard` も全ルートに掛かっている

**4. 依存順**

Task 1 → 2 → 3 → 4 は検出から画面までの一本道。Task 5 と 6 は独立だが、どちらも `/api/scan` の応答に触るため 5 → 6 の順にする。Task 7 は最後。番号順に実行する。

**5. 性能**

Task 5 のハッシュは、走査中のストリームを `Transform` で通過させるため追加の I/O は発生しない。SHA-256 の CPU コストだけが増える。数GBの履歴でも数秒の増加にとどまるはずだが、Task 5 Step 9 で実測して報告する。
