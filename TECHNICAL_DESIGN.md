# DevTax Radar 技術設計

Date: 2026-07-18
Decision status: Adopted for local-first public repository

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
| UI | React | 2ページのダッシュボードを短時間で構築できる |
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
│  ├─ App.tsx                    # 2画面UI・オンボーディング
│  ├─ client/                    # API client・UI型
│  ├─ server/
│  │  ├─ index.ts               # Fastify API・静的配信
│  │  ├─ database.ts            # node:sqlite
│  │  ├─ dashboard.ts
│  │  ├─ paths.ts
│  │  └─ security.ts
│  ├─ adapters/
│  │  ├─ claude.ts
│  │  └─ codex.ts
│  ├─ core/
│  │  ├─ allocation.ts
│  │  ├─ taxDecision.ts
│  │  └─ assetThresholds.ts
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

取得価額候補は資産単位で累積し、供用開始後に10万円・20万円等の金額境界へ渡す。決定木と金額境界モジュールは実装済みだが、金額境界の全入力をダッシュボードから編集・保存する接続は未実装である。

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
| 機能過多 | 実ログ読取、月次配賦、2ページ、10/20万円境界を最初の縦切りにする |

## 12. 配布判断

### 採用

- 製品本体: `127.0.0.1`で動くローカルWebアプリ
- ソース: GitHub Public Repository
- ソース配布: cloneまたはsource archiveから`npm ci && npm run build && npm start`
- バージョン配布: `v*`タグでGitHub Release ZIPを自動公開。Node.js 24.14以上で`npm start`
- ライセンス: `LICENSE`にMIT Licenseを採用済み
- 公開デモ: 必須ではない。必要な場合だけ合成fixtureによる静的ショーケースを作る

### 将来

- Tauri等: Nodeを意識しないワンクリック配布
- Cloudflare Pages／Workers Static Assets: 紹介サイトまたは合成デモのみ
- local agent + optional sync: 複数PC同期をユーザーが明示的に望む段階

## 13. 税務ルールの国税庁公式資料

- [自己の製作に係るソフトウェアの取得価額等](https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/08/06.htm)
- [減価償却のあらまし](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2100.htm)
- [資本的支出を行った場合の減価償却](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2107.htm)
- [少額減価償却資産・一括償却資産の所得税基本通達](https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/08/12.htm)
- [ソフトウェアの取得価額と耐用年数](https://www.nta.go.jp/taxes/shiraberu/taxanswer/hojin/5461.htm)
- [令和8年度税制改正の大綱（抄）](https://www.nta.go.jp/publication/pamph/shotoku/0026004-015.pdf)
