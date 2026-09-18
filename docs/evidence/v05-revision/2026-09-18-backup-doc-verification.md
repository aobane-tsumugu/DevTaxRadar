# W07/W08: バックアップ照合と文書検査の補強

実施日: 2026-09-18（日本時間）  
製品基点: main `271ef56352ab782ff71434769ed1edb78565c513`  
作業ブランチ: `work/w07-w08-acceptance-20260918` / PR #18  
結論: 限定した修正と試験のみ。W01〜W08の総合受入・W08完了ではない。

## 変更した実装

### W07: 大容量バックアップの照合

既存の [dataBundle.ts](../../../src/server/dataBundle.ts) はDBとsaltのサイズ・SHA-256を照合する際、`readFileSync` で対象全体をBufferへ読み込んでいた。[bundleFile.ts](../../../src/server/bundleFile.ts) へ照合関数を分離し、64KiBの固定バッファで末尾の部分ブロックまで読み取る方式へ変更した。読取前後のサイズ・mtime・ctimeが変わる場合は拒否し、正常・異常ともにファイルハンドルを閉じる。

manifest v1、SHA-256、SQLite全体のVACUUM snapshot、schema/integrity/参照整合性検査、安定salt、新しい復元先だけへの公開、復元後の走査保留は維持する。独自の部分DBエクスポートへ作り直していない。シンボリックリンク防御や原本アーカイブを追加したという意味ではない。

[ファイル照合の回帰試験](../../../tests/server/bundleFile.test.ts) は8件。空・1バイト・ブロック境界前後・複数ブロックの独立SHA照合、同じ長さの改変、ファイル欠落とディレクトリ拒否を検査した。読取中の別プロセスによる更新競合の実試験は含めていない。

### W07: 原本なしでの全DB・採用資料読取り試験を追加（未実行）

[restoredReviewApi.test.ts](../../../tests/server/restoredReviewApi.test.ts) を追加した。次の流れを実際のサーバー・CLI・SQLiteへ接続しているが、この環境では実行できていない。

1. 隔離HOMEの合成Claudeログを実Adapterで走査し、版照合付きworkspace APIで制作物と直接費を保存する。
2. 非空の観測と費用を含む年度資料をpreview/adoptし、保存版とJSON/Markdownのバイト列を取得する。DB全テーブルの行とsaltも取得する。
3. 起動中DBから既存CLIでbackupを作り、合成元ログと旧DBだけを削除する。別の新規保存先へCLIで復元し、全テーブルとsaltを比較する。
4. 自動走査を有効にして復元先を起動し、再接続保留・手動走査409・採用資料と出力の一致を検査する。
5. 原本がない取得元をすべて無効化したまま再接続し、再起動後のdataset識別子・保存資料・出力一致とbackupの不変性を検査する。

この試験の存在や構文変換成功は、実API・ブラウザ・別PC・Windowsの合格を意味しない。既存の破損backup、未対応schema、移行中断、再接続回帰を置き換えない。

### W08: 既存文書検査を拡張

[verify-docs.cjs](../../../scripts/design/verify-docs.cjs) の既存の要件対応・リンク・アンカー・文字コード・構文検査を維持し、以下を同じ入口に追加した。

- 元のHTMLを作業中に上書きしない。隔離先へ生成に必要なソースをコピーし、既存生成器を2回実行する。生成物どうしと追跡HTMLの完全なバイト一致を照合する。
- 観測APIを含めた3つの登録元を参照し、改行を含むルート登録を扱う。未記載の現行APIと、存在しない旧APIを現行として記述する逆方向の食い違いも拒否する。
- AC識別子の重複をSetで黙って除去せず拒否する。API章の欠落を負のindexで通さない。

コピー対象から元の生成HTML、DB/salt/復元マーカー、node_modules/.gitを除外する。元HTMLが古い・生成器が失敗する・何も生成しない・非決定的に生成する場合は検査を失敗させ、修復済みと装わない。

[検査器の回帰試験](../../../tests/server/designDocs.test.ts) は14件。合成した小さな文書・生成器で検査器自体を実行した。**実際のrequirements-matrix、HTML生成器、追跡HTMLの同期・再生成一致は未完了**。現役の生成器には旧日付・撤去済経路の説明が残るため、検査器の合格を製品文書の合格へ転用しない。生成器や生成HTMLの内容はこの変更では書き換えていない。

## 実行結果と再現方法

環境はLinux / Node.js 22.16.0 / TypeScript 5.8.3。正式なNode24・lockfile依存とは異なる。TypeScriptを一時ディレクトリで構文変換し、試験ファイルの `vitest` importだけを `node:test` へ変更した。製品の照合関数・文書検査は差し替えていない。Fastify/Zod/SQLiteの代替実装を用いて実API合格とすることもしていない。

```sh
DEVTAX_TEST_TYPESCRIPT=/path/to/installed/typescript \
  node docs/evidence/v05-revision/2026-09-18-focused-harness.cjs
```

実施コマンドのTypeScript指定先は `/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript`。このパスは開発者の一般環境にはそのまま適用しない。証跡用helperは製品のpackage.jsonやCIへ新しいゲートとして追加していない。

結果: **22 tests / 3 suites / pass 22 / fail 0 / skipped 0 / cancelled 0**。

[TAPログ](2026-09-18-focused-tests.tap)、[環境と実行ソースのSHA-256](2026-09-18-focused-environment.json)、[再現用harness](2026-09-18-focused-harness.cjs) を同じ変更に含めた。dataBundle.tsと実API試験は構文変換のみであり、この22件へ含めない。正式な型検査・Vitest・lint・format・build・privacy・release検証の結果ではない。

## メモリ測定

256MiB（268,435,456 bytes）の合成ゼロファイルについて、元の一括読込み式と変更後の照合関数を別Nodeプロセスで各3回実行した。全6回でサイズ・SHA-256が一致した。測定値は [JSON](2026-09-18-bundle-memory.json) に保存。

| 方式 | 最大常駐メモリ（KiB、3回） | 約MiB |
| --- | --- | --- |
| 元の全体Buffer読込み | 287736 / 287736 / 287740 | 281.0 |
| 64KiBブロック読込み | 33272 / 33268 / 33268 | 32.5 |

process.resourceUsage().maxRSSの値。プロセス本体を含む。ファイル照合だけの合成測定であり、SQLite整合性検査、backup全工程、大容量初回走査、実利用の応答性の結果ではない。実行順やOSキャッシュを制御した速度ベンチマークではないため、時間値から一定の高速化率を主張しない。

## GitHub実行と未実施

mainが基点から進んでいないことを再取得して確認した。作業ブランチの一時read-only workflowとdraft PRによる検証を試みたが、確認したHEAD `e10545c` / `e851fd5` の実行一覧は0件。既存CI run `33136825548` は旧commitのqueued状態であり、現HEAD合格には使用していない。

一時workflowは最終製品差分から外し、基点のblob `4c887dc4f5e3f9360841ebf7a023b24bb3ed834c` へ戻した。Actions権限・課金・有効化設定、他のqueued job、Releaseタグ、公開デプロイ、実データ・原本・既存採用資料は変更していない。mainへ受入済みとして統合していない。

残件は [実装計画](../../design/implementation-plan.md) と [CURRENT](CURRENT.md) に従う。W01〜W06の正式な現HEAD受入、W07の全backup/restore・実API・ブラウザ/Windows・大容量走査実測、W08の要件表/生成元/生成物の内容同期と実際の再生成一致を残す。完了条件を弱めず、過去の限定成功件数も今回の製品全体合格へ加算しない。
