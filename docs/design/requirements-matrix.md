# DevTax v0.5 要件・実装・受入対応表

更新日: 2026-09-09
実装確認基準: `7c201f0` / package 0.1.0。今回の変更は文書・受入条件の更新であり、製品修正や追加受入の実施ではない
設計状態: [製品仕様v0.5](../../PRODUCT_SPEC.md)と[技術設計v0.5](../../TECHNICAL_DESIGN.md)を採用。実装状態は別管理。

「部分接続」は関連するコードがあっても要件全体を満たしていない状態。「未接続」は採用した契約を実行する経路がない状態。以下の受入条件は今後の実装を評価する条件であり、実施済みテスト結果ではない。旧版の検証証跡を新しい要件の合格記録へ転用しない。

実装順序と削除条件は[実装・簡素化の作業計画](implementation-plan.md)を参照。過去の実施記録は[検証証跡](../evidence/v05-revision/CURRENT.md)からたどる。

## 要件からコードと受入条件への対応

| 要件ID | 責務 | 現行の接続状態と根拠 | 受入条件 |
| --- | --- | --- | --- |
| REQ-LIFE-01 | 制作物・単位・用途・活動を分離 | 部分接続。[planning/types](../../src/planning/types.ts)のtaxUnitに複数の意味が集中 | AC-LIFE |
| REQ-LIFE-02 | 稼働版・改良・複数用途の併存 | 部分接続。predecessorIdとmixedはあるが単一lifecycleStatus | AC-LIFE |
| REQ-FACT-01 | 発生日・記録日・確認状態・訂正 | 部分接続。eventの2日付とevidenceはある。確認/矛盾/訂正の共通契約は未接続 | AC-FACT |
| REQ-SOURCE-01 | source品質・停止削除の影響 | 部分接続。[historySources](../../src/server/historySources.ts)に増分と旧値保持。採用版には数値観測・走査状態を固定済み。全sourceの捕捉品質とAdapter版は未完了。ファイル単位の前回値使用/初回未取得の来歴を数値と資料へ結ぶ接続はW02、実履歴の複製判定はW03で扱う | AC-SOURCE |
| REQ-SOURCE-02 | Adapterの粒度・定義・重複 | 部分接続。[adapters](../../src/adapters/types.ts)。Codex最終累積と開始時刻への帰属を保持 | AC-SOURCE、AC-TIME |
| REQ-EXPENSE-01 | 原額1回・利用期間・調整 | 部分接続。保存入力は[chargePeriods](../../src/core/chargePeriods.ts)と設備等の別型だが、読取時にExpenseSourceへ正規化。年をまたぐ請求の原額を1件に保つ。共通schema・計算・支払表示・Markdownは理由付きの原額不明を保持する。直接費・自宅費用・設備・期間指定AI請求は理由付きnullの入力・API・DB保存・再起動・previewへ接続。旧DBはbackup検証後に記録保持で移行。月別上書きは理由付きnullを入力・API・DB・共通計算へ接続し、不明月を既定月額で補わない。行なしと確認済み0円を区別。[月別料金移行](../../src/server/monthlyChargeMigration.ts)で旧記録を保持。既定月額も理由付きnullをUI・API・DB・計算・入力控えへ接続。保存済み0円を再表示し、空欄と新規DBは未入力理由付きnullとして扱う。旧料金は保持。[既定月額移行](../../src/server/defaultChargeMigration.ts)で既存料金・契約期間を保持。競合時は金額と理由を一組で選ぶ。期間指定AI請求の証拠参照を登録済み根拠から選択し、DB・費用源・配分明細・年度資料・Markdownへ接続。参照先欠落は警告。同Provider・利用期間・既知原額の重複候補を入力画面/費用基礎/年度資料/Markdownで案内し、自動除外しない。金額不明を含む部分期間重複も連結した請求群として検出し、全件が同日重複とは扱わない。注意を年度資料へ保持。各年度に関係する請求だけで検出し、将来請求の追加で過年度資料を変えない。期間指定請求の優先順位はサービス・対象月ごとに判定する。該当月は月額概算を加算せず、別月は月別上書き、なければ観測月の既定月額へ戻る。明示した契約期間の制限は維持する。月の一部だけを覆う請求では、対象日外の利用へ残りの月額を推定配分しない。将来請求の追加で過年度の既知額・0円・不明額・根拠を落とさない。別契約確認の保存は接続済みだが、履歴を実契約別の分母へ分離する接続と請求番号照合は未完了（W03）。共通入力・返金/訂正の保存は未接続 | AC-EXPENSE |
| REQ-EXPENSE-02 | 手入力と取込・換算根拠 | 部分接続。[Onboarding](../../src/client/pages/Onboarding.tsx)に円額入力。共通取込確認・換算来歴は未接続 | AC-EXPENSE |
| REQ-EXPENSE-03 | 設備・自宅・直接費の条件 | 部分接続。[workspaceCosts](../../src/core/workspaceCosts.ts)で購入額と年額の代用を撤去。[設備定額法計算層](../../src/core/equipmentDepreciation.ts)は個人有形設備の条件付き年額・残高を計算する。年度別条件をDB・API・編集画面へ保存し、条件付き年額を共通費用基礎と業務/私用/制作物寄与へ接続。不足・未対応・矛盾は未算定。前年採用版の構造化期末計算と入力額を照合し、不一致は採用不可。旧版未収録は照合不能。自由記述参照先・適用条件の検証は未完了。自宅・直接費の根拠と対応先は正規化済み | AC-BASIS |
| REQ-COST-01 | 原額・基礎・寄与・費用・残高の分離 | 部分接続。[costs](../../src/accounting/costs.ts)・[workspaceCosts](../../src/core/workspaceCosts.ts)・[costProjection](../../src/core/costProjection.ts)で旧入力を共通の原額/基礎/寄与へ正規化。支払画面・API・作業中Markdownへ接続。限定した設備の年度条件・条件付き計算は接続。全費用の税務処理・残高への自動生成は未完了 | AC-BASIS |
| REQ-COST-02 | 直接対応と複数先への配賦 | 部分接続。共通モデルで複数寄与と通常業務/私用/未配分/捕捉外/端数を分離。AC-ALLOCの4費用合成例を検証。設備の年度別複数先入力・0.01%配分・参照/合計検証・採用版固定・出力を接続。自宅費用にも任意のtargets配列を追加し、複数先入力・保存・原額からの配分・旧記録移行・固定資料Markdownを接続。直接費にも複数先入力・割合不明・保存再読取・旧表移行・原額の一度だけの配分・年度資料の固定/出力を接続。返金等を含む全体受入は未完了 | AC-ALLOC |
| REQ-COST-03 | 契約×期間の捕捉外状態 | 部分接続。不明null／捕捉外なし0／入力推定率をUI・API・DB・[allocation](../../src/core/allocation.ts)・[dashboard](../../src/server/dashboard.ts)へ接続。10%／25%の暗黙採用を撤去し、基準なし・不明時は支払を配分未算定として保持。全体1値から契約×期間別の状態と根拠への移行は未接続 | AC-CAPTURE |
| REQ-COST-04 | 方法版・期間・根拠 | 部分接続。採用資料は設定・費用基礎の方法・engine版を固定。契約と期間を単位とする配賦方式改訂は未接続。時間帯を含むcache再利用条件と観測/固定資料の帰属の一致はW02、契約別の適用期間はW03で扱う | AC-METHOD、AC-TIME |
| REQ-COST-05 | 多段階原価と二重費用化防止 | 計算層を追加。親寄与の一度だけの消費、循環・重複・原額超過・期間重複拒否、出典追跡を検証。[金額対応](../../src/core/balanceCostProvenance.ts)で最終配分と増加額を対応付け、年度横断の過剰使用を採用時に拒否。[入力画面](../../src/client/pages/BalanceCostLinksEditor.tsx)・固定資料・出力へ接続。[参照経路の表示](../../src/client/pages/CostTracePanel.tsx)で最終対応額・未算定基礎から複数の元支払までたどり、段階間を移動できる。金額の再計算・段階合算・欠落補完を行わない。[残高段階の金額対応](../../src/core/balanceFlowLinks.ts)で期首/増加/振替受入から費用化/減少/振替への明示リンク、元額超過・日付・残高先・循環を照合し、保存/年度資料固定/不整合の採用拒否へ接続。対応元選択/使用額の入力と採用前/保存版の照合表示を接続。複数原価の一部消費内訳、期首原価の由来と全二重費用化防止は未完了 | AC-GRAPH |
| REQ-DECISION-01 | 事実から候補・額・残高へ | 部分接続。[DecisionEditor](../../src/client/pages/DecisionEditor.tsx)で本人の扱い・根拠・確認を記録し、内容編集で未確認へ戻す。[taxDecision](../../src/core/taxDecision.ts)と[assetThresholds](../../src/core/assetThresholds.ts)による全費用の自動計算は未接続 | AC-DECISION |
| REQ-DECISION-02 | 不足・条件・矛盾・未対応の状態 | 部分接続。missingFacts等があるが影響額/期間を持つ共通質問モデルなし | AC-DECISION、AC-FACT |
| REQ-DECISION-03 | 方法の条件付き年次比較 | 未接続。同額の申告条件シナリオは方法別年次計算ではない | AC-METHOD |
| REQ-DECISION-04 | 相談回答の反映 | 部分接続。[回答入力](../../src/client/pages/ConsultationAnswersEditor.tsx)で未判断の問いに事実/方法の回答・対象年・受領日・確認先を結ぶ。残高API/DB/入力控え・採用snapshot・保存版表示・Markdownへ接続。解消は既存の確認済み判断IDと理由へ結び、解消時の回答と問い・対象額・根拠・判断の対応を固定する。回答または確認対象の変更・削除・未記録は未判断の再確認とし採用を停止。旧採用版は当時の形式の読取りを維持する。解消年より後の回答は以前の解消を無効にしない。対象年より後の回答は当該年の表示・履歴照合から除外し、旧版を保持。[見直し元の回答](../../src/client/pages/ConsultationContextPanel.tsx)を保持して制作物・利用状況と対象年の判断へ移動する導線を接続。対象制作物/年の未確認判断を追加可能。残高の未保存入力を保持し閲覧のみで保存しない。個別設備/契約等のフィールドへの対応付け、変更との恒久参照、候補/金額/残高への原因別影響は未完了 | AC-CONSULT |
| REQ-YEAR-01 | 種類別残高と対応する振替 | 計算層を追加。[annualBalances](../../src/core/annualBalances.ts)で種類別保存則と単一振替を検証。残高DBと入力保存・年度preview・固定版読取/出力/比較/採用/年別影響の9 APIへ接続。[BalancesPage](../../src/client/pages/BalancesPage.tsx)で期首・増減・振替を入力して年度別確認。[balanceReferences](../../src/core/balanceReferences.ts)で制作物・資料の存在と判断の確認状態・年・制作物を照合。年度資料の採用・訂正を確認画面とPOSTへ接続。増加額の費用配分への対応・未対応・重複を照合。[balanceFlowLinks](../../src/core/balanceFlowLinks.ts)で期首・増加・振替受入から費用化・減少・振替への明示対応を照合し、元額超過・別残高・未来日付・循環を検出。対応元入力、再読込、採用拒否と修正後採用を実画面で確認。[balanceLotTrace](../../src/core/balanceLotTrace.ts)で単一原価の一部使用と混在原価の全額移動を追跡し、採用前/保存版/Markdownへ接続。[BalanceLotUseEditor](../../src/client/pages/BalanceLotUseEditor.tsx)で混在原価の使用内訳を明示し、原価別の上限超過を採用時に拒否。未指定の一部使用は内訳未確定として表示。全費用からの生成、期首原価の由来、未追跡原価の由来、全適用条件の照合は未完了 | AC-YEAR、AC-GRAPH |
| REQ-YEAR-02 | 年次照合・採用期末から翌期首 | 計算・残高保存層を追加。既知と未知、前年度の採用版との整合を検証。[openingLotCarry](../../src/core/openingLotCarry.ts)で前年採用期末の原価残額を当年期首と照合し、原価別繰越額・未追跡額・前年資料IDを固定。採用前/保存版/Markdownに接続。不整合時は採用停止。外部資料からの初回期首原価は未対応。[reviewHistory](../../src/core/reviewHistory.ts)で接続した過年度の費用・判断・根拠・利用量・未判断の変更も採用時に照合し、必要な年度の訂正を要求。作業中残高の年別表示を接続。[PendingBalanceEditor](../../src/client/pages/PendingBalanceEditor.tsx)で未判断の登録・根拠選択・解消年と判断の記録を接続。解消前の年度には問いを残し、解消以後は繰越対象から外す。残高は自動変更しない。[AnnualReviewSummary](../../src/client/pages/AnnualReviewSummary.tsx)で対象年の採用版・費用化額・期末残高・不明・採用理由を概要へ接続。[ReviewComparisonAction](../../src/client/pages/ReviewComparisonAction.tsx)で保存版と現在の保存入力との差を要求時に確認できる。全費用からの処理生成を含む年次確認の全体受入は未完了 | AC-YEAR |
| REQ-RECORD-01 | 入力・観測・方式・結果の固定版 | 残高専用の[balanceRepository](../../src/server/balanceRepository.ts)を追加。固定snapshot・hash・再送整合を検証。製品DB初期化と固定版読取APIへ接続。[reviewMaterials](../../src/server/reviewMaterials.ts)で料金・計画・数値観測・共通費用結果を同じ読取snapshotから組立。preview hashとrepositoryの固定保存・再送へ接続。[ReviewAdoptionPanel](../../src/client/pages/ReviewAdoptionPanel.tsx)とPOSTで確認hash付きの採用・訂正・再送へ接続。適用条件・金額の由来の検証は未完了 | AC-RECORD |
| REQ-RECORD-02 | 走査・削除・更新と採用版の分離 | 保存層はdraftや現在の判断・観測の消失後も資料付き版を保持。数値観測・直近10件の走査状態を固定し、更新で確認hashが変わる。製品の採用操作を接続。全sourceの捕捉状態・adapter版の完全な記録は未完了。年度採用前に取得した数値と条件を、元履歴の消失・自動再走査から守る入口もW02で定める。採用済み資料の消失を確認した指摘ではない | AC-RECORD、AC-SOURCE |
| REQ-RECORD-03 | 訂正と後年度への差分 | 元版保持、画面からの訂正採用、保存版と現在の費用・判断・残高の比較、後年度の影響検出を接続。相談回答の保存・判断確認・見直し導線・固定出力は接続済み（REQ-DECISION-04）。個別項目との恒久対応と全方式の変更原因別再計算は未完了 | AC-CORRECTION |
| REQ-UX-01 | 目的に沿った主導線 | 部分接続。[CostsPage](../../src/client/pages/CostsPage.tsx)に支払と配分、対象年切替、原額と未算定理由の確認を接続。[AnnualOverview](../../src/client/pages/AnnualOverview.tsx)で対象年の全費用、未算定、未接続の当年処理・繰越しを分離。AI内訳は対象年へ限定。[AnnualReviewSummary](../../src/client/pages/AnnualReviewSummary.tsx)で概要に対象年の採用済み費用化額・期末既知額・不明残高・未判断・前年訂正を表示し、残高画面へ接続。作業中資料とは版を区別。未採用・取得失敗を0円にしない。[登録状況](../../src/client/pages/RecordStatusPanel.tsx)で登録有無を示し、スコアや一律チェックを確認済みの成果として表示しない。未登録と該当なしを区別。入力結果は具体的な不足情報を表示。[年度別確認の判定層](../../src/planning/costPresence.ts)で本人の該当なし/保留・記録との不一致を扱う。DB・workspace API・競合比較・入力控え・採用資料の本人記録へ接続。年度別の編集画面・登録状況・理由付き診断へ接続。年度判定を採用資料に固定し、不一致は画面とサーバーで採用を停止。保留・未確認は状態を保持する。保存版の年度残高・費用・設備配分根拠・全説明の画面内閲覧を接続。採用版を中心とする主導線全体と制作物の生涯表示は未完了 | AC-UX |
| REQ-UX-02 | 途中保存・競合・影響preview | 部分接続。[workspaceRepository](../../src/server/workspaceRepository.ts)で料金と計画の一括保存・版照合・直後再送照合、途中失敗のrollbackを接続。途中保存も料金を含む。[workspaceMerge](../../src/core/workspaceMerge.ts)と[比較画面](../../src/client/pages/WorkspaceConflictPanel.tsx)で3版比較・記録単位の選択・再競合・入力保持を接続。[workspaceImpact](../../src/server/workspaceImpact.ts)と[影響確認画面](../../src/client/pages/WorkspaceImpactPanel.tsx)で登録範囲の年別費用・分類比較、書込前hash再照合を接続。再走査中も編集入力・保存元の版を保持し、新しい月だけ追加。残高draftも要求ID・内容hash・保存後版を原子保存し、通信断後の再送を認識。[balanceMerge](../../src/core/balanceMerge.ts)と[残高比較画面](../../src/client/pages/BalanceConflictPanel.tsx)で記録単位の3版比較・選択・再競合を接続。選択結果を編集へ戻して検証後に保存。[残高のブラウザ復旧](../../src/client/balanceRecovery.ts)を接続。保存元と未完成入力・要求IDを資料IDで分離して控え、復旧時は最新と比較。容量失敗は警告。[年度採用要求の復旧](../../src/client/reviewRecovery.ts)で送信前に同一要求を控え、再読込後の明示再送を接続。DB識別・採用済み要求・未保存時の資料hashを照合。[料金/計画の入力復旧](../../src/client/workspaceRecovery.ts)で未完成入力・候補整理・保存元を控え、再読込後に復旧。保存時は同じ版番号でも元の内容が変わっていれば3版比較し、既に保存済みの同内容は再書込しない。[料金・計画の送信控え](../../src/client/workspaceAttempt.ts)を保存前に資料IDごとに記録し、再読込後の明示再送へ接続。接続先変更は停止、競合は既存比較へ戻り、成功確認後だけ控えを削除。旧planning/config書込経路の版照合迂回と全体送信に対する64KiB上限の不整合はW01で解消する。普通のメモ保存への全年度影響確認の分離はW05。未確定の比較選択、税務・採用残高の影響は未接続 | AC-SAVE |
| REQ-UX-03 | local失敗とdemoの分離 | 修正済み。[client/dashboard](../../src/client/dashboard.ts)は失敗を返し、Appがエラーと再読込を表示。loopbackの合成デモは明示的なmode=demo。テストと実ブラウザで確認 | AC-MODE |
| REQ-UX-04 | 変更箇所だけの確認 | 部分接続。[reviewComparison](../../src/core/reviewComparison.ts)と比較画面で指定した保存版と現在の保存入力・年次結果を比較。金額以外の理由・判断・未算定も検出。旧資料の不足を比較不可と表示。同年の訂正採用を接続。GET impactで各保存年の期首・期末差と過年度訂正の未反映を表示。税務方式や単独の変更原因に基づく後年度差額の算定は未接続 | AC-UX |
| REQ-EXPORT-01 | 同版の全費用・残高・根拠出力 | 部分接続。[costExport](../../src/core/costExport.ts)が画面と同じ共通費用projectionのMarkdownを出力。計画記述も同じDB読取snapshotに揃える。作業中資料に加え、[reviewExport](../../src/core/reviewExport.ts)と[資料一覧](../../src/client/pages/ReviewRecordsPanel.tsx)で保存版の費用・判断・残高をMarkdown/JSON出力。Markdownに保存時の残高対応元・使用額・残額・未対応額・照合問題も記載し、当時の名称を使う。不明額は照合不能、旧版の欠落は未収録とし、現在値から補完しない。全保存JSONも添付。費用明細・金額追跡で同じ版の根拠説明・出所・日付を展開し、未収録・参照欠落・重複を区別。年度資料の採用操作を接続。DB全体のbackup/復元はREQ-RESTORE-01を参照 | AC-EXPORT |
| REQ-EXPORT-02 | 相談出力の境界とpreview | 部分接続。localReference除外あり、自由記述はそのまま | AC-PRIVACY、AC-EXPORT |
| REQ-RESTORE-01 | 一貫したbackupと別PC復元 | 部分接続。[database](../../src/server/database.ts)の移行backupはある。[dataBundle](../../src/server/dataBundle.ts)でDB全体と識別子の一貫したsnapshot・hash/整合検証・新規フォルダへの復元基盤を追加。[CLI](../../scripts/data-backup.ts)のcreate/verify/restoreを接続。現行schemaを隔離領域で取得して復元し、元source設定を保持して走査を停止。保存済み資料の確認は可能。[restoreSources](../../src/server/restoreSources.ts)と[再接続CLI](../../scripts/restore-sources.ts)で全sourceの確認hash・root/enabled一括保存・保留解除を接続。元IDを維持し、変更元のcacheのみ削除。[再接続画面](../../src/client/pages/RestoreSourcesPanel.tsx)とGET/POST APIを接続し、確認・入力保持・競合再確認を実装。[配布処理](../../scripts/package-release.ts)にCLIを同梱し、[実行検査](../../scripts/release-smoke.ts)で起動から復元・再接続・再起動を検証。別PC実機と既存保存先の切替を含む全受入は未完了 | AC-RESTORE |
| REQ-RESTORE-02 | 利用終了後の読取とschema | 部分接続。保存版のMarkdown/JSON（schemaVersion付き）とDB/識別子の検証付きbackupを提供。別PC実機・将来のschema互換を含む利用終了後の読取受入は未完了 | AC-RESTORE、AC-EXPORT |
| REQ-PRIVACY-01 | 本文・秘密参照・公開境界 | 部分接続。[security](../../src/server/security.ts)等の既存保護を新モデルにも適用する必要 | AC-PRIVACY |

