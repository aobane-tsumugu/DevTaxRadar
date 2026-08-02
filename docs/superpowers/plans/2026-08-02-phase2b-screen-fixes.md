# フェーズ2b（画面まわりの残バグ修正）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設計書 8.2 のうちフェーズ2で扱うと決めた 13 件（B2・B3・I1・I2・I3・I4・I5・I6・I7・M4・M5・M6・M8）を修正し、公開できる状態にする。

**Architecture:** 大きく3系統に分かれる。(1) 契約期間を `provider_settings` へ日付で持たせ、契約外の月とセッションを配賦から外す（I1・B2・M4）。(2) オンボーディングのモーダルを、重なりのないレイアウトとフォーカス制御へ直す（I2・M5）。(3) 表示の小さな誤りと空状態、スキャン進捗、README の記述を直す（I3・I4・I6・I7・M6・M8・B3・I5）。既存の配賦エンジン（`src/core/allocation.ts`）には手を入れない。契約期間の判定は集計層（`src/server/dashboard.ts`）で行い、エンジンには「配賦対象の月と利用行」だけを渡す。

**Tech Stack:** TypeScript 6 / React 19 / Fastify 5 / zod 4 / `node:sqlite` の `DatabaseSync` / vitest 4 / Prettier 3 / oxlint

## Global Constraints

- 絵文字を使わない。ファイルは UTF-8（BOM なし）、改行は LF。Windows 環境で文字化けしない文字だけを使う
- コードスタイルは Prettier 設定に従う（`singleQuote: true`、`semi: false`、`printWidth: 100`）。編集後に `npm run format` を実行する
- 各タスクのコミット前に `npm test`・`npm run typecheck`・`npm run lint`・`npm run format:check`・`npm run privacy:check` をすべて実行し、通ることを確認する。`lint` は error 0 が条件（既存の `only-export-components` warning は許容）
- 検証はコミット済みのテストで行う。使い捨てスクリプトを実行した結果を「テスト済み」と報告しない。テストが書けない場合は、書けない理由を報告する
- ローカル参照（生セッションID・絶対パス・作業ディレクトリ）を `session_references` テーブルの外へ出さない。`/api/dashboard` などの応答へ混ぜない
- 配賦不変条件（provider×月の配賦合計＝その月の月額）を壊さない。`assertAllocationInvariant` を無効化・迂回しない
- 画面文言は日本語の敬体。専門用語には短い補足を添える
- 内部表現は日付が `YYYY-MM-DD`、月が `YYYY-MM`。画面表示は `YYYY年M月`
- 日付の比較はローカルタイム基準で行う（`src/adapters/localTime.ts` の `localDateFromTimestamp`）。ISO 文字列を `slice` して月日を取り出さない

---

## タスク一覧

| # | 内容 | 対象ID |
|---|---|---|
| 1 | 契約期間カラムの追加と設定の読み書き | I1 |
| 2 | 契約期間にもとづく配賦の絞り込み | I1 |
| 3 | 月額の未入力警告と契約期間の入力欄 | B2・M4・I1 |
| 4 | モーダルのフッター配置 | I2 |
| 5 | モーダルのフォーカストラップと Escape | M5 |
| 6 | 表示の小修正 | I4・I6・I7・M6 |
| 7 | 空状態の整備 | I3 |
| 8 | スキャン進捗の表示 | M8 |
| 9 | 仕上げ（ledger クエリ・README・CSS 整理） | I5・B3 |

---

### Task 1: 契約期間カラムの追加と設定の読み書き

**Files:**
- Modify: `src/server/database.ts`（`LocalConfiguration` 型・スキーマ・マイグレーション・`getConfiguration`・`saveConfiguration`）
- Modify: `src/client/types.ts:92-100`（`LocalConfiguration` の重複定義）
- Modify: `src/server/index.ts:188-220`（`configurationSchema`）
- Create: `tests/server/helpers/configuration-probe.ts`
- Create: `tests/server/configuration.test.ts`
- Modify: `tests/server/server.integration.test.ts`

**Interfaces:**
- Consumes: なし（このタスクが最初）
- Produces:
  ```ts
  // src/server/database.ts と src/client/types.ts の両方に同じ形で定義する
  export type ProviderContract = {
    startedOn?: string // 'YYYY-MM-DD'
    endedOn?: string // 'YYYY-MM-DD'
  }

  export type LocalConfiguration = {
    charges: { claude: number; codex: number }
    monthlyCharges: Array<{ provider: 'claude' | 'codex'; month: string; amountJpy: number }>
    contracts: { claude: ProviderContract; codex: ProviderContract }
    unobservedRatio: number
  }
  ```
  `contracts` は必須プロパティで、値が未設定のときは `{}`（両フィールドとも `undefined`）を返す。

**背景:** いま月額は「履歴のある全月」へ一律に適用される。7月18日に契約を開始しても7月1日からの利用へ月額が配賦されてしまう。契約期間を日付で持たせて、この不整合を消す。日割りは行わない（領域2で扱う）。

- [ ] **Step 1: 失敗するテストを書く（DB 往復）**

`tests/server/helpers/configuration-probe.ts` を作る。`tests/server/helpers/database-probe.ts` と同じく、`DEVTAX_RADAR_DATA_DIR` を渡した子プロセスで動かす前提のスクリプト。

```ts
import { getConfiguration, saveConfiguration } from '../../../src/server/database.ts'

if (!process.env.DEVTAX_RADAR_DATA_DIR) {
  throw new Error('DEVTAX_RADAR_DATA_DIR is required')
}

const initial = getConfiguration()

saveConfiguration({
  charges: { claude: 30000, codex: 20000 },
  monthlyCharges: [{ provider: 'claude', month: '2026-07', amountJpy: 30000 }],
  contracts: {
    claude: { startedOn: '2026-07-18' },
    codex: { startedOn: '2026-01-05', endedOn: '2026-05-31' },
  },
  unobservedRatio: 0.1,
})

const saved = getConfiguration()

saveConfiguration({ ...saved, contracts: { claude: {}, codex: {} } })
const cleared = getConfiguration()

process.stdout.write(JSON.stringify({ initial, saved, cleared }))
```

`tests/server/configuration.test.ts` を作る。

```ts
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { LocalConfiguration } from '../../src/server/database.ts'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

describe('provider contract periods', () => {
  it('stores contract dates per provider and clears them again', () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), 'devtax-config-'))
    temporaryDirectories.push(dataDirectory)

    const stdout = execFileSync(
      process.execPath,
      ['--import', 'tsx', resolve('tests/server/helpers/configuration-probe.ts')],
      {
        cwd: resolve('.'),
        encoding: 'utf8',
        env: { ...process.env, DEVTAX_RADAR_DATA_DIR: dataDirectory },
      },
    )
    const result = JSON.parse(stdout) as {
      initial: LocalConfiguration
      saved: LocalConfiguration
      cleared: LocalConfiguration
    }

    expect(result.initial.contracts).toEqual({ claude: {}, codex: {} })
    expect(result.saved.contracts).toEqual({
      claude: { startedOn: '2026-07-18' },
      codex: { startedOn: '2026-01-05', endedOn: '2026-05-31' },
    })
    expect(result.cleared.contracts).toEqual({ claude: {}, codex: {} })
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run tests/server/configuration.test.ts`
Expected: FAIL。`contracts` が `LocalConfiguration` に無いため型エラー、または `undefined` との比較で落ちる。

- [ ] **Step 3: 型を追加する**

`src/server/database.ts:25-33` の `LocalConfiguration` を、上の Interfaces に書いた形へ差し替える。`ProviderContract` も同じファイルで `export` する。

`src/client/types.ts:92-100` の `LocalConfiguration` にも同じ `contracts` を追加する。クライアント側は `ProviderKey` を使っているため、次の形にする。

```ts
export type ProviderContract = {
  startedOn?: string
  endedOn?: string
}

export type LocalConfiguration = {
  charges: Record<ProviderKey, number>
  monthlyCharges: Array<{
    provider: ProviderKey
    month: string
    amountJpy: number
  }>
  contracts: Record<ProviderKey, ProviderContract>
  unobservedRatio: number
}
```

- [ ] **Step 4: マイグレーションを書く**

`src/server/database.ts` の既存マイグレーション群（`PRAGMA table_info(scans)` を使っている箇所、285行付近）のすぐ後ろへ、同じ書き方で追加する。`provider_settings` は `STRICT` テーブルだが、`NULL` 許容の `TEXT` 列の追加は問題ない。

```ts
const providerSettingsColumns = new Set(
  (
    database.prepare(`PRAGMA table_info(provider_settings)`).all() as Array<{ name: string }>
  ).map((column) => column.name),
)
if (!providerSettingsColumns.has('contract_started_on')) {
  database.exec('ALTER TABLE provider_settings ADD COLUMN contract_started_on TEXT')
}
if (!providerSettingsColumns.has('contract_ended_on')) {
  database.exec('ALTER TABLE provider_settings ADD COLUMN contract_ended_on TEXT')
}
```

新規作成側（`CREATE TABLE IF NOT EXISTS provider_settings`、110-113行）にも同じ2列を書き足す。既存DBはマイグレーションで、新規DBは `CREATE TABLE` で、どちらも同じ形になる。

```sql
CREATE TABLE IF NOT EXISTS provider_settings (
  provider TEXT PRIMARY KEY,
  monthly_fee_jpy INTEGER NOT NULL DEFAULT 0,
  contract_started_on TEXT,
  contract_ended_on TEXT
) STRICT;
```

- [ ] **Step 5: 読み書きを実装する**

`getConfiguration`（527行付近）の provider 読み出しを次へ差し替える。

