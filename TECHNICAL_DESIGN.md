# DevTax Radar 技術設計

Date: 2026-07-24
Decision status: Adopted for confirmed specification v0.3

## 1. 採用構成

> **GitHubから取得した利用者が、自分のPCだけで履歴の読取・配賦・保存を完結できるローカルWebアプリにする。**

```text
GitHub Public Repository / Releases
└─ 利用者のPC
   ├─ Node local server（127.0.0.1 only）
   ├─ Claude / Codex adapter
   │  ├─ ~/.claude/projects（read only）
   │  └─ ~/.codex/sessions（read only）
   ├─ local SQLite database
   └─ React UI（localhost）
```

Cloudflare等の公開Webアプリは、ブラウザの制約上、各利用者のローカル履歴を自動走査できない。ファイルアップロードや常駐エージェントを要求すると、導入負荷と漏えいリスクが増える。したがって、クラウドは製品の必須実行経路に含めない。

公開Webを作る場合は、紹介サイトまたは完全に合成した匿名デモに限定する。

## 2. 技術スタック

| 領域 | 採用 | 理由 |
| --- | --- | --- |
| Language | TypeScript | Collector、配賦エンジン、UIで型を共有できる |
| UI | React | 3画面と5段階オンボーディングを、ブラウザで分かりやすく表示できる |
| Build | Vite | ローカル開発と静的ビルドが速い |
| Styling | CSS | 追加ランタイムなしでダッシュボードを実装済み |
| Charts | React + CSS | 複数月の積み上げ表示を独自実装済み |
| Icons | 同梱SVG／テキスト記号 | 実行時CDNへ依存しない |
| Validation | Zod | 履歴スキーマとサニタイズ後データを検証できる |
| Runtime | Node.js 24.14+ | ローカルファイル、HTTP、組込みSQLiteを単一ランタイムで扱える |
| Local API | Fastify | loopback限定API、入力検証、静的UI配信を小さく実装できる |
| Local collector | Node.js + TypeScript (`tsx`) | Claude／CodexのJSONLをストリーム処理できる |
| Storage | `node:sqlite` | 追加のDBサーバーやクラウドなしで、月次履歴と根拠を永続化できる |
| Test | Vitest | 配賦、閾値、サニタイザーを高速に検証できる |
| CI | GitHub Actions | typecheck、test、lint、build、privacy checkを自動化する |
| Distribution | GitHub source + Releases | 誰でも取得、検証、更新できる |

`node:sqlite`を利用するためNode.js 24.14以上を要求する。MVPではネイティブnpmモジュールのビルド失敗を避けられる利点を優先し、DB access layerを分離して将来の差替えを可能にする。

### 採用しないもの

- Next.js: SSRが不要で、ローカル履歴アクセスの問題も解決しない
- Electron/Tauri: ワンクリック配布段階では有効だが、最初の公開版はNodeローカルサーバーを優先する
- Dockerを標準導入にする構成: Windows／macOSで履歴フォルダのmountと権限設定が利用者負担になる
- Cloud database: 個人の利用履歴を外部保存しない
- LLMによる税務確定: 説明可能性と再現性を優先する
- Cloudflareを必須ランタイムにする構成: ローカル履歴アクセスのために別のアップロード経路が必要になる

## 3. リポジトリ構成

```text
devtax-radar/
├─ README.md
├─ PRODUCT_SPEC.md
├─ TECHNICAL_DESIGN.md
├─ package.json
├─ vite.config.ts
├─ .github/
│  ├─ workflows/
│  │  ├─ ci.yml
│  │  └─ release.yml
│  └─ dependabot.yml
├─ src/
│  ├─ App.tsx                    # 3画面UI・5段階オンボーディング
│  ├─ client/                    # API client・UI型
│  ├─ planning/
│  │  └─ types.ts               # 診断・制作物・費用・証拠の共有型
│  ├─ server/
│  │  ├─ index.ts               # Fastify API・静的配信
│  │  ├─ database.ts            # node:sqlite
│  │  ├─ dashboard.ts
│  │  ├─ planningRepository.ts  # 診断・台帳の検証と永続化
│  │  ├─ paths.ts
│  │  └─ security.ts
│  ├─ adapters/
│  │  ├─ claude.ts
│  │  └─ codex.ts
│  ├─ core/
│  │  ├─ allocation.ts
│  │  ├─ taxDecision.ts
│  │  ├─ assetThresholds.ts
│  │  ├─ diagnosis.ts           # 現在地・次の行動・不足情報
│  │  └─ planningLedger.ts      # 設備・自宅費用・直接費の台帳
│  └─ index.css
├─ fixtures/
│  ├─ claude/                   # 合成JSONL
│  └─ codex/                    # 合成JSONL
├─ scripts/
│  ├─ privacy-check.ts
│  └─ package-release.ts
├─ tests/
│  ├─ adapters/
│  ├─ core/
│  └─ server/
├─ docs/
│  └─ SECURITY.md
└─ dist/                        # ローカル本番ビルド
```