## 受入シナリオ

| ID | 入力・操作 | 合格条件 |
| --- | --- | --- |
| AC-LIFE | 履歴0件で開始。別の制作物は全候補から復元。旧版利用と改良開発・部分公開を併存させ、中止・承継へ進む | 同じ制作物・事実の来歴を保ち、段階の一本化やフォルダ都合の資産分割を強制しない |
| AC-FACT | 後日復元、推定した開始日、相反する資料、本人訂正を投入 | 発生日/記録日と確認状態を区別。影響期間・金額と訂正理由へ戻れる |
| AC-SOURCE | source停止、完全列挙後の消失、不完全列挙、不安定file、形式不適合、複製を投入。前回値あり/初回未取得を混在 | ファイル単位保留とsource単位I/O保護を区別。旧値使用・未取得・方式版が再起動と資料出力後も分かる。別sourceの同一IDと同一実履歴の複製を混同しない。採用版を変更しない |
| AC-TIME | UTCで取得後に日本時間へ変更して再起動。変更あり/なしのfileを増分取得。年越し、長期Codex session、契約月途中も使う | cache再利用と再読取で帰属月が混ざらない。記録の時間帯と計算条件が一致。Adapterの精度を超えた帰属を作らず、旧版の帰属は保持 |
| AC-EXPENSE | 1請求を複数先へ、年払い・月途中・返金・重複候補・外貨換算・手入力と取込候補を使う | 原額・訂正元・期間・換算根拠を保持。重複を暗黙採用しない。返金が他期間へ消えることがない |
| AC-BASIS | 設備購入額はあるが供用・方法不足。別設備は基礎算定済み。自宅と直接費を混在 | 購入額と費用基礎を分離。不明はnullと理由。既知の小計を計算し、原額は追跡可能 |
| AC-ALLOC | 設計図R6の4費用配分。別ケースで同サービス・同期間の契約A8,000円/制作物Aと契約B2,000円/制作物B | R6はA15,600、B1,800、私用9,800、未取得800、未配分5,000、計33,000。別契約ケースはA8,000/B2,000であり5,000ずつにしない。不明帰属を自動分配せず原額保持。寄与超過を拒否 |
| AC-CAPTURE | 確認済み捕捉外なし、本人推定、割合不明、旧snapshotありの切断を別契約で使う | 同じ既定率に置換しない。未知と仮計算を分離。旧寄与と全額留保の二重計上なし |
| AC-GRAPH | 設備基礎を制作物原価へ組入れ、制作中から完成対象へ振替。重複組入れと循環を試す | 移動の両側は同額・同ID。移動だけで費用が増えない。循環・重複を拒否 |
| AC-DECISION | 対応する各処理群について条件充足、不足、期限外、矛盾、未対応を作る | 候補名だけで終わらず、額・残高・理由・不足を返す。適用していないルールを適用済みとしない |
| AC-METHOD | 同じfactsに複数の適用可能方法と条件付き方法。別scenarioで仮定だけを変える | 年別費用・残高・条件を比較。元facts/採用版を変更しない。税額未計算差を節税額としない |
| AC-YEAR | 下の2年合成例と未判断残高を採用。別ケースで前年DevTax資料なしの外部期首から開始 | 前期末→翌期首、種類別保存則、未確定の範囲が一致。外部期首は出典・確認・未知を保持し、導入前の全年度再入力を要求しない。未知を確定期首へ補完しない |
| AC-RECORD | projection表示後に別タブ保存/再走査。採用を再送し元ログを消す。別ケースでは夏に取得→未判断・年度未採用→原本消失→自動再走査 | stale token採用拒否。同一要求は同一結果。採用額と方法は不変。年度採用前の数値と条件も保全した記録から説明でき、保全を税務採用・原本保存と混同しない |
| AC-CORRECTION | N年採用後にN＋1年を採用し、その後N年を訂正 | 元版と理由を保持。N＋1年の差分候補を提示して採用版は自動上書きしない。元版と訂正版を合算しない |
| AC-CONSULT | 要確認論点を出力し、事実の回答と方法の選択を別々に戻す | 回答が同じ対象へ結び付き、変化した候補・額・残高を追跡できる |
| AC-SAVE | 料金入力途中、古いタブ、全公開書込経路、途中失敗、再送、メモ変更、配賦変更。64KiB超の日本語workspaceと採用上限前後を送る | 旧APIを含め新版を無検知で上書きできない。一括保存・再送整合、preview/saveの容量整合、失敗時入力保持。通常メモ保存と年度採用で確認範囲が異なる |
| AC-MODE | local APIの停止・403・parse失敗、明示した合成demoを比較 | localは再試行可能な失敗表示。個人の数字を合成値へ置換しない |
| AC-UX | 早期、過去、月次、節目、年次、相談の代表作業をWindowsと狭い画面で実行 | 主作業16px以上、変更なし再入力不要、該当なし可、質問の理由・結果が読める |
| AC-EXPORT | 同一revisionを画面/Markdown/JSONへ出す。draftを変えて再出力する | 保存版の全費用・残高・根拠・不足が一致。新draftを混ぜない。非対応formatを誤受理しない |
| AC-RESTORE | WAL稼働中backup、破損backup、移行中断、別PC復元、未対応schema、利用終了時持出し。元共有へ接続不能なまま保存資料を読む | 検証したsnapshotとsaltを復元。破損/新schemaを拒否して既存記録を保つ。原本再接続なしでも固定資料が読め、再接続後も識別子と採用版を維持。実機未実施を合成試験で完了扱いしない |
| AC-PRIVACY | 本文・元ID・パス・自由記述を含む合成入力を通常API/採用/出力/Releaseへ通す | 構造上の秘密境界を維持。自由記述previewあり。通常DTOと公開物へ原本情報が漏れない |

