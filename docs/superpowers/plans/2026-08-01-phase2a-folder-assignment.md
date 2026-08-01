# フェーズ2a: フォルダの割当画面 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 利用者が57個の作業フォルダを制作物と分類へ割り当てられる専用画面を作り、フェーズ1で「未分類」のまま残っている配賦を利用者が確定できるようにする。

**Architecture:** フォルダ一覧はサーバで `usage_events` と `planning_project_rules` から組み立てて返す。割当の保存は planning スナップショット全体ではなくルールだけを置き換える専用エンドポイントで行う（bodyLimit 64 KiB に収めるため）。セッションの内容確認は元JSONLをオンデマンドで読み、DBには書かない。`src/App.tsx` が3030行に達しているため、新画面と既存の Onboarding を別ファイルへ分離する。

**Tech Stack:** TypeScript 6, React 19, Node.js 24 (`node:sqlite` DatabaseSync), Fastify 5, zod 4, vitest 4, Prettier 3

設計: `docs/superpowers/specs/2026-08-01-session-attribution-and-retention-design.md` の6章

## Global Constraints

- Node.js >= 24.14.0
- 絵文字を使わない。ソース、テスト、コミットメッセージ、UI文言のすべてで禁止
- ファイルはUTF-8、改行はLFで書く（`.gitattributes` で強制済み）
- UI文言とテスト名は日本語で書く
- コード整形は Prettier に従う。`npm run format` で整形し、`npm run format:check` が通ること
- テストは合成fixtureと一時ディレクトリだけを使う。実ユーザーの `~/.claude` `~/.codex` を読むテストを書かない
- 生のセッションID、絶対パス、作業ディレクトリは `session_references` テーブルにだけ置く。`usage_events` と、ダッシュボード・台帳・診断・エクスポートのレスポンスへ混ぜない。セッション詳細APIだけが例外で、そこでも利用者の明示的な要求に応じて1件ずつ返す
- 各タスクの完了時に `npm run typecheck`、`npm test`、`npm run format:check` が通ること。`npm run build`、`npm run lint`、`npm run privacy:check` は最終タスクで確認する
- APIのリクエスト本文は64 KiB以内（`src/server/index.ts` の `bodyLimit`）

---

## File Structure

### 新規作成

| ファイル | 責務 |
|---|---|
| `src/server/folders.ts` | セッション行とルールからフォルダ一覧を組み立てる |
| `src/server/sessionPreview.ts` | 元JSONLから「何をしたか」を抽出し、resumeコマンドを組み立てる |
| `src/client/pages/Onboarding.tsx` | 既存の Onboarding を移設（ロジック変更なし） |
| `src/client/pages/FolderAssignmentPage.tsx` | フォルダ割当画面 |
| `src/client/pages/shared.tsx` | ページ間で共有するラベル関数と `PanelHeading` |
| `tests/server/folders.test.ts` | フォルダ一覧集計のテスト |
| `tests/server/sessionPreview.test.ts` | プレビュー抽出とresumeコマンド生成のテスト |

### 変更

| ファイル | 変更内容 |
|---|---|
| `src/App.tsx` | Onboarding と共有部品を移設し、新画面をナビゲーションへ追加 |
| `src/server/index.ts` | `GET /api/folders`、`PUT /api/planning/rules`、`GET /api/sessions`、`GET /api/sessions/detail` を追加 |
| `src/server/database.ts` | `getSessionsForProject` を追加 |
| `src/server/planningRepository.ts` | `replaceProjectRules` を追加 |
| `src/client/api.ts` | 新エンドポイントのクライアント関数 |
| `src/client/types.ts` | `FolderSummary`、`SessionSummary`、`SessionDetail` 型 |
| `src/index.css` | 割当画面のスタイル |

---

## Task 1: Onboarding と共有部品をページファイルへ分離

`src/App.tsx` は3030行あり、うち `Onboarding` が1684行を占める。新画面を同じファイルへ足すと、以後の変更がこのファイルの読み込みに支配される。純粋な移設として先に片付ける。

**Files:**
- Create: `src/client/pages/Onboarding.tsx`
- Create: `src/client/pages/shared.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `src/client/pages/shared.tsx` exports `yen`（`Intl.NumberFormat`）、`GROUP_LABELS`、`GROUP_CLASS`、`incomeCategoryLabel`、`usageModeLabel`、`lifecycleLabel`、`categoryLabel`、`monthKeyFromLabel`、`PanelHeading`
- Produces: `src/client/pages/Onboarding.tsx` default-exports `Onboarding`（現在の props をそのまま維持）

- [ ] **Step 1: 現在のテストが通ることを確認する**

Run: `npm test`
Expected: PASS（119件）。移設後に同じ結果になることが、この作業の唯一の検証手段である。UIの単体テストは存在しないため、`npm run build` の成功と型検査が実質的な回帰検出になる。

- [ ] **Step 2: 共有部品を `shared.tsx` へ移す**

`src/App.tsx` の先頭付近にある次の宣言を、そのまま `src/client/pages/shared.tsx` へ移し、`export` を付ける。

- `yen`（`new Intl.NumberFormat('ja-JP', ...)`）
- `GROUP_LABELS`、`GROUP_CLASS`
- `incomeCategoryLabel`、`usageModeLabel`、`lifecycleLabel`、`categoryLabel`
- `monthKeyFromLabel`
- `PanelHeading` コンポーネント

型のインポートは移設先で必要なものだけを持っていく（`TaxGroup`、`TaxUnitRecord`、`HomeCostRecord`、`PlanningSnapshot`、`ReactNode`）。

`src/App.tsx` はこれらを `import { ... } from './client/pages/shared'` で受け取る。

- [ ] **Step 3: Onboarding を移す**

`src/App.tsx` の `function Onboarding({...})` 全体を `src/client/pages/Onboarding.tsx` へ移す。**ロジックは1行も変えない。** 移設に伴い必要になるのは次だけ。

- インポートの追加（`react`、`../types`、`../../planning/types`、`../api`、`./shared`、`../../core/diagnosis`）
- 末尾に `export default Onboarding`
- `src/App.tsx` 側に `import Onboarding from './client/pages/Onboarding'`

`Onboarding` が使っている `MappingEditor` はフェーズ1で削除済みのため存在しない。もし参照が残っていたら移設前に確認すること。

- [ ] **Step 4: 型検査とビルドで回帰を見る**

Run: `npm run typecheck && npm run build && npm test`
Expected: すべて PASS、テストは119件のまま。型検査は、移設漏れや循環インポートをここで捕まえる。

- [ ] **Step 5: 整形して行数を確認する**

Run: `npm run format && wc -l src/App.tsx src/client/pages/Onboarding.tsx src/client/pages/shared.tsx`
Expected: `src/App.tsx` が1300行程度まで減っていること。

- [ ] **Step 6: コミット**

```bash
git add src/App.tsx src/client/pages/
git commit -m "refactor: move onboarding and shared parts into page files

App.tsx had reached 3030 lines, 1684 of them the onboarding modal. The
folder assignment screen would have made every later change depend on
reading all of it. Pure move, no logic changes."
```

---

## Task 2: フォルダ一覧の集計とAPI

割当画面は「どのフォルダに、いつ、どれだけ利用があり、今どう割り当てられているか」を一覧で必要とする。ダッシュボードの `products` は配賦の副産物であり、割当作業には情報が足りない。専用の集計を作る。

**Files:**
- Create: `src/server/folders.ts`
- Create: `tests/server/folders.test.ts`
- Modify: `src/server/index.ts`
- Modify: `src/client/types.ts`
- Modify: `src/client/api.ts`

**Interfaces:**
- Consumes: `getUsageSessions(): UsageSessionRow[]`（`src/server/database.js`）、`getPlanningSnapshot()`（`src/server/planningRepository.js`）、`resolveSessionAssignment(session, rules, timeZone?)`（`src/server/sessionAssignment.js`）
- Produces: 型 `FolderSummary`、関数 `buildFolderSummaries(): FolderSummary[]`、エンドポイント `GET /api/folders`

- [ ] **Step 1: 失敗するテストを書く**

`tests/server/folders.test.ts` を作る。

```ts
import { describe, expect, it } from 'vitest'
import type { UsageSessionRow } from '../../src/server/database.js'
import type { PlanningSnapshot } from '../../src/planning/types.js'
import { emptyPlanningSnapshot } from '../../src/planning/types.js'
import { summarizeFolders } from '../../src/server/folders.js'