製品データはリポジトリ内ではなくOS標準のユーザーデータ領域へ保存する。

```text
Windows: %LOCALAPPDATA%\DevTaxRadar\devtax-radar.db
macOS:   ~/Library/Application Support/DevTaxRadar/devtax-radar.db
Linux:   ~/.local/share/devtax-radar/devtax-radar.db
```

## 4. ローカル実行

ソースから使う場合の実装済みコマンド:

```bash
npm ci
npm run dev
```

処理:

1. Nodeサーバーを`127.0.0.1`へbindする
2. `http://127.0.0.1:5173`でブラウザUIを開く
3. ユーザーの明示操作でClaude／Codexの既定パスを検出する
4. JSONLをストリーム処理し、許可メタデータだけを正規化する
5. 集計結果、分類、Provider×月別請求額をローカルSQLiteへ保存する
6. APIはUIに必要な集計・根拠だけを返す

本番相当のローカル実行:

```bash
npm run build
npm start
```

`npm start`はビルド済みReact UIとAPIを同じoriginから配信する。通常利用時にVite開発サーバーは使わない。

### 4.1 ローカル境界の防御

- `0.0.0.0`ではなく`127.0.0.1`だけへbindする
- CORSを許可しない
- state-changing APIはJSON、同一Origin、起動ごとのCSRF tokenを要求する
- UIへプロンプト・応答本文・ソースコードを返さない
- 元履歴はread onlyで開き、変更・削除しない
- telemetry、クラウド同期、外部LLM送信を初期状態で持たない
- UI資産、アイコン、フォントをbundleし、CDNから実行時取得しない
- SQLite書込みはトランザクション単位で反映する

長時間scanのworker thread化は未実装であり、履歴量が大きい端末での応答性は今後の課題とする。

### 4.2 任意の匿名デモ

Adapterテストと静的UI確認には`fixtures/claude`、`fixtures/codex`の合成JSONLを使う。これは利用者向け製品データではなく、実ログ・実請求額・実プロジェクト名を一切含まない。

## 5. Collector設計

## 5.1 Claude

入力:

```text
~/.claude/projects/**/*.jsonl
```

採用フィールド:

- timestamp
- cwd
- sessionId
- message.id
- message.model
- message.usage.*

`message.id`で重複排除する。本文フィールドは正規化オブジェクトへコピーしない。

## 5.2 Codex

入力:

```text
~/.codex/sessions/**/*.jsonl
```

採用フィールド:

- session_meta.payload.session_id
- session_meta.payload.timestamp
- session_meta.payload.cwd
- 最終token_count.total_token_usage

`token_count`は累積値のため、セッションごとの最終値だけを採用する。

将来のラッパーモードでは、`codex exec --json`の`turn.completed.usage`を一次取得経路にする。Hookからは`session_id`と`cwd`を取得する。Codex transcript形式は安定APIではないため、ローカル履歴パーサーにはスキーマバージョンと信頼度を持たせる。

## 5.3 正規化型

```ts
type NormalizedUsage = {
  provider: "claude" | "codex";
  month: string;
  sessionKey: string;
  projectKey: string;
  model: string;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  captureMethod: string;
  confidence: "A" | "B" | "C";
};
```

`sessionKey`と`projectKey`は端末内saltでハッシュ化し、元のIDと絶対パスはSQLiteへ保存しない。`projectLabel`はローカルUI用の末尾名であり、公開物へ転用しない。

## 6. 配賦エンジン

Providerと月を分母にする。

```ts
allocatedAmount =
  providerMonthlyFee *
  projectWeightedUsage /
  (capturedWeightedUsage + unobservedUsageEquivalent);
```

### 重要な制約

