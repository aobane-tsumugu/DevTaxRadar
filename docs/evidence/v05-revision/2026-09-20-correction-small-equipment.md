# C02：少額設備の供用年費用基礎を既存経路へ接続

実施日: 2026-09-20（日本時間）。Issue #21 / 親Issue #19 / PR #18。
基点: `719f7aef4c3ddee5bee871b6dc39db4484755714`。

## 実装

先行する `bf47a10` の8万円の方法比較と通常業務の供用質問の修正、`719f7ae` の試算・判断根拠の分離を保持した。今回、新しい台帳を作らず、既存equipmentMethodSchema → planningのJSON保存 → inspectEquipmentAnnualCalculation → workspaceCosts → 年度資料と設備表示へ、`immediate-expense` を接続した。

有形設備の全体取得価額が10万円未満であることを業務割合の適用前に判定する。個人・供用日・通常条件・貸付用途を確認し、供用年の年額基礎を全体額とする。業務・制作物割合は従来の共通配分で一度だけ適用する。翌年は既知の0円として再計上しない。未供用、不明価額、貸付条件の不足は0円に置き換えない。普通定額法の入口も、通常の少額資産をそのまま償却しないようにした。

少額の処理に耐用年数・供用月の月割り・年末までの継続利用を要求しない。編集画面の耐用年数・継続利用の質問をこの方法では隠すが、以前の入力や採用済み資料は削除しない。貸付用途の項目は該当する取得日と金額のときだけ表示する。少額の費用基礎を普通償却額と表示しない。

結果は新しい識別子 `jp-individual-small-equipment/1` を持ち、普通定額法の保存形式は維持する。既存消費側が利用する年額フィールド `depreciationJpy` は互換のため継続使用するが、新形式は `amountKind: immediate-expense`、率・月数はnull、端数処理なし、残存額0として明示する。旧資料の読取りに新計算を適用しない。

過去の普通償却残高が入力されている場合、それを方法変更だけでゼロにしない。不整合として訂正の確認を求める。法人、私用転用、無形資産、特殊調整を通常の少額設備処理へ補完しない。用途や活動への税務適用そのものを自動認定するものではない。

## 根拠

2026-09-20に国税庁 No.2100 の個人所得税向け説明を確認した。10万円未満、供用年、2022年4月以後の主要業務以外の貸付除外、税込・税抜を含む取得価額の意味を確認する。支払の一部や業務按分後の額で閾値を判定しない。

- https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2100.htm
- https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2106.htm

## 実行した検証

Linux / Node.js 22.16.0 / TypeScript 5.8.3。実製品の `equipmentImmediateExpense.ts` と35件の回帰試験を専用一時領域で構文変換し、Vitest importだけをnode:testへ変更して実行した。

**35 tests / 1 suite / pass 35 / fail 0 / skipped 0 / cancelled 0**。

8万円・12月供用・翌年0・既知0と不明・未供用・取得年をまたぐ供用、99,999/100,000境界、貸付条件、既知の未対応条件、矛盾日付、前年の普通償却残高を消さないことを検査した。元の入力を変更しないことも確認した。この純粋関数には代替のZod/SQLiteを挿入していない。

新規の自己完結した計算モジュールは `tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler src/core/equipmentImmediateExpense.ts` で実際に型検査した。既存のschema・画面・workspace側変更と統合試験は構文変換まで。これを製品全体の意味解析型検査の合格とはしない。

実schema、共通projection、SQLiteの既存テーブル保存とrollbackを使う7件の `equipmentImmediateIntegration.test.ts` も追加したが、lockfile依存のある正式実行は未実施。35件へ加算していない。通常の検証入口:

```sh
npm test -- tests/core/equipmentImmediateExpense.test.ts tests/core/equipmentImmediateIntegration.test.ts
```

Node24全体検証・実API・React操作・Windows等は別環境の工程。C01の複数年ソフト原価、C03の選択方法から費用化と年度採用への接続、他の是正項目はこの変更だけで完了扱いにしない。main・公開範囲・Release・実データは変更していない。
