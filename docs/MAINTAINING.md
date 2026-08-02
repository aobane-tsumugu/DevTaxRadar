# メンテナー向けの手順

利用者には不要な、このリポジトリを維持する側の手順です。

## 公開デモのデプロイ

メンテナーはCloudflareへログインしたPCで次を実行します。

```bash
npm ci
npm run deploy:cloudflare
```

このPagesプロジェクトはWranglerによるDirect Upload方式です。自動デプロイを追加する場合は、Cloudflareで`Cloudflare Pages: Edit`だけを対象アカウントへ許可したAPIトークンを作成し、GitHub ActionsのRepository secretsへ`CLOUDFLARE_API_TOKEN`と`CLOUDFLARE_ACCOUNT_ID`を登録します。秘密値をリポジトリやIssueへ記載しないでください。

## デプロイ前の確認

公開デモは合成データ専用です。デプロイ前に必ず次を実行し、実データが混入していない
ことを確かめます。`deploy:cloudflare` は内部で `privacy:check` を実行しますが、
ビルド成果物だけでなくソースも確認してください。

```bash
npm ci
npm test
npm run privacy:check
```

## デモが古くなったとき

デモは手動デプロイのため、`main` を更新しても自動では追随しません。README の
「公開デモ」節に、現在のデモへ入っていない機能を書いています。デプロイしたら、
その記述も更新してください。

## リリース

`v*` タグを push すると、GitHub Actions が品質ゲートを通したうえで
`npm install` 不要の Release ZIP を公開します。

```bash
git tag v0.2.0
git push origin v0.2.0
```