```ts
const providerRows = db
  .prepare(
    `SELECT provider, monthly_fee_jpy AS amount,
            contract_started_on AS startedOn, contract_ended_on AS endedOn
     FROM provider_settings`,
  )
  .all() as Array<{
  provider: string
  amount: number
  startedOn: string | null
  endedOn: string | null
}>
const byProvider = new Map(providerRows.map((row) => [row.provider, row]))

function contractFor(provider: 'claude' | 'codex'): ProviderContract {
  const row = byProvider.get(provider)
  const contract: ProviderContract = {}
  if (row?.startedOn) contract.startedOn = row.startedOn
  if (row?.endedOn) contract.endedOn = row.endedOn
  return contract
}
```

戻り値は次のようにする。

```ts
return {
  charges: {
    claude: Number(byProvider.get('claude')?.amount ?? 0),
    codex: Number(byProvider.get('codex')?.amount ?? 0),
  },
  monthlyCharges,
  contracts: { claude: contractFor('claude'), codex: contractFor('codex') },
  unobservedRatio: Number(ratioRow?.value ?? 0.1),
}
```

`saveConfiguration` の `updateCharge` を次へ差し替える。空文字ではなく `null` を書く（空文字が入ると `startedOn` が truthy な空文字として読み出されるため）。

```ts
const updateCharge = db.prepare(`
  UPDATE provider_settings
  SET monthly_fee_jpy = ?, contract_started_on = ?, contract_ended_on = ?
  WHERE provider = ?
`)
```

呼び出し側。

```ts
for (const provider of ['claude', 'codex'] as const) {
  const contract = configuration.contracts[provider]
  updateCharge.run(
    configuration.charges[provider],
    contract?.startedOn ?? null,
    contract?.endedOn ?? null,
    provider,
  )
}
```

- [ ] **Step 6: テストが通ることを確認する**

Run: `npx vitest run tests/server/configuration.test.ts`
Expected: PASS

- [ ] **Step 7: API スキーマを拡張する**

`src/server/index.ts:188` の `configurationSchema` に `contracts` を足す。`.strict()` があるため、これを入れないと画面からの保存が 400 になる。

```ts
const contractDateSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, {
  message: '日付は YYYY-MM-DD で入力してください。',
})

const providerContractSchema = z
  .object({
    startedOn: contractDateSchema.optional(),
    endedOn: contractDateSchema.optional(),
  })
  .strict()
  .refine(
    (contract) =>
      !contract.startedOn || !contract.endedOn || contract.startedOn <= contract.endedOn,
    { message: '契約終了日は開始日以降にしてください。' },
  )
```

`configurationSchema` の `monthlyCharges` の次へ追加する。

```ts
    contracts: z
      .object({
        claude: providerContractSchema,
        codex: providerContractSchema,
      })
      .strict()
      .default({ claude: {}, codex: {} }),
```

- [ ] **Step 8: 統合テストを更新する**

`tests/server/server.integration.test.ts` の設定往復部分（196-223行付近）を更新する。`configuration` オブジェクトへ `contracts` を足し、`storedConfiguration` の `toEqual` にも `contracts` を含める。

```ts
      contracts: {
        claude: { startedOn: '2026-04-01' },
        codex: {},
      },
```

`toEqual` はこうなる。

```ts
    expect(storedConfiguration).toEqual({
      charges: configuration.charges,
      monthlyCharges: configuration.monthlyCharges,
      contracts: configuration.contracts,
      unobservedRatio: configuration.unobservedRatio,
    })
```

同じファイルの `duplicateChargeResponse` の後ろへ、日付が逆順のときに 400 になることを確かめるケースを足す。

```ts
    const invalidContractResponse = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${port}`,
        'x-devtax-csrf': runtime.csrfToken,
      },
      body: JSON.stringify({
        ...configuration,
        contracts: { claude: { startedOn: '2026-07-01', endedOn: '2026-06-30' }, codex: {} },
      }),
    })
    expect(invalidContractResponse.status).toBe(400)
```

- [ ] **Step 9: 全テストを実行する**

Run: `npm test && npm run typecheck && npm run lint && npm run format:check && npm run privacy:check`
Expected: すべて成功。`src/client/pages/Onboarding.tsx` が `contracts` を渡していないため型エラーが出る場合は、`onSave` へ渡すオブジェクトへ `contracts: configuration?.contracts ?? { claude: {}, codex: {} }` を暫定で足して通す（本格的な入力欄は Task 3 で作る）。

- [ ] **Step 10: コミット**

```bash
git add src/server/database.ts src/client/types.ts src/server/index.ts src/client/pages/Onboarding.tsx tests/server/configuration.test.ts tests/server/helpers/configuration-probe.ts tests/server/server.integration.test.ts
git commit -m "feat: store provider contract periods as dates"
```

---

### Task 2: 契約期間にもとづく配賦の絞り込み

**Files:**
- Create: `src/server/contractPeriod.ts`
- Create: `tests/server/contractPeriod.test.ts`
- Modify: `src/server/dashboard.ts`

**Interfaces:**
- Consumes: Task 1 の `LocalConfiguration['contracts']` と `ProviderContract`
- Produces:
  ```ts
  export function contractCoversMonth(contract: ProviderContract | undefined, month: string): boolean
  export function contractCoversDate(contract: ProviderContract | undefined, date: string): boolean
  export function hasAnyContractPeriod(contracts: Record<'claude' | 'codex', ProviderContract>): boolean
  ```

**背景:** 設計書 8.3 の適用規則をここで実装する。契約期間と重ならない暦月には月額を適用しない。契約期間外のセッションは配賦の分母から外すが、明細からは消さず「契約期間外」として金額0で残す。消してしまうと「なぜこの利用が計上されていないのか」を説明できなくなる。

- [ ] **Step 1: 失敗するテストを書く**

`tests/server/contractPeriod.test.ts` を作る。

```ts
import { describe, expect, it } from 'vitest'
import {
  contractCoversDate,
  contractCoversMonth,
  hasAnyContractPeriod,
} from '../../src/server/contractPeriod.ts'

describe('contractCoversMonth', () => {
  it('covers every month when no dates are set', () => {
    expect(contractCoversMonth({}, '2026-01')).toBe(true)
    expect(contractCoversMonth(undefined, '2026-01')).toBe(true)
  })

  it('excludes months entirely before the start date', () => {
    expect(contractCoversMonth({ startedOn: '2026-07-18' }, '2026-06')).toBe(false)
    expect(contractCoversMonth({ startedOn: '2026-07-18' }, '2026-07')).toBe(true)
    expect(contractCoversMonth({ startedOn: '2026-07-18' }, '2026-08')).toBe(true)
  })

  it('excludes months entirely after the end date', () => {
    expect(contractCoversMonth({ endedOn: '2026-05-02' }, '2026-05')).toBe(true)
    expect(contractCoversMonth({ endedOn: '2026-05-02' }, '2026-06')).toBe(false)
  })

  it('handles the last day of a month at both edges', () => {
    expect(contractCoversMonth({ startedOn: '2026-02-28' }, '2026-02')).toBe(true)
    expect(contractCoversMonth({ endedOn: '2026-02-01' }, '2026-02')).toBe(true)
  })
})

describe('contractCoversDate', () => {
  it('covers every date when no dates are set', () => {
    expect(contractCoversDate({}, '2026-07-01')).toBe(true)
  })

  it('excludes dates before the start and after the end', () => {
    const contract = { startedOn: '2026-07-18', endedOn: '2026-09-30' }
    expect(contractCoversDate(contract, '2026-07-17')).toBe(false)
    expect(contractCoversDate(contract, '2026-07-18')).toBe(true)
    expect(contractCoversDate(contract, '2026-09-30')).toBe(true)
    expect(contractCoversDate(contract, '2026-10-01')).toBe(false)
  })
})

