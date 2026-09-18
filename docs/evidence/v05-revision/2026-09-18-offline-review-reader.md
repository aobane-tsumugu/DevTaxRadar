# W07: 通常起動を経由しない保存資料の読取り

実施日: 2026-09-18（日本時間）

基点: PR #18 `c4a1a5b04292a86205fad936fd3f0a6c249dd20b`。mainは `271ef56352ab782ff71434769ed1edb78565c513` のまま。ユーザーの指示により、Windows・ブラウザ等の実機確認を別枠として実装を継続した。

## 実装

`npm run data:read -- list/export` を追加した。[使い方と境界](../../READING-SAVED-REVIEWS.md)を参照。指定したDBから保存済み年度資料を読む。アプリDBの初期化・移行・再計算・走査・原本へのアクセス・salt生成・再接続を呼ばない。復元保留マーカーも解除しない。

`balanceRepository.ts` にあった正規化・SHA-256・保存資料読取りを `storedReview.ts` へ共通化した。通常APIの `getBalanceReview` と新しい読取り専用CLIが同じ関数を使う。正規化は元の保存形式と同一で、既存の採用・保存要求のハッシュ形式を変えていない。新たに資料の重複IDと索引年／payload年の不一致も拒否する。

出力は既存の `reviewExportJson` / `reviewExportMarkdown` をそのまま呼ぶ。保存版にない情報を再構成せず、元版と訂正版、不明と0円、未収録と確認済みを区別する。出力は読取り元の外の新規ファイルに限定し、既存ファイルを上書きしない。

ソース版のpackage.json、Releaseのbundle entry・コマンド・START-HERE・案内文書・構文チェックへ接続した。既存のRelease lifecycle試験へ「実APIからの年度採用と出力→backup→合成旧DB削除→standalone CLIで同じ版を出力→API出力と一致」の検査を追加した。このRelease全工程はこの環境では未実行。

## 実行した試験

Linux / Node.js 22.16.0 / TypeScript 5.8.3。製品が指定するNode24/lockfile環境とは異なる。

`tests/server/reviewArchive.test.ts` と必要な実製品ソースを一時ディレクトリで構文変換し、試験ファイルの `vitest` importだけを `node:test` に変更した。SQLiteはNode組込みの実DB、出力も既存の実装を使用した。入力検証・DB・計算・出力の代替実装は使用していない。CLIエントリは実際に子プロセスで起動した。試験コードはコンパイル後にはJSエントリ、通常Vitest実行時にはtsxのTSエントリを選ぶ。

結果: **36 tests / 3 suites / pass 36 / fail 0 / skipped 0 / cancelled 0**。前回の22件は今回の成功数へ加算していない。

検証内容: 旧正規化形式との一致、ID/年/ハッシュ/JSON/保存形式の不一致拒否、重複ID拒否、WALの確定済み記録の読取りと未確定書込みの非表示、原本・saltなし、復元保留保持、通常アプリと異なるスキーマの読取り、既存版と訂正版の区別、不明額・追加フィールド・保存時結果の保持、出力バイト一致、CLI引数・終了コード、出力先の重複と読取り元内出力の拒否。

fixtureは2つとも合成した保存形式v1の資料。ひとつは旧残高のみ、もうひとつは非空の費用・証拠・数値観測を含む。fixtureを実APIで採用した結果ではなく、保存済み形式の読取り互換性の検証である。Release試験では実APIによる採用から検査するが、その追加部分は未実行。

通常の再実行:

```sh
npm test -- tests/server/reviewArchive.test.ts
```

今回の限定再実行:

```sh
DEVTAX_TEST_TYPESCRIPT=/path/to/installed/typescript \
  node docs/evidence/v05-revision/2026-09-18-archive-harness.cjs
```

環境・ソースhash・実行範囲は [実行記録](2026-09-18-archive-environment.json) に保存。harnessは証跡用で、package.jsonやCIへ別の必須ゲートとして追加していない。

## 未実施と残る実装

正式なNode24全体Vitest・型検査・lint・format・build・privacy・Release lifecycleは未実行。API共有部の変更は構文変換と差分を確認したが、通常API全体の実行成功とはしない。既存のbackup全体、移行中断、再接続、実APIの総合受入を36件で置き換えていない。

Windows・実ブラウザ・狭い画面・実共有フォルダの確認は、今回のユーザー指示に従い別枠。これらを待たずコードを追加したが、実機合格とはしていない。

W06の全費用から条件付き処理候補までの残接続、W08のrequirements-matrix・HTML生成元・生成HTMLの全体同期と実際の再生成一致は、この変更では未完了。各Wの完了条件は変更していない。実装追加と総合受入を区別する。
