# フェーズ1: セッション単位の帰属 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI利用履歴をセッション単位で保存し、フォルダ×期間のルールをセッションの発生日時で解決することで、未割当のフォルダが1件目の制作物へ自動集約される問題をなくす。

**Architecture:** Adapter はメッセージ単位のイベントを返し続ける。サーバが `(provider, sessionKey, projectKey, month)` へ集約してから SQLite へ保存し、集計時に純関数 `resolveSessionAssignment` でルールを解決する。日付判定はすべてローカルタイムゾーン基準に統一する。生のセッションIDと絶対パスは `session_references` テーブルへ隔離する。

**Tech Stack:** TypeScript 6, Node.js 24 (`node:sqlite` DatabaseSync), Fastify 5, zod 4, vitest 4

設計: `docs/superpowers/specs/2026-08-01-session-attribution-and-retention-design.md`

## Global Constraints

- Node.js >= 24.14.0（`package.json` の `engines` に固定済み）
- 絵文字を使わない。ソース、テスト、コミットメッセージ、UI文言のすべてで禁止
- ファイルはUTF-8で書く。Windows環境で文字化けする文字を使わない
- UI文言とテスト名は日本語で書く。既存コードの書き方に合わせる
- テストは合成fixtureと一時ディレクトリだけを使う。実ユーザーの `~/.claude` `~/.codex` を読むテストを書かない
- 各タスクの完了時に、そのタスクが追加・変更したテストが通ること。`npm run typecheck` と全テストの通過は Task 8 完了時点で満たす。型の段階的移行のため、中間タスクでは他ファイルに型エラーが残ることを許容する。どのタスクのどの手順で一時的なエラーが残るかは、各タスクの手順に明記してある
- 生のセッションID、絶対パス、作業ディレクトリは `session_references` テーブルにだけ置く。`usage_events` と API レスポンスへ混ぜない

---

## File Structure

### 新規作成

| ファイル | 責務 |
|---|---|
| `src/adapters/localTime.ts` | タイムスタンプをローカルタイムゾーン基準の日付・月へ変換する |
| `src/server/sessionAggregation.ts` | メッセージ単位イベントをセッション行へ畳み込む |
| `src/server/sessionAssignment.ts` | セッションとルールから割当先を決定する純関数 |
| `tests/adapters/localTime.test.ts` | タイムゾーン変換のテスト |
| `tests/server/sessionAggregation.test.ts` | 集約のテスト |
| `tests/server/sessionAssignment.test.ts` | 割当解決のテスト |

### 変更

| ファイル | 変更内容 |
|---|---|
| `src/adapters/types.ts` | `NormalizedUsage` に `observedAt` と `localReference` を追加 |
| `src/adapters/jsonl.ts` | `monthFromTimestamp` を削除し `localTime.ts` へ移す |
| `src/adapters/claude.ts` | `observedAt` と生参照を返す |
| `src/adapters/codex.ts` | 同上 |
| `src/server/database.ts` | `usage_events` 作り直し、`session_references` 新設、`project_mappings` 廃止 |
| `src/server/dashboard.ts` | `resolveMonthlyProjectMapping` を削除しセッション単位集計へ |
| `src/server/index.ts` | スキャン時にセッション集約と生参照の保存を行う |
| `src/planning/types.ts` | `ProjectRuleRecord.taxUnitId` を任意化、`general-learning` を追加 |
| `src/server/planningRepository.ts` | zodスキーマとSQLを上記に合わせる |
| `src/App.tsx` | 1件目の制作物へのフォールバックを削除 |
| `src/client/types.ts` | `ProjectClassification` に `general-learning` を追加 |

### 削除

| ファイル | 理由 |
|---|---|
| `tests/server/dashboardPlanningRules.test.ts` | 月単位解決のテスト。`tests/server/sessionAssignment.test.ts` が置き換える |

---

## Task 1: ローカルタイムゾーン基準の日付変換

現在の `monthFromTimestamp` はISO文字列の先頭を文字列のまま切り出しており、UTC表記の `2026-07-31T23:50:00.000Z` を7月として扱う。JST では8月1日である。月次配賦は月単位で金額を割り当てるため、この1か月のずれは配賦額のずれになる。

タイムゾーンを引数で受け取れる形にする。プロセスの `TZ` 環境変数に依存すると、テストが環境で結果を変えてしまうためである。

**Files:**
- Create: `src/adapters/localTime.ts`
- Test: `tests/adapters/localTime.test.ts`
- Modify: `src/adapters/jsonl.ts:106-112`（`monthFromTimestamp` を削除）

**Interfaces:**
- Produces: `resolvedTimeZone(): string`、`localDateFromTimestamp(value: unknown, timeZone?: string): string | undefined`（`YYYY-MM-DD`）、`localMonthFromTimestamp(value: unknown, timeZone?: string): string | undefined`（`YYYY-MM`）

- [ ] **Step 1: 失敗するテストを書く**

`tests/adapters/localTime.test.ts` を作る。

```ts
import { describe, expect, it } from 'vitest'
import {
  localDateFromTimestamp,
  localMonthFromTimestamp,
  resolvedTimeZone,
} from '../../src/adapters/localTime.ts'

describe('localDateFromTimestamp', () => {
  it('UTC表記の月末深夜はJSTで翌月1日になる', () => {
    expect(localDateFromTimestamp('2026-07-31T23:50:00.000Z', 'Asia/Tokyo')).toBe('2026-08-01')
    expect(localDateFromTimestamp('2026-07-31T23:50:00.000Z', 'UTC')).toBe('2026-07-31')
  })

  it('JSTの正午は同じ日付になる', () => {
    expect(localDateFromTimestamp('2026-07-15T03:00:00.000Z', 'Asia/Tokyo')).toBe('2026-07-15')
  })

  it('オフセット付き表記も解釈する', () => {
    expect(localDateFromTimestamp('2026-07-31T23:50:00+09:00', 'Asia/Tokyo')).toBe('2026-07-31')
  })

  it('文字列でない値と解釈できない値はundefinedを返す', () => {
    expect(localDateFromTimestamp(undefined, 'UTC')).toBeUndefined()
    expect(localDateFromTimestamp(1234, 'UTC')).toBeUndefined()
    expect(localDateFromTimestamp('not-a-timestamp', 'UTC')).toBeUndefined()
  })
})

describe('localMonthFromTimestamp', () => {
  it('月境界をタイムゾーンで判定する', () => {
    expect(localMonthFromTimestamp('2026-07-31T23:50:00.000Z', 'Asia/Tokyo')).toBe('2026-08')
    expect(localMonthFromTimestamp('2026-07-31T23:50:00.000Z', 'UTC')).toBe('2026-07')
  })

  it('年境界をまたぐ場合も正しい', () => {
    expect(localMonthFromTimestamp('2025-12-31T20:00:00.000Z', 'Asia/Tokyo')).toBe('2026-01')
  })
})

describe('resolvedTimeZone', () => {
  it('IANAタイムゾーン識別子を返す', () => {
    expect(resolvedTimeZone()).toMatch(/^[A-Za-z]+(?:\/[A-Za-z_+-]+)*$/)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run tests/adapters/localTime.test.ts`
Expected: FAIL。`src/adapters/localTime.ts` が存在しないため解決できない。

- [ ] **Step 3: 実装を書く**

`src/adapters/localTime.ts` を作る。

```ts
const formatterCache = new Map<string, Intl.DateTimeFormat>()

export function resolvedTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone)
  if (cached) return cached
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  formatterCache.set(timeZone, created)
  return created
}

/** Formats an instant as YYYY-MM-DD in the given zone. Tax records follow the local calendar. */
export function localDateFromTimestamp(
  value: unknown,
  timeZone: string = resolvedTimeZone(),
): string | undefined {
  if (typeof value !== 'string') return undefined
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return undefined

  const parts = formatter(timeZone).formatToParts(parsed)
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value
  const year = pick('year')
  const month = pick('month')
  const day = pick('day')
  if (!year || !month || !day) return undefined
  return `${year}-${month}-${day}`
}

export function localMonthFromTimestamp(
  value: unknown,
  timeZone: string = resolvedTimeZone(),
): string | undefined {
  return localDateFromTimestamp(value, timeZone)?.slice(0, 7)
}
```

`Intl.DateTimeFormat` のインスタンス生成は重いため、タイムゾーンごとにキャッシュする。数千件のイベントを処理するので効く。

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run tests/adapters/localTime.test.ts`
Expected: PASS（9件）

- [ ] **Step 5: `monthFromTimestamp` を削除する**

`src/adapters/jsonl.ts` の末尾から次の関数を削除する。

```ts
export function monthFromTimestamp(value: unknown): string | undefined {
  const match = /^(\d{4})-(\d{2})-\d{2}T/.exec(value);
  ...
}
```

この時点で `src/adapters/claude.ts` と `src/adapters/codex.ts` が壊れる。Task 2 で直す。

- [ ] **Step 6: コミット**

```bash
git add src/adapters/localTime.ts tests/adapters/localTime.test.ts src/adapters/jsonl.ts
git commit -m "feat: judge dates in the local time zone

