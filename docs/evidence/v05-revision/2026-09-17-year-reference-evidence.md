# 2026-09-17 年度参照の範囲と過年度原価の証拠照合

基点: main `91c8e841febe97b5fc466349291102a1c8c5d7e0`。W06の年度採用・訂正の不備を修正した。税務上の方式・税額の新しい判断は追加していない。

## 修正

### 年度採用に翌年の未確認入力を要求しない

`buildReviewMaterials` は返金記録だけを対象年度までに絞っていたが、`checkBalanceReferences` は翌年の残高移動・未判断・解消判断も検査していた。そのため翌年の作業案に未確認の判断があるだけで、当年の年度資料も `needs-review` になる。

既存の参照照合に明示的な対象年度を追加し、年度資料の生成から渡す。対象年度までの移動・未判断・解消・回答・返金参照を同じ範囲で確認する。翌年の解消は当年の解消として採用しない。当年・過年度の参照切れ、未確認判断、同一参照の曖昧さ、外部期首、返金の原価照合は維持する。原価追跡と参照確認の年度不一致も拒否する。

対象年度を渡さない通常の照合は、従来どおり全snapshotを確認する。全snapshotの金額・日付・残高の保存則を検証する経路は変更しない。将来の入力を削除せず、渡されたsnapshot・planning・固定資料を変更しない。

### 同額でも、過年度原価に使った証拠の変更を検出する

`historicalReviewMaterials` は `linkedCostInputs` に過年度の費用計算を含める一方、証拠本文の選択では当年の費用だけを見ていた。過年度の領収書や配賦根拠が同じIDのまま変更・削除されても、年度の訂正チェックで差が出ないケースがあった。

比較対象に既に含まれている費用計算から、元費用・寄与・埋込み返金の証拠参照を集めるよう修正した。無関係な資料・未接続の将来費用を比較対象へ広げず、証拠一覧の並替えも訂正としない。旧資料の計算結果を再計算したり、採用済みpayloadを上書きしたりしない。

## 実行結果

環境: Linux、Node.js `22.16.0`、TypeScript `5.8.3`。

| 試験 | 件数 | 基点 | 修正後 |
| --- | ---: | --- | --- |
| 新規 `tests/core/balanceReferenceYear.test.ts` | 24 | 成功10・失敗14 | 成功24・失敗0 |
| 新規 `tests/core/reviewHistoryEvidence.test.ts` | 12 | 成功7・失敗5 | 成功12・失敗0 |
| 既存 `tests/core/adjustmentCostLink.test.ts` | 26 | 成功26・失敗0 | 成功26・失敗0 |
| 合計 | 62 | 成功43・失敗19 | 成功62・失敗0・skip0 |

TypeScriptをJavaScriptへ構文変換し、試験の `vitest` importだけを `node:test` に変更して実行した。assertは `node:assert/strict` を使用。**製品関数・入力検証・照合関数の置換や省略は行っていない。** 返金の入力検証も取得した実装をそのまま実行した。費用projectionと原価traceの入出力は合成fixtureであり、全原価エンジンを実行した結果ではない。

基点から取得した実行対象7製品ファイル、年度資料生成ファイル、既存試験はGit blob SHAとバイト一致を確認した。主要な基点blob:

- `balanceReferences.ts`: `be9c9f3738f85f4fbb9019c208b861dfdd218d74`
- `reviewHistory.ts`: `6e02bde8732828d46f758d7eae17fa60272eaa2c`
- `reviewMaterials.ts`: `d438fe8d3cfdfa35e9ffd75bb731cb051b1894f0`
- `adjustmentCostLink.test.ts`: `ddf8d9c05f2559472516820497a7794d6e467db2`

取得した製品8ファイルと試験3ファイルの構文変換は診断0。年度資料生成から対象年を渡す呼出しは静的確認であり、Zod/Fastifyを含む実API実行ではない。

この環境ではnpm registryとNode配布元の名前解決が失敗し、Node24配布物の取得も失敗した。lockfileの依存関係は取得できていない。基点SHAのGitHub Actions実行一覧は0件だった。設定変更・再実行で検証成功を作ったとは扱わない。

正式な環境で再実行する既存コマンド（下記を今回実行済みとはしない）:

```sh
npm ci
npm test -- tests/core/balanceReferenceYear.test.ts tests/core/reviewHistoryEvidence.test.ts tests/core/adjustmentCostLink.test.ts
npm run typecheck
npm test
npm run lint
npm run format:check
npm run build
npm run privacy:check
```

## 残る受入

Node24・TypeScript6・lockfileによる全体検証、年度preview→採用→再読込の実API、返金を含む画面・Markdown・JSONの同一revision確認は未実施。W07の完全なbackup→restore・原本なし資料読取り・Windows実機、W08の要件表・生成元・生成HTML全体同期も未完了。

実データ・原本・採用済み資料、Releaseタグ、公開デプロイ、Actions設定は変更していない。新規ブランチ・force pushは使用しない。過去の限定試験件数を現在mainの全体成功には転用しない。
