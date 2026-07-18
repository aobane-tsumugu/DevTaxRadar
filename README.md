# DevTax Radar

![DevTax Radar — AI原価を、説明できる数字に。](./public/og.jpg)

> **Claude CodeとCodexの定額料金を、説明可能なプロダクト別AI原価へ。**

DevTax Radarは、収益化前の個人開発者向けローカルWebアプリです。同じ定額サブスク内に混在する新規開発、機能追加、保守、私用を、Claude Code／Codexのローカル利用履歴から月別・プロダクト別に配賦します。

単なる「仕事60%、私用40%」ではありません。Providerごとの利用量、プロダクト、資産・改良計画、作業目的までたどれる数字を作り、通常経費、新規ソフトウェア取得価額、資本的支出、私用等の**税務処理候補**を提示します。

Global Build Week Community Event - Tokyo　の3時間ハッカソンでのバイブコーディングのMVPプロダクトです。
https://luma.com/uj22d2rs
セキュリティ・ロジックの精査は不十分な可能性があるのでプロトタイプとして、個人の責任でご利用ください。

> Status: Hackathon MVP。履歴走査・配賦・ローカル保存・2画面UI・税務候補エンジンを実装済みです。申告内容を確定する製品ではありません。

## 公開デモ

Cloudflare Pages版は、複数月の動作確認に使える**完全な合成データ専用デモ**です。実在するセッション、パス、プロンプト、請求額はアップロードしません。

