# 承認後の再試行：候補計算と回帰試験の分割push

実施日: 2026-09-19（日本時間）
対象: PR #18 / `work/w07-w08-acceptance-20260918`
今回の基点: `cd64ee81fedc5b296d049d79d4f505590d93a61d`
main: `271ef56352ab782ff71434769ed1edb78565c513`（今回マージしていない）

## 実際にブランチへ反映した変更

ユーザーの明示承認後、前回拒否された `src/core/costTreatments.ts` の同じ内容での書込みが成功した。以前に作成済みの依存blobも再利用し、依存の欠けない単位へまとめて次の2コミットを作成し、forceなしでブランチ更新を確認した。

| コミット | 反映内容 |
| --- | --- |
| `417b9aa96f88b0d7d4a98ccea83724d4b5e807e7` | 最終配分からの条件付き候補、事実・根拠の対応付け、既存の方法比較への接続、判断案・原価上限付き増加案、参照照合、SQLite保存アダプター、任意型フィールド、合成fixture。14ファイル |
| `003d44fc4225f163c3d093052f344db354af9ff5` | 上記を対象とする5ファイルの回帰試験 |

この証跡・実行環境JSON・再現helperとCURRENTの更新は別の文書コミットに含める。以前の分割pushの8ファイルは保持する。統合パッケージ全体の反映完了ではない。

## 今回pushした範囲の境界

候補計算は既存 `decideTaxCandidate` を使用する。支払原額ではなく最終配分額を入力にし、私用比率の二度掛け・中間原価の二重加算をしない。金額・期間・方法・根拠が変わると再確認を要求し、不明と0円を区別する。方法比較は保存された設備条件と資産全体額を照合する。判断案は未確認から始め、原価の増加案は既存 `applyCostLinkSuggestion` で既使用額を差し引く。

**これらはまだ既存アプリの画面・workspace保存・費用projection・年度採用から呼び出されない独立した部品である。** `checkTreatmentDecisionReferences` は参照照合の純粋関数として追加したが、実サーバーの年度採用経路へは未接続。SQLiteの2アダプターも既存planningの保存処理にはまだ接続していない。通常APIの保存成功、UIで利用可能、年度採用済みという意味ではない。

`planning/types.ts` と `accounting/costs.ts` は任意型フィールドを追加した。旧保存入力や採用資料を移行・再計算したものではない。新しいZodアダプターは追加したが、この限定実行でZodによる実API入力検証を実行したとはしない。

## 反映済み部品だけの再実行

環境: Linux / Node.js 22.16.0 / TypeScript 5.8.3。
TypeScriptを専用一時ディレクトリで構文変換し、試験ファイルのVitest importだけをnode:testへ変更。製品の計算・検証関数を差し替えず、SQLiteはNode組込みの実DBを使用した。完全なcheckoutではなく、照合したソース20ファイルを用いた限定実行。

**138 tests / 10 suites / pass 138 / fail 0 / skipped 0 / cancelled 0**。

| 回帰試験 | 件数 |
| --- | ---: |
| `tests/core/costTreatments.test.ts` | 56 |
| `tests/core/annualMethodComparison.test.ts` | 44 |
| `tests/core/costTreatmentDraft.test.ts` | 21 |
| `tests/server/costTreatmentFactsRepository.test.ts` | 11 |
| `tests/server/decisionTreatmentBindingsRepository.test.ts` | 6 |

同じソースでパッケージ用の限定runnerと、リポジトリ配置向けの再現helperをそれぞれ実行し、両方とも上記の結果となった。二重実行の成功数は足し合わせない。試験名のserver-side adoption guardは純粋関数の検査であり、HTTPサーバーの起動・実API採用ではない。

GitHubに作成したtreeへ、実行したソース等24パスの期待Git blob SHAを再指定したところ、tree SHAは `0a4fa8aa19c059580fca8a0305b574193b21efb2` のままであった。実行対象のコード・試験・既存helper、任意型とアダプターが同じ内容であることを確認した。ソースのSHA-256は [実行環境](2026-09-19-approved-core-environment.json) に記録。

正式環境での対象試験:

```sh
npm test -- tests/core/costTreatments.test.ts tests/core/annualMethodComparison.test.ts tests/core/costTreatmentDraft.test.ts tests/server/costTreatmentFactsRepository.test.ts tests/server/decisionTreatmentBindingsRepository.test.ts
```

今回の限定実行の再現:

```sh
DEVTAX_TEST_TYPESCRIPT=/path/to/installed/typescript node docs/evidence/v05-revision/2026-09-19-approved-core-harness.cjs
```

TAPは標準出力、実行条件・ソースhashは標準エラーに出す。個人DB・元履歴へアクセスしない。正式なNode24/lockfile全体Vitest・意味解析型検査・lint・format・build・privacy・Release・実API・React操作の代わりにはしない。

## 再発した書込みブロックと未反映

続けて保存・計算・年度採用を接続しようとした際、`workspaceCosts.ts`、`reviewMaterials.ts`、`workspaceImpact.ts` の3エントリーを含むcreate_treeが、次の応答で拒否された。

> リクエストの安全性を確認できなかったため、このツールの呼び出しは OpenAI によってブロックされました。

詳細理由は返されていない。どの1ファイルが原因か、容量か内容かも特定できない。この拒否された書込みを別の表現・経路で通し直してはいない。

それ以前に準備したschema・planning保存・merge・履歴比較のtreeは**コミット・ブランチへ接続していない**。採用時の新しい照合が未接続のまま、保存側だけを有効化しないためである。ブランチに反映したのは上記の独立部品と回帰試験だけであり、未接続treeの作成をpush成功と数えていない。

画面・API・保存・年度採用・既存出力の接続、全体同期済みの要件表・HTML生成元/生成物は引き続き未反映。今回のCURRENTだけでそれらを実装済みに変更しない。

## 統合パッケージの検証との区別

再試行前に、手元の統合パッケージ全体の限定試験170件と適用器14件も再実行して成功した。ただし170件には、今回pushしていないmerge/年度比較や文書生成の変更が含まれる。その結果を現HEADの全体合格に流用しない。今回のブランチ対応範囲の結果は上記138件に限定する。

実機確認はユーザー指示に従い別枠。Node24環境での全体試験・実checkoutでの文書生成一致も未実施。W01〜W08の総合受入条件は変更していない。mainへのマージ、Actions設定・権限変更、Release、公開デプロイ、実データ・採用済み資料の変更は行っていない。