- ClaudeとCodexの生トークンを同じ分母にしない
- input、output、cache、reasoningの内訳を保持する
- 重みと計算式をUIで表示する
- 未取得利用を0にするにはユーザー確認を要求する
- 配賦額の端数差は「未分類・調整」行で月額合計に一致させる

### 不変条件

```text
Provider月額
= 全プロダクト配賦額
+ 私用配賦額
+ 未取得利用額
+ 丸め調整額
```

## 7. 税務ルールエンジン

MVPでは決定木として実装し、LLMへ最終判断させない。

```text
利用目的
├─ 私用 → 対象外
├─ 通常業務・保守 → 通常経費候補
├─ 供用前の直接開発 → 新規取得価額候補
└─ 供用後
   ├─ 障害除去・効用維持 → 修繕費候補
   └─ 新機能・機能向上 → 資本的支出候補
```

取得価額候補は資産単位で累積し、実際に使い始めた状況とともに10万円・20万円等の金額境界へ渡す。決定木と金額境界モジュールは実装済みである。5段階オンボーディングから制作物、開始イベント、設備、自宅費用、直接費、証拠を編集・保存できるが、金額境界にある全例外条件と候補の確定・修正履歴はまだ画面編集へ接続していない。

すべての結果:

```ts
type TaxDecision = {
  primaryCandidate: string;
  confidence: "high" | "medium" | "low";
  appliedRuleIds: string[];
  missingFacts: string[];
  userConfirmationRequired: boolean;
};
```

資本的支出は候補分類までとし、当年の減価償却額は算定しない。供用日、耐用年数、償却方法を不足情報として返す。ソフトウェアの耐用年数候補は、複写して販売するための原本・研究開発用が3年、その他が5年である。

青色申告者向け少額減価償却資産特例では、次をコードとテストで区別する。

- 新旧の40万円／30万円基準は取得・製作日で判定し、供用開始日は別条件
- 対象金額の下限は10万円
- 年間上限300万円は事業月数で月割り
- 一括償却資産として選択した資産との重複適用不可
- 貸付用資産は、主要な事業として行う貸付け等を除いて対象外

## 7.1 診断・台帳アーキテクチャ

既存の`/api/config`と既存SQLite表は後方互換のため維持する。新機能は追加テーブルと`/api/planning`名前空間へ実装し、既存DBもmigrationなしで起動できるよう`CREATE TABLE IF NOT EXISTS`で段階導入する。

```text
履歴・請求設定（既存）
  usage_events（セッション単位） / session_references / provider_month_charges
             ↓
診断・制作物台帳（追加）
  planning_profiles / tax_units / lifecycle_events
             ↓
費用・証拠台帳（追加）
  equipment_assets / home_cost_rules / direct_costs / evidence_records
             ↓
純粋関数
  diagnosis / lifecycle / cost ledger
             ↓
Dashboard projection / export
```

### 共有型

`src/planning/types.ts`をブラウザ・サーバー共通の純粋型として利用する。

- `PlanningProfile`: 年分、早期診断／事後整理、所得・申告候補、収益化状況
- `TaxUnitRecord`: 制作物・改良計画、自己利用／外部提供／混合、状態、完成条件
- `LifecycleEventRecord`: 開発開始、評価、自分利用開始、外部公開、販売、改良、廃止、中止
- `EquipmentRecord`: パソコン・GPU機器等、取得・転用・業務割合・期間償却候補
- `HomeCostRecord`: 家賃・電気・通信費、按分方式、式、理由、有効期間
- `DirectCostRecord`: 外注・素材・クラウド等の制作物直接費
- `EvidenceRecord`: Gitを必須としない参照・メモと証拠強度
- `DecisionRecord`: 候補、確認・上書き、理由、確認日時、エンジン版

### API

- `GET /api/planning`: 全台帳のローカルsnapshotを取得
- `PUT /api/planning`: 検証済みsnapshotを単一transactionで保存
- `GET /api/diagnosis`: 保存事実から現在地、今すぐ、イベント時、不足事実を再生成
- `GET /api/ledger`: 設定した対象年について、直接費、設備、家事関連費を集計
- `GET /api/export?format=markdown`: 税理士相談用の明細。端末内の参照情報は出力しない

Mutationは既存と同じCSRF・Origin検査を通す。IDは非可逆なローカルIDとし、証拠ファイル本体、プロンプト、応答、ソースコードは保存しない。

### 画面と初回案内

通常画面は次の3つで構成する。