UTC-based month extraction put work done before 9am JST on the first of
the month into the previous month, shifting the monthly allocation."
```

---

## Task 2: Adapterがセッション日時と生参照を返す

セッション単位の解決には発生日時が要る。resume と内容確認には生のセッションID、元ファイルパス、作業ディレクトリが要る。生の値は `includeLocalReferences` を明示的に有効にしたときだけ返す。fixtureやテストで誤って持ち出さないためである。

**Files:**
- Modify: `src/adapters/types.ts`
- Modify: `src/adapters/claude.ts`
- Modify: `src/adapters/codex.ts`
- Test: `tests/adapters/claude.test.ts`, `tests/adapters/codex.test.ts`

**Interfaces:**
- Consumes: `localMonthFromTimestamp` (Task 1)
- Produces: `NormalizedUsage.observedAt: string`（ISO8601、元のtimestampそのまま）、`NormalizedUsage.localReference?: { nativeSessionId: string; sourcePath: string; workingDirectory: string }`、`AdapterOptions.includeLocalReferences?: boolean`

- [ ] **Step 1: 型を変更する**

`src/adapters/types.ts` の `NormalizedUsage` に2つ追加する。

```ts
export type LocalSessionReference = {
  nativeSessionId: string;
  sourcePath: string;
  workingDirectory: string;
};

