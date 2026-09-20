# DevTax 目的是正：現環境の実装完了点と外部受入への引継ぎ

実施日: 2026-09-20（日本時間）  
候補ブランチ: `work/w07-w08-acceptance-20260918`（固定SHAはIssue #25の最新記録）  
PR: #18 / `work/w07-w08-acceptance-20260918`  
是正作業ブランチ: `work/c03-software-method-posting-20260920`

## 結論

目的監査後のC01〜C05は候補HEADへ実装・push済み。C06は、現環境で確認できるコード・固定資料・文書契約まで整備し、Node24・完全依存・実HTTP/React・Windows/狭幅・公開GitHub/デモ導線を同じ候補HEADで確認する外部受入へ引き渡す。

「売上がないから費用を任意の年へ移す」機能にはしていない。中心経路は、支出→配分→同じソフトの複数年製作原価→一つの取得価額→適用可能な方法→選択した年額→既存残高/年度採用→翌年度/訂正/原本なし読取りである。

## 実装到達点

| C | 到達点 | 主なcommit |
| --- | --- | --- |
| C01 | 2025年・2026年等の同一ソフト製作原価を既存原価追跡から一つの取得価額へ振替。不明・外部期首・未組入れ・二重使用を区別 | `511d074` |
| C02 | 8万円等の通常少額資産、通常業務の不要な供用質問、設備の供用年費用化と3年一括を是正 | `bf47a10`, `725ed68`, `4e00cb3` |
| C03 | 取得価額から普通定額・供用年全額・3年一括・確認済み青色少額資産特例を選択し、同じ年次エンジンで実際の残高費用化へ接続。固定版出力と翌年度・訂正の境界を保持。特例供用年の確認条件を後年0円の年度へ再要求しない | `a9ce02e`, `b183dd3`, `1fe8eac`, `a2745b3` |
| C04 | 未採用試算を製作事実から分離。同じ制作物の共通事実を限定再利用し、費用条件・方法入力をdataset/元revision付きの未送信控えとして復旧 | `719f7ae`, `75ab9b0`, `b183dd3` |
| C05 | 文書ゲートをAPI契約・要件・生成物中心へ整理し、無関係な実装ファイル全体hash固定を撤去。現行モデル・要件表・HTMLを是正実装へ同期 | `1e7606d`, `0814b141` |
| C06 | 現環境でT01〜T13に対応する実装/回帰を確認可能な状態へ。T14と正式環境の全ゲートは別環境引継ぎ | この文書と外部受入hand-off |

## 受入シナリオの接続

- T01/T02: `tests/core/correctionPurposeJourney.test.ts`, `tests/core/softwareMethod.test.ts`
- T03/T04: `tests/client/correctionMethodForm.test.ts`, `annualMethodComparison.ts`
- T05: ordinary-operationを資産供用から分離したtax decision回帰
- T06: `equipmentPool*.test.ts` と設備年額/共通費用基礎
- T07: C01取得原価集約・unknown/external opening回帰
- T08: improvement-planを含むpurpose journey
- T09: `correctionScenarioHistory.test.ts`、未採用試算は過年度訂正を発生させない
- T10: editor recovery / workspace recovery / same-record conflict
- T11: 固定版・訂正・原本なし読取りの既存回帰とpurpose journey
- T12: current design / design isolation / route inventory
- T13: 既存の契約別分母・capture provenance・provider別配賦回帰
- T14: 公開GitHub、配布版、合成デモ、実ブラウザは外部受入

## 現環境での検証事実

過去の成功数は合算しない。代表的な各commitの対象結果として記録する。

- C03中核: `a9ce02e` の対象45件成功（当時の証跡範囲）。
- C03/C04画面・固定出力: `b183dd3` の対象60件成功。React/Zod/SQLite journey 13件は完全依存環境待ち。
- C04プリミティブ: `75ab9b0` の対象40件成功。
- C05: `1e7606d` の対象50件成功。
- 設備3年一括: `4e00cb3` の対象33件成功。実Zod/workspace/SQLite 7件は完全依存環境待ち。
- 青色少額資産特例の画面比較: 2026-09-20にNode22.16.0で `correctionMethodForm` の12件を再実行し成功。350,000円・2026-04-01取得の合成条件で特例候補を年額経路へ通す追加実装は `1fe8eac`。
- `a2745b3` で、供用年の青色条件を確認済みの資産について翌年の費用が0円なら、翌年の現在プロフィール変更だけで過年度採用を再オープンしないよう修正し、対象回帰を追加した。この追加回帰は正式Node24環境で未実行。
- 上記はいずれも正式Node24全体受入の代替ではない。

## 保持した安全境界

- 原額/配分/取得価額/年額/採用残高を重複加算しない。
- unknownを0円にしない。
- 過去の費用化を現在の試算から再構成しない。
- 未採用比較や表示期間の変更だけで採用済み製作事実を失効させない。
- 復旧控えは自動送信・自動採用せず、dataset・元revision・対象を保持する。
- 原本の秘密参照は固定資料・相談出力へ追加しない。
- 旧資料に新しい方法欄を合成しない。

## この環境で実行できない／完了扱いにしないもの

[外部受入hand-off](2026-09-20-purpose-correction-external-handoff.md)へ集約する。Node24/lockfileの全体検査、実HTTP/React、Windows・狭い画面、実共有フォルダ、Release成果物、GitHub公開導線・合成デモ版の一致は未実施。リポジトリは確認時点でprivateのため、展示QRを一般来場者向けに使える状態とはしない。

main merge、リポジトリ公開、Release公開、Cloudflareデプロイ、実データ・採用済み資料の変更は行っていない。