1. 「今年どうなる？」: 3グループの年間・月別集計、準備進捗、現在地、次の行動
2. 「なぜそうなる？」: AI利用の配賦明細、制作物、設備、自宅費用、証拠、費用台帳、Markdown出力
3. 「税務QA」: 取得価額、資本的支出、金額境界、実際に使い始めた日等を初心者向けに説明

初回案内は「履歴→現在地→制作物→費用→診断」の5段階とする。各段階で質問の目的と「ここまで分かったこと」を表示し、途中保存と再開を可能にする。早期診断と事後整理、自分利用と外部提供は同じ画面で混同せずに選択・記録する。

## 7.2 ライフサイクル

自己利用開始と外部公開は別イベントである。`usageMode=mixed`でも一つの日付へ統合しない。公開前でも実作業へ正式採用すれば供用候補になり、公開済みでも本来目的に使用していない場合は事実確認を残す。

同一フォルダを全期間一分類に固定しない。期間付きルール（`planning_project_rules`）をセッションの発生日時（`usage_events.started_at`）で解決する。一致するルールがないフォルダを自動的にどれかの制作物へ割り当てることはせず、未分類のまま残す。再スキャンで行IDが変わるため、セッション割当は`usage_events.id`を参照しない。

## 7.3 診断エンジン

診断文はDBへ固定保存せず、保存事実から再生成する。

```ts
type Diagnosis = {
  currentPosition: string[];
  immediateActions: ActionItem[];
  eventTriggeredActions: ActionItem[];
  missingFacts: string[];
  readiness: { confirmed: number; total: number };
};
```

早期診断では完成条件、利用形態、按分方式、証拠の準備を案内する。事後整理では事実発生日と復元日を分け、既存履歴・公開物・手動メモからの復元を案内する。

禁止する提案はコードとテストで固定する。

- 金額境界を超えるための追加支出・開発
- 税務だけを目的とした公開延期
- 実態と異なる供用日
- 形式だけの版分割、私用の業務化

## 7.4 設備・家事関連費

設備は購入額をそのまま制作物原価へ入れず、登録済みの当年償却費候補または転用時残高を基礎とする。

```text
設備の制作物配賦候補
= 当年償却費候補 × 業務利用割合 × 制作物割合
```

家賃は面積または面積×時間、電気はメーターまたは消費電力×時間×単価、通信費は専用回線または利用時間等の再現可能な方式を保存する。直接、共通、一般管理、私用を分け、一般管理分を無条件にソフトウェア取得価額へ入れない。

### 金額保存則

各費用源について次を満たし、二重計上を拒否する。

```text
原額 = 制作物配賦 + 通常業務 + 私用 + 未分類・未配賦
```

設備の制作物割合、家事関連費の配賦割合は合計100%以下とし、残りを未配賦として表示する。

## 7.5 証拠と判断履歴

証拠は`automatic / external / self-recorded`を区別する。Gitは選択肢の一つであり、デプロイ、販売ページ、ストア、ファイル、スクリーンショット、領収書、カード明細、日記、作業メモ、AIセッションを同等の入口から登録できる。

判断は上書きせずrevisionとして追記し、自動候補、入力事実、適用ルール、不足情報、ユーザー選択、修正理由、確認日時を保持する。

## 8. 匿名デモ／エクスポートのマスキング

ローカル製品の通常利用ではデータを公開しない。匿名デモや共有用エクスポートを明示的に作る場合は、denylistではなくallowlist方式で生成する。

### 公開してよい

- provider
- month
- `Product A`等の匿名名
- 丸めた利用割合
- トークン種別の集計値または指数
- デモ用月額
- 税務候補
- 累積原価のデモ値
- 判定理由

### 公開しない

- プロンプト・応答本文
- ソースコード・ファイル内容
- 絶対パス
- 実リポジトリ名
- Gitブランチ名
- セッションID
- UUID
- メッセージID
- 秒単位のタイムスタンプ
- 実際のサブスク支払額
- メールアドレス、ユーザー名、端末名

### 変換

```text
C:\Users\...\private-project → Product A
2026-06-18T12:34:56Z       → 2026-06
1,234,567 raw tokens       → 1.23M または利用指数
実月額                     → デモ月額
```

### Privacy check

Git追跡ファイルとRelease packageを作る前に次を検査する。

