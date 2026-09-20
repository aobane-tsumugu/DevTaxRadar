# 分割pushの実施結果（部分反映）

実施日: 2026-09-19（日本時間）
基点: `c2950f655134bd38a51e8714f23364c7e255c90d`
対象: PR #18 / `work/w07-w08-acceptance-20260918`

## 実際に反映したコミット

| コミット | 内容 |
| --- | --- |
| `dd87b45ccd56e8f7800617f1d7ce2a5a66d1a03a` | 独立した年度別方法比較と共用率表。既存アプリからの呼出しはまだ接続しない |
| `64b1276c9cd57ab0b61786f71cc751aa18832b9d` | 年度別方法比較の単独試験28件 |
| `c413e906dc26cd5be663fea68f1770cbcb666ce6` | 型引数を含むAPI登録を読む独立した解析helper |
| `396ecf81927e4d31880724302517adfa6a133d74` | API解析の単独試験6件。既存observationRoutesの実ソースも使用 |

4コミットのブランチ反映を確認済み。この文書・実行環境JSON・再現helperを追加の証跡コミットとして反映する。mainへのマージ、Release、デプロイ、実データ変更は行っていない。

## 未反映の部分

統合パッケージ全64ファイルのpush完了ではない。`src/core/costTreatments.ts` を1ファイルだけ含む `create_tree` が、今回も次の応答で拒否された。

> リクエストの安全性を確認できなかったため、このツールの呼び出しは OpenAI によってブロックされました。

具体的な理由は返されていない。そのため、同ファイルへ依存する候補と方法の接続、workspace保存、画面、年度採用と出力、これらを実装済みと記載する要件表・生成HTMLはブランチへ反映していない。未解決のimportを含む部分treeをブランチへ接続していない。

今回pushしたAPI解析helperはまだ文書検査器へ接続していない。生成HTMLの更新・W08全体の完成を主張しない。既存のCURRENTが示す統合未完了の区分は引き続き有効。

前回の統合パッケージは、この分割反映後のcheckoutへ未変更のまま重ねて適用できない。既に存在するファイルを上書きせず、現在のHEADと対象blobを照合して残差分を統合する必要がある。

## 今回実行した検証

Node.js 22.16.0 / TypeScript 5.8.3 / Linux。製品処理は差し替えず、TypeScriptを一時ディレクトリで構文変換し、試験ファイルのVitest importだけをnode:testへ置換した。

結果: **34 tests / 3 suites / pass 34 / fail 0 / skipped 0 / cancelled 0**。方法比較28件、API解析6件。前回の170件とは別の実行範囲であり、足し合わせない。

方法比較はパッケージ内の純粋関数と同一。試験入力は明示した合成factsで、未反映の候補計算や保存を呼んでいない。API解析試験は既存 `src/server/observationRoutes.ts` のblob `89312522da733e41d08b16d48490d6b27bdff05b` を照合して読む。登録内容の静的解析であり、HTTPサーバーの実行ではない。

今回追加したコード・試験の5ファイルについて、GitHubから再取得したblob SHAと、実行したローカルファイルのGit blob SHAがすべて一致した。

正式なNode24/lockfile全体Vitest、意味解析型検査、lint、format、build、privacy、Release、実API、React操作、実機受入は未実施。

通常の対象試験:

```sh
npm test -- tests/core/annualMethodAlternatives.test.ts tests/server/routeInventory.test.ts
```

今回の限定実行の再現:

```sh
DEVTAX_TEST_TYPESCRIPT=/path/to/installed/typescript node docs/evidence/v05-revision/2026-09-19-split-harness.cjs
```

TAPは標準出力、環境と実行ソースhashは標準エラーへ出す。試験用一時フォルダ以外のDBや履歴を読み書きしない。正式な検証入口を置き換えるhelperではない。

[環境・実行ソースhash](2026-09-19-split-environment.json) / [再現helper](2026-09-19-split-harness.cjs)