describe('hasAnyContractPeriod', () => {
  it('is false only when both providers are empty', () => {
    expect(hasAnyContractPeriod({ claude: {}, codex: {} })).toBe(false)
    expect(hasAnyContractPeriod({ claude: { startedOn: '2026-01-01' }, codex: {} })).toBe(true)
    expect(hasAnyContractPeriod({ claude: {}, codex: { endedOn: '2026-01-01' } })).toBe(true)
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run tests/server/contractPeriod.test.ts`
Expected: FAIL。`src/server/contractPeriod.ts` が存在しない。

- [ ] **Step 3: 実装する**

`src/server/contractPeriod.ts` を作る。日付は `YYYY-MM-DD` の固定長で、辞書順比較が日付順比較と一致する。`31` を月の上限として使うのは、その月に実在するどの日付も `YYYY-MM-31` 以下だからで、実在しない日付を作っているわけではない。

```ts
import type { ProviderContract } from './database.js'

// 'YYYY-MM-DD' is fixed width, so lexicographic order equals chronological
// order. No Date object is constructed here: parsing would reintroduce the
// timezone shift that section 5.1 of the design removed.
export function contractCoversDate(
  contract: ProviderContract | undefined,
  date: string,
): boolean {
  if (contract?.startedOn && date < contract.startedOn) return false
  if (contract?.endedOn && date > contract.endedOn) return false
  return true
}

export function contractCoversMonth(
  contract: ProviderContract | undefined,
  month: string,
): boolean {
  // Any real date inside `month` sorts between these two bounds, so the month
  // overlaps the contract unless it falls entirely outside it.
  const firstPossibleDay = `${month}-01`
  const lastPossibleDay = `${month}-31`
  if (contract?.startedOn && contract.startedOn > lastPossibleDay) return false
  if (contract?.endedOn && contract.endedOn < firstPossibleDay) return false
  return true
}

export function hasAnyContractPeriod(
  contracts: Record<'claude' | 'codex', ProviderContract>,
): boolean {
  return (['claude', 'codex'] as const).some(
    (provider) => Boolean(contracts[provider]?.startedOn) || Boolean(contracts[provider]?.endedOn),
  )
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run tests/server/contractPeriod.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/server/contractPeriod.ts tests/server/contractPeriod.test.ts
git commit -m "feat: add contract period predicates"
```

- [ ] **Step 6: dashboard へ組み込む（セッションの振り分け）**

`src/server/dashboard.ts` の `buildDashboard`（225行）で、`assigned` を作った直後（235行の後ろ）へ振り分けを入れる。

先頭の import へ追加する。

```ts
import { localDateFromTimestamp } from '../adapters/localTime.js'
import {
  contractCoversDate,
  contractCoversMonth,
  hasAnyContractPeriod,
} from './contractPeriod.js'
```

`assigned` の直後。

```ts
  const contracts = configuration.contracts
  const contractsConfigured = hasAnyContractPeriod(contracts)
  // A session whose timestamp cannot be read is kept inside the contract:
  // dropping money from the allocation because of an unparsable timestamp
  // would be a worse failure than including it.
  const withinContract = (session: AssignedSession): boolean => {
    const startedOn = localDateFromTimestamp(session.startedAt)
    if (startedOn === undefined) return true
    return contractCoversDate(contracts[session.provider], startedOn)
  }
  const coveredSessions = assigned.filter(withinContract)
  const outOfContractSessions = assigned.filter((session) => !withinContract(session))
```

`groups` を作るループ（243行の `for (const session of assigned)`）の対象を `coveredSessions` へ変える。`classifiedSessions` と `mappedSessions`（237-240行）は割当の進捗を示す指標なので `assigned` のままにする。

- [ ] **Step 7: dashboard へ組み込む（月の絞り込み）**

`providerMonthKeys`（301行）を契約でフィルタする。

```ts
  const providerMonthKeys = new Set(
    [...byProviderMonth.keys(), ...monthlyChargeByKey.keys()].filter((key) => {
      const [provider, month] = key.split(':') as [UsageProvider, string]
      return contractCoversMonth(contracts[provider], month)
    }),
  )
```

- [ ] **Step 8: dashboard へ組み込む（契約期間外の明細行）**

`unobservedAllocation`（189行）の下へ、契約期間外の行を作る関数を足す。`Allocation` の全フィールドを埋める。

```ts
function outOfContractAllocation(
  session: AssignedSession,
  taxUnitById: Map<string, TaxUnitRecord>,
): Allocation {
  return {
    // sessionKey alone is not unique: sessionAggregation splits a session that
    // crosses a month boundary into one row per month, so two rows can share it.
    // React keys off Allocation.id, and a duplicate id silently drops a row.
    id: `out-of-contract-${session.provider}-${session.month}-${session.projectKey}-${session.sessionKey}`,
    month: displayBillingMonth(session.month),
    provider: providerLabel[session.provider],
    product: displayProject(
      session.projectKey,
      session.projectLabel,
      session.assignment.taxUnitId,
      taxUnitById,
    ),
    asset: '対象外',
    stage: '契約期間外',
    usageRate: 0,
    amount: 0,
    group: 'review',
    taxCandidate: '契約期間外',
    confidence: 'C',
    rule: '契約期間外の利用は月額の配賦対象から除外',
    reason:
      '入力された契約期間の外で使われたセッションです。この月の月額には含めていません。契約期間が誤っていれば、はじめの準備の費用ステップで直せます。',
    missing: '契約の開始日・終了日が正しいか確認してください。',
    session: {
      // The exclusion decision is made on the local date, so show that date.
      // The raw ISO timestamp would display a UTC calendar day that can differ
      // from the day the rule actually used.
      date: localDateFromTimestamp(session.startedAt) ?? session.month,
      id: '契約期間外',
      folder: safeLocalLabel(session.projectLabel, `Project ${session.projectKey.slice(-6)}`),
      branch: '対象外',
      model: session.model ?? '不明',
      tokens: 0,
      classification: '契約期間外',
      manualEdit: '契約期間の入力',
    },
  }
}
```

配賦ループ（332-347行）の後ろで、契約期間外の行を追加する。

```ts
  for (const session of outOfContractSessions) {
    allocations.push(outOfContractAllocation(session, taxUnitById))
  }
```

`AssignedSession` 型・`safeLocalLabel`・`providerLabel`・`displayProject`・`TaxUnitRecord` はすべて同ファイル内に既にある。新たな import は不要。金額が 0 なので `assertAllocationInvariant`（配賦エンジンの戻り値に対する検査）には影響しない。

- [ ] **Step 9: 未入力の警告を出す**

`guidance` 配列（512行付近）の先頭へ、契約期間が未入力のときの警告を差し込む。

```ts
    guidance: [
      ...(contractsConfigured
        ? []
        : [
            {
              title: '契約期間が未入力です',
              description:
                '契約期間が未入力のため、履歴のある全月へ同額を適用しています。はじめの準備の費用ステップで契約の開始日（解約済みなら終了日も）を入力すると、契約外の月を配賦から外せます。',
              severity: 'warning' as const,
            },
          ]),
```

既存の要素はそのまま後ろへ残す。

- [ ] **Step 10: 契約期間の効き目を検証するテストを書く**

`tests/server/server.integration.test.ts` は合成セッションを2件登録して `/api/dashboard` を検証している。ここへ検証を足す。契約開始日をセッションの日付より後ろに設定して `/api/config` へ保存し、再取得したダッシュボードで次を確かめる。

```ts
    const laterContractResponse = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${port}`,
        'x-devtax-csrf': runtime.csrfToken,
      },
      body: JSON.stringify({
        ...configuration,
        contracts: { claude: { startedOn: '2030-01-01' }, codex: { startedOn: '2030-01-01' } },
      }),
    })
    expect(laterContractResponse.status).toBe(200)

    const contractDashboard = (await fetch(`http://127.0.0.1:${port}/api/dashboard`).then(
      async (response) => await response.json(),
    )) as DashboardData
    // Every synthetic session predates the contract, so no money is allocated
    // and every session still shows up as an explained zero-yen line.
    expect(contractDashboard.allocations.every((row) => row.amount === 0)).toBe(true)
    expect(
      contractDashboard.allocations.some((row) => row.taxCandidate === '契約期間外'),
    ).toBe(true)
```

`DashboardData` 型はファイル内で既にダッシュボードの検証に使っている型があればそれを使い、無ければ `as { allocations: Array<{ amount: number; taxCandidate: string }> }` で受ける。検証の後は元の `configuration` を保存し直して、後続の assertion へ影響させない。

```ts
    await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${port}`,
        'x-devtax-csrf': runtime.csrfToken,
      },
      body: JSON.stringify(configuration),
    })
```

- [ ] **Step 11: 全テストを実行する**

Run: `npm test && npm run typecheck && npm run lint && npm run format:check && npm run privacy:check`
Expected: すべて成功

- [ ] **Step 12: コミット**

```bash
git add src/server/dashboard.ts tests/server/server.integration.test.ts
git commit -m "feat: exclude out-of-contract months and sessions from allocation"
```

---

### Task 3: 月額の未入力警告と契約期間の入力欄

**Files:**
- Modify: `src/client/pages/Onboarding.tsx`
- Modify: `src/index.css`（`.contract-fields` の追加）

**Interfaces:**
- Consumes: Task 1 の `LocalConfiguration['contracts']`
- Produces: なし（画面のみ）

**背景（B2・M4）:** いま料金欄は `useState(30000)` で初期化され、DB の値 0 で上書きされる。利用者は「30000 と表示されていたのに 0 で保存された」という状態を踏む。初期値を未入力にし、未入力のまま保存しようとしたら一度警告して確認を求める。0 円での保存自体は許す（無料枠や契約前の月がありうる）。

**背景（I1 の入力側）:** Task 1・2 で作った契約期間を、費用ステップから入力できるようにする。

- [ ] **Step 1: 料金の状態を未入力可能にする**

`src/client/pages/Onboarding.tsx:54-55` を差し替える。

```ts
  const [claudeCharge, setClaudeCharge] = useState<number | undefined>(undefined)
  const [codexCharge, setCodexCharge] = useState<number | undefined>(undefined)
```

契約期間の状態を足す（56行の `monthlyCharges` の下）。

```ts
  const [contracts, setContracts] = useState<LocalConfiguration['contracts']>({
    claude: {},
    codex: {},
  })
  // Remember WHICH providers were warned about, not just that a warning fired.
  // A bare boolean goes stale: warn about Claude, then re-select Codex on an
  // earlier step, and the second press would skip the check entirely and save
  // Codex as 0 yen without ever naming it.
  const [confirmedMissingCharges, setConfirmedMissingCharges] = useState<string | null>(null)
```

`LocalConfiguration` は同ファイルで既に import 済み。

- [ ] **Step 2: 設定の反映を「0 は未入力として扱う」へ変える**

94-115行の `useEffect` を差し替える。DB の 0 は「まだ入力していない」の意味なので空欄にする。利用者が意図して 0 を入れた場合も次回は空欄に戻るが、そのときは Step 5 の確認がもう一度出るだけで、金額が勝手に変わることはない。

```ts
  useEffect(() => {
    if (!configuration) return
    setClaudeCharge(configuration.charges.claude > 0 ? configuration.charges.claude : undefined)
    setCodexCharge(configuration.charges.codex > 0 ? configuration.charges.codex : undefined)
    setContracts(configuration.contracts)
    setUnobservedPercent(Math.round(configuration.unobservedRatio * 100))
    const saved = new Map(
      configuration.monthlyCharges.map((charge) => [
        `${charge.provider}:${charge.month}`,
        charge.amountJpy,
      ]),
    )
    setMonthlyCharges(
      data.months.flatMap((month) => {
        const monthKey = monthKeyFromLabel(month.label, planning.profile.taxYear)
        return (['claude', 'codex'] as ProviderKey[]).map((provider) => ({
          provider,
          month: monthKey,
          amountJpy: saved.get(`${provider}:${monthKey}`) ?? configuration.charges[provider],
        }))
      }),
    )
  }, [configuration, data.months, planning.profile.taxYear])
```

- [ ] **Step 3: 入力ハンドラを未入力対応にする**

141-150行の `updateProviderCharge` を差し替える。空欄のとき `event.target.valueAsNumber` は `NaN` になる。

```ts
  function updateProviderCharge(provider: ProviderKey, amount: number | undefined) {
    const normalized = amount === undefined ? undefined : Math.max(0, amount)
    if (provider === 'claude') setClaudeCharge(normalized)
    else setCodexCharge(normalized)
    setConfirmedMissingCharges(null)
    setMonthlyCharges((current) =>
      current.map((charge) =>
        charge.provider === provider ? { ...charge, amountJpy: normalized ?? 0 } : charge,
      ),
    )
  }
```

- [ ] **Step 4: 料金入力欄の JSX を差し替える**

981-1005行の2つの `<input>` を差し替える。`value` に `undefined` を渡すと React が非制御コンポーネントとして扱うため、空文字を渡す。

```tsx
                  <input
                    aria-label="Claude Code 月額"
                    type="number"
                    min="0"
                    placeholder="未入力"
                    value={claudeCharge ?? ''}
                    onChange={(event) =>
                      updateProviderCharge(
                        'claude',
                        Number.isNaN(event.target.valueAsNumber)
                          ? undefined
                          : event.target.valueAsNumber,
                      )
                    }
                  />
```

Codex 側も同じ形にする（`aria-label="Codex 月額"`、`value={codexCharge ?? ''}`、`updateProviderCharge('codex', ...)`）。

- [ ] **Step 5: 未入力の確認を入れる（B2・M4）**

352行の `if (apiUnavailable)` の直前へ、未入力チェックを挟む。これでステップ5（`step === 4`）から保存へ進むときに一度だけ確認が入る。

```ts
    const missingCharges = (['claude', 'codex'] as ProviderKey[]).filter(
      (provider) =>
        selectedProviders.includes(provider) &&
        (provider === 'claude' ? claudeCharge : codexCharge) === undefined,
    )
    const missingKey = missingCharges.join(',')
    if (missingCharges.length > 0 && confirmedMissingCharges !== missingKey) {
      setConfirmedMissingCharges(missingKey)
      setNotice({
        kind: 'error',
        message: `${missingCharges
          .map((provider) => (provider === 'claude' ? 'Claude Code' : 'Codex'))
          .join('と')}の月額が未入力のため、配賦額は0円になります。このまま進める場合は、もう一度「保存する」を押してください。`,
      })
      return
    }
```

`advance` 関数の冒頭で `setNotice(null)` を呼んでいる場合でも、`confirmedMissingCharges` はここでリセットしない。リセットは Step 3 の `updateProviderCharge`（利用者が金額を入れ直したとき）だけで行う。未入力の provider の顔ぶれが変わった場合は、`missingKey` の比較が食い違うため自動的にもう一度警告が出る。

あわせて「戻る」ボタンの `onClick` に `setNotice(null)` を足す。いまは `advance` でしか通知を消していないため、費用ステップで出したエラーが対象年や制作物のステップまで残り続ける。

```tsx
              onClick={() => {
                setNotice(null)
                if (step === 0) onClose()
                else onStep(step - 1)
              }}
```

- [ ] **Step 6: 保存内容へ契約期間と未入力を反映する**

358-365行の `onSave` 呼び出しを差し替える。

```ts
      await onSave({
        charges: {
          claude: Math.max(0, Math.round(claudeCharge ?? 0)),
          codex: Math.max(0, Math.round(codexCharge ?? 0)),
        },
        monthlyCharges,
        contracts,
        unobservedRatio: Math.min(95, Math.max(0, unobservedPercent)) / 100,
      })
```

- [ ] **Step 7: 契約期間の入力欄を足す**

1006行（`{monthlyCharges.length > 0 && (` の直前、`</div>` で `.invoice-box` を閉じた後ろ）へ挿入する。

```tsx
              <div className="contract-fields">
                <div className="contract-heading">
                  <strong>契約期間</strong>
                  <small>
                    入力すると、契約していない月を配賦から外せます。未入力のままでも構いません。その場合は履歴のある全月へ同額を適用します。日割りは行いません。
                  </small>
                </div>
                {(
                  [
                    ['claude', 'Claude Code'],
                    ['codex', 'Codex'],
                  ] as const
                ).map(([provider, label]) => (
                  <div className="contract-row" key={provider}>
                    <strong>{label}</strong>
                    <label>
                      <span>開始日</span>
                      <input
                        aria-label={`${label} 契約開始日`}
                        type="date"
                        value={contracts[provider].startedOn ?? ''}
                        onChange={(event) =>
                          setContracts((current) => ({
                            ...current,
                            [provider]: {
                              ...current[provider],
                              startedOn: event.target.value || undefined,
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>終了日</span>
                      <input
                        aria-label={`${label} 契約終了日`}
                        type="date"
                        value={contracts[provider].endedOn ?? ''}
                        onChange={(event) =>
                          setContracts((current) => ({
                            ...current,
                            [provider]: {
                              ...current[provider],
                              endedOn: event.target.value || undefined,
                            },
                          }))
                        }
                      />
                    </label>
                    <small>解約していない場合、終了日は空のままにしてください。</small>
                  </div>
                ))}
              </div>
```

- [ ] **Step 8: 開始日と終了日の前後関係を画面で止める**

Step 5 の未入力チェックの直前へ足す。サーバ側も 400 を返すが、画面で先に説明したほうが親切。

```ts
    const invalidContract = (['claude', 'codex'] as ProviderKey[]).find((provider) => {
      const contract = contracts[provider]
      return Boolean(
        contract.startedOn && contract.endedOn && contract.startedOn > contract.endedOn,
      )
    })
    if (invalidContract) {
      setNotice({
        kind: 'error',
        message: `${invalidContract === 'claude' ? 'Claude Code' : 'Codex'}の契約終了日は、開始日以降にしてください。`,
      })
      return
    }
```

- [ ] **Step 9: CSS を足す**

`src/index.css` の `.invoice-box` に関するルール群の近く（`.detected-list, .mapping-list, .invoice-box` の定義がある付近）へ足す。既存の変数（`--muted`・`--line`・`--line-strong`）を使う。

```css
.contract-fields {
  margin-top: 18px;
  padding: 16px;
  display: grid;
  gap: 12px;
  border: 1px solid var(--line);
  border-radius: 9px;
}
.contract-heading small {
  display: block;
  margin-top: 4px;
  color: var(--muted);
  line-height: 1.6;
}
.contract-row {
  display: grid;
  grid-template-columns: 120px repeat(2, minmax(0, 1fr));
  gap: 8px 12px;
  align-items: center;
}
.contract-row > small {
  grid-column: 1 / -1;
  color: var(--muted);
}
.contract-row label {
  display: grid;
  gap: 4px;
}
.contract-row label span {
  color: var(--muted);
  font-size: 13px;
}
@media (max-width: 1100px) {
  .contract-row {
    grid-template-columns: minmax(0, 1fr);
  }
}
```

- [ ] **Step 10: 型と整形を確認する**

Run: `npm run typecheck && npm run format && npm run format:check && npm run lint && npm test`
Expected: すべて成功

- [ ] **Step 11: 画面で確認する**

`npm run build` を実行し、`DEVTAX_RADAR_DATA_DIR` を一時ディレクトリへ向けて `npm start` でサーバを起動する。ブラウザで開き、費用ステップで次を確認する。

1. 料金欄が空欄で表示される（`未入力` のプレースホルダ）
2. 空欄のまま「保存する」を押すと未入力の警告が出て、進まない
3. もう一度「保存する」を押すと保存される
4. 契約開始日を入力して保存すると、その月より前の明細が「契約期間外」で金額0になる

確認後、サーバを停止し、一時ディレクトリを削除する。結果は報告ファイルへ書く。

- [ ] **Step 12: コミット**

```bash
git add src/client/pages/Onboarding.tsx src/index.css
git commit -m "feat: require an explicit AI charge and let users enter contract dates"
```

---

### Task 4: モーダルのフッター配置

**Files:**
- Modify: `src/client/pages/Onboarding.tsx:1673-1717`（`.modal-actions` と `notice` の位置）
- Modify: `src/index.css:1469-1481`（`.onboarding-modal`）、`1551-1558`（`.onboarding-body`）、`1914-1923`（`.modal-actions`）、`2229-2240`（メディアクエリ）

**Interfaces:**
- Consumes: なし
- Produces: なし

**背景（I2）:** `.modal-actions` は `.onboarding-body` の中に置かれ、`position: absolute` でスクロール領域の上へ浮いている。`linear-gradient(transparent, #fff 24%)` で下端の文字を隠すため、末尾の入力欄がボタンに重なる。下余白 96px で誤魔化しているが、内容の高さによっては足りない。フッターを独立した行にして、重なりを構造から無くす。

- [ ] **Step 1: JSX を組み替える**

`.onboarding-body`（444行）から `.modal-actions`（1686行）と、その直前の `notice` ブロック（1675-1685行）を外へ出す。両者を包む `.onboarding-main` を新設し、`.onboarding-body` と並べる。

変更後の構造。

```tsx
        <div className="onboarding-main">
          <div className="onboarding-body" ref={onboardingBodyRef}>
            {/* 既存の本文（ステップごとの JSX）をそのまま残す */}
          </div>
          <div className="onboarding-footer">
            {notice && (
              <div
                className={`setup-notice ${notice.kind}`}
                role={notice.kind === 'error' ? 'alert' : 'status'}
                aria-live="polite"
              >
                <span>{notice.kind === 'success' ? '✓' : notice.kind === 'error' ? '!' : 'ⓘ'}</span>
                {notice.message}
              </div>
            )}
            <div className="modal-actions">{/* 既存のボタン3つをそのまま残す */}</div>
          </div>
        </div>
```

`.onboarding-side`（421行）は `.onboarding-main` の外、`.onboarding-modal` の直下に残す。ボタンの中身と `notice` の中身は一字も変えない。

- [ ] **Step 2: CSS を差し替える**

`.onboarding-modal`（1469行）はそのまま 2 列グリッドで残す。`.onboarding-main` を足す。

```css
.onboarding-main {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
}
```

`.onboarding-body`（1551行）の `padding` と `position` を変える。フッターが浮かなくなったので下余白を詰め、`position: relative` は不要になる。

```css
.onboarding-body {
  min-width: 0;
  min-height: 0;
  padding: 46px 48px 32px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
```

`.onboarding-footer` を足し、`.modal-actions`（1914行）から `position` とグラデーションを外す。

```css
.onboarding-footer {
  padding: 14px 48px 18px;
  display: grid;
  gap: 10px;
  border-top: 1px solid var(--line);
  background: #fff;
}
.modal-actions {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
```

`.modal-actions button:disabled`（1925行）はそのまま残す。

メディアクエリの `.onboarding-body` と `.modal-actions` の上書きを差し替える。`position: fixed` は不要になった。

```css
  .onboarding-body {
    padding: 28px 21px 24px;
  }
  .onboarding-footer {
    padding: 12px 21px 14px;
  }
  .modal-actions {
    gap: 8px;
  }
```

`@media (max-width: 760px)` の `.onboarding-modal` にも手を入れる。ここは1カラムになり、`.onboarding-side` と `.onboarding-main` が2行に積まれる。デスクトップ側と同じく行の分割を明示し、スクロールを `.onboarding-body` だけに閉じ込める。

```css
  .onboarding-modal {
    width: 100%;
    height: 100%;
    min-height: 100%;
    max-height: 100%;
    grid-template-columns: 1fr;
    /* State the two-row split explicitly, as the desktop layout does, and keep
       overflow off the modal itself. */
    grid-template-rows: auto minmax(0, 1fr);
    border-radius: 0;
    overflow: hidden;
  }
```

`overflow-y: auto` を `overflow: hidden` へ変える。モーダル自身がスクロールできると、内容が画面高を超えたときにフッターごと流れてしまう。

補足：行を明示しない状態でも、`.onboarding-main` と `.onboarding-body` に `min-height: 0` があるためフッターは流れない（420px 相当で実測して確認済み）。この変更は意図の明示と、モーダル自身がスクロールしうる経路を塞ぐための予防である。

- [ ] **Step 3: `notice` の重複がないことを確認する**

Run: `grep -n "setup-notice" src/client/pages/Onboarding.tsx`
Expected: 1 箇所だけ（Step 1 で移動した先）。移動元が残っていたら消す。

- [ ] **Step 4: 型・整形・テストを確認する**

Run: `npm run typecheck && npm run format && npm run format:check && npm run lint && npm test`
Expected: すべて成功

- [ ] **Step 5: 画面で確認する**

`npm run build` の後、Task 3 と同じ手順でサーバを起動して開く。次を確認する。

1. どのステップでも、本文の末尾がボタンに隠れない
2. 本文をスクロールしてもボタンは常に見える位置にある
3. ブラウザ幅を 900px 程度に狭めてもボタンが本文へ重ならない
4. `notice` を出す操作（未入力のまま保存）で、メッセージがボタンの上に出る

- [ ] **Step 6: コミット**

```bash
git add src/client/pages/Onboarding.tsx src/index.css
git commit -m "fix: move the onboarding footer out of the scrolling body"
```

---

### Task 5: モーダルのフォーカストラップと Escape

**Files:**
- Create: `src/client/focusTrap.ts`
- Create: `tests/client/focusTrap.test.ts`
- Modify: `src/client/pages/Onboarding.tsx`
- Modify: `package.json`（`jsdom` を devDependencies へ）

**Interfaces:**
- Consumes: Task 4 の `.onboarding-main` 構造（トラップ対象は `.onboarding-modal` 全体なので影響なし）
- Produces:
  ```ts
  export function focusableElements(container: HTMLElement): HTMLElement[]
  export type TrapAction = 'close' | 'wrap-forward' | 'wrap-backward' | 'ignore'
  export function trapAction(
    key: string,
    shiftKey: boolean,
    container: HTMLElement,
    activeElement: Element | null,
  ): TrapAction
  ```

**背景（M5）:** モーダルは `role="dialog" aria-modal="true"` を宣言しているが、Tab は背後のページへ抜け、Escape でも閉じない。宣言と実装が食い違っている状態は、支援技術の利用者にとって無いより悪い。

判定ロジックを DOM の純関数として切り出し、React に依存せずテストする。プロジェクトにクライアント側テストが無いため、`jsdom` を 1 つだけ devDependency へ足し、テストファイルの先頭で環境を指定する。`@testing-library/react` は入れない。

- [ ] **Step 1: jsdom を入れる**

Run: `npm install --save-dev jsdom`
Expected: `package.json` の devDependencies へ `jsdom` が入る。`package-lock.json` も更新される。

- [ ] **Step 2: 失敗するテストを書く**

`tests/client/focusTrap.test.ts` を作る。

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { focusableElements, trapAction } from '../../src/client/focusTrap.ts'

function buildContainer(): HTMLElement {
  document.body.innerHTML = `
    <button id="outside">outside</button>
    <div id="modal">
      <button id="first">first</button>
      <input id="middle" />
      <button id="disabled" disabled>disabled</button>
      <a id="link" href="#x">link</a>
      <button id="last">last</button>
    </div>
  `
  return document.getElementById('modal') as HTMLElement
}

describe('focusableElements', () => {
  beforeEach(buildContainer)

  it('lists focusable descendants in document order and skips disabled ones', () => {
    const container = document.getElementById('modal') as HTMLElement
    expect(focusableElements(container).map((element) => element.id)).toEqual([
      'first',
      'middle',
      'link',
      'last',
    ])
  })

  it('skips elements hidden with display none', () => {
    const container = document.getElementById('modal') as HTMLElement
    const middle = document.getElementById('middle') as HTMLElement
    middle.style.display = 'none'
    expect(focusableElements(container).map((element) => element.id)).toEqual([
      'first',
      'link',
      'last',
    ])
  })
})

describe('trapAction', () => {
  beforeEach(buildContainer)

  it('asks to close on Escape', () => {
    const container = document.getElementById('modal') as HTMLElement
    expect(trapAction('Escape', false, container, null)).toBe('close')
  })

  it('wraps forward from the last element', () => {
    const container = document.getElementById('modal') as HTMLElement
    const last = document.getElementById('last')
    expect(trapAction('Tab', false, container, last)).toBe('wrap-forward')
  })

  it('wraps backward from the first element', () => {
    const container = document.getElementById('modal') as HTMLElement
    const first = document.getElementById('first')
    expect(trapAction('Tab', true, container, first)).toBe('wrap-backward')
  })

  it('pulls focus back when it escaped the container', () => {
    const container = document.getElementById('modal') as HTMLElement
    const outside = document.getElementById('outside')
    expect(trapAction('Tab', false, container, outside)).toBe('wrap-forward')
    expect(trapAction('Tab', true, container, outside)).toBe('wrap-backward')
  })

  it('leaves the middle of the sequence to the browser', () => {
    const container = document.getElementById('modal') as HTMLElement
    const middle = document.getElementById('middle')
    expect(trapAction('Tab', false, container, middle)).toBe('ignore')
    expect(trapAction('Enter', false, container, middle)).toBe('ignore')
  })
})
```

- [ ] **Step 3: 失敗を確認する**

Run: `npx vitest run tests/client/focusTrap.test.ts`
Expected: FAIL。`src/client/focusTrap.ts` が存在しない。

- [ ] **Step 4: 実装する**

`src/client/focusTrap.ts` を作る。

```ts
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'details > summary',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

// jsdom has no layout engine, so offsetParent is always null there and cannot be
// used to decide visibility. Walk the ancestor chain instead: it gives the same
// answer in the browser and under test, and it catches the case that actually
// occurs in this modal — inputs inside a closed <details> are still matched by
// the selector but cannot receive focus.
function isHidden(element: HTMLElement, container: HTMLElement): boolean {
  let node: HTMLElement | null = element
  while (node) {
    if (node.hidden || node.style.display === 'none' || node.style.visibility === 'hidden') {
      return true
    }
    if (node instanceof HTMLDetailsElement && !node.open) {
      // A closed <details> still exposes its own summary.
      const summary = node.querySelector('summary')
      if (element !== summary) return true
    }
    if (node === container) return false
    node = node.parentElement
  }
  return false
}

export function focusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (element) => !isHidden(element, container),
  )
}

export type TrapAction = 'close' | 'wrap-forward' | 'wrap-backward' | 'ignore'

export function trapAction(
  key: string,
  shiftKey: boolean,
  container: HTMLElement,
  activeElement: Element | null,
): TrapAction {
  if (key === 'Escape') return 'close'
  if (key !== 'Tab') return 'ignore'

  const elements = focusableElements(container)
  if (elements.length === 0) return 'ignore'

  const inside = activeElement instanceof HTMLElement && container.contains(activeElement)
  if (!inside) return shiftKey ? 'wrap-backward' : 'wrap-forward'

  if (!shiftKey && activeElement === elements.at(-1)) return 'wrap-forward'
  if (shiftKey && activeElement === elements[0]) return 'wrap-backward'
  return 'ignore'
}
```

`offsetParent` は jsdom では常に `null` を返すため、`element.style.display !== 'none'` との論理和で判定する。ブラウザでは `offsetParent` が効き、jsdom では `style.display` が効く。

- [ ] **Step 5: テストが通ることを確認する**

Run: `npx vitest run tests/client/focusTrap.test.ts`
Expected: PASS（6件）

- [ ] **Step 6: モーダルへ組み込む**

`src/client/pages/Onboarding.tsx` の import へ足す。

```ts
import { focusableElements, trapAction } from '../focusTrap.js'
```

`onboardingBodyRef`（67行）の隣へ ref を足す。

```ts
  const modalRef = useRef<HTMLElement>(null)
```

`useEffect` を足す（既存の `useEffect` 群の後ろ、`function toggleProvider` の前）。

```ts
  useEffect(() => {
    const container = modalRef.current
    if (!container) return
    const previouslyFocused = document.activeElement
    focusableElements(container)[0]?.focus()

    function onKeyDown(event: KeyboardEvent) {
      const modal = modalRef.current
      if (!modal) return
      const action = trapAction(event.key, event.shiftKey, modal, document.activeElement)
      if (action === 'ignore') return
      event.preventDefault()
      if (action === 'close') {
        onClose()
        return
      }
      const elements = focusableElements(modal)
      if (action === 'wrap-forward') elements[0]?.focus()
      else elements.at(-1)?.focus()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
  }, [onClose])
```

`<section className="onboarding-modal" ...>`（412行）へ `ref={modalRef}` を足す。

- [ ] **Step 7: 全テストを実行する**

Run: `npm test && npm run typecheck && npm run lint && npm run format:check && npm run privacy:check`
Expected: すべて成功

- [ ] **Step 8: 画面で確認する**

Task 3 と同じ手順でサーバを起動する。次を確認する。

1. モーダルを開くと最初の操作可能要素へフォーカスが移る
2. Tab を押し続けてもフォーカスがモーダルの外へ出ない
3. Shift+Tab で逆順に回り、先頭から末尾へ回り込む
4. Escape でモーダルが閉じる
5. 閉じた後、モーダルを開いたボタンへフォーカスが戻る

- [ ] **Step 9: コミット**

```bash
git add package.json package-lock.json src/client/focusTrap.ts src/client/pages/Onboarding.tsx tests/client/focusTrap.test.ts
git commit -m "fix: trap focus inside the onboarding modal and close it with Escape"
```

---

### Task 6: 表示の小修正（I4・I6・I7・M6）

**Files:**
- Modify: `src/client/pages/Onboarding.tsx:75-78, 655-670`（I4）
- Modify: `src/App.tsx:690-694`（I6）、`966-968`（I7）、`878-932`（M6）
- Modify: `src/index.css`（M6 の行内ボタン用スタイル）
- Create: `src/client/monthLabel.ts`
- Create: `tests/client/monthLabel.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  ```ts
  export function displayMonth(month: string | undefined): string // '2026-01' -> '2026年1月'
  ```

**背景:** I4 は `${product.firstObservedMonth}月` が `2026-01月` になる。I6 は棒グラフの `aria-label` が `2026年4月から7月まで` と固定文字列で、実データと一致しない。I7 は既に実装済みの直接費入力について「未実装です」と書いてある。M6 は `<tr>` に `role="button"` を付けており、表の行としても押しボタンとしても支援技術へ正しく伝わらない。

- [ ] **Step 1: 月表示の失敗するテストを書く**

`tests/client/monthLabel.test.ts` を作る。

```ts
import { describe, expect, it } from 'vitest'
import { displayMonth } from '../../src/client/monthLabel.ts'

describe('displayMonth', () => {
  it('formats an internal month key as Japanese text', () => {
    expect(displayMonth('2026-01')).toBe('2026年1月')
    expect(displayMonth('2026-12')).toBe('2026年12月')
  })

  it('returns an empty string for missing input', () => {
    expect(displayMonth(undefined)).toBe('')
  })

  it('returns unexpected input unchanged instead of inventing a month', () => {
    expect(displayMonth('2026')).toBe('2026')
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run tests/client/monthLabel.test.ts`
Expected: FAIL。ファイルが存在しない。

- [ ] **Step 3: 実装する**

`src/client/monthLabel.ts` を作る。サーバ側 `src/server/dashboard.ts:25` の `displayBillingMonth` と同じ表記に揃える。

```ts
export function displayMonth(month: string | undefined): string {
  if (!month) return ''
  const parsed = month.match(/^(\d{4})-(0[1-9]|1[0-2])$/)
  if (!parsed) return month
  return `${parsed[1]}年${Number(parsed[2])}月`
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run tests/client/monthLabel.test.ts`
Expected: PASS

- [ ] **Step 5: I4 を直す**

`src/client/pages/Onboarding.tsx` の import へ `import { displayMonth } from '../monthLabel.js'` を足す。

75-78行を差し替える。

```ts
  const historyRangeText =
    observedHistoryMonths.length > 0
      ? `${displayMonth(observedHistoryMonths[0])}～${displayMonth(observedHistoryMonths.at(-1))}`
      : '利用時期を確認中'
```

655-670行付近の2箇所（`` `${product.firstObservedMonth}月` `` と `` `${product.lastObservedMonth}月` ``）を、それぞれ `displayMonth(product.firstObservedMonth)` と `displayMonth(product.lastObservedMonth)` へ差し替える。周囲の条件式（`product.firstObservedMonth ? ... : ...`）はそのまま残す。

- [ ] **Step 6: I6 を直す**

`src/App.tsx:690-694` を差し替える。`months` は `Array<{ label: string; ... }>` で、`label` は既に `2026年4月` 形式。

```tsx
          <div
            className="bar-chart"
            role="img"
            aria-label={
              months.length > 0
                ? `${months[0].label}から${months.at(-1)?.label}までの費用配賦積み上げグラフ`
                : '費用配賦積み上げグラフ（対象の月がありません）'
            }
          >
```

- [ ] **Step 7: I7 を直す**

`src/App.tsx:966-968` の `<p className="scope-warning">` を差し替える。

事実確認：`src/server/dashboard.ts` の資産カード生成部は `outsource: 0, other: 0` を固定値で返し、`total` は `aiCost` と同じ AI 配賦額である。`buildPlanningLedger` は `buildDashboard` から一度も呼ばれておらず、`/api/ledger` と Markdown 出力の経路にしかない。したがって「外注費・その他直接費もここに含まれる」と書くのは誤りである。旧文言の「入力は未実装」も誤りで、入力と保存は実装済みである。正しいのは「入力はできるが、このカードの金額にはまだ合算していない」。

```tsx
            <p className="scope-warning">
              このカードの金額はAIサブスクの配賦額だけです。入力済みの外注費・その他直接費・設備の償却費は、費用台帳とMarkdown出力には出ますが、この金額にはまだ合算していません。10万円等の境界は、資産全体の取得価額で確認してください。
            </p>
```

- [ ] **Step 8: M6 を直す**

`src/App.tsx:878-892` の `<tr>` から `onClick`・`onKeyDown`・`role="button"`・`tabIndex`・`aria-label` を外す。

```tsx
              {allocations.map((row) => (
                <tr key={row.id} className={active?.id === row.id ? 'selected-row' : ''}>
                  <td>{row.month}</td>
```

代わりに、月のセルへ根拠を開くボタンを置く。`<td>{row.month}</td>` を差し替える。

```tsx
                  <td>
                    <button
                      className="row-open-button"
                      onClick={() => onSelect(row)}
                      aria-label={`${row.month} ${row.provider} ${row.product}、配賦額${yen.format(row.amount)}の根拠を表示`}
                    >
                      {row.month}
                    </button>
                  </td>
```

分類の `<select>` に付いている `onClick={(event) => event.stopPropagation()}`（914行）は、行の `onClick` が無くなったため不要になる。削除する。

行そのものが押せなくなったため、`src/index.css` の `tbody tr` から `cursor: pointer` を外す。ホバーの背景色（`tbody tr:hover`）は、横に長い表を読むための手がかりとして残す。`tabIndex` を外したことで `tbody tr:focus-visible` は発火しなくなるため、51行目付近のセレクタリストからと、1170行目付近のルールから、どちらも削除する。

`src/index.css` へボタンのスタイルを足す。表の見た目を変えないよう、リンク調にする。

```css
.row-open-button {
  padding: 0;
  color: var(--indigo-dark);
  border: 0;
  background: none;
  font: inherit;
  text-align: left;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}
.row-open-button:hover {
  text-decoration-thickness: 2px;
}
```

`--indigo-dark` が `src/index.css` の `:root` に無い場合は、既存の変数一覧を確認して同等の濃い文字色を使う。

- [ ] **Step 9: 全テストを実行する**

Run: `npm test && npm run typecheck && npm run lint && npm run format:check && npm run privacy:check`
Expected: すべて成功

- [ ] **Step 10: 画面で確認する**

サーバを起動し、次を確認する。

1. 制作物の候補欄に `2026-01月` ではなく `2026年1月` と出る
2. 明細の月セルがボタンになっており、クリックとキーボード（Tab で到達し Enter/Space）で根拠が開く
3. 分類の `<select>` を操作しても根拠パネルが開かない
4. 資産カードの注記が「未実装」ではなくなっている

- [ ] **Step 11: コミット**

```bash
git add src/client/monthLabel.ts tests/client/monthLabel.test.ts src/client/pages/Onboarding.tsx src/App.tsx src/index.css
git commit -m "fix: correct month labels, chart label, stale note, and row semantics"
```

---

### Task 7: 空状態の整備

**Files:**
- Modify: `src/App.tsx`（グラフ・金額境界レーダー・配賦明細・費用台帳）
- Modify: `src/index.css`（`.empty-setup` の流用と、パネル内で使うための調整）

**Interfaces:**
- Consumes: Task 6 の変更（同じ箇所を触るため、Task 6 の後に実行する）
- Produces: なし

**背景（I3）:** 履歴を1度も走査していない利用者には、空のグラフと空の表だけが並ぶ。何が足りないのか、どこへ行けばよいのかが分からない。またフェーズ1で「戻って履歴を走査してください」という案内が失われたままになっている。`src/index.css:1904` の `.empty-setup` は定義済みだが、どこからも使われていない。これを流用する。

- [ ] **Step 1: 共通の空状態コンポーネントを足す**

`src/client/pages/shared.tsx` の末尾へ足す。

```tsx
export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="empty-setup" role="status">
      <p>{message}</p>
      {action}
    </div>
  )
}
```

`ReactNode` は同ファイルで既に import 済み。

- [ ] **Step 2: グラフの空状態を足す**

`src/App.tsx` の棒グラフ（`<div className="bar-chart" ...>`）を条件分岐で包む。`months.length === 0` のときはグラフの代わりに空状態を出す。凡例（`.chart-legend`）も同時に隠す。

```tsx
          {months.length === 0 ? (
            <EmptyState
              message="AIの利用履歴がまだ読み込まれていません。はじめの準備から履歴を走査すると、月ごとの費用がここに出ます。"
              action={
                <button className="primary-button" onClick={onOpenOnboarding}>
                  はじめの準備を開く
                </button>
              }
            />
          ) : (
            <>
              <div className="chart-legend" aria-hidden="true">{/* 既存のまま */}</div>
              <div className="bar-chart" role="img" aria-label={/* Task 6 のまま */}>
                {/* 既存のまま */}
              </div>
            </>
          )}
```

`onOpenOnboarding` は `SummaryPage` の props に無い場合、`App` から渡す。既存の props（`onOpenGuide` など）と同じ経路で追加する。props 名は `onOpenOnboarding: () => void` とし、`App` 側では既存のオンボーディング表示処理（`setOnboarding(true)`）を渡す。

- [ ] **Step 3: 金額境界レーダーの空状態を足す**

`src/App.tsx:756-785` の `.alert-list` の中身を分岐する。

```tsx
        <div className="alert-list">
          {data.boundaries.length === 0 ? (
            <EmptyState message="金額境界を確認できる資産がまだありません。フォルダの割当で制作物を決めて分類すると、10万円などの境界に近づいた資産がここに出ます。" />
          ) : (
            data.boundaries.map((boundary) => {
              /* 既存のまま */
            })
          )}
        </div>
```

- [ ] **Step 4: 配賦明細の空状態を足す**

`src/App.tsx` の `<tbody>`（877行）が空になる場合の行を足す。`<table>` の外に置くとレイアウトが崩れるため、行として出す。列数は 8。

```tsx
            <tbody>
              {allocations.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <EmptyState message="表示できる配賦明細がありません。履歴を走査し、フォルダを制作物へ割り当てると、月ごとの内訳がここに出ます。" />
                  </td>
                </tr>
              )}
              {allocations.map((row) => (
                /* 既存のまま */
              ))}
            </tbody>
```

明細画面がフィルタで絞り込まれた結果 0 件になる場合もあるため、文言は「履歴が無い」と断定せず上の形にする。

- [ ] **Step 5: 費用台帳カードの空状態を足す**

`src/App.tsx:1068` の `.planning-ledger` セクションで、`ledger.contributions`（または相当する明細配列）が空のときに空状態を出す。実装前に該当の配列名を `grep -n "ledger\." src/App.tsx` で確認し、合計だけが並ぶ表の直前へ次を足す。

```tsx
          {ledger.contributions.length === 0 && (
            <EmptyState message="設備・自宅費用・その他直接費がまだ入力されていません。はじめの準備の費用ステップで入力すると、当年の費用候補がここに出ます。" />
          )}
```

配列名が異なる場合は実際の名前へ合わせる。合計（`ledger.totals`）の表示自体は残す。

- [ ] **Step 6: CSS を調整する**

`.empty-setup`（1904行）はモーダル内で使う想定の余白になっている。パネル内でも破綻しないよう、`p` と `button` の間隔を足す。既存プロパティは変えない。

```css
.empty-setup p {
  margin: 0;
  line-height: 1.7;
}
.empty-setup p + button {
  margin-top: 14px;
}
.empty-setup td,
td > .empty-setup {
  margin-top: 0;
}
```

- [ ] **Step 7: 全テストを実行する**

Run: `npm test && npm run typecheck && npm run lint && npm run format:check && npm run privacy:check`
Expected: すべて成功

- [ ] **Step 8: 画面で確認する**

空の一時データディレクトリでサーバを起動し（走査しない）、次を確認する。

1. グラフの位置に空状態と「はじめの準備を開く」ボタンが出る
2. ボタンを押すとオンボーディングが開く
3. 金額境界レーダーに空状態が出る
4. 明細画面に空状態の行が出て、表の枠が崩れない
5. 費用台帳カードに空状態が出る

その後、履歴を走査して空状態が消えることも確認する。

- [ ] **Step 9: コミット**

```bash
git add src/App.tsx src/client/pages/shared.tsx src/index.css
git commit -m "feat: explain what to do when a panel has nothing to show"
```

---

### Task 8: スキャン進捗の表示

**Files:**
- Create: `src/server/scanProgress.ts`
- Create: `tests/server/scanProgress.test.ts`
- Modify: `src/adapters/types.ts`（`AdapterOptions`）
- Modify: `src/adapters/claude.ts`、`src/adapters/codex.ts`
- Modify: `src/server/index.ts`（`/api/scan` と `/api/scan/progress`）
- Modify: `src/client/api.ts`、`src/client/types.ts`
- Modify: `src/client/pages/Onboarding.tsx`

**Interfaces:**
- Consumes: なし
- Produces:
  ```ts
  // src/server/scanProgress.ts
  export type ScanProgress = {
    running: boolean
    provider: 'claude' | 'codex' | null
    filesScanned: number
  }
  export function beginScan(provider: 'claude' | 'codex'): void
  export function reportScannedFile(): void
  export function finishScan(): void
  export function readScanProgress(): ScanProgress
  ```

**背景（M8）:** 走査は数万件のイベントを読むため十数秒かかることがある。いまは「履歴を確認中…」の文字だけで、進んでいるのか固まったのかが分からない。走査済みファイル数を返して表示する。総数は事前に分からない（ディレクトリを列挙しながら読むため）ので、割合ではなく件数を出す。

- [ ] **Step 1: 失敗するテストを書く**

`tests/server/scanProgress.test.ts` を作る。

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import {
  beginScan,
  finishScan,
  readScanProgress,
  reportScannedFile,
} from '../../src/server/scanProgress.ts'

describe('scan progress', () => {
  beforeEach(() => {
    finishScan()
  })

  it('reports an idle state before any scan', () => {
    expect(readScanProgress()).toEqual({ running: false, provider: null, filesScanned: 0 })
  })

  it('counts files while a scan runs', () => {
    beginScan('claude')
    reportScannedFile()
    reportScannedFile()
    expect(readScanProgress()).toEqual({ running: true, provider: 'claude', filesScanned: 2 })
  })

  it('resets the counter when the next provider starts', () => {
    beginScan('claude')
    reportScannedFile()
    beginScan('codex')
    expect(readScanProgress()).toEqual({ running: true, provider: 'codex', filesScanned: 0 })
  })

  it('keeps the final count visible after the scan finishes', () => {
    beginScan('codex')
    reportScannedFile()
    finishScan()
    expect(readScanProgress()).toEqual({ running: false, provider: null, filesScanned: 0 })
  })

  it('ignores reports that arrive while no scan is running', () => {
    reportScannedFile()
    expect(readScanProgress().filesScanned).toBe(0)
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run tests/server/scanProgress.test.ts`
Expected: FAIL。ファイルが存在しない。

- [ ] **Step 3: 実装する**

`src/server/scanProgress.ts` を作る。プロセス内の1件だけの状態で足りる。走査は `/api/scan` の中で直列に走り、同時に2つは動かない。

```ts
export type ScanProgress = {
  running: boolean
  provider: 'claude' | 'codex' | null
  filesScanned: number
}

// Counts only. The file paths themselves stay inside the adapter: they are
// local references, and section 11 of the design keeps those out of every API
// response.
let state: ScanProgress = { running: false, provider: null, filesScanned: 0 }

export function beginScan(provider: 'claude' | 'codex'): void {
  state = { running: true, provider, filesScanned: 0 }
}

export function reportScannedFile(): void {
  if (!state.running) return
  state = { ...state, filesScanned: state.filesScanned + 1 }
}

export function finishScan(): void {
  state = { running: false, provider: null, filesScanned: 0 }
}

export function readScanProgress(): ScanProgress {
  return state
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run tests/server/scanProgress.test.ts`
Expected: PASS（5件）

- [ ] **Step 5: アダプタへ通知口を足す**

`src/adapters/types.ts` の `AdapterOptions` へ足す。

```ts
  onFileScanned?: () => void
```

`src/adapters/claude.ts:30` のループへ 1 行足す。

```ts
  for await (const filePath of discoverJsonlFiles(rootDirectory, diagnostics)) {
    options.onFileScanned?.()
```

`src/adapters/codex.ts` の同じ位置（`discoverJsonlFiles` を回すループ）にも同じ 1 行を足す。既存のテストが `AdapterOptions` をオブジェクトリテラルで渡しているが、任意プロパティなので変更は不要。

- [ ] **Step 6: サーバへ組み込む**

`src/server/index.ts` の import へ足す。

```ts
import { beginScan, finishScan, readScanProgress, reportScannedFile } from './scanProgress.js'
```

進捗エンドポイントを `/api/scan` の定義の前へ足す。

```ts
app.get('/api/scan/progress', async () => readScanProgress())
```

`/api/scan`（242行）の provider ループを差し替える。`try`/`finally` で、例外が出ても必ず `finishScan` する。

```ts
  try {
    for (const provider of parsed.data.providers) {
      beginScan(provider)
      const result =
        provider === 'claude'
          ? await readClaudeHistory(paths.claude, {
              identifierSalt,
              includeLocalProjectLabel: true,
              includeLocalReferences: true,
              onFileScanned: reportScannedFile,
            })
          : await readCodexHistory(paths.codex, {
              identifierSalt,
              includeLocalProjectLabel: true,
              includeLocalReferences: true,
              onFileScanned: reportScannedFile,
            })
      /* 以降の集計・保存は既存のまま */
    }
  } finally {
    finishScan()
  }
```

- [ ] **Step 7: クライアントから読む**

`src/client/types.ts` へ足す。

```ts
export type ScanProgress = {
  running: boolean
  provider: ProviderKey | null
  filesScanned: number
}
```

`src/client/api.ts` へ、既存の GET 関数と同じ書き方で足す。

```ts
export async function getScanProgress(): Promise<ScanProgress> {
  return requestJson('/api/scan/progress')
}
```

- [ ] **Step 8: 画面へ出す**

`src/client/pages/Onboarding.tsx` へ進捗の状態を足す。

```ts
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null)
```

履歴ステップの `busy` 中だけポーリングする `useEffect` を足す。

```ts
  useEffect(() => {
    if (!busy || step !== 0 || apiUnavailable) {
      setScanProgress(null)
      return
    }
    let cancelled = false
    const timer = window.setInterval(() => {
      getScanProgress()
        .then((progress) => {
          if (!cancelled) setScanProgress(progress)
        })
        .catch(() => {
          // The scan itself reports its own failure; a missed progress poll
          // must not replace that message with a less useful one.
        })
    }, 700)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [apiUnavailable, busy, step])
```

`getScanProgress` と `ScanProgress` を import する。

ボタン文言（1699行付近の `'履歴を確認中…'`）を差し替える。

```tsx
                ? step === 0
                  ? scanProgress?.running
                    ? `走査中… ${scanProgress.filesScanned}ファイル`
                    : '履歴を確認中…'
                  : '保存中…'
```

さらに履歴ステップの本文へ、読み上げ向けの進捗を足す。`.detected-list` の直後へ置く。

```tsx
              {busy && (
                <p className="scan-progress" role="status" aria-live="polite">
                  {scanProgress?.running
                    ? `${scanProgress.provider === 'codex' ? 'Codex' : 'Claude Code'}の履歴を走査しています。読み込んだファイル数：${scanProgress.filesScanned}`
                    : '履歴を確認しています。'}
                </p>
              )}
```

`src/index.css` へ足す。

```css
.scan-progress {
  margin-top: 12px;
  color: var(--muted);
  font-size: 14px;
}
```

- [ ] **Step 9: 進捗エンドポイントの統合テストを足す**

`tests/server/server.integration.test.ts` へ、走査していない状態の進捗を確かめるケースを足す。

```ts
    const idleProgress = (await fetch(`http://127.0.0.1:${port}/api/scan/progress`).then(
      async (response) => await response.json(),
    )) as { running: boolean; provider: string | null; filesScanned: number }
    expect(idleProgress).toEqual({ running: false, provider: null, filesScanned: 0 })
```

- [ ] **Step 10: 全テストを実行する**

Run: `npm test && npm run typecheck && npm run lint && npm run format:check && npm run privacy:check`
Expected: すべて成功。`privacy:check` は特に重要で、進捗にファイルパスを含めていないことを守る。

- [ ] **Step 11: 画面で確認する**

実際の履歴（`~/.claude/projects`）を持つ環境で、一時データディレクトリを指定してサーバを起動し、履歴ステップから走査する。走査中にファイル数が増えていくことを確認する。走査後は一時ディレクトリを削除する。

- [ ] **Step 12: コミット**

```bash
git add src/server/scanProgress.ts tests/server/scanProgress.test.ts src/adapters/types.ts src/adapters/claude.ts src/adapters/codex.ts src/server/index.ts src/client/api.ts src/client/types.ts src/client/pages/Onboarding.tsx src/index.css tests/server/server.integration.test.ts
git commit -m "feat: report scanned file counts while a scan runs"
```

---

### Task 9: 仕上げ（ledger クエリ・README・CSS 整理）

**Files:**
- Modify: `src/client/api.ts:114`
- Modify: `README.md`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: Task 1-8 のすべて
- Produces: なし

**背景（I5）:** クライアントは `/api/ledger?year=` を送っているが、サーバは無視している。費用台帳の年は保存済みスナップショットの `profile.taxYear` で決まるため、クエリで変えられるものではない。誤解を生むので送信をやめる。

**背景（B3）:** README の「実装済み」に「通常経費、取得価額、資本的支出、制作原価、私用等の決定木」とあるが、`decideTaxCandidate`（`src/core/taxDecision.ts:100`）と `guideAssetThresholds`（`src/core/assetThresholds.ts:29`）はテストからしか呼ばれておらず、画面やAPIの経路には入っていない。公開リポジトリで事実と違う記述を残さない。

**背景（CSS）:** 設計書 12 章に記録した孤児セレクタの整理。`.mapping-list` は生きている `.detected-list` と、`.history-rules` は `.advanced-fields` と、`.rule-fields` は `.cost-edit-row` とセレクタを共有している。名前だけで一括削除すると生きたスタイルが壊れる。

- [ ] **Step 1: I5 を直す**

`src/client/api.ts:114` を確認し、`year` を使わない形へ変える。

```ts
export async function getLedger(): Promise<PlanningLedger> {
  return requestJson('/api/ledger')
}
```

`grep -n "getLedger" src/` で呼び出し側を確認し、引数を渡している箇所から `year` を外す。`year` 変数が未使用になる場合は、その計算も消す。

- [ ] **Step 2: B3 を直す（README の実装済み）**

`README.md:115` の「## 実装済み」の一覧から、次の行を削除する。

```
- 通常経費、取得価額、資本的支出、制作原価、私用等の決定木
```

`README.md:213-214` の「## 現在の制約」を差し替える。

```
- 税務候補の決定木（`src/core/taxDecision.ts`）と金額境界の案内（`src/core/assetThresholds.ts`）は関数として実装しテスト済みですが、画面とAPIの経路からはまだ呼んでいません。画面に出る税務候補は、配賦時の分類と資産の状態から組み立てています
- Markdown出力は実装済みです。CSV出力と、候補を利用者が確定・修正した履歴の画面編集は未実装です
```

- [ ] **Step 3: README へフェーズ2bの変更を反映する**

「## 実装済み」の一覧へ、このフェーズで加えた機能を足す。

```
- providerごとの契約期間（開始日・終了日）にもとづく、契約外の月とセッションの配賦除外
- 走査中のファイル数表示
```

`README.md:43` のイベント紹介文に「税務候補エンジンを実装済み」とあるため、ここも「税務候補の提示」へ言い換え、Step 2 の記述と矛盾しないようにする。

- [ ] **Step 4: 孤児 CSS を確認する**

各セレクタについて、実際に使われているか確認する。

```bash
for name in mapping-list mapping-row history-rules rule-fields; do
  echo "--- $name ---"
  grep -rn "$name" src --include=*.tsx --include=*.ts
done
```

JSX から参照が 1 件も無いクラスだけを対象にする。共有セレクタ（`,` で並んでいるもの）は、その名前だけをセレクタリストから外し、残りの名前とルール本体は必ず残す。単独ルールなら、ルールごと削除する。

例：`.detected-list, .mapping-list, .invoice-box { ... }` は `.detected-list, .invoice-box { ... }` にする。ルール本体は消さない。

メディアクエリ内（`@media (max-width: 1100px)`）にも同じ名前の上書きがあるため、そちらも同様に処理する。

- [ ] **Step 5: CSS の削除で見た目が変わっていないことを確認する**

削除前後で `npm run build` を実行し、`dist/assets/*.css` のサイズが減っていること、およびブラウザで4画面（サマリー・明細・フォルダの割当・税務QA）とオンボーディングの全ステップを開いて崩れが無いことを確認する。1箇所でも崩れたら、その名前は生きているので削除を取り消す。

- [ ] **Step 6: 全テストを実行する**

Run: `npm test && npm run typecheck && npm run lint && npm run format:check && npm run privacy:check && npm run build`
Expected: すべて成功

- [ ] **Step 7: コミット**

```bash
git add src/client/api.ts README.md src/index.css
git commit -m "docs: describe what actually ships, and drop the unused ledger query"
```

---

## 自己レビュー結果

**1. 仕様の網羅**

| ID | 対応タスク |
|---|---|
| B2 | Task 3（Step 1-6） |
| B3 | Task 9（Step 2-3） |
| I1 | Task 1・2・3 |
| I2 | Task 4 |
| I3 | Task 7 |
| I4 | Task 6（Step 1-5） |
| I5 | Task 9（Step 1） |
| I6 | Task 6（Step 6） |
| I7 | Task 6（Step 7） |
| M4 | Task 3（Step 5・8） |
| M5 | Task 5 |
| M6 | Task 6（Step 8） |
| M8 | Task 8 |

設計書 12 章の残課題のうち、孤児 CSS は Task 9 Step 4-5、履歴0件の案内は Task 7 Step 2 で扱う。「`new-development` で制作物未指定のルールが資産名『要確認』で境界カードに出る」件は、フェーズ2a のフォルダ割当画面で制作物の指定を促す表示を入れており、本計画の対象外とする。

**2. 型の整合**

- `ProviderContract` と `LocalConfiguration` は Task 1 で `src/server/database.ts` と `src/client/types.ts` の両方に定義する。定義が2箇所にあるのは既存の構造で、本計画では統合しない
- `contractCoversMonth` / `contractCoversDate` / `hasAnyContractPeriod`（Task 2）は Task 2 の中だけで使う
- `displayMonth`（Task 6）はクライアント専用。サーバ側の `displayBillingMonth` とは別実装だが、出力表記は一致させる
- `ScanProgress` は `src/server/scanProgress.ts` と `src/client/types.ts` の両方に定義する（`provider` の型が `UsageProvider` と `ProviderKey` で別名のため）
- `focusableElements` / `trapAction`（Task 5）は `src/client/focusTrap.ts` のみ

**3. 依存順**

Task 1 → 2 → 3 は契約期間の一連。Task 4 → 5 はモーダルの同じ箇所。Task 6 → 7 は `src/App.tsx` の同じ表とパネル。Task 8 と 9 は独立。番号順に実行する。

**4. 実行順で注意する点**

- Task 1 Step 9 で `Onboarding.tsx` へ暫定の `contracts` を足す。Task 3 Step 6 でそれを本実装へ置き換える
- Task 4 で `.modal-actions` を移動した後、Task 5 の `focusableElements` はモーダル全体を対象にするため、移動の影響を受けない
- Task 6 で明細の `<tr>` から `onClick` を外すため、Task 7 Step 4 の空行はクリック対象を持たない