function session(overrides: Partial<UsageSessionRow> = {}): UsageSessionRow {
  return {
    provider: 'claude',
    sessionKey: 'session_a',
    projectKey: 'project_a',
    month: '2026-07',
    startedAt: '2026-07-15T01:00:00.000Z',
    endedAt: '2026-07-15T02:00:00.000Z',
    messageCount: 5,
    projectLabel: 'my-app',
    model: 'claude-opus-5',
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ...overrides,
  }
}

function planning(rules: PlanningSnapshot['projectRules'] = []): PlanningSnapshot {
  return {
    ...emptyPlanningSnapshot(2026),
    taxUnits: [
      {
        id: 'unit-a',
        name: '公開アプリ A',
        unitType: 'new-software',
        usageMode: 'external',
        revenueModel: 'sales',
        lifecycleStatus: 'developing',
      },
    ],
    projectRules: rules,
  }
}

describe('summarizeFolders', () => {
  it('同じフォルダのセッションを1件へまとめる', () => {
    const folders = summarizeFolders(
      [session({ sessionKey: 'a' }), session({ sessionKey: 'b', messageCount: 3 })],
      planning(),
      'Asia/Tokyo',
    )

    expect(folders).toHaveLength(1)
    expect(folders[0]).toMatchObject({
      projectKey: 'project_a',
      label: 'my-app',
      sessionCount: 2,
      messageCount: 8,
    })
  })

  it('利用期間を最初と最後のセッションから求める', () => {
    const folders = summarizeFolders(
      [
        session({ sessionKey: 'a', startedAt: '2026-05-01T01:00:00.000Z', endedAt: '2026-05-01T02:00:00.000Z' }),
        session({ sessionKey: 'b', startedAt: '2026-07-20T01:00:00.000Z', endedAt: '2026-07-20T02:00:00.000Z' }),
      ],
      planning(),
      'Asia/Tokyo',
    )

    expect(folders[0]?.firstUsedOn).toBe('2026-05-01')
    expect(folders[0]?.lastUsedOn).toBe('2026-07-20')
  })

  it('利用したAIサービスを重複なく列挙する', () => {
    const folders = summarizeFolders(
      [
        session({ sessionKey: 'a', provider: 'claude' }),
        session({ sessionKey: 'b', provider: 'codex' }),
        session({ sessionKey: 'c', provider: 'claude' }),
      ],
      planning(),
      'Asia/Tokyo',
    )

    expect(folders[0]?.providers).toEqual(['claude', 'codex'])
  })

  it('ルールがなければ未割当として返す', () => {
    const folders = summarizeFolders([session()], planning(), 'Asia/Tokyo')

    expect(folders[0]?.assignments).toEqual([])
    expect(folders[0]?.unassignedSessionCount).toBe(1)
  })

  it('適用中のルールを割当として返す', () => {
    const folders = summarizeFolders(
      [session()],
      planning([
        {
          id: 'rule-1',
          projectKey: 'project_a',
          effectiveFrom: '2026-01-01',
          taxUnitId: 'unit-a',
          classification: 'new-development',
        },
      ]),
      'Asia/Tokyo',
    )

    expect(folders[0]?.assignments).toEqual([
      {
        ruleId: 'rule-1',
        taxUnitId: 'unit-a',
        taxUnitName: '公開アプリ A',
        classification: 'new-development',
        effectiveFrom: '2026-01-01',
        effectiveTo: undefined,
        provider: undefined,
        sessionCount: 1,
      },
    ])
    expect(folders[0]?.unassignedSessionCount).toBe(0)
  })

  it('期間で分かれたルールをそれぞれの適用件数とともに返す', () => {
    const folders = summarizeFolders(
      [
        session({ sessionKey: 'a', startedAt: '2026-07-05T01:00:00.000Z', endedAt: '2026-07-05T02:00:00.000Z' }),
        session({ sessionKey: 'b', startedAt: '2026-07-25T01:00:00.000Z', endedAt: '2026-07-25T02:00:00.000Z' }),
      ],
      planning([
        {
          id: 'rule-early',
          projectKey: 'project_a',
          effectiveFrom: '2026-07-01',
          effectiveTo: '2026-07-14',
          taxUnitId: 'unit-a',
          classification: 'new-development',
        },
        {
          id: 'rule-late',
          projectKey: 'project_a',
          effectiveFrom: '2026-07-15',
          taxUnitId: 'unit-a',
          classification: 'maintenance',
        },
      ]),
      'Asia/Tokyo',
    )

    expect(folders[0]?.assignments.map((item) => [item.ruleId, item.sessionCount])).toEqual([
      ['rule-early', 1],
      ['rule-late', 1],
    ])
  })

  it('制作物を指定しないルールは分類だけを返す', () => {
    const folders = summarizeFolders(
      [session()],
      planning([
        {
          id: 'rule-private',
          projectKey: 'project_a',
          effectiveFrom: '2026-01-01',
          classification: 'private',
        },
      ]),
      'Asia/Tokyo',
    )

    expect(folders[0]?.assignments[0]).toMatchObject({
      taxUnitId: undefined,
      taxUnitName: undefined,
      classification: 'private',
    })
  })

  it('利用量の多い順に並べる', () => {
    const folders = summarizeFolders(
      [
        session({ projectKey: 'small', sessionKey: 'a', projectLabel: 'small' }),
        session({ projectKey: 'big', sessionKey: 'b', projectLabel: 'big' }),
        session({ projectKey: 'big', sessionKey: 'c', projectLabel: 'big' }),
      ],
      planning(),
      'Asia/Tokyo',
    )

    expect(folders.map((folder) => folder.projectKey)).toEqual(['big', 'small'])
  })

  it('ラベルがなければ末尾6文字から表示名を作る', () => {
    const folders = summarizeFolders(
      [session({ projectLabel: null, projectKey: 'project_abcdef123456' })],
      planning(),
      'Asia/Tokyo',
    )

    expect(folders[0]?.label).toBe('Project 123456')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run tests/server/folders.test.ts`
Expected: FAIL。`src/server/folders.ts` が存在しない。

- [ ] **Step 3: 実装を書く**

`src/server/folders.ts` を作る。

```ts
import { localDateFromTimestamp, resolvedTimeZone } from '../adapters/localTime.ts'
import type { UsageProvider } from '../adapters/types.ts'
import type { PlanningSnapshot, ProjectClassification } from '../planning/types.js'
import { getUsageSessions, type UsageSessionRow } from './database.js'
import { resolveSessionAssignment } from './sessionAssignment.js'
import { getPlanningSnapshot } from './planningRepository.js'

export type FolderAssignment = {
  ruleId: string
  taxUnitId?: string
  taxUnitName?: string
  classification: ProjectClassification
  effectiveFrom: string
  effectiveTo?: string
  provider?: UsageProvider
  sessionCount: number
}

export type FolderSummary = {
  projectKey: string
  label: string
  sessionCount: number
  messageCount: number
  firstUsedOn: string
  lastUsedOn: string
  providers: UsageProvider[]
  assignments: FolderAssignment[]
  unassignedSessionCount: number
}

const providerOrder: Record<UsageProvider, number> = { claude: 0, codex: 1 }

function displayLabel(row: UsageSessionRow): string {
  return row.projectLabel ?? `Project ${row.projectKey.slice(-6)}`
}

/**
 * Builds the assignment screen's folder list. Rules are reported with how many
 * sessions each currently covers, so the user can see the effect of a period
 * split before changing it.
 */
export function summarizeFolders(
  sessions: UsageSessionRow[],
  planning: PlanningSnapshot,
  timeZone: string = resolvedTimeZone(),
): FolderSummary[] {
  const unitNameById = new Map(planning.taxUnits.map((unit) => [unit.id, unit.name]))
  const byProject = new Map<string, FolderSummary>()
  const ruleUsage = new Map<string, number>()

  for (const session of sessions) {
    const assignment = resolveSessionAssignment(session, planning.projectRules, timeZone)
    if (assignment.ruleId) {
      ruleUsage.set(assignment.ruleId, (ruleUsage.get(assignment.ruleId) ?? 0) + 1)
    }

    const day = localDateFromTimestamp(session.startedAt, timeZone) ?? session.startedAt.slice(0, 10)
    const current = byProject.get(session.projectKey)
    if (!current) {
      byProject.set(session.projectKey, {
        projectKey: session.projectKey,
        label: displayLabel(session),
        sessionCount: 1,
        messageCount: session.messageCount,
        firstUsedOn: day,
        lastUsedOn: day,
        providers: [session.provider],
        assignments: [],
        unassignedSessionCount: assignment.ruleId ? 0 : 1,
      })
      continue
    }

    current.sessionCount += 1
    current.messageCount += session.messageCount
    if (day < current.firstUsedOn) current.firstUsedOn = day
    if (day > current.lastUsedOn) current.lastUsedOn = day
    if (!current.providers.includes(session.provider)) current.providers.push(session.provider)
    if (!assignment.ruleId) current.unassignedSessionCount += 1
    if (session.projectLabel && current.label.startsWith('Project ')) {
      current.label = session.projectLabel
    }
  }

  for (const folder of byProject.values()) {
    folder.providers.sort((left, right) => providerOrder[left] - providerOrder[right])
    folder.assignments = planning.projectRules
      .filter((rule) => rule.projectKey === folder.projectKey)
      .map((rule) => ({
        ruleId: rule.id,
        taxUnitId: rule.taxUnitId,
        taxUnitName: rule.taxUnitId ? unitNameById.get(rule.taxUnitId) : undefined,
        classification: rule.classification,
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        provider: rule.provider,
        sessionCount: ruleUsage.get(rule.id) ?? 0,
      }))
  }

  return [...byProject.values()].sort((left, right) => {
    if (left.sessionCount !== right.sessionCount) return right.sessionCount - left.sessionCount
    return left.projectKey < right.projectKey ? -1 : 1
  })
}

export function buildFolderSummaries(): FolderSummary[] {
  return summarizeFolders(getUsageSessions(), getPlanningSnapshot())
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run tests/server/folders.test.ts`
Expected: PASS（9件）

- [ ] **Step 5: APIとクライアント型を追加する**

`src/server/index.ts` に追加する。`/api/dashboard` の直後に置く。

```ts
app.get('/api/folders', async () => {
  const { buildFolderSummaries } = await import('./folders.js')
  return { folders: buildFolderSummaries() }
})
```

`src/client/types.ts` に追加する。

```ts
export type FolderAssignment = {
  ruleId: string
  taxUnitId?: string
  taxUnitName?: string
  classification: ProjectClassification
  effectiveFrom: string
  effectiveTo?: string
  provider?: ProviderKey
  sessionCount: number
}

export type FolderSummary = {
  projectKey: string
  label: string
  sessionCount: number
  messageCount: number
  firstUsedOn: string
  lastUsedOn: string
  providers: ProviderKey[]
  assignments: FolderAssignment[]
  unassignedSessionCount: number
}
```

`ProjectClassification` は `src/planning/types.js` から import する。フェーズ1で `src/client/types.ts` 側の重複定義は削除済みなので、新たに定義し直さないこと。

`src/client/api.ts` に追加する。

```ts
export function getFolders(): Promise<{ folders: FolderSummary[] }> {
  return requestJson('/api/folders')
}
```

- [ ] **Step 6: 全体を確認してコミット**

Run: `npm run typecheck && npm test && npm run format:check`
Expected: すべて PASS

```bash
git add src/server/folders.ts tests/server/folders.test.ts src/server/index.ts src/client/types.ts src/client/api.ts
git commit -m "feat: summarize folders for the assignment screen

Reports each rule with the number of sessions it currently covers, so a
period split shows its effect before the user changes it."
```

---

## Task 3: ルールだけを置き換える保存API

割当画面はルールだけを更新する。planning スナップショット全体を送ると、設備・自宅費用・証拠まで往復することになり、`bodyLimit` の64 KiBに収まらなくなる規模へ育ちうる。ルール専用の入口を作る。

**Files:**
- Modify: `src/server/planningRepository.ts`
- Modify: `src/server/index.ts`
- Modify: `src/client/api.ts`
- Test: `tests/server/planningApi.test.ts`

**Interfaces:**
- Produces: `replaceProjectRules(rules: ProjectRuleRecord[], db?): void`、エンドポイント `PUT /api/planning/rules`、クライアント関数 `savePlanningRules(csrfToken, rules)`

- [ ] **Step 1: 失敗するテストを書く**

`tests/server/planningApi.test.ts` へ追加する。既存のサーバ起動ヘルパーとリクエスト関数の名前は、ファイル冒頭を読んで合わせること。

```ts
  it('ルールだけを置き換えられる', async () => {
    await put('/api/planning', {
      ...emptyPlanningSnapshot(2026),
      taxUnits: [
        {
          id: 'unit-rules-api',
          name: 'ルールAPI用',
          unitType: 'new-software',
          usageMode: 'external',
          revenueModel: 'sales',
          lifecycleStatus: 'developing',
        },
      ],
    })

    const response = await put('/api/planning/rules', {
      rules: [
        {
          id: 'rule-api-1',
          projectKey: 'project_rules_api_0001',
          effectiveFrom: '2026-01-01',
          taxUnitId: 'unit-rules-api',
          classification: 'new-development',
        },
      ],
    })
    expect(response.status).toBe(200)

    const snapshot = await getJson('/api/planning')
    expect(snapshot.projectRules).toHaveLength(1)
    expect(snapshot.taxUnits).toHaveLength(1)
  })

  it('存在しない制作物を指すルールを拒否する', async () => {
    const response = await put('/api/planning/rules', {
      rules: [
        {
          id: 'rule-api-orphan',
          projectKey: 'project_rules_api_0002',
          effectiveFrom: '2026-01-01',
          taxUnitId: 'unit-does-not-exist',
          classification: 'new-development',
        },
      ],
    })
    expect(response.status).toBe(400)
  })
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run tests/server/planningApi.test.ts`
Expected: FAIL。`/api/planning/rules` が404。

- [ ] **Step 3: リポジトリ関数を書く**

`src/server/planningRepository.ts` に追加する。既存の `savePlanningSnapshot` と同じトランザクションの作法に従う。

```ts
export const projectRulesSchema = z.object({
  rules: z.array(projectRuleSchema).max(5_000),
})

export function replaceProjectRules(
  rules: ProjectRuleRecord[],
  db: DatabaseSync = getDatabase(),
): void {
  const unitIds = new Set(
    (db.prepare('SELECT id FROM planning_tax_units').all() as Array<{ id: string }>).map(
      (row) => row.id,
    ),
  )
  for (const rule of rules) {
    if (rule.taxUnitId && !unitIds.has(rule.taxUnitId)) {
      throw new Error(`未登録の制作物を指すルールです: ${rule.id}`)
    }
    if (rule.effectiveTo && rule.effectiveTo < rule.effectiveFrom) {
      throw new Error(`終了日が開始日より前のルールです: ${rule.id}`)
    }
  }

  const insert = db.prepare(`INSERT INTO planning_project_rules(id, project_key,
    provider, effective_from, effective_to, tax_unit_id, classification, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)

  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec('DELETE FROM planning_project_rules')
    for (const rule of rules) {
      insert.run(
        rule.id,
        rule.projectKey,
        rule.provider ?? null,
        rule.effectiveFrom,
        rule.effectiveTo ?? null,
        rule.taxUnitId ?? null,
        rule.classification,
        rule.reason ?? null,
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
```

`ProjectRuleRecord` の import を忘れないこと。

- [ ] **Step 4: エンドポイントを追加する**

`src/server/index.ts` の `PUT /api/planning` の直後に置く。

```ts
app.put('/api/planning/rules', async (request, reply) => {
  const { projectRulesSchema, replaceProjectRules } = await import('./planningRepository.js')
  const parsed = projectRulesSchema.safeParse(request.body)
  if (!parsed.success) {
    await reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() })
    return
  }
  try {
    replaceProjectRules(parsed.data.rules)
  } catch (error) {
    await reply.code(400).send({
      error: 'invalid_request',
      message: error instanceof Error ? error.message : '保存できませんでした。',
    })
    return
  }
  return { saved: true }
})
```

- [ ] **Step 5: クライアント関数を追加する**

`src/client/api.ts` に追加する。

```ts
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
```

- [ ] **Step 6: テストが通ることを確認してコミット**

Run: `npm run typecheck && npm test && npm run format:check`
Expected: すべて PASS

```bash
git add src/server/planningRepository.ts src/server/index.ts src/client/api.ts tests/server/planningApi.test.ts
git commit -m "feat: add a rules-only save endpoint

The assignment screen changes only rules. Round-tripping the whole
planning snapshot would carry equipment, home costs and evidence with
every edit, which the 64 KiB body limit cannot hold as those grow."
```

---

## Task 4: フォルダ割当画面の骨格

一覧、検索、フィルタ、並び替え、1件ずつの割当変更まで作る。一括操作と期間分割は次のタスクで足す。

**Files:**
- Create: `src/client/pages/FolderAssignmentPage.tsx`
- Modify: `src/App.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `getFolders()`（Task 2）、`savePlanningRules(csrfToken, rules)`（Task 3）、`FolderSummary`、`FolderAssignment`
- Produces: `FolderAssignmentPage` を default export

- [ ] **Step 1: 画面コンポーネントを書く**

`src/client/pages/FolderAssignmentPage.tsx` を作る。

```tsx
import { useMemo, useState } from 'react'
import type { FolderSummary, ProviderKey } from '../types'
import type { PlanningSnapshot, ProjectClassification, ProjectRuleRecord } from '../../planning/types'
import { PanelHeading } from './shared'

type SortKey = 'usage' | 'recent' | 'name'

const CLASSIFICATION_LABELS: Record<ProjectClassification, string> = {
  'new-development': '新しく作った',
  maintenance: '保守・バグ修正',
  'feature-addition': '機能を大きく追加した',
  'general-learning': '一般的な学習',
  private: '趣味・私用',
  unclassified: 'あとで確認',
}

const PROVIDER_LABELS: Record<ProviderKey, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
}

function ruleId(projectKey: string, effectiveFrom: string): string {
  return `rule-${projectKey.slice(-12)}-${effectiveFrom}`
}

export default function FolderAssignmentPage({
  folders,
  planning,
  busy,
  onSaveRules,
}: {
  folders: FolderSummary[]
  planning: PlanningSnapshot
  busy: boolean
  onSaveRules: (rules: ProjectRuleRecord[]) => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [unassignedOnly, setUnassignedOnly] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('usage')

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = folders.filter((folder) => {
      if (unassignedOnly && folder.unassignedSessionCount === 0) return false
      if (!needle) return true
      return folder.label.toLowerCase().includes(needle)
    })
    return [...filtered].sort((left, right) => {
      if (sortKey === 'name') return left.label.localeCompare(right.label, 'ja')
      if (sortKey === 'recent') return left.lastUsedOn < right.lastUsedOn ? 1 : -1
      return right.sessionCount - left.sessionCount
    })
  }, [folders, query, sortKey, unassignedOnly])

  const unassignedFolders = folders.filter((folder) => folder.unassignedSessionCount > 0).length

  async function assign(
    folder: FolderSummary,
    patch: { taxUnitId?: string; classification?: ProjectClassification },
  ) {
    const existing = folder.assignments[0]
    const effectiveFrom = existing?.effectiveFrom ?? folder.firstUsedOn
    const next: ProjectRuleRecord = {
      id: existing?.ruleId ?? ruleId(folder.projectKey, effectiveFrom),
      projectKey: folder.projectKey,
      effectiveFrom,
      effectiveTo: existing?.effectiveTo,
      provider: existing?.provider,
      taxUnitId: patch.taxUnitId ?? existing?.taxUnitId,
      classification: patch.classification ?? existing?.classification ?? 'unclassified',
      reason: '割当画面で登録',
    }
    if (patch.taxUnitId === '') next.taxUnitId = undefined

    const others = planning.projectRules.filter((rule) => rule.id !== next.id)
    await onSaveRules([...others, next])
  }

  return (
    <>
      <section className="assignment-toolbar" aria-label="フォルダの絞り込み">
        <div className="assignment-counts">
          <strong>
            未割当 {unassignedFolders} / {folders.length}件
          </strong>
          {unassignedFolders > 0 && (
            <span className="assignment-warning">
              未割当のフォルダは配賦額が「対象外・要確認」に残ります
            </span>
          )}
        </div>
        <label>
          <span>フォルダを探す</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="フォルダ名の一部"
          />
        </label>
        <label className="assignment-toggle">
          <input
            type="checkbox"
            checked={unassignedOnly}
            onChange={(event) => setUnassignedOnly(event.target.checked)}
          />
          <span>未割当のみ表示</span>
        </label>
        <label>
          <span>並び順</span>
          <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
            <option value="usage">利用量が多い順</option>
            <option value="recent">最近使った順</option>
            <option value="name">名前順</option>
          </select>
        </label>
      </section>

      <section className="panel assignment-panel">
        <PanelHeading
          title="フォルダの割当"
          subtitle={`${visible.length}件を表示 · AI履歴の作業フォルダを制作物と作業内容へ結び付けます`}
        />
        {visible.length === 0 ? (
          <p className="assignment-empty">
            {folders.length === 0
              ? 'まだ履歴を取り込んでいません。「設定を確認」からAI履歴を走査してください。'
              : '条件に一致するフォルダがありません。'}
          </p>
        ) : (
          <ul className="assignment-list">
            {visible.map((folder) => (
              <li key={folder.projectKey}>
                <div className="assignment-folder">
                  <strong>{folder.label}</strong>
                  <small>
                    {folder.sessionCount}セッション · {folder.firstUsedOn}〜{folder.lastUsedOn} ·{' '}
                    {folder.providers.map((provider) => PROVIDER_LABELS[provider]).join('・')}
                  </small>
                </div>
                <div className="assignment-fields">
                  <label>
                    <span>制作物</span>
                    <select
                      value={folder.assignments[0]?.taxUnitId ?? ''}
                      disabled={busy}
                      onChange={(event) => assign(folder, { taxUnitId: event.target.value })}
                    >
                      <option value="">指定しない</option>
                      {planning.taxUnits.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.name || '名前未入力'}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>この期間にしたこと</span>
                    <select
                      value={folder.assignments[0]?.classification ?? 'unclassified'}
                      disabled={busy}
                      onChange={(event) =>
                        assign(folder, {
                          classification: event.target.value as ProjectClassification,
                        })
                      }
                    >
                      {Object.entries(CLASSIFICATION_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {folder.unassignedSessionCount > 0 && (
                  <span className="assignment-status warning">
                    未割当 {folder.unassignedSessionCount}件
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
```

- [ ] **Step 2: App.tsx へ組み込む**

`Page` 型に `'folders'` を追加し、サイドバーのナビゲーションに4項目目を足す。「税務QA」の前に置く。

```tsx
<button
  className={page === 'folders' ? 'nav-item active' : 'nav-item'}
  onClick={() => setPage('folders')}
>
  <span aria-hidden="true">▤</span>
  <span>
    フォルダの割当
    <small>履歴と制作物を結ぶ</small>
  </span>
</button>
```

`folders` state と読み込みを `App` へ足す。既存の `getDashboardData()` などと同じ `useEffect` の中で読む。

```tsx
const [folders, setFolders] = useState<FolderSummary[]>([])
```

`Promise.all` の配列に `getFolders()` を加え、`setFolders(nextFolders.folders)` する。

ルール保存の関数を足す。保存後はフォルダ一覧とダッシュボードを読み直す。

```tsx
async function storeRules(rules: ProjectRuleRecord[]): Promise<void> {
  const activeRuntime = runtime ?? (await getRuntime())
  if (!runtime) setRuntime(activeRuntime)
  await savePlanningRules(activeRuntime.csrfToken, rules)
  const [nextFolders, nextPlanning, nextDashboard] = await Promise.all([
    getFolders(),
    getPlanning(),
    getDashboardData(),
  ])
  setFolders(nextFolders.folders)
  setPlanningState(nextPlanning)
  setData(nextDashboard)
}
```

ページ切り替えの三項演算子へ分岐を足す。`page === 'folders'` のとき `FolderAssignmentPage` を描画する。ページ見出しの文言も足す。

- 見出し: `フォルダの割当`
- eyebrow: `履歴と制作物の対応`
- 説明: `AI履歴の作業フォルダを、制作物と作業内容へ結び付けます。ここで割り当てた内容が配賦額の分類になります。`

`page !== 'guide'` でフィルターを出す条件は `page === 'summary' || page === 'evidence'` に変える。割当画面に配賦フィルターは不要である。

あわせてオンボーディングからの導線を作る。設計6.1が求めているもので、これがないと利用者は新画面の存在に気づかない。`Onboarding` の props に `unassignedFolderCount: number` を足し、ステップ5（診断）の末尾に案内を出す。画面遷移そのものは `App` 側で `onClose` を包んで行うため、`Onboarding` に遷移用のコールバックは渡さない。

```tsx
{unassignedFolderCount > 0 && (
  <div className="setup-insight">
    <span>▤</span>
    <p>
      <strong>まだ割り当てていないフォルダが{unassignedFolderCount}件あります</strong>
      <br />
      保存したあと「フォルダの割当」画面で、どの制作物の作業だったかを決められます。
      割り当てるまで、その利用分は「対象外・要確認」に残ります。
    </p>
  </div>
)}
```

保存完了後にモーダルを閉じる処理（`window.setTimeout(onClose, 650)`）の直後で、未割当があれば割当画面へ遷移する。`App` 側で `onClose` を渡すときに、未割当があれば `setPage('folders')` も行う形にする。利用者を放り出さないためである。

- [ ] **Step 3: スタイルを足す**

`src/index.css` の末尾近く、既存のパネル定義の後に足す。既存の変数と配色に合わせる。

既存のデザイントークンを使うこと。`src/index.css` の冒頭で定義されている `--line`、`--line-strong`、`--muted`、`--card`、`--paper`、`--navy`、`--amber`、`--amber-soft`、`--shadow-md` を色や影の直値の代わりに使う。

```css
.assignment-toolbar {
  margin: 0 0 14px;
  padding: 14px 18px;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 16px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--card);
}
.assignment-counts {
  display: grid;
  gap: 3px;
  margin-right: auto;
}
.assignment-counts strong {
  font-size: 16px;
}
.assignment-warning {
  color: var(--amber);
  font-size: 13px;
}
.assignment-toolbar label {
  display: grid;
  gap: 5px;
  font-size: 13px;
  color: var(--muted);
}
.assignment-toolbar input[type='text'],
.assignment-toolbar input:not([type]),
.assignment-toolbar select {
  min-width: 170px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 9px;
  font-size: 14px;
}
.assignment-toggle {
  flex-direction: row;
  align-items: center;
  gap: 7px;
}
.assignment-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 9px;
}
.assignment-list li {
  padding: 13px 15px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
}
.assignment-folder {
  display: grid;
  gap: 3px;
  min-width: 0;
}
.assignment-folder strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.assignment-folder small {
  color: var(--muted);
  font-size: 12px;
}
.assignment-fields {
  display: flex;
  gap: 10px;
}
.assignment-fields label {
  display: grid;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}
.assignment-fields select {
  padding: 7px 9px;
  border: 1px solid var(--line);
  border-radius: 8px;
  font-size: 13px;
}
.assignment-status.warning {
  padding: 4px 9px;
  border-radius: 999px;
  background: var(--amber-soft);
  color: var(--amber);
  font-size: 12px;
  white-space: nowrap;
}
.assignment-empty {
  padding: 26px 4px;
  color: var(--muted);
  text-align: center;
}

@media (max-width: 880px) {
  .assignment-list li {
    grid-template-columns: 1fr;
  }
  .assignment-fields {
    flex-wrap: wrap;
  }
}
```

- [ ] **Step 4: 型検査とビルドを通す**

Run: `npm run typecheck && npm run build && npm test && npm run format:check`
Expected: すべて PASS

- [ ] **Step 5: 手で動作を確認する**

Run: `npm start`（別ターミナル）で `http://127.0.0.1:4317` を開く。

確認すること。

- サイドバーに「フォルダの割当」が出る
- 履歴を取り込んでいれば一覧にフォルダが並ぶ
- 制作物の選択を変えると保存され、再読み込み後も残る
- 「未割当のみ表示」で絞り込める
- 検索でフォルダ名の部分一致が効く

**実データを取り込む場合は `DEVTAX_RADAR_DATA_DIR` を一時ディレクトリへ向けて起動し、確認後にそのディレクトリを削除すること。** 開発中の実験結果を利用者の本番DBへ残さない。

- [ ] **Step 6: コミット**

```bash
git add src/client/pages/FolderAssignmentPage.tsx src/App.tsx src/index.css
git commit -m "feat: add the folder assignment screen

Phase 1 removed the automatic assignment that collapsed every folder into
one product, which left users with no way to classify at all. This is that
way."
```

---

## Task 5: 一括割当と期間の分割

57件を1件ずつ触るのは現実的ではない。複数選択してまとめて割り当てられるようにする。あわせて、1つのフォルダに期間で分かれた複数のルールを持たせられるようにする。

**Files:**
- Modify: `src/client/pages/FolderAssignmentPage.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: Task 4 の `FolderAssignmentPage`

- [ ] **Step 1: 選択状態と一括操作バーを足す**

`FolderAssignmentPage` に選択の state を足す。

```tsx
const [selected, setSelected] = useState<Record<string, boolean>>({})
const selectedKeys = Object.keys(selected).filter((key) => selected[key])
```

各行の先頭にチェックボックスを置く。

```tsx
<input
  type="checkbox"
  checked={Boolean(selected[folder.projectKey])}
  disabled={busy}
  onChange={(event) =>
    setSelected((current) => ({ ...current, [folder.projectKey]: event.target.checked }))
  }
  aria-label={`${folder.label}を選択`}
/>
```

一括操作の関数を足す。選択された各フォルダについて、既存ルールがあれば更新し、なければ作る。

セレクトのプレースホルダ（空文字）と「制作物を指定しない」を区別する必要がある。空文字は「まだ何も選んでいない」を表すので、制作物なしには `'__none__'` という明示的な値を使う。

```tsx
const NO_TAX_UNIT = '__none__'

async function assignSelected(patch: {
  taxUnitId?: string
  classification?: ProjectClassification
}) {
  const targets = folders.filter((folder) => selected[folder.projectKey])
  if (targets.length === 0) return

  const nextById = new Map(planning.projectRules.map((rule) => [rule.id, rule]))
  for (const folder of targets) {
    const existing = folder.assignments[0]
    const effectiveFrom = existing?.effectiveFrom ?? folder.firstUsedOn
    const id = existing?.ruleId ?? ruleId(folder.projectKey, effectiveFrom)
    nextById.set(id, {
      id,
      projectKey: folder.projectKey,
      effectiveFrom,
      effectiveTo: existing?.effectiveTo,
      provider: existing?.provider,
      taxUnitId:
        patch.taxUnitId === NO_TAX_UNIT ? undefined : (patch.taxUnitId ?? existing?.taxUnitId),
      classification: patch.classification ?? existing?.classification ?? 'unclassified',
      reason: '割当画面で一括登録',
    })
  }

  await onSaveRules([...nextById.values()])
  setSelected({})
}
```

Task 4 の1件ずつの `assign` も同じ扱いへ揃えること。そちらは `<select>` の `value` が現在の `taxUnitId ?? ''` なので、「指定しない」の option の値を `NO_TAX_UNIT` に変え、`assign` の中で `patch.taxUnitId === NO_TAX_UNIT` を `undefined` として扱う。

一括操作バーを一覧の下に置く。選択が0件のときは出さない。

```tsx
{selectedKeys.length > 0 && (
  <div className="assignment-bulk" role="status">
    <strong>{selectedKeys.length}件を選択中</strong>
    <label>
      <span>制作物</span>
      <select
        value=""
        disabled={busy}
        onChange={(event) => assignSelected({ taxUnitId: event.target.value })}
      >
        <option value="">まとめて設定...</option>
        <option value={NO_TAX_UNIT}>指定しない</option>
        {planning.taxUnits.map((unit) => (
          <option key={unit.id} value={unit.id}>
            {unit.name || '名前未入力'}
          </option>
        ))}
      </select>
    </label>
    <label>
      <span>作業内容</span>
      <select
        value=""
        disabled={busy}
        onChange={(event) =>
          assignSelected({ classification: event.target.value as ProjectClassification })
        }
      >
        <option value="">まとめて設定...</option>
        {Object.entries(CLASSIFICATION_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
    <button className="text-button" disabled={busy} onClick={() => setSelected({})}>
      選択を解除
    </button>
  </div>
)}
```

「まとめて設定...」と「指定しない」がどちらも空文字なのは扱いにくい。`option` の値を `'__none__'` にして、`assignSelected` 側で `'__none__'` を `''` として扱うこと。空文字は「未選択」を意味するプレースホルダ専用にする。

- [ ] **Step 2: 期間の分割を足す**

各行に「期間を分ける」ボタンを置き、押すと2件目のルールを作る。開始日は既存ルールの終了日の翌日、なければ今日の日付とする。

```tsx
async function splitPeriod(folder: FolderSummary) {
  const last = folder.assignments.at(-1)
  const from = last?.effectiveTo
    ? nextDay(last.effectiveTo)
    : new Date().toISOString().slice(0, 10)
  const id = ruleId(folder.projectKey, from)
  if (planning.projectRules.some((rule) => rule.id === id)) return

  const updated = planning.projectRules.map((rule) =>
    rule.id === last?.ruleId && !rule.effectiveTo
      ? { ...rule, effectiveTo: previousDay(from) }
      : rule,
  )
  await onSaveRules([
    ...updated,
    {
      id,
      projectKey: folder.projectKey,
      effectiveFrom: from,
      taxUnitId: last?.taxUnitId,
      classification: 'unclassified',
      reason: '割当画面で期間を分割',
    },
  ])
}
```

日付のずらしはページ内のヘルパーとして書く。

```tsx
function shiftDay(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + days))
  return shifted.toISOString().slice(0, 10)
}
const nextDay = (date: string) => shiftDay(date, 1)
const previousDay = (date: string) => shiftDay(date, -1)
```

`Date.UTC` を使うのは、ローカルタイムの日付文字列を日単位でずらすときに時差の影響を受けないためである。ここで扱うのは時刻を持たない日付なので、UTCで計算して文字列へ戻すのが安全である。

- [ ] **Step 3: 2件目以降のルールを行に表示する**

`folder.assignments.length > 1` のとき、行の下に期間ごとの割当を並べる。それぞれに開始日の入力、制作物、分類のセレクトを出す。1件目と同じ `assign` を、ルールIDを指定できる形へ広げて使う。

```tsx
{folder.assignments.length > 1 && (
  <ul className="assignment-periods">
    {folder.assignments.map((assignment) => (
      <li key={assignment.ruleId}>
        <span>
          {assignment.effectiveFrom}〜{assignment.effectiveTo ?? ''}
        </span>
        <span>{assignment.taxUnitName ?? '制作物なし'}</span>
        <span>{CLASSIFICATION_LABELS[assignment.classification]}</span>
        <small>{assignment.sessionCount}セッション</small>
      </li>
    ))}
  </ul>
)}
```

- [ ] **Step 4: スタイルを足す**

```css
.assignment-bulk {
  position: sticky;
  bottom: 12px;
  margin-top: 12px;
  padding: 12px 16px;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 10px 30px rgba(9, 13, 26, 0.12);
}
.assignment-bulk strong {
  margin-right: auto;
}
.assignment-periods {
  grid-column: 1 / -1;
  list-style: none;
  padding: 9px 0 0;
  margin: 9px 0 0;
  border-top: 1px dashed var(--line);
  display: grid;
  gap: 5px;
}
.assignment-periods li {
  padding: 0;
  border: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 13px;
  color: var(--muted);
}
```

- [ ] **Step 5: 確認してコミット**

Run: `npm run typecheck && npm run build && npm test && npm run format:check`

手で確認すること。複数選択して制作物をまとめて設定できる。期間を分けると2件目のルールが増え、1件目に終了日が入る。

```bash
git add src/client/pages/FolderAssignmentPage.tsx src/index.css
git commit -m "feat: add bulk assignment and period splitting

57 folders is too many to touch one at a time, and a folder's purpose
changes over time."
```

---

## Task 6: セッション一覧と内容プレビューのAPI

割当を決めるには「そのフォルダで何をしていたか」の手がかりが要る。本文はDBへ保存しないまま、元JSONLをオンデマンドで読んで先頭だけ返す。

**Files:**
- Create: `src/server/sessionPreview.ts`
- Create: `tests/server/sessionPreview.test.ts`
- Modify: `src/server/database.ts`
- Modify: `src/server/index.ts`
- Modify: `src/client/types.ts`
- Modify: `src/client/api.ts`

**Interfaces:**
- Consumes: `getSessionReference(provider, sessionKey)`（`src/server/database.js`）
- Produces: `getSessionsForProject(projectKey): UsageSessionRow[]`、`readSessionPreview(sourcePath, provider): Promise<string | undefined>`、`buildResumeCommand(provider, nativeSessionId, workingDirectory, exists)`、エンドポイント `GET /api/sessions?projectKey=...` と `GET /api/sessions/detail?provider=...&sessionKey=...`

- [ ] **Step 1: 失敗するテストを書く**

`tests/server/sessionPreview.test.ts` を作る。

```ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildResumeCommand, readSessionPreview } from '../../src/server/sessionPreview.js'

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'devtax-preview-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('readSessionPreview', () => {
  it('Claude履歴の最初のユーザー発言を返す', async () => {
    const path = join(directory, 'claude.jsonl')
    writeFileSync(
      path,
      [
        JSON.stringify({ type: 'summary', summary: 'ignored' }),
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: [{ type: 'text', text: '配賦ロジックを直したい' }] },
        }),
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: [{ type: 'text', text: '二番目は無視する' }] },
        }),
      ].join('\n'),
      'utf8',
    )

    expect(await readSessionPreview(path, 'claude')).toBe('配賦ロジックを直したい')
  })

  it('コマンド呼び出しの行を読み飛ばす', async () => {
    const path = join(directory, 'claude-command.jsonl')
    writeFileSync(
      path,
      [
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: [{ type: 'text', text: '<command-name>/model</command-name>' }] },
        }),
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: [{ type: 'text', text: '本当の依頼はこちら' }] },
        }),
      ].join('\n'),
      'utf8',
    )

    expect(await readSessionPreview(path, 'claude')).toBe('本当の依頼はこちら')
  })

  it('文字列のcontentも読める', async () => {
    const path = join(directory, 'claude-string.jsonl')
    writeFileSync(
      path,
      JSON.stringify({ type: 'user', message: { role: 'user', content: '文字列の依頼' } }),
      'utf8',
    )

    expect(await readSessionPreview(path, 'claude')).toBe('文字列の依頼')
  })

  it('長い発言は120文字で切る', async () => {
    const path = join(directory, 'claude-long.jsonl')
    const long = 'あ'.repeat(300)
    writeFileSync(
      path,
      JSON.stringify({ type: 'user', message: { role: 'user', content: long } }),
      'utf8',
    )

    const preview = await readSessionPreview(path, 'claude')
    expect(preview).toHaveLength(121)
    expect(preview?.endsWith('...')).toBe(false)
    expect(preview?.slice(-1)).toBe('…')
  })

  it('Codex履歴の最初のユーザー発言を返す', async () => {
    const path = join(directory, 'codex.jsonl')
    writeFileSync(
      path,
      [
        JSON.stringify({ type: 'session_meta', payload: { cwd: '/work' } }),
        JSON.stringify({
          type: 'event_msg',
          payload: { type: 'user_message', message: 'Codexへの依頼' },
        }),
      ].join('\n'),
      'utf8',
    )

    expect(await readSessionPreview(path, 'codex')).toBe('Codexへの依頼')
  })

  it('ファイルがなければundefinedを返す', async () => {
    expect(await readSessionPreview(join(directory, 'missing.jsonl'), 'claude')).toBeUndefined()
  })

  it('ユーザー発言がなければundefinedを返す', async () => {
    const path = join(directory, 'empty.jsonl')
    writeFileSync(path, JSON.stringify({ type: 'summary' }), 'utf8')
    expect(await readSessionPreview(path, 'claude')).toBeUndefined()
  })
})

