# DevTax 目的是正：現環境の実装完了点と外部受入への引継ぎ

実施日: 2026-09-20（日本時間）  
候補ブランチ: `work/w07-w08-acceptance-20260918`（固定SHAはIssue #25の最新記録）  
PR: #18 / `work/w07-w08-acceptance-20260918`  
是正作業ブランチ: `work/c03-software-method-posting-20260920`

## 結論

目的監査後のC01〜C05は候補HEADへ実装・push済み。C04の再監査で見つかった、判断記録の未送信復旧未接続と、年額費用化時の別画面・自由入力 `ordinary-expense` 判断は是正した。C06はこの是正を含む同一候補HEADをNode24・実HTTP/React・Windows・展示/配布環境で外部受入する。

「売上がないから費用を任意の年へ移す」機能にはしていない。中心経路は、支出→配分→同じソフトの複数年製作原価→一つの取得価額→適用可能な方法→選択した年額→既存残高/年度採用→翌年度/訂正/原本なし読取りである。

## 実装到達点

| C | 到達点 | 主なcommit |
| --- | --- | --- |
| C01 | 2025年・2026年等の同一ソフト製作原価を既存原価追跡から一つの取得価額へ振替。不明・外部期首・未組入れ・二重使用を区別 | `511d074` |
| C02 | 8万円等の通常少額資産、通常業務の不要な供用質問、設備の供用年費用化と3年一括を是正 | `bf47a10`, `725ed68`, `4e00cb3` |
| C03 | 取得価額から普通定額・供用年全額・3年一括・確認済み青色少額資産特例を選択し、同じ年次エンジンで実際の残高費用化へ接続。固定版出力と翌年度・訂正の境界を保持。特例供用年の確認条件を後年0円の年度へ再要求しない | `a9ce02e`, `b183dd3`, `1fe8eac`, `a2745b3` |
| C04 | 是正実装済み。`DecisionEditor` の未送信控えをdataset・元revision・競合・容量不足境界へ接続。保存済みSoftwareMethodから同画面で当年継続使用を本人確認し、構造化DecisionRecordを通常workspaceへ保存して既存decisionId経路へ渡す。0円年は判断を作らず、同一確認元は再利用、変更時はstaleとして再確認する | `2c83ffb`〜`df4394f` |
| C05 | 文書ゲートをAPI契約・要件・生成物中心へ整理し、無関係な実装ファイル全体hash固定を撤去。現行モデル・要件表・HTMLを是正実装へ同期 | `1e7606d`, `0814b141` |
| C06 | 現環境でT01〜T13に対応する実装/回帰を確認可能な状態へ。T14と正式環境の全ゲートは別環境引継ぎ | この文書と外部受入hand-off |

## 受入シナリオの接続

- T01/T02: `tests/core/correctionPurposeJourney.test.ts`, `tests/core/softwareMethod.test.ts`, `tests/core/softwareAnnualDecision.test.ts`
- T03/T04: `tests/client/correctionMethodForm.test.ts`, `annualMethodComparison.ts`
- T05: ordinary-operationを資産供用から分離したtax decision回帰
- T06: `equipmentPool*.test.ts` と設備年額/共通費用基礎
- T07: C01取得原価集約・unknown/external opening回帰
- T08: improvement-planを含むpurpose journey
- T09: `correctionScenarioHistory.test.ts`、未採用試算は過年度訂正を発生させない
- T10: `tests/client/decisionEditorRecovery.test.tsx`、editor recovery / workspace recovery / same-record conflict
- T11: 固定版・訂正・原本なし読取りの既存回帰とpurpose journey
- T12: current design / design isolation / route inventory
- T13: 既存の契約別分母・capture provenance・provider別配賦回帰
- T14: 公開GitHub、配布版、合成デモ、実ブラウザは外部受入

## 現環境での検証事実

今回セッションでは、GitHub上の最新HEAD・PR #18・Issue #19〜#25を再取得し、C04の2残件を現行ソースで再現して修正した。追加回帰は `tests/client/decisionEditorRecovery.test.tsx` と `tests/core/softwareAnnualDecision.test.ts`。後者はT02の120,000円取得価額・5年定額・2026/2027各24,000円、同年再試行、stale、0円年、movementのdecisionIdと参照整合を検査する。

この実行環境はNode 22.16.0で、repository checkout・lockfile依存がなく、package要件のNode >=24.14.0を満たさない。したがって今回追加したVitest、`npm ci`、docs:check、typecheck、lint、format、build、privacy、release:packは**今回セッションでは未実行**であり、過去の成功件数を今回の結果へ合算しない。現環境ではGitHub上のソース・生成契約・参照・HEAD・Actions有無を静的に再監査し、実行環境を必要とする受入はC06へ引き継ぐ。

## 保持した安全境界

- 原額/配分/取得価額/年額/採用残高を重複加算しない。
- unknownを0円にしない。
- 過去の費用化を現在の試算から再構成しない。
- 未採用比較や表示期間の変更だけで採用済み製作事実を失効させない。
- 復旧控えは自動送信・自動採用せず、dataset・元revision・対象を保持する。
- 原本の秘密参照は固定資料・相談出力へ追加しない。
- 旧資料に新しい方法欄を合成しない。

## この環境で実行できない／完了扱いにしないもの

[外部受入hand-off](2026-09-20-purpose-correction-external-handoff.md) に従い、Node24/lockfileの全体検査、実HTTP/React、Windows・狭い画面、実共有フォルダ、backup/restore・原本なし読取り、Release成果物、GitHub公開導線・合成デモ版の一致は未実施。リポジトリは確認時点でprivateのため、展示QRを一般来場者向けに使える状態とはしない。

main merge、リポジトリ公開、Release公開、Cloudflareデプロイ、実データ・採用済み資料の変更は行っていない。
