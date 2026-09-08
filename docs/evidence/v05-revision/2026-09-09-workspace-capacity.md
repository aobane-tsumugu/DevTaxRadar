# W01部分実装: workspaceのHTTP受信容量

日付: 2026-09-09（日本時間）  
親commit: `7cba5797dc5cf983bd43c6a97c4c716040fcd0f9`  
状態: 部分実装。実API回帰試験は追加・未実行。W01完了、AC-SAVE合格、main反映ではない。

## 変更したこと

`src/server/workspaceHttp.ts`に、workspace全体を受け取るpreview・saveで共有する2MiB（2,097,152バイト）の上限と413の説明を置いた。`index.ts`の2ルートだけへ接続した。上限はUTF-8のJSON全体であり、文字数やメモだけの長さではない。

容量超過は`workspace_too_large`と`limitBytes`を返し、保存済みデータを変更していないことと、編集中の画面を閉じず入力を控えることを説明する。その他のエラーはFastifyの既存処理へ委譲する。既定64KiB、残高保存2MiB、年度採用16KiB、復元の専用上限は変更していない。

入力schema、期待版、一括保存、再送識別、影響確認、DB移行・旧版読取りは変更していない。依存パッケージ・lockfile、個人DB・元履歴、Actions設定、Releaseタグ・公開デプロイも変更していない。

## 追加した回帰試験（未実行）

`tests/server/workspaceCapacity.test.ts`は、既存API試験と同様に独立した一時データ領域で実サーバーを起動する。Fastifyに似せた別サーバーを試験するものではない。

- 日本語2,000文字のメモ12件で旧64KiBを超える入力をpreview→保存→再読込し、同じ要求の再送と古い版の競合を確認する。
- preview・saveそれぞれで2MiB-1、2MiB、2MiB+1を確認する。構造化入力は実schemaに従い、HTTPバイト境界の調整だけに合法なJSON末尾空白を使う。
- 超過時にrevision・設定・計画が不変であること、不正JSONとCSRFなしの要求が拒否されることを確認する。

## 実施した確認

実行環境: Node.js 22.16.0と同環境のTypeScript。プロジェクト指定のNode.js 24.14以上の環境ではない。外部ホストの名前解決に失敗し、リポジトリのclone・依存関係取得ができなかった。

1. 変更したTypeScript 3ファイルを`typescript.transpileModule`で構文確認した。構文診断エラーなし。プロジェクトの型検査ではない。
2. `workspaceHttp.ts`の型注釈を除いた実コードを実行し、上限値、413のstatus/code/limitBytes、他エラーの委譲をassertした。replyは単純なstubであり、FastifyのHTTP受信試験ではない。
3. HTMLのR6部分を更新した。変更前HTMLのgit blob SHAが`733462a826706434b68e64109f2eeee2e4824f83`と一致することを確認したうえで、`work-plan.cjs`の出力だけを置換した。31章・30図、重複しないID、内部アンカーを確認し、図とR6作業計画以外の内容は変更していない。

`npm test`、`npm run build`、`npm run lint`、`npm run format:check`、実API・ブラウザ・再起動・旧DB移行・全体HTML再生成・文書検査一式は未実施。過去の成功件数を今回の成功として転用しない。

## HTMLの反映範囲

HTML生成元`work-plan.cjs`と生成済み`docs/design/workflow-blueprint.html`のR6進捗を更新した。全体生成スクリプトは実行しておらず、同スクリプトのtable・noteの処理でR6の作業計画部分を出力し、変更前SHAが一致するHTMLへ反映した。Gitによる3-way mergeで適用結果が更新済みHTMLとバイト単位で一致することを確認し、他の章・図は変更していない。

適用のためだけに作ったbinary patchは生成物の反映後に削除し、恒久的な更新機構として製品へ追加しない。HTMLの全体再生成とソース行参照の再計算は未実施であり、W08の統合確認で扱う。

## W01に残ること

旧`PUT /api/planning`、`PUT /api/planning/rules`、`POST /api/config`はまだ残る。これらを使う既存API試験も残している。全呼出し元の移行と回帰確認なしに、削除完了とはしない。

さらに、`src/client/workspaceAttempt.ts`は保存元と要求の双方を控えに含め、`raw.length > 2000000`をHTTP送信前に拒否する。これはUTF-16コード単位であり、今回のHTTP上限とは別である。ブラウザの保存容量不足もある。HTTPが2MiBを受け取ることを、画面から2MiBまで必ず保存できる保証とはしない。

次のW01差分では旧書込経路の移行、復旧用控えとHTTPの容量・失敗時の手順の整合、編集中入力を保持するブラウザ試験を完了させる。確認や保存領域を黙って省く実装や、安易な無制限化はしない。W02〜W08へ完了扱いで進めない。

想定する検証コマンド（この記録では未実行）:

```sh
npm test -- tests/server/workspaceCapacity.test.ts tests/server/planningApi.test.ts
npm run build
npm run lint
npm run format:check
node scripts/design/build-workflow-blueprint.cjs
node scripts/design/verify-docs.cjs
```