export type NormalizedUsage = {
  provider: UsageProvider;
  month: string;
  observedAt: string;
  sessionKey: string;
  projectKey: string;
  projectLabel?: string;
  localReference?: LocalSessionReference;
  model: string;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  activeSeconds?: number;
  captureMethod: string;
  adapter: string;
  schemaVersion: string;
  confidence: AdapterConfidence;
};
```

`AdapterOptions` にも追加する。

```ts
export type AdapterOptions = {
  identifierSalt: string;
  /**
   * Local UI only. Exposes the final cwd segment, never the absolute path.
   * Keep false for fixtures, exports, logs, and any cloud-facing process.
   */
  includeLocalProjectLabel?: boolean;
  /**
   * Local UI only. Exposes the provider session ID, the transcript path and
   * the working directory so the app can offer resume. Never leaves this PC.
   */
  includeLocalReferences?: boolean;
};
```

- [ ] **Step 2: 失敗するテストを書く**

`tests/adapters/claude.test.ts` に追加する。既存の `describe` の中へ入れる。

```ts
  it('observedAtに元のタイムスタンプを保持する', async () => {
    const result = await readClaudeHistory(fixtureRoot, { identifierSalt: 'salt' })
    expect(result.events[0]?.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('opt-inしない限り生の識別子を返さない', async () => {
    const result = await readClaudeHistory(fixtureRoot, { identifierSalt: 'salt' })
    expect(result.events[0]?.localReference).toBeUndefined()
  })

  it('opt-inすると生のセッションIDと作業フォルダを返す', async () => {
    const result = await readClaudeHistory(fixtureRoot, {
      identifierSalt: 'salt',
      includeLocalReferences: true,
    })
    const reference = result.events[0]?.localReference
    expect(reference?.nativeSessionId).toBeTruthy()
    expect(reference?.sourcePath).toContain('.jsonl')
    expect(reference?.workingDirectory).toBeTruthy()
  })
```

`fixtureRoot` は既存テストで使っている変数名に合わせる。既存ファイルを読んで確認すること。

同じ3件を `tests/adapters/codex.test.ts` にも追加する（`readCodexHistory` に読み替える）。

- [ ] **Step 3: テストが失敗することを確認する**

Run: `npx vitest run tests/adapters/claude.test.ts tests/adapters/codex.test.ts`
Expected: FAIL。`observedAt` と `localReference` が undefined。

- [ ] **Step 4: `claude.ts` を実装する**

`src/adapters/claude.ts` を書き換える。`monthFromTimestamp` の import を `localMonthFromTimestamp` へ差し替え、`filePath` を `normalizeClaudeRow` へ渡す。

```ts
import { localMonthFromTimestamp } from "./localTime.ts";
import {
  childRecord,
  discoverJsonlFiles,
  nonNegativeInteger,
  readJsonlObjects,
  stringValue,
} from "./jsonl.ts";
```

読み取りループを変える。

```ts
  for await (const filePath of discoverJsonlFiles(rootDirectory, diagnostics)) {
    for await (const row of readJsonlObjects(filePath, diagnostics)) {
      const event = normalizeClaudeRow(row, filePath, options, seenMessages, diagnostics);
      if (event) events.push(event);
    }
  }
```

`normalizeClaudeRow` のシグネチャと本体を変える。

```ts
function normalizeClaudeRow(
  row: Record<string, unknown>,
  filePath: string,
  options: AdapterOptions,
  seenMessages: Set<string>,
  diagnostics: AdapterResult["diagnostics"],
): NormalizedUsage | undefined {
  const message = childRecord(row, "message");
  const usage = message && childRecord(message, "usage");
  if (!message || !usage) {
    diagnostics.unsupportedLines += 1;
    return undefined;
  }

  const timestamp = stringValue(row.timestamp);
  const month = localMonthFromTimestamp(timestamp);
  const cwd = stringValue(row.cwd);
  const sessionId = stringValue(row.sessionId) ?? stringValue(row.session_id);
  const messageId = stringValue(message.id);

  if (!timestamp || !month || !cwd || !sessionId || !messageId) {
    diagnostics.invalidRecords += 1;
    return undefined;
  }

  const messageKey = privateKey("message", messageId, options.identifierSalt);
  if (seenMessages.has(messageKey)) {
    diagnostics.duplicateRecords += 1;
    return undefined;
  }
  seenMessages.add(messageKey);

  return {
    provider: "claude",
    month,
    observedAt: timestamp,
    sessionKey: privateKey("session", sessionId, options.identifierSalt),
    projectKey: privateKey("project", cwd, options.identifierSalt),
    projectLabel: options.includeLocalProjectLabel
      ? localProjectLabel(cwd)
      : undefined,
    localReference: options.includeLocalReferences
      ? { nativeSessionId: sessionId, sourcePath: filePath, workingDirectory: cwd }
      : undefined,
    model: stringValue(message.model) ?? "unknown",
    inputTokens: nonNegativeInteger(usage.input_tokens),
    cacheReadTokens: nonNegativeInteger(usage.cache_read_input_tokens),
    cacheWriteTokens: nonNegativeInteger(usage.cache_creation_input_tokens),
    outputTokens: nonNegativeInteger(usage.output_tokens),
    reasoningTokens: 0,
    captureMethod: "local transcript compatibility adapter",
    adapter: ADAPTER,
    schemaVersion: SCHEMA_VERSION,
    confidence: "B",
  };
}
```

`timestamp` を `stringValue` で取るように変えた点に注意する。以前は `row.timestamp` を `unknown` のまま渡していたが、`observedAt` に入れるため文字列であることを確定させる必要がある。

- [ ] **Step 5: `codex.ts` を実装する**

`src/adapters/codex.ts` は1ファイル1セッションなので、`filePath` を `CodexSession` へ持たせる。

```ts
type CodexSession = {
  sessionId?: string;
  timestamp?: string;
  cwd?: string;
  model?: string;
  usage?: Record<string, unknown>;
  sourcePath: string;
};
```

読み取りループを変える。

```ts
  for await (const filePath of discoverJsonlFiles(rootDirectory, diagnostics)) {
    const session: CodexSession = { sourcePath: filePath };
    ...
  }
```

`normalizeCodexSession` の返り値を変える。

```ts
  const month = localMonthFromTimestamp(session.timestamp);
  if (!session.sessionId || !session.cwd || !month || !session.usage || !session.timestamp) {
    diagnostics.invalidRecords += 1;
    return undefined;
  }

  return {
    provider: "codex",
    month,
    observedAt: session.timestamp,
    sessionKey: privateKey("session", session.sessionId, options.identifierSalt),
    projectKey: privateKey("project", session.cwd, options.identifierSalt),
    projectLabel: options.includeLocalProjectLabel
      ? localProjectLabel(session.cwd)
      : undefined,
    localReference: options.includeLocalReferences
      ? {
          nativeSessionId: session.sessionId,
          sourcePath: session.sourcePath,
          workingDirectory: session.cwd,
        }
      : undefined,
    model: session.model ?? "unknown",
    inputTokens: nonNegativeInteger(session.usage.input_tokens),
    cacheReadTokens: nonNegativeInteger(session.usage.cached_input_tokens),
    cacheWriteTokens: nonNegativeInteger(session.usage.cache_write_input_tokens),
    outputTokens: nonNegativeInteger(session.usage.output_tokens),
    reasoningTokens: nonNegativeInteger(session.usage.reasoning_output_tokens),
    captureMethod: "local transcript compatibility adapter",
    adapter: ADAPTER,
    schemaVersion: SCHEMA_VERSION,
    confidence: "B",
  };
```

import も `localMonthFromTimestamp` へ差し替える。

- [ ] **Step 6: テストが通ることを確認する**

Run: `npx vitest run tests/adapters/ && npm run typecheck`
Expected: adapters のテストは PASS。`typecheck` は `src/server/index.ts` でエラーが出る（`StoredUsageEvent` に `observedAt` を渡していないため）。Task 4 で直すので、この時点では adapters のテストが通ることだけ確認する。

- [ ] **Step 7: コミット**

```bash
git add src/adapters/ tests/adapters/
git commit -m "feat: carry session timestamps and opt-in local references

Session-level rule resolution needs the observation time. Resume needs
the provider session ID, transcript path and working directory, so the
adapters return them only when the caller opts in."
```

---

## Task 3: セッション集約の純関数

Adapter はメッセージ単位のイベントを返す。実測で46,004行あるが、集計は常に `project × month` へ丸めており、メッセージ粒度を保つ意味がない。保存前に `(provider, sessionKey, projectKey, month)` へ畳み込む。

**Files:**
- Create: `src/server/sessionAggregation.ts`
- Test: `tests/server/sessionAggregation.test.ts`

**Interfaces:**
- Consumes: `NormalizedUsage` (Task 2)
- Produces: 型 `UsageSession`、関数 `aggregateSessions(events: NormalizedUsage[]): UsageSession[]`

- [ ] **Step 1: 失敗するテストを書く**

`tests/server/sessionAggregation.test.ts` を作る。

```ts
import { describe, expect, it } from 'vitest'
import type { NormalizedUsage } from '../../src/adapters/types.ts'
import { aggregateSessions } from '../../src/server/sessionAggregation.ts'

function event(overrides: Partial<NormalizedUsage> = {}): NormalizedUsage {
  return {
    provider: 'claude',
    month: '2026-07',
    observedAt: '2026-07-15T10:00:00.000Z',
    sessionKey: 'session_a',
    projectKey: 'project_a',
    model: 'claude-opus-5',
    inputTokens: 100,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 10,
    reasoningTokens: 0,
    captureMethod: 'test',
    adapter: 'test',
    schemaVersion: 'test-v1',
    confidence: 'B',
    ...overrides,
  }
}

describe('aggregateSessions', () => {
  it('同じセッションのメッセージを1行へ畳み込む', () => {
    const sessions = aggregateSessions([
      event({ observedAt: '2026-07-15T10:00:00.000Z', inputTokens: 100, outputTokens: 10 }),
      event({ observedAt: '2026-07-15T11:00:00.000Z', inputTokens: 200, outputTokens: 20 }),
    ])

    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      sessionKey: 'session_a',
      messageCount: 2,
      inputTokens: 300,
      outputTokens: 30,
      startedAt: '2026-07-15T10:00:00.000Z',
      endedAt: '2026-07-15T11:00:00.000Z',
    })
  })

  it('reasoningTokensをoutputTokensへ合算する', () => {
    const sessions = aggregateSessions([
      event({ outputTokens: 10, reasoningTokens: 5 }),
    ])
    expect(sessions[0]?.outputTokens).toBe(15)
  })

  it('入力順が逆でも開始と終了を正しく決める', () => {
    const sessions = aggregateSessions([
      event({ observedAt: '2026-07-15T11:00:00.000Z' }),
      event({ observedAt: '2026-07-15T10:00:00.000Z' }),
    ])
    expect(sessions[0]?.startedAt).toBe('2026-07-15T10:00:00.000Z')
    expect(sessions[0]?.endedAt).toBe('2026-07-15T11:00:00.000Z')
  })

  it('月をまたぐセッションは月ごとに分ける', () => {
    const sessions = aggregateSessions([
      event({ month: '2026-07', observedAt: '2026-07-31T10:00:00.000Z' }),
      event({ month: '2026-08', observedAt: '2026-08-01T10:00:00.000Z' }),
    ])
    expect(sessions).toHaveLength(2)
    expect(sessions.map((session) => session.month)).toEqual(['2026-07', '2026-08'])
  })

  it('プロジェクトが違えば別の行にする', () => {
    const sessions = aggregateSessions([
      event({ projectKey: 'project_a' }),
      event({ projectKey: 'project_b' }),
    ])
    expect(sessions).toHaveLength(2)
  })

  it('最初に現れた生参照とラベルを採用する', () => {
    const sessions = aggregateSessions([
      event({
        projectLabel: 'pairs',
        localReference: {
          nativeSessionId: 'native-1',
          sourcePath: '/a.jsonl',
          workingDirectory: '/work/pairs',
        },
      }),
      event({ projectLabel: undefined, localReference: undefined }),
    ])
    expect(sessions[0]?.projectLabel).toBe('pairs')
    expect(sessions[0]?.localReference?.nativeSessionId).toBe('native-1')
  })

  it('空配列は空配列を返す', () => {
    expect(aggregateSessions([])).toEqual([])
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run tests/server/sessionAggregation.test.ts`
Expected: FAIL。モジュールが存在しない。

- [ ] **Step 3: 実装を書く**

`src/server/sessionAggregation.ts` を作る。

```ts
import type {
  LocalSessionReference,
  NormalizedUsage,
  UsageProvider,
} from '../adapters/types.ts'

export type UsageSession = {
  provider: UsageProvider
  sessionKey: string
  projectKey: string
  month: string
  startedAt: string
  endedAt: string
  messageCount: number
  projectLabel?: string
  model?: string
  localReference?: LocalSessionReference
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  schemaVersion: string
  confidence: 'high' | 'medium' | 'low'
}

const confidenceByGrade = { A: 'high', B: 'medium', C: 'low' } as const

/**
 * Folds message-level events into one row per session, project and month.
 * A session that crosses a month boundary stays split, because the monthly
 * fee is allocated per calendar month.
 */
export function aggregateSessions(events: NormalizedUsage[]): UsageSession[] {
  const byKey = new Map<string, UsageSession>()

  for (const event of events) {
    const key = `${event.provider}:${event.sessionKey}:${event.projectKey}:${event.month}`
    const current = byKey.get(key)
    const outputTokens = event.outputTokens + event.reasoningTokens

    if (!current) {
      byKey.set(key, {
        provider: event.provider,
        sessionKey: event.sessionKey,
        projectKey: event.projectKey,
        month: event.month,
        startedAt: event.observedAt,
        endedAt: event.observedAt,
        messageCount: 1,
        projectLabel: event.projectLabel,
        model: event.model,
        localReference: event.localReference,
        inputTokens: event.inputTokens,
        outputTokens,
        cacheReadTokens: event.cacheReadTokens,
        cacheWriteTokens: event.cacheWriteTokens,
        schemaVersion: event.schemaVersion,
        confidence: confidenceByGrade[event.confidence],
      })
      continue
    }

    current.messageCount += 1
    current.inputTokens += event.inputTokens
    current.outputTokens += outputTokens
    current.cacheReadTokens += event.cacheReadTokens
    current.cacheWriteTokens += event.cacheWriteTokens
    if (event.observedAt < current.startedAt) current.startedAt = event.observedAt
    if (event.observedAt > current.endedAt) current.endedAt = event.observedAt
    current.projectLabel ??= event.projectLabel
    current.localReference ??= event.localReference
  }

  return [...byKey.values()]
}
```

`observedAt` の比較は文字列比較で行う。ISO8601 は同じタイムゾーン表記なら辞書順が時刻順と一致する。Claude も Codex も `Z` 表記のUTCを出すため成立する。オフセット表記が混ざる場合に備えるなら `Date` へ変換する必要があるが、実データで確認できていない拡張は入れない。

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run tests/server/sessionAggregation.test.ts`
Expected: PASS（7件）

- [ ] **Step 5: コミット**

```bash
git add src/server/sessionAggregation.ts tests/server/sessionAggregation.test.ts
git commit -m "feat: fold message events into session rows"
```

---

## Task 4: DBスキーマの作り直し

`usage_events` の現在の UNIQUE 制約 `(provider, session_key, month, project_key, observed_at)` は、`observed_at` が全行NULLであるために衝突せず、偶然正しく動いている。SQLiteはNULL同士を重複と見なさないためである。日時を入れた瞬間に `INSERT OR REPLACE` で同時刻のメッセージが潰れ、トークンが失われる。セッション単位のキーへ作り直す。

生のセッションIDと絶対パスは別テーブルへ隔離する。エクスポート経路がスキーマ上そこへ到達しないようにするためである。

**Files:**
- Modify: `src/server/database.ts`
- Test: `tests/server/database.test.ts`

**Interfaces:**
- Consumes: `UsageSession` (Task 3)
- Produces: `replaceProviderSessions(provider, sessions, diagnostics, options)`、`getUsageSessions(): UsageSessionRow[]`、`getSessionReference(provider, sessionKey)`

- [ ] **Step 1: 失敗するテストを書く**

`tests/server/database.test.ts` へ追加する。既存の一時ディレクトリ設定パターンに合わせること（ファイル冒頭を読んで確認する）。

```ts
  it('同じセッションを二重に保存しない', () => {
    replaceProviderSessions('claude', [session(), session()], diagnostics)
    expect(getUsageSessions()).toHaveLength(1)
  })

  it('再スキャンで置き換えてもトークンが失われない', () => {
    replaceProviderSessions('claude', [session({ inputTokens: 100 })], diagnostics)
    replaceProviderSessions('claude', [session({ inputTokens: 250 })], diagnostics)
    const rows = getUsageSessions()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.inputTokens).toBe(250)
  })

  it('生参照はopt-inしたときだけ保存する', () => {
    replaceProviderSessions('claude', [session()], diagnostics)
    expect(getSessionReference('claude', 'session_a')).toBeUndefined()

    replaceProviderSessions('claude', [session({
      localReference: {
        nativeSessionId: 'native-1',
        sourcePath: '/tmp/a.jsonl',
        workingDirectory: '/tmp/work',
      },
    })], diagnostics)
    expect(getSessionReference('claude', 'session_a')).toMatchObject({
      nativeSessionId: 'native-1',
      workingDirectory: '/tmp/work',
    })
  })

  it('セッション行に開始日時と終了日時を保持する', () => {
    replaceProviderSessions('claude', [session()], diagnostics)
    const row = getUsageSessions()[0]
    expect(row?.startedAt).toBe('2026-07-15T10:00:00.000Z')
    expect(row?.endedAt).toBe('2026-07-15T11:00:00.000Z')
  })
```

ヘルパーを同ファイルに置く。

```ts
const diagnostics = { filesSeen: 1, malformedLines: 0 }

function session(overrides: Partial<UsageSession> = {}): UsageSession {
  return {
    provider: 'claude',
    sessionKey: 'session_a',
    projectKey: 'project_a',
    month: '2026-07',
    startedAt: '2026-07-15T10:00:00.000Z',
    endedAt: '2026-07-15T11:00:00.000Z',
    messageCount: 2,
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    schemaVersion: 'test-v1',
    confidence: 'medium',
    ...overrides,
  }
}
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run tests/server/database.test.ts`
Expected: FAIL。`replaceProviderSessions` が存在しない。

- [ ] **Step 3: スキーマを書き換える**

`src/server/database.ts` の `CREATE TABLE usage_events` を差し替える。

```sql
    CREATE TABLE IF NOT EXISTS usage_events (
      id INTEGER PRIMARY KEY,
      provider TEXT NOT NULL,
      session_key TEXT NOT NULL,
      project_key TEXT NOT NULL,
      month TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      message_count INTEGER NOT NULL,
      project_label TEXT,
      model TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      schema_version TEXT NOT NULL,
      confidence TEXT NOT NULL,
      UNIQUE(provider, session_key, project_key, month)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS usage_events_month_provider
      ON usage_events(month, provider);
    CREATE INDEX IF NOT EXISTS usage_events_project
      ON usage_events(project_key);

    CREATE TABLE IF NOT EXISTS session_references (
      provider TEXT NOT NULL,
      session_key TEXT NOT NULL,
      native_session_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      working_directory TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      PRIMARY KEY(provider, session_key)
    ) STRICT;
```

`content_hash` `byte_size` `file_mtime` はフェーズ3で追加する。ここで NOT NULL の列を作ると、ハッシュ計算を実装するまでスキャンが失敗するためである。

`scans` テーブルにも判定タイムゾーンを足す。後から「どの暦で月を切ったか」を説明できるようにするためで、PCを移動した場合の差異にも気づける。

```sql
    CREATE TABLE IF NOT EXISTS scans (
      id INTEGER PRIMARY KEY,
      provider TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      files_seen INTEGER NOT NULL DEFAULT 0,
      events_written INTEGER NOT NULL DEFAULT 0,
      malformed_lines INTEGER NOT NULL DEFAULT 0,
      time_zone TEXT,
      status TEXT NOT NULL
    ) STRICT;
```

旧スキーマからの移行は行わない。v0.1.0 は未公開で、既存DBを持つのは開発者だけである。起動時に旧形式を検出したら作り直す。次のコードを、`database.exec` のスキーマ定義ブロックより後、`return database` の前に置く。`CREATE TABLE IF NOT EXISTS` は既存テーブルがあると何もしないため、DROPしてから作り直す必要がある。

```ts
const USAGE_EVENTS_SCHEMA = `
  CREATE TABLE usage_events (
    id INTEGER PRIMARY KEY,
    provider TEXT NOT NULL,
    session_key TEXT NOT NULL,
    project_key TEXT NOT NULL,
    month TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    message_count INTEGER NOT NULL,
    project_label TEXT,
    model TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    schema_version TEXT NOT NULL,
    confidence TEXT NOT NULL,
    UNIQUE(provider, session_key, project_key, month)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS usage_events_month_provider ON usage_events(month, provider);
  CREATE INDEX IF NOT EXISTS usage_events_project ON usage_events(project_key);
`
```

上のスキーマ定義ブロックでは `CREATE TABLE IF NOT EXISTS usage_events (...)` として同じ列を書き、この定数は作り直し専用に使う。二重定義を避けたい場合は、定数側を `IF NOT EXISTS` 付きにしてスキーマ定義ブロックからも参照する形にしてよい。

```ts
  const usageColumns = new Set(
    (database.prepare(`PRAGMA table_info(usage_events)`).all() as Array<{ name: string }>)
      .map((column) => column.name),
  )
  if (usageColumns.size > 0 && !usageColumns.has('started_at')) {
    database.exec('DROP TABLE usage_events')
    database.exec(USAGE_EVENTS_SCHEMA)
  }

  const scanColumns = new Set(
    (database.prepare(`PRAGMA table_info(scans)`).all() as Array<{ name: string }>)
      .map((column) => column.name),
  )
  if (!scanColumns.has('time_zone')) {
    database.exec('ALTER TABLE scans ADD COLUMN time_zone TEXT')
  }
```

`scans` は `ALTER TABLE` で足せる。既存の走査履歴は残す価値があるためである。`usage_events` は列構成が大きく変わるうえ、再スキャンで復元できるので作り直す。

- [ ] **Step 4: 保存関数を書き換える**

`replaceProviderEvents` を `replaceProviderSessions` へ置き換える。

```ts
import { resolvedTimeZone } from '../adapters/localTime.ts'
import type { UsageProvider } from '../adapters/types.ts'
import type { UsageSession } from './sessionAggregation.ts'

export function replaceProviderSessions(
  provider: UsageProvider,
  sessions: UsageSession[],
  diagnostics: { filesSeen: number; malformedLines: number },
): void {
  const db = getDatabase()
  const insertScan = db.prepare(`
    INSERT INTO scans(provider, started_at, time_zone, status)
    VALUES (?, ?, ?, 'running')
  `)
  const scanResult = insertScan.run(provider, new Date().toISOString(), resolvedTimeZone())
  const scanId = Number(scanResult.lastInsertRowid)

  const insertSession = db.prepare(`
    INSERT INTO usage_events(
      provider, session_key, project_key, month, started_at, ended_at,
      message_count, project_label, model, input_tokens, output_tokens,
      cache_read_tokens, cache_write_tokens, schema_version, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, session_key, project_key, month) DO UPDATE SET
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      message_count = excluded.message_count,
      project_label = excluded.project_label,
      model = excluded.model,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      cache_read_tokens = excluded.cache_read_tokens,
      cache_write_tokens = excluded.cache_write_tokens,
      schema_version = excluded.schema_version,
      confidence = excluded.confidence
  `)
  const insertReference = db.prepare(`
    INSERT INTO session_references(
      provider, session_key, native_session_id, source_path,
      working_directory, captured_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, session_key) DO UPDATE SET
      native_session_id = excluded.native_session_id,
      source_path = excluded.source_path,
      working_directory = excluded.working_directory,
      captured_at = excluded.captured_at
  `)
  const capturedAt = new Date().toISOString()

  try {
    db.exec('BEGIN IMMEDIATE')
    db.prepare('DELETE FROM usage_events WHERE provider = ?').run(provider)
    db.prepare('DELETE FROM session_references WHERE provider = ?').run(provider)
    for (const item of sessions) {
      insertSession.run(
        item.provider, item.sessionKey, item.projectKey, item.month,
        item.startedAt, item.endedAt, item.messageCount,
        item.projectLabel ?? null, item.model ?? null,
        item.inputTokens, item.outputTokens,
        item.cacheReadTokens, item.cacheWriteTokens,
        item.schemaVersion, item.confidence,
      )
      if (item.localReference) {
        insertReference.run(
          item.provider, item.sessionKey,
          item.localReference.nativeSessionId,
          item.localReference.sourcePath,
          item.localReference.workingDirectory,
          capturedAt,
        )
      }
    }
    db.exec('COMMIT')
    db.prepare(`
      UPDATE scans
      SET completed_at = ?, files_seen = ?, events_written = ?,
          malformed_lines = ?, status = 'complete'
      WHERE id = ?
    `).run(
      new Date().toISOString(),
      diagnostics.filesSeen,
      sessions.length,
      diagnostics.malformedLines,
      scanId,
    )
  } catch (error) {
    db.exec('ROLLBACK')
    db.prepare(`
      UPDATE scans SET completed_at = ?, status = 'failed' WHERE id = ?
    `).run(new Date().toISOString(), scanId)
    throw error
  }
}
```

`INSERT OR REPLACE` ではなく `ON CONFLICT ... DO UPDATE` を使う。前者は行を削除して挿入し直すため rowid が変わり、`ORDER BY rowid` に依存する箇所の順序が壊れる。

- [ ] **Step 5: 読み出し関数を書き換える**

`getProjectUsage` を `getUsageSessions` へ置き換える。`ProjectUsageRow` 型も差し替える。

```ts
export type UsageSessionRow = {
  provider: UsageProvider
  sessionKey: string
  projectKey: string
  month: string
  startedAt: string
  endedAt: string
  messageCount: number
  projectLabel: string | null
  model: string | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export function getUsageSessions(): UsageSessionRow[] {
  return getDatabase().prepare(`
    SELECT provider, session_key AS sessionKey, project_key AS projectKey,
           month, started_at AS startedAt, ended_at AS endedAt,
           message_count AS messageCount, project_label AS projectLabel, model,
           input_tokens AS inputTokens, output_tokens AS outputTokens,
           cache_read_tokens AS cacheReadTokens, cache_write_tokens AS cacheWriteTokens
    FROM usage_events
    ORDER BY month, provider, project_key, started_at
  `).all() as UsageSessionRow[]
}

export type SessionReferenceRow = {
  nativeSessionId: string
  sourcePath: string
  workingDirectory: string
  capturedAt: string
}

export function getSessionReference(
  provider: UsageProvider,
  sessionKey: string,
): SessionReferenceRow | undefined {
  return getDatabase().prepare(`
    SELECT native_session_id AS nativeSessionId, source_path AS sourcePath,
           working_directory AS workingDirectory, captured_at AS capturedAt
    FROM session_references WHERE provider = ? AND session_key = ?
  `).get(provider, sessionKey) as SessionReferenceRow | undefined
}
```

`getUsageOverview` の `sessions` 列も直す。現在は `COUNT(DISTINCT session_key)` を provider×month ごとに数えて合計しており、月をまたぐセッションを二重に数えている（M3）。

```ts
  const providers = db.prepare(`
    SELECT provider, month,
           COUNT(*) AS sessions,
           COUNT(DISTINCT project_key) AS projects,
           SUM(input_tokens) AS inputTokens,
           SUM(output_tokens) AS outputTokens,
           SUM(cache_read_tokens) AS cacheReadTokens,
           SUM(cache_write_tokens) AS cacheWriteTokens,
           MIN(started_at) AS firstObservedAt,
           MAX(ended_at) AS lastObservedAt
    FROM usage_events
    GROUP BY provider, month
    ORDER BY month, provider
  `).all() as UsageOverview['providers']
```

セッション行は `(provider, session_key, project_key, month)` で一意なので、`COUNT(*)` は「その月のセッション×プロジェクトの組数」になる。1セッションが複数プロジェクトにまたがる場合は複数回数えるが、これは意図した挙動である。表示上は「利用記録の件数」であり、セッション数そのものではない。

- [ ] **Step 6: テストが通ることを確認する**

Run: `npx vitest run tests/server/database.test.ts`
Expected: PASS

- [ ] **Step 7: コミット**

```bash
git add src/server/database.ts tests/server/database.test.ts
git commit -m "feat: store usage as session rows and isolate local references

The old UNIQUE key only worked because observed_at was always NULL.
Session-level keys make it meaningful, and raw identifiers now live in a
separate table that export paths never touch."
```

---

## Task 6: セッション割当の解決

> 実行順の注意: この課題は「ルールの制作物を任意にする」課題（この文書では Task 6 として記述）より **後** に実行する。`taxUnitId` が任意でないと本タスクのテストが型エラーになるためである。実行順は 1, 2, 3, 4, 「ルールの任意化」, 「セッション割当の解決」, 7, 8 とする。

`resolveMonthlyProjectMapping` は「月全体を1つのルールが覆う場合だけ採用」する。外れた月は丸ごと未分類へ落ちる。セッションの発生日時で解決すれば、月の途中の切替も表現できる。

**Files:**
- Create: `src/server/sessionAssignment.ts`
- Test: `tests/server/sessionAssignment.test.ts`
- Delete: `tests/server/dashboardPlanningRules.test.ts`

**Interfaces:**
- Consumes: `localDateFromTimestamp` (Task 1)、`ProjectRuleRecord` (Task 6 で `taxUnitId` が任意化される)
- Produces: 型 `SessionAssignment`、関数 `resolveSessionAssignment(session, rules): SessionAssignment`

- [ ] **Step 1: 失敗するテストを書く**

`tests/server/sessionAssignment.test.ts` を作る。

```ts
import { describe, expect, it } from 'vitest'
import type { ProjectRuleRecord } from '../../src/planning/types.js'
import { resolveSessionAssignment } from '../../src/server/sessionAssignment.ts'

const session = {
  projectKey: 'project_a',
  provider: 'codex' as const,
  startedAt: '2026-07-15T03:00:00.000Z',
}

function rule(overrides: Partial<ProjectRuleRecord> = {}): ProjectRuleRecord {
  return {
    id: 'rule-1',
    projectKey: 'project_a',
    effectiveFrom: '2026-07-01',
    taxUnitId: 'tax-unit-a',
    classification: 'new-development',
    ...overrides,
  }
}

describe('resolveSessionAssignment', () => {
  it('ルールがなければ未割当を返す', () => {
    expect(resolveSessionAssignment(session, [], 'Asia/Tokyo')).toEqual({
      taxUnitId: null,
      classification: 'unclassified',
      ruleId: null,
    })
  })

  it('期間内の単一ルールを採用する', () => {
    expect(resolveSessionAssignment(session, [rule()], 'Asia/Tokyo')).toEqual({
      taxUnitId: 'tax-unit-a',
      classification: 'new-development',
      ruleId: 'rule-1',
    })
  })

  it('月の途中で切り替わるルールをセッション単位で振り分ける', () => {
    const rules = [
      rule({ id: 'rule-early', effectiveFrom: '2026-07-01', effectiveTo: '2026-07-14' }),
      rule({ id: 'rule-late', effectiveFrom: '2026-07-15', classification: 'maintenance' }),
    ]

    expect(resolveSessionAssignment(session, rules, 'Asia/Tokyo').ruleId).toBe('rule-late')
    expect(resolveSessionAssignment(
      { ...session, startedAt: '2026-07-10T03:00:00.000Z' }, rules, 'Asia/Tokyo',
    ).ruleId).toBe('rule-early')
  })

  it('開始日当日と終了日当日を期間に含める', () => {
    const rules = [rule({ effectiveFrom: '2026-07-15', effectiveTo: '2026-07-15' })]
    expect(resolveSessionAssignment(session, rules, 'Asia/Tokyo').ruleId).toBe('rule-1')
  })

  it('期間外のルールは採用しない', () => {
    const rules = [rule({ effectiveFrom: '2026-07-16' })]
    expect(resolveSessionAssignment(session, rules, 'Asia/Tokyo').taxUnitId).toBeNull()
  })

  it('projectKeyが違うルールは無視する', () => {
    const rules = [rule({ projectKey: 'project_b' })]
    expect(resolveSessionAssignment(session, rules, 'Asia/Tokyo').taxUnitId).toBeNull()
  })

  it('provider指定が合わないルールは無視する', () => {
    const rules = [rule({ provider: 'claude' })]
    expect(resolveSessionAssignment(session, rules, 'Asia/Tokyo').taxUnitId).toBeNull()
  })

  it('provider指定のあるルールを優先する', () => {
    const rules = [
      rule({ id: 'rule-any' }),
      rule({ id: 'rule-codex', provider: 'codex', classification: 'maintenance' }),
    ]
    expect(resolveSessionAssignment(session, rules, 'Asia/Tokyo').ruleId).toBe('rule-codex')
  })

  it('同じ具体度ならeffectiveFromが新しい方を優先する', () => {
    const rules = [
      rule({ id: 'rule-old', effectiveFrom: '2026-07-01' }),
      rule({ id: 'rule-new', effectiveFrom: '2026-07-10' }),
    ]
    expect(resolveSessionAssignment(session, rules, 'Asia/Tokyo').ruleId).toBe('rule-new')
  })

  it('effectiveFromも同じならid昇順で決定的に選ぶ', () => {
    const rules = [
      rule({ id: 'rule-b' }),
      rule({ id: 'rule-a' }),
    ]
    expect(resolveSessionAssignment(session, rules, 'Asia/Tokyo').ruleId).toBe('rule-a')
  })

  it('taxUnitIdのないルールは分類だけを返す', () => {
    const rules = [rule({ taxUnitId: undefined, classification: 'private' })]
    expect(resolveSessionAssignment(session, rules, 'Asia/Tokyo')).toEqual({
      taxUnitId: null,
      classification: 'private',
      ruleId: 'rule-1',
    })
  })

  it('タイムゾーンで日付が変わる境界を正しく扱う', () => {
    const lateNight = { ...session, startedAt: '2026-07-14T23:00:00.000Z' }
    const rules = [rule({ id: 'rule-15th', effectiveFrom: '2026-07-15' })]

    expect(resolveSessionAssignment(lateNight, rules, 'Asia/Tokyo').ruleId).toBe('rule-15th')
    expect(resolveSessionAssignment(lateNight, rules, 'UTC').taxUnitId).toBeNull()
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run tests/server/sessionAssignment.test.ts`
Expected: FAIL。モジュールが存在しない。

- [ ] **Step 3: 実装を書く**

`src/server/sessionAssignment.ts` を作る。

```ts
import { localDateFromTimestamp, resolvedTimeZone } from '../adapters/localTime.ts'
import type { UsageProvider } from '../adapters/types.ts'
import type { ProjectRuleRecord } from '../planning/types.js'

export type SessionAssignment = {
  taxUnitId: string | null
  classification: ProjectRuleRecord['classification']
  ruleId: string | null
}

const unassigned: SessionAssignment = {
  taxUnitId: null,
  classification: 'unclassified',
  ruleId: null,
}

/**
 * Picks the rule in effect when the session started. Overlapping rules are
 * resolved deterministically so the same input always yields the same
 * allocation: a provider-specific rule wins, then the later start date, then
 * the lexicographically smaller id.
 */
export function resolveSessionAssignment(
  session: { projectKey: string; provider: UsageProvider; startedAt: string },
  rules: ProjectRuleRecord[],
  timeZone: string = resolvedTimeZone(),
): SessionAssignment {
  const day = localDateFromTimestamp(session.startedAt, timeZone)
  if (!day) return unassigned

  const candidates = rules.filter((rule) =>
    rule.projectKey === session.projectKey &&
    (!rule.provider || rule.provider === session.provider) &&
    rule.effectiveFrom <= day &&
    (!rule.effectiveTo || rule.effectiveTo >= day),
  )
  if (candidates.length === 0) return unassigned

  const [winner] = candidates.sort((left, right) => {
    const specificity = Number(Boolean(right.provider)) - Number(Boolean(left.provider))
    if (specificity !== 0) return specificity
    if (left.effectiveFrom !== right.effectiveFrom) {
      return left.effectiveFrom < right.effectiveFrom ? 1 : -1
    }
    return left.id < right.id ? -1 : 1
  })

  return {
    taxUnitId: winner!.taxUnitId ?? null,
    classification: winner!.classification,
    ruleId: winner!.id,
  }
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run tests/server/sessionAssignment.test.ts`
Expected: PASS（12件）

- [ ] **Step 5: 旧テストを削除する**

```bash
git rm tests/server/dashboardPlanningRules.test.ts
```

月単位解決の仕様そのものを捨てるため、テストも移植せず削除する。旧テストが確認していた「月途中のルールを誤分類しない」という性質は、新テストの「月の途中で切り替わるルールをセッション単位で振り分ける」が置き換える。

- [ ] **Step 6: コミット**

```bash
git add src/server/sessionAssignment.ts tests/server/sessionAssignment.test.ts
git commit -m "feat: resolve rules per session instead of per month

Monthly resolution dropped any folder whose rule changed mid-month into
unclassified. Session timestamps make the switch representable."
```

---

## Task 6: ルールの制作物を任意にし一般学習を追加

「私用」「一般学習」は資産を形成しない。ダミーの制作物を作らせないよう `taxUnitId` を任意にする。`general-learning` は `src/core/types.ts` の `WorkPurpose` に既にあるのに、ルール側の enum になかった。

**Files:**
- Modify: `src/planning/types.ts:54-63`
- Modify: `src/server/planningRepository.ts:49-60`（`projectRuleSchema`）
- Modify: `src/server/planningRepository.ts`（`getPlanningSnapshot` と `savePlanningSnapshot` のSQL）
- Modify: `src/server/database.ts`（`planning_project_rules` の `tax_unit_id`）
- Modify: `src/client/types.ts:85-90`（`ProjectClassification`）
- Test: `tests/server/planningRepository.test.ts`

**Interfaces:**
- Produces: `ProjectRuleRecord.taxUnitId?: string`、`ProjectClassification` に `'general-learning'` を追加

- [ ] **Step 1: 失敗するテストを書く**

`tests/server/planningRepository.test.ts` へ追加する。

```ts
  it('制作物を指定しないルールを保存できる', () => {
    const snapshot = {
      ...emptyPlanningSnapshot(2026),
      projectRules: [{
        id: 'rule-private',
        projectKey: 'project_private_0001',
        effectiveFrom: '2026-01-01',
        classification: 'private' as const,
      }],
    }

    savePlanningSnapshot(snapshot, db)
    const stored = getPlanningSnapshot(db)
    expect(stored.projectRules[0]?.taxUnitId).toBeUndefined()
    expect(stored.projectRules[0]?.classification).toBe('private')
  })

  it('一般学習の分類を保存できる', () => {
    const snapshot = {
      ...emptyPlanningSnapshot(2026),
      projectRules: [{
        id: 'rule-learning',
        projectKey: 'project_learning_001',
        effectiveFrom: '2026-01-01',
        classification: 'general-learning' as const,
      }],
    }

    savePlanningSnapshot(snapshot, db)
    expect(getPlanningSnapshot(db).projectRules[0]?.classification).toBe('general-learning')
  })
```

既存テストのDB初期化パターン（`db` 変数の作り方）はファイル冒頭を読んで合わせること。

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run tests/server/planningRepository.test.ts`
Expected: FAIL。zodが `taxUnitId` を必須として拒否する。

- [ ] **Step 3: 型を変える**

`src/planning/types.ts` の `ProjectRuleRecord`。

```ts
export type ProjectClassification =
  | 'new-development'
  | 'maintenance'
  | 'feature-addition'
  | 'general-learning'
  | 'private'
  | 'unclassified'

export type ProjectRuleRecord = {
  id: string
  projectKey: string
  provider?: 'claude' | 'codex'
  effectiveFrom: string
  effectiveTo?: string
  taxUnitId?: string
  classification: ProjectClassification
  reason?: string
}
```

`src/client/types.ts` の `ProjectClassification` にも `'general-learning'` を追加する。2箇所に同じ union があるのは既存の重複だが、本タスクでは統合しない。クライアントとサーバの型境界を変える作業は別の関心事である。

- [ ] **Step 4: zodスキーマとSQLを変える**

`src/server/planningRepository.ts` の `projectRuleSchema`。

```ts
const projectRuleSchema = z.object({
  id: identifier,
  projectKey: z.string().trim().min(8).max(120),
  provider: z.enum(['claude', 'codex']).optional(),
  effectiveFrom: date,
  effectiveTo: date.optional(),
  taxUnitId: identifier.optional(),
  classification: z.enum([
    'new-development', 'maintenance', 'feature-addition',
    'general-learning', 'private', 'unclassified',
  ]),
  reason: z.string().trim().max(1_000).optional(),
})
```

`getPlanningSnapshot` の `projectRules` の map に `taxUnitId` の null 変換を足す。

```ts
      })).map((row) => ({
        ...row,
        provider: optional(row.provider as string | null),
        effectiveTo: optional(row.effectiveTo as string | null),
        taxUnitId: optional(row.taxUnitId as string | null),
        reason: optional(row.reason as string | null),
      })),
```

`savePlanningSnapshot` の insert を `item.taxUnitId ?? null` にする。

```ts
    for (const item of parsed.projectRules) projectRule.run(item.id, item.projectKey,
      item.provider ?? null, item.effectiveFrom, item.effectiveTo ?? null,
      item.taxUnitId ?? null, item.classification, item.reason ?? null)
```

`src/server/database.ts` の `planning_project_rules` から `NOT NULL` を外す。

```sql
      tax_unit_id TEXT REFERENCES planning_tax_units(id),
```

既存DBには `NOT NULL` 付きで作られたテーブルがあるため、Task 4 と同じ方式で作り直す。`PRAGMA table_info(planning_project_rules)` の `notnull` が1なら DROP して作り直す。ルールは再入力可能な設定情報であり、未公開版では失っても問題ない。

- [ ] **Step 5: 参照整合性チェックを直す**

`planningSnapshotSchema` の `superRefine` にある `withTaxUnit` ループは、`record.taxUnitId` が falsy なら検査を飛ばす作りになっているため変更不要。ただし `projectRules` が含まれていることを確認し、`taxUnitId` が指定されている場合だけ存在検査が走ることをテストで確かめる。

```ts
  it('存在しない制作物を指すルールは拒否する', () => {
    const snapshot = {
      ...emptyPlanningSnapshot(2026),
      projectRules: [{
        id: 'rule-orphan',
        projectKey: 'project_orphan_0001',
        effectiveFrom: '2026-01-01',
        taxUnitId: 'missing-unit',
        classification: 'new-development' as const,
      }],
    }
    expect(() => savePlanningSnapshot(snapshot, db)).toThrow()
  })
```

- [ ] **Step 6: テストが通ることを確認する**

Run: `npx vitest run tests/server/planningRepository.test.ts && npm run typecheck`
Expected: テストは PASS。`typecheck` は `src/server/dashboard.ts` でエラーが残る（Task 7 で直す）。

- [ ] **Step 7: コミット**

```bash
git add src/planning/types.ts src/client/types.ts src/server/planningRepository.ts src/server/database.ts tests/server/planningRepository.test.ts
git commit -m "feat: allow rules without a tax unit and add general learning

Private use and general learning do not form an asset, so they must not
require a dummy product to be created first."
```

---

## Task 7: ダッシュボード集計のセッション単位化

`buildDashboard` を `getUsageSessions` ベースへ書き換える。あわせて `allocatedRate` の指標名を直す（B4）。現在は「マッピングが解決できた行の割合」を「配賦済み」と表示しており、分類が `unclassified` でも100%になる。実測では「配賦済み100%」と「対象外・要確認100%」が同時に表示された。

**Files:**
- Modify: `src/server/dashboard.ts`
- Modify: `src/client/types.ts`（`DashboardData.meta`）
- Modify: `src/App.tsx:536`（表示ラベル）
- Test: `tests/server/server.integration.test.ts`

**Interfaces:**
- Consumes: `getUsageSessions` (Task 4)、`resolveSessionAssignment` (Task 5)
- Produces: `DashboardData.meta.mappedRate`（対応付け済みの割合）、`DashboardData.meta.classifiedRate`（分類が確定した割合）

- [ ] **Step 1: 失敗するテストを書く**

`tests/server/server.integration.test.ts` へ追加する。既存のサーバ起動ヘルパーとリクエスト関数の名前は、ファイル冒頭を読んで合わせること。

```ts
  it('ルールがなければ分類済みは0%、対応付け済みも0%になる', async () => {
    replaceProviderSessions('claude', [{
      provider: 'claude',
      sessionKey: 'session_integration_a',
      projectKey: 'project_integration_a',
      month: '2026-07',
      startedAt: '2026-07-15T10:00:00.000Z',
      endedAt: '2026-07-15T11:00:00.000Z',
      messageCount: 3,
      inputTokens: 1000,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      schemaVersion: 'test-v1',
      confidence: 'medium',
    }], { filesSeen: 1, malformedLines: 0 })

    const dashboard = await getJson('/api/dashboard')
    expect(dashboard.meta.classifiedRate).toBe(0)
    expect(dashboard.meta.mappedRate).toBe(0)
  })

  it('ルールを登録すると分類済みが上がる', async () => {
    savePlanningSnapshot({
      ...emptyPlanningSnapshot(2026),
      taxUnits: [{
        id: 'tax-unit-integration',
        name: '統合テスト用アプリ',
        unitType: 'new-software',
        usageMode: 'external',
        revenueModel: 'sales',
        lifecycleStatus: 'developing',
      }],
      projectRules: [{
        id: 'rule-integration',
        projectKey: 'project_integration_a',
        effectiveFrom: '2026-07-01',
        taxUnitId: 'tax-unit-integration',
        classification: 'new-development',
      }],
    })

    const dashboard = await getJson('/api/dashboard')
    expect(dashboard.meta.classifiedRate).toBe(100)
    expect(dashboard.allocations.some(
      (row: { product: string }) => row.product === '統合テスト用アプリ',
    )).toBe(true)
  })
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run tests/server/server.integration.test.ts`
Expected: FAIL。`classifiedRate` が存在しない。

- [ ] **Step 3: `buildDashboard` を書き換える**

`resolveMonthlyProjectMapping` と `ResolvedProjectMapping` を削除し、次の形にする。

```ts
import { resolveSessionAssignment, type SessionAssignment } from './sessionAssignment.js'
import { getUsageSessions, type UsageSessionRow } from './database.js'

type AssignedSession = UsageSessionRow & { assignment: SessionAssignment }

type ProjectMonthGroup = {
  provider: 'claude' | 'codex'
  month: string
  projectKey: string
  taxUnitId: string | null
  classification: ProjectClassification
  projectLabel: string | null
  model: string | null
  sessions: number
  messageCount: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  firstStartedAt: string
  lastEndedAt: string
}
```

集計は次の順に行う。

```ts
export function buildDashboard(): DashboardData {
  const sessions = getUsageSessions()
  const overview = getUsageOverview()
  const configuration = getConfiguration()
  const planning = getPlanningSnapshot()
  const taxUnitById = new Map(planning.taxUnits.map((unit) => [unit.id, unit]))

  const assigned: AssignedSession[] = sessions.map((session) => ({
    ...session,
    assignment: resolveSessionAssignment(session, planning.projectRules),
  }))

  const groups = new Map<string, ProjectMonthGroup>()
  for (const session of assigned) {
    const key = [
      session.provider, session.month, session.projectKey,
      session.assignment.taxUnitId ?? '', session.assignment.classification,
    ].join(':')
    const current = groups.get(key)
    if (!current) {
      groups.set(key, {
        provider: session.provider,
        month: session.month,
        projectKey: session.projectKey,
        taxUnitId: session.assignment.taxUnitId,
        classification: session.assignment.classification,
        projectLabel: session.projectLabel,
        model: session.model,
        sessions: 1,
        messageCount: session.messageCount,
        inputTokens: session.inputTokens,
        outputTokens: session.outputTokens,
        cacheReadTokens: session.cacheReadTokens,
        cacheWriteTokens: session.cacheWriteTokens,
        firstStartedAt: session.startedAt,
        lastEndedAt: session.endedAt,
      })
      continue
    }
    current.sessions += 1
    current.messageCount += session.messageCount
    current.inputTokens += session.inputTokens
    current.outputTokens += session.outputTokens
    current.cacheReadTokens += session.cacheReadTokens
    current.cacheWriteTokens += session.cacheWriteTokens
    current.projectLabel ??= session.projectLabel
    current.model ??= session.model
    if (session.startedAt < current.firstStartedAt) current.firstStartedAt = session.startedAt
    if (session.endedAt > current.lastEndedAt) current.lastEndedAt = session.endedAt
  }
```

配賦への受け渡しは、既存の `grouped` / `rowBySource` を `groups` へ差し替える形で書く。

```ts
  const groupById = new Map([...groups.values()].map((group) => [groupKey(group), group]))
  const byProviderMonth = new Map<string, ProjectMonthGroup[]>()
  for (const group of groups.values()) {
    const key = `${group.provider}:${group.month}`
    byProviderMonth.set(key, [...(byProviderMonth.get(key) ?? []), group])
  }

  const monthlyChargeByKey = new Map(
    configuration.monthlyCharges.map((charge) => [
      `${charge.provider}:${charge.month}`,
      charge.amountJpy,
    ]),
  )
  const providerMonthKeys = new Set([
    ...byProviderMonth.keys(),
    ...monthlyChargeByKey.keys(),
  ])

  const inputs = [...providerMonthKeys].sort().map((key) => {
    const [provider, month] = key.split(':') as ['claude' | 'codex', string]
    return {
      provider,
      billingMonth: month as BillingMonth,
      monthlyFeeJpy: monthlyChargeByKey.get(key) ?? configuration.charges[provider],
      unobservedUsage: {
        kind: 'estimated' as const,
        ratio: configuration.unobservedRatio,
      },
      usageLines: (byProviderMonth.get(key) ?? []).map((group) => ({
        id: groupKey(group),
        productId: group.projectKey,
        taxUnitId: group.taxUnitId ?? undefined,
        bucket: group.classification === 'private' || group.classification === 'general-learning'
          ? 'private' as const
          : 'product' as const,
        usageWeight: calculateWeightedTokenUsage({
          inputTokens: group.inputTokens,
          cachedInputTokens: group.cacheReadTokens,
          cacheCreationTokens: group.cacheWriteTokens,
          outputTokens: group.outputTokens,
        }),
      })),
    }
  })

  const allocations: Allocation[] = []
  for (const result of allocateSubscriptions(inputs)) {
    for (const line of result.lines) {
      if (line.kind === 'rounding-adjustment' && line.allocatedAmountJpy === 0) continue
      if (line.kind === 'unobserved' || line.kind === 'rounding-adjustment') {
        allocations.push(unobservedAllocation(result.provider, result.billingMonth, line))
        continue
      }
      const group = line.sourceId ? groupById.get(line.sourceId) : undefined
      if (!group) continue
      allocations.push(allocationForGroup(group, line, taxUnitById))
    }
  }
```

`groupKey` は集約で使ったキー生成をそのまま関数に切り出す。

```ts
function groupKey(group: ProjectMonthGroup): string {
  return [
    group.provider, group.month, group.projectKey,
    group.taxUnitId ?? '', group.classification,
  ].join(':')
}
```

`allocationForProject` を `allocationForGroup` へ置き換える。`ResolvedProjectMapping` に依存していた部分を `ProjectMonthGroup` と `taxUnitById` へ差し替える。

```ts
function allocationForGroup(
  group: ProjectMonthGroup,
  line: AllocationLine,
  taxUnitById: Map<string, TaxUnitRecord>,
): Allocation {
  const view = classificationView[group.classification]
  const taxUnit = group.taxUnitId ? taxUnitById.get(group.taxUnitId) : undefined
  const product = taxUnit?.name
    ?? safeLocalLabel(group.projectLabel, `Project ${group.projectKey.slice(-6)}`)
  return {
    id: groupKey(group),
    month: displayBillingMonth(group.month),
    provider: providerLabel[group.provider],
    product,
    asset: taxUnit?.name ?? '要確認',
    stage: view.stage,
    usageRate: Math.round(line.allocationRatio * 1000) / 10,
    amount: line.allocatedAmountJpy,
    group: view.group,
    taxCandidate: view.candidate,
    confidence: taxUnit ? 'B' : 'C',
    rule: view.rule,
    reason: view.reason,
    missing: taxUnit
      ? '供用状況と証拠を月次確認してください。'
      : 'プロダクト、資産単位、作業目的を選択してください。',
    session: {
      date: `${group.firstStartedAt.slice(0, 10)} 〜 ${group.lastEndedAt.slice(0, 10)}`,
      id: `${group.provider === 'codex' ? 'cdx' : 'cld'}-••••-${group.projectKey.slice(-4)}`,
      folder: safeLocalLabel(group.projectLabel, '名称未取得'),
      branch: '取得対象外',
      model: group.model ?? 'unknown',
      tokens: group.inputTokens + group.outputTokens
        + group.cacheReadTokens + group.cacheWriteTokens,
      classification: taxUnit ? `期間ルール → ${taxUnit.name}` : '未分類',
      manualEdit: `${group.sessions}セッション / ${group.messageCount}メッセージ`,
    },
  }
}
```

`classificationView` に `general-learning` の項目を足す。

```ts
  'general-learning': {
    group: 'review',
    stage: '一般学習',
    candidate: '対象外',
    rule: 'ユーザーが一般学習として登録',
    reason: '特定の制作物へ直接対応しない学習として登録されています。',
  },
```

`projectSummaries` は `groups` ではなく `sessions`（割当前のセッション行）から作る。フォルダ一覧は分類に関係なく1フォルダ1件であるべきだからである。`firstObservedAt` には `startedAt` の最小値、`lastObservedAt` には `endedAt` の最大値を入れる（M2）。

`assets` と `boundaries` の組み立ては変更しない。`allocations` から `group === 'future'` の行を集めるロジックはそのまま動く。

型の import 元は次のとおり。`TaxUnitRecord` と `ProjectClassification` は `../planning/types.js`、`UsageProvider` は `../adapters/types.ts`、`BillingMonth` と `AllocationLine` と `calculateWeightedTokenUsage` は既存どおり `../core/index.js`。

同じ `(provider, month, projectKey)` が異なる分類で複数グループに分かれうる点が、月単位集計との違いである。月の途中でルールが切り替わった場合に、その月のそのフォルダが2行に分かれて表示される。これは意図した挙動であり、「7月前半は新規開発、後半は保守」を金額とともに示せる。

`usageLines` の `id` は `provider:month:projectKey:taxUnitId:classification` を使い、`rowBySource` の代わりに `groups` を引く。

`displayProject` は `taxUnitById.get(group.taxUnitId)?.name` を最優先し、なければ `safeLocalLabel(group.projectLabel, ...)` へ落とす。`ProjectMapping` の `productName` は参照しない（Task 8 で legacy を消すため）。

`bucket` は `classification === 'private' || classification === 'general-learning' ? 'private' : 'product'` とする。一般学習も事業原価へ含めない。

- [ ] **Step 4: 指標を2つに分ける**

```ts
  const classifiedSessions = assigned.filter(
    (session) => session.assignment.classification !== 'unclassified',
  ).length
  const mappedSessions = assigned.filter(
    (session) => session.assignment.ruleId !== null,
  ).length

  return {
    meta: {
      source: 'local',
      sessionCount: overview.providers.reduce((sum, row) => sum + row.sessions, 0),
      lastSynced: ...,
      mappedRate: sessions.length === 0 ? 0 : Math.round(mappedSessions / sessions.length * 100),
      classifiedRate: sessions.length === 0 ? 0 : Math.round(classifiedSessions / sessions.length * 100),
    },
    ...
  }
```

`src/client/types.ts` の `DashboardData.meta` から `allocatedRate` を削除し、`mappedRate` と `classifiedRate` を追加する。

`src/App.tsx:536` の表示を直す。

```tsx
            trailing={<span className="confidence">分類済み {data.meta.classifiedRate}%</span>}
```

`src/client/dashboard.ts` の `demoDashboard.meta` も `allocatedRate: 92` から `mappedRate: 92, classifiedRate: 88` へ変える。デモは分類済みが対応付け済みより少ない状態を見せるべきである。両者が常に一致するデータでは、指標を分けた意味が伝わらない。

`src/App.tsx:145` の自動オンボーディング条件 `data.meta.allocatedRate === 0` も `data.meta.classifiedRate === 0` へ変える。

- [ ] **Step 5: テストが通ることを確認する**

Run: `npm test && npm run typecheck`
Expected: すべて PASS

- [ ] **Step 6: コミット**

```bash
git add src/server/dashboard.ts src/client/types.ts src/client/dashboard.ts src/App.tsx tests/server/server.integration.test.ts
git commit -m "feat: aggregate the dashboard from session assignments

Splits the single allocated rate into mapped and classified rates. The
old metric reported 100 percent while every yen sat in review."
```

---

## Task 8: legacy mappingの廃止と自動集約の削除

プロダクト名の出どころが `project_mappings.productName` と `planning_tax_units.name` の2系統あり、状況によってどちらが使われるか追えない。planning へ一本化する。あわせて、未割当フォルダを1件目の制作物へ紐づけるフォールバック（B1の直接の原因）を削除する。

**Files:**
- Modify: `src/server/database.ts`（`project_mappings` の削除、`LocalConfiguration` から `mappings` を除去）
- Modify: `src/server/index.ts`（`configurationSchema` から `mappings` を除去）
- Modify: `src/client/types.ts`（`LocalConfiguration`、`ProjectMapping`）
- Modify: `src/App.tsx`（`MappingEditor` と `planningWithCurrentRules` のフォールバック）
- Test: `tests/server/planningApi.test.ts`

**Interfaces:**
- Consumes: Task 6 の `ProjectRuleRecord.taxUnitId?`
- Produces: `LocalConfiguration` から `mappings` が消える

- [ ] **Step 1: 移行コードを書く**

`src/server/database.ts` の `getDatabase()` 末尾、`return database` の前に置く。

```ts
  const legacyMappings = database.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_mappings'`,
  ).get() as { name?: string } | undefined
  if (legacyMappings?.name) {
    database.exec(`
      INSERT OR IGNORE INTO planning_project_rules(
        id, project_key, provider, effective_from, effective_to,
        tax_unit_id, classification, reason
      )
      SELECT 'migrated-' || project_key, project_key, NULL, '1970-01-01', NULL,
             NULL, classification, '旧設定から移行'
      FROM project_mappings
    `)
    database.exec('DROP TABLE project_mappings')
  }
```

`tax_unit_id` は NULL で移行する。旧設定の `productName` は制作物ではなく、フォルダに付けた表示名にすぎない。制作物として復元すると、ユーザーが確認していない税務単位を作ることになり、B1と同じ誤りを繰り返す。移行後は分類だけが残り、制作物の割り当ては割当画面（フェーズ2）で行う。

`effective_from` を `1970-01-01` にするのは、旧設定に期間の概念がなく全期間へ適用されていたためである。

- [ ] **Step 2: 失敗するテストを書く**

`tests/server/planningApi.test.ts` へ追加する。

```ts
  it('設定APIはmappingsを受け付けない', async () => {
    const response = await post('/api/config', {
      charges: { claude: 30000, codex: 20000 },
      monthlyCharges: [],
      unobservedRatio: 0.1,
      mappings: [{
        projectKey: 'project_should_be_rejected',
        productName: 'x', assetName: 'y', classification: 'private',
      }],
    })
    expect(response.status).toBe(400)
  })
```

zodの既定は未知キーを除去するだけで拒否しないため、`configurationSchema` に `.strict()` を付ける必要がある。

- [ ] **Step 3: テストが失敗することを確認する**

Run: `npx vitest run tests/server/planningApi.test.ts`
Expected: FAIL。200が返る。

- [ ] **Step 4: サーバ側から mappings を除去する**

`src/server/index.ts` の `configurationSchema` から `mappings` の定義と、`superRefine` 内の `projectKeys` 重複検査を削除し、`.strict()` を付ける。

```ts
const configurationSchema = z.object({
  charges: z.object({
    claude: z.number().int().nonnegative(),
    codex: z.number().int().nonnegative(),
  }),
  monthlyCharges: z.array(z.object({
    provider: z.enum(['claude', 'codex']),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    amountJpy: z.number().int().nonnegative(),
  })).max(240).default([]),
  unobservedRatio: z.number().min(0).max(0.95),
}).strict().superRefine((configuration, context) => {
  const chargeKeys = new Set<string>()
  configuration.monthlyCharges.forEach((charge, index) => {
    const key = `${charge.provider}:${charge.month}`
    if (chargeKeys.has(key)) {
      context.addIssue({
        code: 'custom',
        path: ['monthlyCharges', index],
        message: 'Providerと月の組合せが重複しています。',
      })
    }
    chargeKeys.add(key)
  })
})
```

`src/server/database.ts` の `LocalConfiguration` 型、`getConfiguration`、`saveConfiguration` から `mappings` を除去する。`CREATE TABLE project_mappings` の定義も削除する。

`src/client/types.ts` から `ProjectMapping` 型と `LocalConfiguration.mappings` を削除する。

- [ ] **Step 5: `App.tsx` のフォールバックを削除する**

`planningWithCurrentRules`（`src/App.tsx:1112-1132`）を削除する。`mappings` state、`MappingEditor` コンポーネント、`updateMapping`、`history-rules` の折りたたみブロック（`src/App.tsx:1585-1613`）も削除する。

オンボーディングのステップ3は「制作物を登録する」ことだけを行い、フォルダとの結び付けは行わない。`onSavePlanning(planningWithCurrentRules)` の呼び出しを `onSavePlanning(planningDraft)` へ変える。`saveProgress` も同様。

`addHistoryCandidates` は残す。履歴から制作物の名前候補を作る機能であり、ルールを作るわけではない。ただし `setRuleAssignments` の呼び出しを削除し、`ruleAssignments` state も削除する。

この時点で、ステップ3で登録した制作物にはどのフォルダも紐づかない。配賦はすべて未分類になる。割り当てはフェーズ2の割当画面で行う。フェーズ1完了時点のアプリは「セッション単位で集計し、すべて未分類として表示する」状態になるが、これは意図した中間状態である。従来のように誤った自動集約で埋めるより、未分類と正直に表示するほうが正しい。

- [ ] **Step 6: テストが通ることを確認する**

Run: `npm test && npm run typecheck && npm run build`
Expected: すべて PASS

- [ ] **Step 7: privacy checkを走らせる**

Run: `npm run privacy:check`
Expected: `Privacy check passed.`

- [ ] **Step 8: コミット**

```bash
git add -A
git commit -m "feat: drop legacy project mappings and the auto-assign fallback

Unassigned folders were silently attached to the first product, which
collapsed 57 distinct folders into one tax unit. They now stay
unclassified until the user assigns them."
```

---

## 完了条件

- [ ] `npm test` がすべて通る
- [ ] `npm run typecheck` が通る
- [ ] `npm run build` が通る
- [ ] `npm run privacy:check` が通る
- [ ] 実履歴でスキャンし、`usage_events` の行数がセッション数程度（数千ではなく千程度）になっている
- [ ] 配賦明細に「対応付け済み」と「分類済み」が別の指標として表示される
- [ ] 未割当のフォルダが1件目の制作物へ紐づかない

## フェーズ2へ引き継ぐこと

- 割当画面がないため、フェーズ1完了時点では全セッションが未分類になる
- `session_references` は保存されるが、まだどの画面からも参照されない
- `content_hash` `byte_size` `file_mtime` はフェーズ3で追加する
- B2・I1（料金の未入力と全月一律適用）はフェーズ2以降で扱う
