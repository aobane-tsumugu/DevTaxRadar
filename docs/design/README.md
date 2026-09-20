# DevTaxの仕様と設計資料

更新日: 2026-09-19。アプリ接続の確認基点は `6f574c4606e5e069640df96065d72bd081a33414`（PR #18）。現行の文書生成と照合は `f4e92ef` から反映しています。

製品仕様v0.5と技術設計v0.5は完成形の正本です。接続したコード、実行した検証、まだ満たしていない要件を区別し、文書生成の成功を製品全体の受入へ読み替えません。

## 現行の入口

- [製品仕様](../../PRODUCT_SPEC.md)と[技術設計](../../TECHNICAL_DESIGN.md)：要求と設計契約。
- [現行設計図](workflow-blueprint.html)と[要件対応表](requirements-matrix.md)：同一モデルから生成した現在の接続範囲。31要件・36 API・21受入の対応。
- [実装計画](implementation-plan.md)：W01〜W08の責務・変更しない完了条件。[CURRENT](../evidence/v05-revision/CURRENT.md)：反映先・実行結果・未実施。
- [受入条件の生成元](acceptance-scenarios.md)と[方法比較の境界](method-comparison-rule.md)：受入の原文と条件付き計算の適用範囲。

## 生成と検査

```sh
npm run docs:generate
npm run docs:check
```

npm scriptは次の入口を呼びます。生成器と文書検査器はNode組込み機能だけを使用し、個人DB・HOME・履歴・ネットワークへアクセスしません。

```sh
node scripts/design/build-workflow-blueprint.cjs
node scripts/design/build-workflow-blueprint.cjs --check
node scripts/design/verify-docs.cjs
```

生成元は `docs/design/current-design.json` と `acceptance-scenarios.md`、描画は `scripts/design/render-current-design.cjs` です。要件表とHTMLだけを直接編集せず、モデル変更と両生成物を同じ変更へ含めてください。`--check` は不一致を修復せず失敗させます。

既存 `verify-docs.cjs` はリンク・アンカー・文字コード・構文・要件/受入対応を調べ、隔離先で2回生成して追跡HTMLとバイト一致を比較します。要件表だけが古くても検査中に修復しません。`verify-current-inputs.cjs` は実checkoutの仕様ID、型引数を含む登録APIとその所属モジュール、コード参照、8完了条件と21受入条件の原文ハッシュを照合します。

コピー対象のシンボリックリンク・特殊ファイルは拒否し、元HTMLと生成結果にも通常ファイルを要求します。DB・saltに加えて`.env`系、`.npmrc`、`.netrc`、`.claude`、`.codex`をコピー対象から除外します。これにより、コピーされたリンクを通して元の作業ツリーへ書き込む経路を残しません。

隔離先はOSサンドボックスではありません。任意の悪意あるNodeスクリプトの動作を封じるものではないため、生成器そのものを確認してから実行してください。[コピー境界と回帰試験](../evidence/v05-revision/2026-09-19-environment-completion.md)に今回の検証範囲を記録しています。

API登録元を変更した場合は一覧と責務を再確認し、`sourceBlobs` のGit blob SHAを更新してください。ハッシュだけ更新して新APIを記載しなければ、双方向のルート照合が失敗します。受入条件を弱めて通すために契約ハッシュを更新しないでください。

CIはNode設定後、依存インストール前に同じ文書チェックを実行する構成です。この接続はCIの実行成功を意味しません。Node24・lockfileの製品試験、型検査、lint、format、build、privacyは引き続き別の必須工程です。実行済みの範囲はCURRENTと証跡を参照してください。

## 設計の履歴

[旧設計図](workflow-blueprint.legacy.html)は、従来のP1〜P6・R1〜R6と詳細図を失わないよう、元のblobを変更せず同じフォルダへ保存したものです。古い日付・API・進捗は当時の履歴であり、現行実装の説明には使いません。[設計判断](purpose-led-redesign.md)、[旧製品仕様](archive/PRODUCT_SPEC.v0.4.md)、[旧技術設計](archive/TECHNICAL_DESIGN.v0.4.md)も保持しています。

旧 `scripts/design/current-*.cjs`、`purpose-*.cjs`、`end-state.cjs`、`work-plan.cjs` 等は旧図の生成意図を残す履歴モジュールです。現行入口からは実行せず、旧行番号や撤去済みシンボルの記述を現行モデルへ混在させません。
