# W08：未反映4ファイルの分割push完了

実施日: 2026-09-19（日本時間）。対象: PR #18 / `work/w07-w08-acceptance-20260918`。
再開基点: `78b506bcf89f8ecbe993b8d06022d7dada616106`。
4ファイル反映後: `7c05eda413ed0be9e5819080c91bfb683a526e44`。

## 今回の結論

前回の書込みで残っていた4ファイルを、ユーザーの再試行・分割指示に従い1ファイルずつ反映した。今回は4件とも成功した。ローカルのZIPだけではなく、下記コミットを作業ブランチへpush済み。mainへのマージ、Release、公開デプロイは行っていない。

| コミット | ファイルと変更 |
| --- | --- |
| `577022d88c0d50c9f20248a1778772721a98182c` | package.json：既存生成器を呼ぶdocs:generate/docs:checkを追加。依存関係・製品コマンドは変更なし |
| `bec9174ab42dcadbb62a3bb4dce087cd96c7b646` | .github/workflows/ci.yml：Node設定後・npm ci前にdocs:checkを追加。既存の型検査・試験・lint・format・build・privacyを維持 |
| `f52a464fa727e91514c4d5be264cf0085b491a57` | docs/design/README.md：現行モデル・生成器・検査入口と旧図の履歴区分を説明 |
| `7c05eda413ed0be9e5819080c91bfb683a526e44` | docs/design/implementation-plan.md：現在地とW06〜W08の状態を同期。8つの完了条件は不変 |

GitHub compareはahead 4 / behind 0、変更ファイルは上記4つだけ。package.jsonは2行追加、CIは3行追加であり、既存ゲートの削除や権限拡大はない。計画は以前に準備済みのblob `1c43469be183bd2381c38b9106d427e3ebcff294` を全文再読取りして再利用した。

## 文書とCIの入口

```sh
npm run docs:generate
npm run docs:check
```

生成器、要件表・HTML、既存の隔離2回再生成検査は以前の `f4e92ef` を維持する。今回の変更により上記npm scriptとCIから呼べる。CI接続済みと、CI実行成功は別である。

## 今回実行した検証

Linux / Node.js 22.16.0 / TypeScript 5.8.3。既存 `tests/server/currentDesign.test.ts` を専用一時フォルダで構文変換し、Vitest importだけをnode:testへ変更して実行した。生成器・検査器・API抽出の実装は差し替えていない。完全なcheckoutではなく、Git blobで一致を確認した対象ファイルを使用した。

結果: **22 tests / 3 suites / pass 22 / fail 0 / skipped 0 / cancelled 0**。

実際の要件表・HTMLの一致、隔離2回再生成、古い生成物・古い要件表の拒否、入力の非書換え、AC行の保持、HTMLのエスケープ、モデルの重複・不正参照拒否、CLI引数、アンカー、型引数付きの実observationRoutesなどを検査した。前回の183件は今回再実行しておらず、22件に加算していない。

生成と実生成物照合も直接実行した。

```sh
node scripts/design/build-workflow-blueprint.cjs
node scripts/design/build-workflow-blueprint.cjs --check
```

| 生成物 | bytes | SHA-256 |
| --- | ---: | --- |
| requirements-matrix.md | 21306 | 90bf27e957c0a29fa098808527d7da942f058d0ba5b83f0ec4ab18c9777c233a |
| workflow-blueprint.html | 45003 | dfe7c6c6d9948310b3552d7f3d40d0b96ae4deaa8abd89da59f76b262f15f59d |

生成物はGitHubの既存blobと一致し、今回再書込みする必要はなかった。更新した計画の8完了条件と21AC行も、現行モデルにある次のSHA-256に一致した。対象行をLFで結合し、終端LFを加えた値である。

- 8完了条件: `e5e8947e38a19d073334a966c21eecce3d674895bd19edc0080a38b68d520c09`
- 21AC行: `77ab4839351a06b8e5edd66db53898ab3312d59e12b1000c3c32363f77016f4e`

## 実行内容とリモートの一致

実行した生成器・検査器・テスト・モデル・生成物と計画の11パスについて、ローカルのGit blob SHAをリモートtreeへ再指定した。tree SHAは `5dbb314bcea1241c5edf66095d28283a1b81335f` のままであり、検証対象とpush後の内容が一致した。この照合による新しいコミット・ブランチ更新は行っていない。

| ファイル | Git blob SHA |
| --- | --- |
| scripts/design/build-workflow-blueprint.cjs | 9d89ef2355a4d3dbd7eee9716a8500e369d52e46 |
| scripts/design/render-current-design.cjs | 3c8ca10dd9a3699969dafbcaf57733850981e43a |
| scripts/design/verify-docs.cjs | 298c3f495bf81cdf8565187c2cfaa02986455e8c |
| scripts/design/route-inventory.cjs | 4bb7dc65e6e938af00f00acfa0e223548ec2f235 |
| docs/design/current-design.json | 22163729bd9ef0081895ecc7446d1dc8960702d1 |
| docs/design/acceptance-scenarios.md | 8381d82ec6f824ae307d776ab6c395647160ad3b |
| docs/design/implementation-plan.md | 1c43469be183bd2381c38b9106d427e3ebcff294 |
| tests/server/currentDesign.test.ts | 2f953b0fb024cc3911655bf349dc95c0e16db853 |
| src/server/observationRoutes.ts | 89312522da733e41d08b16d48490d6b27bdff05b |
| docs/design/requirements-matrix.md | 0b9b2b5a8a9bff7d79d13c5314fdded9b3b8dda6 |
| docs/design/workflow-blueprint.html | 8f32f15adf2c51aa692d668325b5ff92c52a36ed |

生TAPのSHA-256: `a9476ff9ee90067cadfc9e03eb2f3bc1f156930944b6084044caeb5280c5904b`。標準の再実行入口は `npm test -- tests/server/currentDesign.test.ts`。今回の実行は上記Node22のimport変更を伴う限定実行であり、正式Vitestの実行とは区別する。

## 未実施と完了の区分

**W08で未反映だった4ファイルの残件は解消した。** 以前の「4ファイルがブロックされ未反映」という記録は当時の履歴となる。W08の文書同期・生成物・検査入口・CIへの接続はブランチにそろった。

一方、正式Node24/lockfileの全体Vitest・型検査・lint・format・build・privacy・Release・実API/React操作、および完全なcheckoutを使うdocs:check全体は未実施。今回もnpm registryの名前解決に失敗した。空の参照ファイルを作って全体文書検査を通したり、別環境の試験を合格扱いにしたりしていない。

`7c05eda` のActions実行一覧は確認時点で0件。CI設定は反映済みだが、CI合格は未確認。権限・課金・Actionsの有効化設定やジョブ再送は変更していない。

Windows・実ブラウザ・狭い画面・実共有フォルダはユーザーの別枠。要件表で明示した未対応条件や目標機能も今回の文書更新で実装済みにしない。W01〜W08の製品全体の総合受入完了は宣言しない。実データ・原本・採用済み資料には触れていない。
