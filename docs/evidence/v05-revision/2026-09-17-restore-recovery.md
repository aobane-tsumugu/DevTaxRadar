# 2026-09-17 W07 再接続時の取得元保持とキャッシュ更新

基点: main `93e410675910eb8a760679eaf59227e9c039f3c7`。対象は `src/server/paths.ts`、`src/server/restoreSources.ts` と回帰試験。実データ・原本・採用済み資料は使っていない。

## 修正した二つの問題

1. 再接続で停止を選んだ取得元も、復元先OSの絶対パスへ無条件に正規化していた。例えばWindowsのドライブパスをLinuxへ持ち込むと、停止したまま元の参照を保持する選択でも拒否される。変更していない停止中の取得元に限り、元パスと比較キーをそのまま保持する。新しいパス指定・有効化には従来の絶対パス検証を適用し、有効な取得元の可読性・重複の検査は弱めない。
2. パス文字列が変わったときだけファイルキャッシュを削除していた。同じ絶対パス・サイズ・更新時刻でも別PCのファイルが同じとは限らない。復元後の再接続では全取得元の旧ファイルキャッシュを無効化する。ID・identifier-salt・保存済みのusage_eventsは保持し、走査は開始しない。正常終了後の同じ要求の再送では、新しく作られたキャッシュを削除しない。

DB変更とキャッシュ無効化は既存のBEGIN IMMEDIATE／receipt／rollbackの範囲内。新しいAPI・DBテーブル・状態管理基盤は追加していない。

## 実行した検証と限界

環境: Linux、Node.js 22.16.0、SQLite 3.49.1、TypeScript 5.8.3。基点の2製品ファイルはGit blob SHAとバイト一致を確認した。

- paths.ts: `0912fb1a42cefec9114d8cc95290d12b279b68fb`
- restoreSources.ts: `db65e6e0395acb8454706902f23b0b9997cd50eb`

追加試験は `tests/server/restoreSourcesRecovery.test.ts`。実行環境にlockfileのZod/Vitestがないため、ローカル検証コピーではTypeScriptを変換し、test importをnode:testへ変更した。さらにrestoreSourcesのZodスキーマ宣言とimportを除外し、`schema.parse(input)`を`structuredClone(input)`へ置換した。**入力検証を除いたサービス処理の限定試験であり、製品のZod境界・実APIを通した合格ではない。** 試験入力は元スキーマの形を満たす合成データに限定した。GitHubに保存する製品コード・試験コードのZod/Vitestは置換していない。

同じサービス処理10件で、基点は成功4・失敗6、修正後は成功10・失敗0。追加したパス境界5件を含め、修正後は計15件成功・失敗0・skip0。実SQLiteの一時DBで、停止した元参照と数値・識別子の保持、同じパスのキャッシュ無効化、再送、重複拒否、元フォルダ不在、古い確認の拒否、receipt保存失敗時のrollback、別SQLite接続での再読込みを確認した。別PC・Windows実機・製品プロセス再起動の受入試験ではない。

paths.ts単体はTypeScript 5.8.3／@types/node 25.1.0でstrict・noEmitの型検査成功。3変更TypeScriptファイルは構文変換診断0。これはリポジトリ指定のTypeScript 6／Node 24／lockfileによる全体typecheckの成功ではない。全体のlint・format:check・build・privacy:checkは未実施。

対応環境では次の既存Vitestコマンドで、Zod境界を維持した製品コードに対して再実行する必要がある（今回の実行結果ではない）。

```sh
npm ci
npm test -- tests/server/restoreSources.test.ts tests/server/restoreSourcesRecovery.test.ts
```

## W08までの残作業

W06の返金projection・画面・年度資料・実原価照合は、既に基点のmainへ入っている。以前のCURRENTにあった「統合変更が未反映」は現状ではない。W06の総合受入、W07のバックアップからの復元・原本なし読取り・実機作業、W08の作業計画・要件表・生成HTML全体の同期は未完了。今回の限定試験でこれらを完了に変更しない。