**公開URL: [https://devtax-radar.pages.dev/](https://devtax-radar.pages.dev/)**

公開デモは閲覧・画面操作用です。自分のClaude Code／Codex履歴を走査する場合は、下記のローカル版を使用してください。

## ローカルで起動

必要環境は**Node.js 24.14以上**です。

```bash
git clone https://github.com/aobane-tsumugu/DevTaxRadar.git
cd DevTaxRadar
npm ci
npm run dev
```

起動後、`http://127.0.0.1:5173`を開きます。ローカルAPIは`127.0.0.1:4317`で動きます。

本番相当のローカル実行:

```bash
npm run build
npm start
```

GitHub ReleaseのZIPは依存関係をbundle済みです。Node.js 24.14以上を用意して展開し、ZIP内で次を実行します。`npm install`は不要です。

```bash
npm start
```

起動後、`http://127.0.0.1:4317`を開きます。

GitHubからソースまたはReleaseを取得し、各利用者のPCで使うことを配布の基本とします。利用者自身にCloudflareアカウントは不要です。

## デモ

1. 「設定を確認」からオンボーディングを開く
2. Claude Code／Codexを選んで履歴を走査する
3. 検出した作業フォルダをProduct A／B等へ割り当てる
4. Provider×月別の請求額と未取得利用率を保存する
5. 「今年どうなる？」で複数月の3グループ集計を見る
6. 「なぜそうなる？」で配賦額から匿名化された根拠メタデータまでたどる

APIへ接続できない静的プレビューでは、UI確認用の合成データへフォールバックします。実履歴はリポジトリ、Release、公開デモへ含めません。

## Cloudflareへデプロイ

メンテナーはCloudflareへログインしたPCで次を実行します。

```bash
npm ci
npm run deploy:cloudflare
```

このPagesプロジェクトはWranglerによるDirect Upload方式です。自動デプロイを追加する場合は、Cloudflareで`Cloudflare Pages: Edit`だけを対象アカウントへ許可したAPIトークンを作成し、GitHub ActionsのRepository secretsへ`CLOUDFLARE_API_TOKEN`と`CLOUDFLARE_ACCOUNT_ID`を登録します。秘密値をリポジトリやIssueへ記載しないでください。

## 実装済み

- `~/.claude/projects/**/*.jsonl`と`~/.codex/sessions/**/*.jsonl`のread-only走査
- 本文を正規化データへコピーしないClaude Code／Codex Adapter
- セッション、作業フォルダ、モデル、月、トークン内訳の正規化
- 識別子とパスの端末内saltによるハッシュ化
- ClaudeとCodexを別分母にした月額配賦
- Provider×月別に異なる請求額の入力・SQLite保存・配賦
- 入力、出力、キャッシュを区別した加重利用量
- 私用、未分類、未取得利用、丸め調整を含む配賦不変条件
- 複数月サマリーと詳細配賦の2画面UI
- 月額、未取得利用率、プロダクト割当のSQLite保存
- 通常経費、取得価額、資本的支出、制作原価、私用等の決定木
- 10万円・20万円と青色申告者向け少額特例の条件ガイダンス
- loopback限定、Origin検査、CSRF token、64 KiB本文上限
- 合成fixture、ユニット・統合テスト、公開物のprivacy check
- Pull Request／`main` push時のGitHub Actions CI
- `v*`タグから、`npm install`不要のRelease ZIPを自動公開

主要実装:

- [Claude Code Adapter](./src/adapters/claude.ts)
- [Codex Adapter](./src/adapters/codex.ts)
- [定額料金の配賦](./src/core/allocation.ts)
- [税務候補の決定木](./src/core/taxDecision.ts)
- [資産金額境界](./src/core/assetThresholds.ts)
- [ローカルAPI](./src/server/index.ts)
- [プライバシー検査](./scripts/privacy-check.ts)

## 配賦方法

ClaudeとCodexではトークン定義が異なるため、生トークンをProvider間で合算しません。

```text
Provider月次配賦額
= Provider月額
× 対象プロダクトの加重利用量
÷ Provider内の配賦分母
```

各Providerの月額は、プロダクト、私用、未取得利用、丸め調整の合計と必ず一致します。未取得利用は、Webチャットや別PCなどローカル履歴で捕捉できない利用へ月額の一部を留保する仕組みです。

## 税務ガイダンスの範囲

画面では「今年の必要経費」「翌年以後へ残る原価」「対象外・要確認」の3グループに簡略化し、内部では通常経費、取得価額、資本的支出、制作原価、私用等を分けます。

現在のルール実装は、次の事実を区別します。

- 10万円**未満**と、10万円以上20万円未満
- 青色申告者向け少額特例の新旧判定日は**取得・製作日**。供用開始日は減価償却等の別条件
- 同特例の対象は10万円以上で、年間上限300万円は事業月数で月割り
- 一括償却資産を選択した資産との重複適用不可
- 貸付用資産は、主要な事業として行う貸付け等を除いて対象外
- ソフトウェアの耐用年数候補は、複写販売用原本・研究開発用が3年、その他が5年

資本的支出については候補分類まで実装していますが、**当年の減価償却額はまだ算定しません**。耐用年数、償却方法、供用日等を不足情報として返します。

## プライバシー

履歴の読取、集計、分類、保存は利用者のPC内で完結します。

- サーバーは`127.0.0.1`だけで待受
- telemetry、クラウド同期、外部LLM送信なし
- プロンプト、応答、ソースコードを保存しない
- 元のセッションIDと絶対パスを保存しない
- SQLiteはOS標準のユーザーデータ領域へ保存
- 実ログ、DB、ホームパス、UUID等をprivacy checkで検査
- Release ZIPから実データ、fixture、ローカルDBを除外

詳細は[セキュリティ方針](./docs/SECURITY.md)を参照してください。

## テスト

```bash
npm test
npm run typecheck
npm run lint
npm run privacy:check
npm run build
```

テストはAdapter、配賦不変条件、税務候補、資産境界、SQLite、パス、セキュリティ、ローカルAPIを対象にしています。実ユーザー履歴ではなく合成fixtureと一時ディレクトリを使います。

## 現在の制約

- 税務ルールエンジンは実装済みですが、全ルールがダッシュボードUIへ接続済みではありません
- CSV出力、判定確定・修正ボタン、直接費入力、供用開始登録は画面上のデモで、永続化処理は未実装です
- 資本的支出の当年償却額、制作原価、前払費用、旧版残価移転は未算定です
- 事業所得／雑所得、税額、申告内容、税務上の資産単位を自動確定しません
- Claude Code／Codexの履歴形式変更にはAdapter更新が必要です
- DB暗号化と複数PC同期は未実装です

本プロジェクトは、開発履歴と費用の整理、税務処理候補の説明を支援するプロトタイプです。税務相談や税理士業務を代替するものではありません。

コードは[MIT License](./LICENSE)で公開します。

## 設計資料

- [統合プロダクト仕様](./PRODUCT_SPEC.md)
- [技術設計](./TECHNICAL_DESIGN.md)
- [セキュリティ方針](./docs/SECURITY.md)

## 国税庁公式資料

- [自己の製作に係るソフトウェアの取得価額等](https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/08/06.htm)
- [資本的支出と修繕費等](https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/05/07.htm)
- [減価償却のあらまし](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2100.htm)
- [資本的支出を行った場合の減価償却](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2107.htm)
- [少額減価償却資産・一括償却資産の所得税基本通達](https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/08/12.htm)
- [ソフトウェアの取得価額と耐用年数](https://www.nta.go.jp/taxes/shiraberu/taxanswer/hojin/5461.htm)
- [令和8年度税制改正の大綱（抄）](https://www.nta.go.jp/publication/pamph/shotoku/0026004-015.pdf)