- `C:\Users\`、`/Users/`等のホームパス
- UUID形式
- `.claude`、`.codex`由来のセッション識別子
- `prompt`、`message.content`等の禁止フィールド
- 登録した実プロジェクト名
- `.local`ファイルとローカルDBのpackage混入

失敗時はビルドを停止する。

## 9. 品質ゲートとGitHub Actions

ローカルでは次の品質ゲートを実行できる。

```text
npm ci
→ npm run typecheck
→ npm test
→ npm run lint
→ npm run privacy:check
→ npm run build
```

テスト、型検査、lint、privacy check、ビルド用scriptとGitHub Actions workflowは実装済みである。Pull Requestと`main` pushでCIを実行し、実ログをCIへ渡さず、完全な合成fixtureだけを使う。

`v*`タグのpushでは同じ品質ゲート後に`npm run release:pack`を実行し、GitHub ReleaseへZIPを自動公開する。Release ZIPはサーバーと依存関係をbundleしているため、利用者側の`npm install`は不要である。必要環境はNode.js 24.14以上で、展開先から`npm start`して`http://127.0.0.1:4317`を開く。

package作成時はallowlistで内容を検査し、実データ、`fixtures`、ローカルDB、`node_modules`、`.claude`、`.codex`等をZIPへ含めない。

## 10. README／AI審査対策

READMEは次の順番にする。

1. 1行の価値
2. 30秒で分かる課題と解決
3. 3コマンドのローカル実行手順
4. スクリーンショットまたはGIF
5. 何を端末内で読み、何を外へ送らないか
6. 実データで検証した規模
7. 他の経費按分ツールとの違い
8. アーキテクチャ図
9. 配賦式
10. 税務ルールの範囲
11. 任意の匿名デモURL
12. テスト方法
13. 制約・免責
14. 公式資料

AI審査がコードを探索しやすいよう、READMEから以下へ直接リンクする。

- `PRODUCT_SPEC.md`
- `TECHNICAL_DESIGN.md`
- Collector実装
- 配賦エンジン
- 税務ルール
- Privacy test
- デモ台本

リポジトリのSocial Previewは1280×640pxで作成する。READMEと同じキャッチコピー、3グループのチャート、Claude Code／Codexのロゴではなくテキスト名を使う。

## 11. 技術的リスク

| リスク | 対策 |
| --- | --- |
| Claude／Codex更新で履歴形式が変わる | Adapter、schema version、confidenceを持つ |
| トークンが実コストではない | 「配賦基準」と明示し、月額実請求を別入力 |
| Chat利用等が履歴にない | 未取得利用バケット |
| 実データを公開してしまう | allowlist sanitizer + CI privacy test |
| 税務判断を断定する | 候補、根拠、不足情報、ユーザー確定 |
| Node導入が非技術者には難しい | GitHub Releasesで`npm install`不要のZIPを提供 |
| `node:sqlite`の仕様変更 | DB access layerとmigration testで隔離 |
| 機能過多 | AI原価に直結する診断、制作物、設備、自宅費用、証拠へ限定し、税額・暗号資産・電子申告は扱わない |

## 12. 配布判断

### 採用

- 製品本体: `127.0.0.1`で動くローカルWebアプリ
- ソース: GitHub Public Repository
- ソース配布: cloneまたはsource archiveから`npm ci && npm run build && npm start`
- バージョン配布: `v*`タグでGitHub Release ZIPを自動公開。Node.js 24.14以上で`npm start`
- ライセンス: `LICENSE`にMIT Licenseを採用済み
- 公開デモ: Cloudflare Pagesへ、合成fixtureだけを使う静的ショーケースを公開済み。実履歴の走査・保存は行わない

### 将来

- Tauri等: Nodeを意識しないワンクリック配布
- Cloudflare Workers等の動的サービス: 将来必要になった場合も、実履歴をアップロードしない境界を維持する
- local agent + optional sync: 複数PC同期をユーザーが明示的に望む段階

## 13. 税務ルールの国税庁公式資料

- [自己の製作に係るソフトウェアの取得価額等](https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/08/06.htm)
- [減価償却のあらまし](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2100.htm)
- [資本的支出を行った場合の減価償却](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2107.htm)
- [少額減価償却資産・一括償却資産の所得税基本通達](https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/08/12.htm)
- [ソフトウェアの取得価額と耐用年数](https://www.nta.go.jp/taxes/shiraberu/taxanswer/hojin/5461.htm)
- [令和8年度税制改正の大綱（抄）](https://www.nta.go.jp/publication/pamph/shotoku/0026004-015.pdf)
