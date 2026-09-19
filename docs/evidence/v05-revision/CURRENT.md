# DevTax v0.5 現在地と検証の入口

更新日: 2026-09-19（日本時間）。対象は PR #18 / `work/w07-w08-acceptance-20260918`。main `271ef56352ab782ff71434769ed1edb78565c513` へのマージは行っていない。

## 現在の反映先

アプリ接続は `4f1439589d3dcf25fbed57b44c6aa0baca6cf997` と `6f574c4606e5e069640df96065d72bd081a33414` に反映済み。保存・計算・画面・年度採用・出力に関する41ファイルを実際のブランチtreeと照合した。以前の記録にある「独立部品のみ、アプリ未接続」は当時の履歴であり現在の状態ではない。

W08の主要資料・生成・検査は `f4e92ef2d75f3006d101f4d693a62331da43bd15` にpush済み。[今回の実行記録](2026-09-19-w08-sync.md)に反映した内容・対象ソースhash・生成結果・未実施をまとめた。

## W08で反映したもの

[現行要件モデル](../../design/current-design.json)と[受入条件原文](../../design/acceptance-scenarios.md)から、[要件表](../../design/requirements-matrix.md)と[設計図](../../design/workflow-blueprint.html)を同時生成する。31要件・21受入・36 APIを対応付け、旧図は[履歴](../../design/workflow-blueprint.legacy.html)として元の内容を保持した。

型引数付きAPIの抽出、登録元の双方向照合、実ソースのfingerprint、要件・参照・完了条件の検査を既存の文書検査へ接続。古いHTMLだけでなく、古い要件表も検査中に修復しない。8完了条件・21受入条件の文言を弱めていない。

現在の入口:

```sh
node scripts/design/build-workflow-blueprint.cjs
node scripts/design/build-workflow-blueprint.cjs --check
node scripts/design/verify-docs.cjs
```

最後のコマンドは実checkout全体を検査する。今回の環境では生成と実生成物一致、隔離2回再生成、関連する限定試験を実行した。完全なcheckoutの参照検査成功とはしていない。

## 今回の検証

**183件成功・失敗0・skip0**。Linux / Node22.16.0 / TypeScript5.8.3でVitest importだけをnode:testへ変更。実SQLite、既存の計算・原価補完・比較処理、実際の文書生成器と生成物を使用した。文書契約の追加13件は合成checkoutの検査器試験。古い成功件数を加算せず、実API・React・正式Node24全体の合格ともしていない。

[環境・対象ソースhash](2026-09-19-w08-environment.json)と[実行用helper](2026-09-19-w08-harness.cjs)を保存。helperは専用一時フォルダで実行し、個人DBや元履歴へアクセスしない。

## 残件の区分

**反映が残る4ファイル**：実装計画の状態欄、設計READMEの入口説明、npmの文書script、CIへの文書チェック追加。これらを含む後続の書込みが安全性確認で拒否されたため未反映。原因ファイルは不明で、拒否された処理を別経路で再実行していない。古いREADMEの生成元説明より、このCURRENTと今回の証跡を優先して読む。

**正式環境の検証**：Node24/lockfileの全体Vitest・型検査・lint・format・build・privacy・Release・実API/React操作、実checkoutの全体文書チェック。これらの未実施と実装済みを区別する。W01〜W08の総合受入完了とはしない。

**別枠の実機確認**：Windows、実ブラウザ、狭い画面、実共有フォルダ、大容量実利用。ユーザー指示に従い実装を進める前提待ちにしていない。

**製品の適用範囲・目標**：[要件表](../../design/requirements-matrix.md)に未対応の特殊条件、全形式取込、共通事実モデル、生涯全体画面等を明示。制限を環境だけの問題として扱わない。

## 保持する履歴

- [承認後の候補部品push](2026-09-19-approved-retry.md)と[先行分割push](2026-09-19-split-push.md)。当時のブロックと独立部品の結果であり、アプリ接続前の履歴。
- [原本なし読取り](2026-09-18-offline-review-reader.md)、[backup照合と文書検査器](2026-09-18-backup-doc-verification.md)。data:read、全DB復元、saltとschemaの照合を保持。
- [年度参照と証拠比較](2026-09-17-year-reference-evidence.md)、[取得元保持とcache](2026-09-17-restore-recovery.md)、[返金保存境界](2026-09-17-adjustment-save.md)。既存の修正を未着手として作り直さない。

実装計画の完了条件、実データ・原本・既存採用資料は変更していない。mainへのマージ、Release、公開デプロイ、権限・課金・Actions有効化設定の変更は行っていない。