describe('buildResumeCommand', () => {
  it('作業フォルダへの移動とセットで組み立てる', () => {
    expect(buildResumeCommand('claude', 'abc-123', 'C:\\work\\app', true)).toEqual({
      command: 'cd "C:\\work\\app" && claude --resume abc-123',
      changeDirectory: 'cd "C:\\work\\app"',
      resume: 'claude --resume abc-123',
      workingDirectoryExists: true,
    })
  })

  it('Codexはcodex resumeを使う', () => {
    expect(buildResumeCommand('codex', 'xyz-789', '/home/user/app', true).resume).toBe(
      'codex resume xyz-789',
    )
  })

  it('作業フォルダが存在しなければcdを外す', () => {
    const result = buildResumeCommand('claude', 'abc-123', 'C:\\gone', false)
    expect(result.command).toBe('claude --resume abc-123')
    expect(result.changeDirectory).toBeUndefined()
    expect(result.workingDirectoryExists).toBe(false)
  })

  it('引用符を含むパスをエスケープする', () => {
    const result = buildResumeCommand('claude', 'abc', 'C:\\wo"rk', true)
    expect(result.changeDirectory).toBe('cd "C:\\wo\\"rk"')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run tests/server/sessionPreview.test.ts`
Expected: FAIL。モジュールが存在しない。

- [ ] **Step 3: 実装を書く**

`src/server/sessionPreview.ts` を作る。

```ts
import { createReadStream, existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import type { UsageProvider } from '../adapters/types.ts'

const PREVIEW_LENGTH = 120

export type ResumeCommand = {
  command: string
  changeDirectory?: string
  resume: string
  workingDirectoryExists: boolean
}

function firstText(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  const parts = content
    .filter(
      (part): part is { type: string; text: string } =>
        typeof part === 'object' &&
        part !== null &&
        (part as { type?: unknown }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string',
    )
    .map((part) => part.text)
  return parts.length > 0 ? parts.join(' ') : undefined
}

function isCommandNoise(text: string): boolean {
  return text.includes('<command-name>') || text.includes('<local-command')
}

function claudeUserText(row: Record<string, unknown>): string | undefined {
  if (row.type !== 'user') return undefined
  const message = row.message
  if (typeof message !== 'object' || message === null) return undefined
  const record = message as { role?: unknown; content?: unknown }
  if (record.role !== 'user') return undefined
  return firstText(record.content)
}

function codexUserText(row: Record<string, unknown>): string | undefined {
  const payload = row.payload
  if (typeof payload !== 'object' || payload === null) return undefined
  const record = payload as { type?: unknown; message?: unknown }
  if (record.type !== 'user_message') return undefined
  return typeof record.message === 'string' ? record.message : undefined
}

/**
 * Reads the first real user turn from a transcript so the assignment screen can
 * show what a session was about. Nothing read here is written to the database:
 * the prompt body stays in the provider's own file.
 */
export async function readSessionPreview(
  sourcePath: string,
  provider: UsageProvider,
): Promise<string | undefined> {
  if (!existsSync(sourcePath)) return undefined

  const stream = createReadStream(sourcePath, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY })
  try {
    for await (const line of lines) {
      if (line.trim().length === 0) continue
      let row: unknown
      try {
        row = JSON.parse(line)
      } catch {
        continue
      }
      if (typeof row !== 'object' || row === null) continue

      const text =
        provider === 'claude'
          ? claudeUserText(row as Record<string, unknown>)
          : codexUserText(row as Record<string, unknown>)
      if (!text) continue
      const trimmed = text.trim()
      if (trimmed.length === 0 || isCommandNoise(trimmed)) continue

      const collapsed = trimmed.replace(/\s+/g, ' ')
      return collapsed.length > PREVIEW_LENGTH
        ? `${collapsed.slice(0, PREVIEW_LENGTH)}…`
        : collapsed
    }
  } catch {
    return undefined
  } finally {
    lines.close()
    stream.destroy()
  }
  return undefined
}

export function buildResumeCommand(
  provider: UsageProvider,
  nativeSessionId: string,
  workingDirectory: string,
  workingDirectoryExists: boolean,
): ResumeCommand {
  const resume =
    provider === 'claude' ? `claude --resume ${nativeSessionId}` : `codex resume ${nativeSessionId}`
  if (!workingDirectoryExists) {
    return { command: resume, resume, workingDirectoryExists: false }
  }
  const changeDirectory = `cd "${workingDirectory.replaceAll('"', '\\"')}"`
  return {
    command: `${changeDirectory} && ${resume}`,
    changeDirectory,
    resume,
    workingDirectoryExists: true,
  }
}
```

- [ ] **Step 4: DBアクセサを足す**

`src/server/database.ts` に追加する。

```ts
export function getSessionsForProject(projectKey: string): UsageSessionRow[] {
  return getDatabase()
    .prepare(
      `SELECT provider, session_key AS sessionKey, project_key AS projectKey,
              month, started_at AS startedAt, ended_at AS endedAt,
              message_count AS messageCount, project_label AS projectLabel, model,
              input_tokens AS inputTokens, output_tokens AS outputTokens,
              cache_read_tokens AS cacheReadTokens, cache_write_tokens AS cacheWriteTokens
       FROM usage_events WHERE project_key = ?
       ORDER BY started_at DESC, session_key`,
    )
    .all(projectKey) as UsageSessionRow[]
}
```

- [ ] **Step 5: エンドポイントを足す**

`src/server/index.ts` に追加する。

```ts
app.get('/api/sessions', async (request, reply) => {
  const parsed = z.object({ projectKey: z.string().min(1).max(120) }).safeParse(request.query)
  if (!parsed.success) {
    await reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() })
    return
  }
  const { getSessionsForProject } = await import('./database.js')
  const sessions = getSessionsForProject(parsed.data.projectKey).map((session) => ({
    provider: session.provider,
    sessionKey: session.sessionKey,
    month: session.month,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    messageCount: session.messageCount,
    model: session.model,
    weightedTokens:
      session.inputTokens + session.outputTokens + session.cacheReadTokens + session.cacheWriteTokens,
  }))
  return { sessions }
})

app.get('/api/sessions/detail', async (request, reply) => {
  const parsed = z
    .object({
      provider: z.enum(['claude', 'codex']),
      sessionKey: z.string().min(1).max(120),
    })
    .safeParse(request.query)
  if (!parsed.success) {
    await reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() })
    return
  }

  const [{ getSessionReference }, { buildResumeCommand, readSessionPreview }] = await Promise.all([
    import('./database.js'),
    import('./sessionPreview.js'),
  ])
  const reference = getSessionReference(parsed.data.provider, parsed.data.sessionKey)
  if (!reference) {
    return { available: false }
  }

  const transcriptExists = existsSync(reference.sourcePath)
  return {
    available: true,
    transcriptExists,
    preview: transcriptExists
      ? await readSessionPreview(reference.sourcePath, parsed.data.provider)
      : undefined,
    resume: buildResumeCommand(
      parsed.data.provider,
      reference.nativeSessionId,
      reference.workingDirectory,
      existsSync(reference.workingDirectory),
    ),
  }
})
```

このエンドポイントは生のパスとセッションIDを扱う唯一の場所である。利用者が1件ずつ明示的に要求したときだけ返す。一覧APIの側には含めない。

- [ ] **Step 6: クライアント型と関数を足す**

`src/client/types.ts` に追加する。

```ts
export type SessionSummary = {
  provider: ProviderKey
  sessionKey: string
  month: string
  startedAt: string
  endedAt: string
  messageCount: number
  model: string | null
  weightedTokens: number
}

export type SessionDetail = {
  available: boolean
  transcriptExists?: boolean
  preview?: string
  resume?: {
    command: string
    changeDirectory?: string
    resume: string
    workingDirectoryExists: boolean
  }
}
```

`src/client/api.ts` に追加する。

```ts
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
```

- [ ] **Step 7: プライバシー回帰テストを足す**

`tests/server/server.integration.test.ts` の、フェーズ1で追加した生識別子の漏出検査に1件足す。**一覧API `/api/sessions` には生識別子が出てはならない。**

```ts
  it('セッション一覧に生の識別子が出ない', async () => {
    const response = await getJson(
      `/api/sessions?projectKey=${encodeURIComponent('project_integration_a')}`,
    )
    const serialized = JSON.stringify(response)
    expect(serialized).not.toContain('RAW-SESSION-ID-SHOULD-NOT-LEAK')
    expect(serialized).not.toContain('RAW-PATH-SHOULD-NOT-LEAK')
    expect(serialized).not.toContain('RAW-CWD-SHOULD-NOT-LEAK')
  })
```

`project_integration_a` と各定数は、フェーズ1で追加した既存テストが使っている値に合わせること。ファイルを読んで実際の名前を確認する。

- [ ] **Step 8: 確認してコミット**

Run: `npm run typecheck && npm test && npm run format:check`
Expected: すべて PASS

```bash
git add src/server/sessionPreview.ts tests/server/sessionPreview.test.ts src/server/database.ts src/server/index.ts src/client/types.ts src/client/api.ts tests/server/server.integration.test.ts
git commit -m "feat: expose session previews and resume commands

Deciding what a folder was for needs a hint of what happened in it. The
prompt body is read from the provider's own file on demand and never
written to our database."
```

---

## Task 7: セッション詳細の表示

**Files:**
- Modify: `src/client/pages/FolderAssignmentPage.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `getSessions(projectKey)`、`getSessionDetail(provider, sessionKey)`（Task 6）

- [ ] **Step 1: 行の展開を足す**

`FolderAssignmentPage` に展開状態とセッションの state を足す。

```tsx
const [expanded, setExpanded] = useState<string | null>(null)
const [sessions, setSessions] = useState<Record<string, SessionSummary[]>>({})
const [details, setDetails] = useState<Record<string, SessionDetail>>({})

async function toggleFolder(projectKey: string) {
  if (expanded === projectKey) {
    setExpanded(null)
    return
  }
  setExpanded(projectKey)
  if (!sessions[projectKey]) {
    const result = await getSessions(projectKey)
    setSessions((current) => ({ ...current, [projectKey]: result.sessions }))
  }
}

async function loadDetail(provider: ProviderKey, sessionKey: string) {
  const key = `${provider}:${sessionKey}`
  if (details[key]) return
  const detail = await getSessionDetail(provider, sessionKey)
  setDetails((current) => ({ ...current, [key]: detail }))
}
```

各行に展開ボタンを置く。

```tsx
<button
  className="text-button assignment-expand"
  onClick={() => toggleFolder(folder.projectKey)}
  aria-expanded={expanded === folder.projectKey}
>
  {expanded === folder.projectKey ? 'セッションを閉じる' : 'セッションを見る'}
</button>
```

展開時にセッション一覧を出す。各セッションに「何をしたか」を読むボタンを置く。読み込み済みならプレビューと resume コマンドを表示する。

```tsx
{expanded === folder.projectKey && (
  <div className="assignment-sessions">
    {(sessions[folder.projectKey] ?? []).map((session) => {
      const key = `${session.provider}:${session.sessionKey}`
      const detail = details[key]
      return (
        <article key={key}>
          <div className="session-head">
            <strong>{session.startedAt.slice(0, 10)}</strong>
            <span>{PROVIDER_LABELS[session.provider]}</span>
            <span>{session.messageCount}メッセージ</span>
            <span>{session.model ?? 'モデル不明'}</span>
            {!detail && (
              <button
                className="text-button"
                onClick={() => loadDetail(session.provider, session.sessionKey)}
              >
                内容を確認
              </button>
            )}
          </div>
          {detail && (
            <div className="session-detail">
              {detail.available === false ? (
                <p className="session-missing">
                  この履歴の参照情報がありません。再度スキャンすると復元されます。
                </p>
              ) : detail.transcriptExists === false ? (
                <p className="session-missing">
                  元の履歴は削除済みです。集計値だけが残っています。
                </p>
              ) : (
                <p className="session-preview">{detail.preview ?? '内容を取得できませんでした。'}</p>
              )}
              {detail.resume && (
                <div className="session-resume">
                  <code>{detail.resume.command}</code>
                  <button
                    className="text-button"
                    onClick={() => navigator.clipboard?.writeText(detail.resume!.command)}
                  >
                    コピー
                  </button>
                  {!detail.resume.workingDirectoryExists && (
                    <small>作業フォルダが見つかりません</small>
                  )}
                </div>
              )}
            </div>
          )}
        </article>
      )
    })}
    {(sessions[folder.projectKey] ?? []).length === 0 && (
      <p className="assignment-empty">セッションを読み込んでいます…</p>
    )}
  </div>
)}
```

`navigator.clipboard` はセキュアコンテキストでのみ使える。`127.0.0.1` はセキュアコンテキストとして扱われるため利用できるが、`?.` で存在を確認してから呼ぶこと。

- [ ] **Step 2: スタイルを足す**

```css
.assignment-expand {
  grid-column: 1 / -1;
  justify-self: start;
}
.assignment-sessions {
  grid-column: 1 / -1;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--line);
  display: grid;
  gap: 10px;
}
.assignment-sessions article {
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: 10px;
  display: grid;
  gap: 6px;
}
.session-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: var(--muted);
}
.session-head strong {
  color: inherit;
  font-size: 14px;
}
.session-preview {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f5f6fa;
  font-size: 13px;
  line-height: 1.6;
}
.session-missing {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}
.session-resume {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.session-resume code {
  padding: 6px 9px;
  border-radius: 7px;
  background: #171d30;
  color: #e8ebf5;
  font-size: 12px;
  overflow-x: auto;
  max-width: 100%;
}
.session-resume small {
  color: #9a6b13;
}
```

- [ ] **Step 3: 確認してコミット**

Run: `npm run typecheck && npm run build && npm test && npm run format:check`

手で確認すること。フォルダを展開するとセッションが並ぶ。「内容を確認」で最初の発言が出る。resume コマンドがコピーできる。

```bash
git add src/client/pages/FolderAssignmentPage.tsx src/index.css
git commit -m "feat: show session previews and resume commands in the assignment screen"
```

---

## Task 8: 配賦明細からの割当変更

明細を見ながら「この月のこのフォルダは分類が違う」と気づいたとき、その場で直せるようにする。変更はその月の初日を開始日とするルールとして保存する。

**Files:**
- Modify: `src/server/dashboard.ts`
- Modify: `src/client/types.ts`
- Modify: `src/App.tsx`
- Test: `tests/server/server.integration.test.ts`

**Interfaces:**
- Consumes: `savePlanningRules`（Task 3）
- Produces: `Allocation.projectKey` と `Allocation.monthKey` を追加

- [ ] **Step 1: 失敗するテストを書く**

`tests/server/server.integration.test.ts` に追加する。

```ts
  it('配賦明細の行が元のフォルダと月を持つ', async () => {
    const dashboard = await getJson('/api/dashboard')
    const row = dashboard.allocations.find(
      (item: { stage: string }) => item.stage !== '未取得' && item.stage !== '1円未満調整',
    )
    expect(row.projectKey).toBeTruthy()
    expect(row.monthKey).toMatch(/^\d{4}-\d{2}$/)
  })
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run tests/server/server.integration.test.ts`
Expected: FAIL。`projectKey` が undefined。

- [ ] **Step 3: Allocation に情報を足す**

`src/client/types.ts` の `Allocation` に3つ足す。`ProjectClassification` は `../planning/types` から import する。

```ts
  projectKey?: string
  monthKey?: string
  classification?: ProjectClassification
```

配賦の全行が持つわけではない（未取得利用と丸め調整は持たない）ため任意とする。`classification` を持つ理由は、明細のセレクトが現在値を表示するのに `taxCandidate`（「取得価額」などの表示用文字列）ではなく元の分類値を必要とするためである。

`src/server/dashboard.ts` の `allocationForGroup` の返り値に足す。

```ts
    projectKey: group.projectKey,
    monthKey: group.month,
    classification: group.classification,
```

`unobservedAllocation` には足さない。

- [ ] **Step 4: 明細に編集を足す**

`src/App.tsx` の `EvidencePage` に、割当変更のためのセレクトを足す。props に `planning`、`onSaveRules`、`busy` を渡す。

税務候補の列を、表示のみから編集可能へ変える。

```tsx
<td>
  {row.projectKey && row.monthKey ? (
    <select
      value={row.classification ?? 'unclassified'}
      disabled={busy}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) =>
        onReclassify(row, event.target.value as ProjectClassification)
      }
      aria-label={`${row.month} ${row.product}の分類を変更`}
    >
      {Object.entries(CLASSIFICATION_LABELS).map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  ) : (
    <span className={`tax-chip ${GROUP_CLASS[row.group]}`}>{row.taxCandidate}</span>
  )}
</td>
```

`onReclassify` を `App` に置く。

```tsx
async function reclassifyAllocation(row: Allocation, classification: ProjectClassification) {
  if (!row.projectKey || !row.monthKey) return
  const effectiveFrom = `${row.monthKey}-01`
  const id = `rule-${row.projectKey.slice(-12)}-${effectiveFrom}`
  const existing = planning.projectRules.find((rule) => rule.id === id)
  const others = planning.projectRules.filter((rule) => rule.id !== id)

  await storeRules([
    ...others,
    {
      id,
      projectKey: row.projectKey,
      effectiveFrom,
      effectiveTo: existing?.effectiveTo,
      taxUnitId: existing?.taxUnitId,
      classification,
      reason: '配賦明細から変更',
    },
  ])
}
```

`CLASSIFICATION_LABELS` は `FolderAssignmentPage` にあるものを `shared.tsx` へ移して両方から使う。

行のクリックで根拠パネルが切り替わるため、セレクトの `onClick` で `stopPropagation` を呼ぶこと。これを忘れると、分類を変えるたびに選択行が動く。

- [ ] **Step 5: 確認してコミット**

Run: `npm run typecheck && npm run build && npm test && npm run format:check && npm run lint && npm run privacy:check`
Expected: すべて PASS

手で確認すること。明細の分類を変えると保存され、金額のグループ（今年の費用／将来／要確認）が変わる。

```bash
git add src/server/dashboard.ts src/client/types.ts src/App.tsx src/client/pages/shared.tsx tests/server/server.integration.test.ts
git commit -m "feat: let the allocation detail reclassify a folder-month

A change made here becomes a rule effective from the first of that month,
so the intent 'May was different' is recorded as 'from May 1st'."
```

---

## 完了条件

- [ ] `npm run typecheck`、`npm test`、`npm run build`、`npm run lint`、`npm run format:check`、`npm run privacy:check` がすべて通る
- [ ] 実履歴でスキャンした状態で、割当画面に全フォルダが並ぶ
- [ ] 制作物と分類を割り当てると、ダッシュボードの `classifiedRate` が0%から上がる
- [ ] 複数選択してまとめて割り当てられる
- [ ] フォルダを展開してセッションの内容と resume コマンドが見られる
- [ ] 配賦明細から分類を変更できる
- [ ] `/api/sessions` のレスポンスに生の識別子が含まれない

## フェーズ2bへ引き継ぐこと

次の計画で扱う。本計画では触らない。

- B2（AI料金が未入力のまま保存できる）、I1（月額の全月一律適用と契約期間の日付入力）
- I2（モーダルのフッターがコンテンツに重なる）、I3（空状態の未整備）
- I4（「2026-01月」表示）、I6（棒グラフの aria-label がハードコード）、I7（古い注記）
- M4（ステップ4の必須チェックが実質無効）、M5（モーダルのフォーカストラップとEscape）、M6（`<tr role="button">`）
- B3（READMEの「実装済み」と実装の不一致）
- フェーズ1から持ち越した孤児CSSの整理
