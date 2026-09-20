# DevTax v0.5 現在地と検証の入口

更新日: 2026-09-20（日本時間）  
候補ブランチ: `work/w07-w08-acceptance-20260918`（是正作業ブランチ `work/c03-software-method-posting-20260920` と同期）。固定SHAはIssue #25の最新記録を正とする。mainへは未マージ。

## 目的是正の現在地

[目的是正計画](../../design/purpose-correction-plan.md)のC01〜C05は実装を候補ブランチへ反映済み。C04は再監査で見つかった2残件を是正し、#23の受入条件をコード・静的接続・追加回帰で再確認する段階まで進めた。複数年製作原価→一つの取得価額→適用可能な方法→選択方法の年額→既存残高/年度採用→固定版出力という中心経路を接続した。少額設備・設備3年一括、通常業務の不要質問、共通事実再利用、未送信入力復旧、文書契約整理も候補HEADに含む。

青色申告の少額資産特例は、既存の `annual-method-comparison/2` の適用判定を再利用し、事業所得・青色申告、事業者要件、他資産の特例使用済額、事業月数、明細準備を資産の方法記録へ固定して年額経路へ接続した。税額・申告内容の自動確定は行わない。

[最終是正記録](2026-09-20-purpose-correction-final.md)と[別環境hand-off](2026-09-20-purpose-correction-external-handoff.md)を現在の入口とする。

## GitHub管理

- #20 C01: 実装完了。複数年取得価額・不明/外部期首/二重使用の境界を実装。
- #21 C02: 実装完了。少額資産・通常業務・設備費用基礎・設備3年一括を実装。
- #22 C03: 実装完了。選択方法から実年額・残高・年度採用・固定出力まで接続。
- #23 C04: **実装是正済み**。`DecisionEditor` の未送信控えをdataset/元revision/競合/容量不足境界へ接続し、年額費用化は選択済み方法から同画面で本人確認した構造化DecisionRecordを通常workspaceへ保存する。内部候補名の手入力は不要。
- #24 C05: 実装完了。文書ゲートを契約中心へ整理し、現行モデル/生成物を同期。
- #25 C06: **外部最終受入待ち**。C01〜C05を含む同一固定HEADでNode24/full dependencies、実API/React、Windows、公開GitHub/デモ/配布版を確認。
- #19: #25完了までopenを維持。

## 現環境での検証

今回セッションではGitHub上の最新ソースを再読取りし、C04の2残件を再現したうえで実装・pushした。追加した回帰は `tests/client/decisionEditorRecovery.test.tsx` と `tests/core/softwareAnnualDecision.test.ts`。代表T02は2025年60,000円＋2026年60,000円→取得価額120,000円→2026-01-01供用→5年定額→2026年24,000円→2027年24,000円を、各年の内部候補名手入力なしで確認する。

この実行環境はNode 22.16.0で、repository checkout・lockfile依存がなく、package要件はNode >=24.14.0のため、今回追加したVitest・typecheck・build等のnpmゲートは**実行していない**。GitHub Actionsもこの是正作業ブランチの観測HEADにはrun/statusがなかった。したがって過去commitの成功件数は今回結果へ加算せず、今回実施したGitHubソース静的監査と、外部Node24で実行する試験を分離して記録する。

C04静的受入では、DecisionEditorのdataset/revision付き復旧、復旧時の非送信、未完成年文字列保持、競合時の確認抑止、生成年額判断の読取専用表示、方法画面に `ordinary-expense` 自由入力がないこと、0円年・同年再利用・stale・movement decisionId・workspace revision guardを現行ソースで再確認した。C06静的監査は31要件=PRODUCT_SPEC、current-design参照欠落0、API登録元blob差分0、21受入条件hash一致、8完了条件hash一致、要件表/HTML再生成一致を確認した。

## 現行文書

[現行モデル](../../design/current-design.json)、[要件表](../../design/requirements-matrix.md)、[HTML設計図](../../design/workflow-blueprint.html)は是正候補HEADの接続状態へ更新済み。既存21AC行と8完了条件を弱めていない。

## 残る実装と、未実施を完了扱いにしないもの

C01〜C05の是正コードに残る既知の実装残件は、この再監査範囲ではない。Node24＋lockfile、全体Vitest、typecheck/build、lint、format、privacy、Release pack、実HTTP/API・React、Windows・狭幅、backup/restore・原本なし読取り、GitHub公開導線、合成デモ版との一致を #25 で確認する。

確認時点でrepositoryはprivate。MIT LICENSEがあっても展示QRを一般向けに使える状態とはしない。公開範囲変更・main merge・Release・Cloudflare deployは行っていない。実データ・原本・採用済み資料も変更していない。
