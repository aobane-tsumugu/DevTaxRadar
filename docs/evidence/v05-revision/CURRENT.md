# DevTax v0.5 現在地と検証の入口

更新日: 2026-09-19（日本時間）。対象: PR #18 / `work/w07-w08-acceptance-20260918`。main `271ef56352ab782ff71434769ed1edb78565c513` へのマージは行っていない。

## 現在の反映先

アプリ接続は `4f1439589d3dcf25fbed57b44c6aa0baca6cf997` と `6f574c4606e5e069640df96065d72bd081a33414` に反映済み。保存・共通計算・画面・年度採用・出力への接続を含む。以前の「独立部品のみ、アプリ未接続」という説明は当時の履歴である。

W08の要件表・現行モデル・生成HTML・検査は `f4e92ef2d75f3006d101f4d693a62331da43bd15` に反映済み。今回、最後に未反映だった4ファイルを1つずつpushし、`7c05eda413ed0be9e5819080c91bfb683a526e44` までで解消した。

| コミット | 今回反映した残件 |
| --- | --- |
| `577022d` | package.jsonのdocs:generate/docs:check |
| `bec9174` | CIへの文書チェック接続（既存の製品ゲートは維持） |
| `f52a464` | 設計READMEの現行生成元・手順・履歴区分 |
| `7c05eda` | 実装計画の現在地とW06〜W08状態（完了条件は不変） |

[今回の分割pushと検証の記録](2026-09-19-w08-finalization.md)を `4e18acb` に反映した。**これら4ファイルの未反映残件はない。** W08の文書同期・生成物・検査入口・CIへの接続は作業ブランチにそろった。製品全体の受入済みという意味ではない。

## 現行の入口

```sh
npm run docs:generate
npm run docs:check
```

[要件モデル](../../design/current-design.json)と[受入条件原文](../../design/acceptance-scenarios.md)から、[要件表](../../design/requirements-matrix.md)と[設計図](../../design/workflow-blueprint.html)を同時生成する。31要件・21受入・36 APIを対応付ける。[実装計画](../../design/implementation-plan.md)の8完了条件と21AC行の原文ハッシュも維持する。使い方は更新済みの[設計README](../../design/README.md)を参照。

docs:checkは生成物の一致、リンク・アンカー・文字コード、仕様と要件、型引数付きAPIと登録元、コード参照、受入条件を検査する。隔離した2回再生成を含み、検査中に古いHTML・要件表を修復しない。完全なcheckoutが必要であり、コマンドの接続と全体実行成功は区別する。

## 今回の検証

**文書回帰22件成功・失敗0・skip0**。Linux / Node.js 22.16.0 / TypeScript 5.8.3で、既存currentDesign.test.tsのVitest importだけをnode:testへ変更した限定実行。生成器・検査器は実装を変えず使用した。

実際の要件表・HTMLの生成一致、隔離2回再生成、入力不変を再確認。更新した計画の8完了条件と21AC行のハッシュ一致を確認した。実行対象等11パスをGitHub treeと照合し、同じ内容であることを確認済み。今回の変更は4ファイルだけで、製品コード・依存関係は変更していない。

前回の183件は[W08本体の同期記録](2026-09-19-w08-sync.md)と[当時の環境](2026-09-19-w08-environment.json)に限定する。今回再実行した件数へ加算しない。[以前の再現helper](2026-09-19-w08-harness.cjs)も保持する。

## 残る検証と適用範囲

**正式環境の検証**：Node24/lockfileの全体Vitest・型検査・lint・format・build・privacy・Release・実API/React操作、および完全なcheckoutでのdocs:check全体は未実施。今回もnpm registryの名前解決に失敗した。CIは接続済みだが、`7c05eda` のActions一覧は確認時点で実行0件であり、合格とはしていない。

**別枠の実機確認**：Windows、実ブラウザ、狭い画面、実共有フォルダ、大容量実利用。ユーザー指示に従い実装進行の前提待ちにはしないが、合格とも宣言しない。

**製品の適用範囲・目標**：[要件表](../../design/requirements-matrix.md)に記載した未対応の特殊条件、全形式取込、共通事実モデル、生涯全体画面等を維持する。文書更新で未対応機能を実装済みに変えない。W01〜W08の製品全体の総合受入は未完了。

## 保持する履歴

- [W08本体の同期](2026-09-19-w08-sync.md)。当時残った4ファイルは今回解消済み。
- [承認後の候補部品push](2026-09-19-approved-retry.md)と[先行分割push](2026-09-19-split-push.md)。当時のブロックと独立部品の結果。
- [原本なし読取り](2026-09-18-offline-review-reader.md)、[backup照合と文書検査器](2026-09-18-backup-doc-verification.md)。data:read、全DB復元、salt・schema検査を保持。
- [年度参照と証拠比較](2026-09-17-year-reference-evidence.md)、[取得元保持とcache](2026-09-17-restore-recovery.md)、[返金保存境界](2026-09-17-adjustment-save.md)。既存の修正を未着手として作り直さない。

実装計画の完了条件、実データ・原本・既存採用資料は変更していない。mainへのマージ、Release、公開デプロイ、権限・課金・Actions有効化設定の変更は行っていない。