## 年をまたぐ合成例

以下は採用した扱いを仮定する算術検証。費用化額はfixture入力であり、実税務上の償却方法・算定額を示さない。

| 年度・種類 | 期首 | 増加・受入 | 振替・費用化 | 期末 |
| --- | ---: | ---: | ---: | ---: |
| N年・制作中原価 | 20,000 | 新規30,000 | 完成対象へ40,000 | 10,000 |
| N年・完成後の資産等 | 0 | 制作中から40,000 | 費用化4,000 | 36,000 |
| N＋1年・制作中原価 | 10,000 | 新規12,000 | 完成対象へ15,000 | 7,000 |
| N＋1年・完成後の資産等 | 36,000 | 制作中から15,000 | 費用化6,000 | 45,000 |

N年末46,000＋翌年増加12,000−翌年費用化6,000＝N＋1年末52,000（7,000＋45,000）。振替だけでは費用は増えない。

## 証拠の更新方法

要件の実装状態を変えるときは、対象コード、実行した受入ID、コマンド、環境、HEADと差分、結果、未実施を記録する。単体関数の成功をAPI/UI/保存/出力の接続済みとしない。文書検査と製品受入を分ける。検査を走らせるために個人DBや元履歴を読み書きしない。

## 承認済み作業への対応

保存はW01、取得・採用前保全はW02、契約・粒度はW03、旧計算削除はW04、日常確認はW05、全費用・判断・期首接続はW06、出力・復元はW07、文書・検査整理はW08。[作業計画](implementation-plan.md)に依存関係・対象ファイル・削除条件を集約する。今回追加した受入条件は未実施であり、既存の接続済み記述は過去証跡に基づく。
