# DevTaxへの参加

DevTaxは開発中のプロトタイプです。不具合の報告、要望、プルリクエストを歓迎します。

## 受け付けているもの

- **不具合の報告**：再現手順、期待した結果、実際の結果、OSとNode.jsの版を書いてください。
- **要望**：どんな場面で何に困っているかを先に書いてください。機能の形はそのあと一緒に考えます。
- **プルリクエスト**：小さな修正はそのまま送ってください。大きな変更は、先にIssueで方向を相談してもらえると手戻りが減ります。

税務上の扱いを判断する相談は受け付けていません。DevTaxは税理士業務を代替しません。

## 実データを載せない

Issue・プルリクエスト・スクリーンショットに、実際のClaude Code／Codex履歴、プロンプト、請求額、プロジェクト名、ホームディレクトリのパスを載せないでください。再現には合成データを使ってください。テストも合成fixtureと一時ディレクトリだけを使います。

`npm run privacy:check`はホームパスやUUIDなどの混入を検査しますが、すべてを見つけられるわけではありません。送る前に差分を自分で確認してください。

## 開発の始め方

Node.js 24.14以上が必要です。

```bash
npm ci
npm run dev
```

画面は`http://127.0.0.1:5173`、ローカルAPIは`127.0.0.1:4317`で動きます。自分の履歴を触らずに試すときは、別のデータフォルダを指定して起動してください。

```bash
DEVTAX_RADAR_DATA_DIR=/tmp/devtax-dev DEVTAX_RADAR_AUTO_SCAN=0 npm run dev
```

PowerShellでは次のとおりです。

```powershell
$env:DEVTAX_RADAR_DATA_DIR = "$env:TEMP\devtax-dev"; $env:DEVTAX_RADAR_AUTO_SCAN = "0"; npm run dev
```

## 送る前の確認

READMEの[開発に参加する](./README.md#開発に参加する)にある9つのコマンドを順に実行してください。`format:check`も必須です。失敗した対象を`npx prettier --write <file>`で整形し、差分を確認してから再実行してください。対象は`src/**/*.{ts,tsx,css}`、`tests/**/*.ts`、`scripts/*.ts`です。Markdownや`tests/**/*.tsx`はこのコマンドの対象外です。既存の未整形を理由にゲートを省略しないでください。

- 挙動を変えたら、それを確かめるテストを足してください。
- APIを追加・変更したら`docs/design/current-design.json`も更新し、`npm run docs:check`を通してください。
- 不明な金額を0円として扱わない、履歴ファイルへ書き込まない、という既存の約束は崩さないでください。

## コミット

1つのコミットには1つの理由の変更を入れ、件名は何が変わるかを英語で短く書いてください（例：`fix: keep the viewed year after saving`）。
