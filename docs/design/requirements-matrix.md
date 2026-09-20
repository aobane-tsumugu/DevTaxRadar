# DevTax v0.5 要件・実装・受入対応表

更新日: 2026-09-20
実装差分基点: `1fe8eaca41391e3e4787a5d7dea83abaf53d62bd`。PR #18の是正ブランチ。複数年度のソフトウェア取得原価、適用可能な方法、選択した年額の残高・年度採用、少額設備、一括償却、共通事実の再利用と未送信入力復旧まで接続した候補HEAD。Node24・実ブラウザ・公開導線の最終受入は別環境で固定HEADを検証する。

製品仕様v0.5の要求・既存の受入条件を維持する。以下は現在の接続範囲であり、各ACの総合受入済みを示さない。実機確認は別枠、正式環境の全体試験は未実施として区別する。

現在地は[CURRENT](../evidence/v05-revision/CURRENT.md)、完了条件は[実装計画](implementation-plan.md)、設計目標は[製品仕様](../../PRODUCT_SPEC.md)を参照。

## 要件からコードと受入条件への対応

| 要件ID | 責務 | 現行の接続状態と根拠 | 受入条件 |
| --- | --- | --- | --- |
| REQ-LIFE-01 | 制作物・単位・用途・活動 | 制作物、用途、期間分類、出来事を保存。独立した活動全体の共通事実モデルは目標仕様であり、現行のtaxUnitモデルの範囲を超えて完成とはしない。 [types.ts](../../src/planning/types.ts) | AC-LIFE |
| REQ-LIFE-02 | 稼働版・改良・複数用途 | 前身後継・単一振替・残額使用を既存経路で扱う。混在用途の資産境界は本人の条件として保持し、全自動の資産分割は行わない。 [balanceUseDraft.ts](../../src/core/balanceUseDraft.ts) [BalancesPage.tsx](../../src/client/pages/BalancesPage.tsx) | AC-LIFE、AC-GRAPH |
| REQ-FACT-01 | 事実の時点・根拠・訂正 | 発生日と記録日、条件と証拠を保持。同額の根拠変更も候補元変更へ反映する。すべての取込様式に共通する訂正モデルは未完成。 [costTreatmentFacts.ts](../../src/core/costTreatmentFacts.ts) [reviewHistory.ts](../../src/core/reviewHistory.ts) | AC-FACT |
| REQ-SOURCE-01 | 取得元品質・旧値・保全 | 取得元単位のI/O失敗とファイル単位保留、前回値・未取得、捕捉来歴を区別。採用前の数値観測を保全し、税務採用と混同しない。現HEADで全取得回帰の再実行は必要。 [historySources.ts](../../src/server/historySources.ts) [observationRecords.ts](../../src/server/observationRecords.ts) | AC-SOURCE、AC-RECORD |
| REQ-SOURCE-02 | 履歴粒度・重複 | 契約選択と履歴粒度の制約を計算へ渡す。同じnative IDと実ログ複製を区別し、精度不足時に月・契約別利用を推定しない。 [usageGranularity.ts](../../src/core/usageGranularity.ts) [contractUsage.ts](../../src/core/contractUsage.ts) | AC-SOURCE、AC-TIME |
| REQ-EXPENSE-01 | 原額・期間・調整 | 全費用は共通費用源へ正規化。料金の優先順位はproviderと対象月。理由付きnullと0、返金と元費用訂正、残高減少への対応を保持する。 [workspaceCosts.ts](../../src/core/workspaceCosts.ts) [sourceAdjustments.ts](../../src/core/sourceAdjustments.ts) [adjustmentBalanceLinks.ts](../../src/core/adjustmentBalanceLinks.ts) | AC-EXPENSE |
| REQ-EXPENSE-02 | 入力・取込・換算 | 手入力と返金・訂正の共通検証、明示した換算額・率・日付・出典を保存。全原始請求の統一取込UIを実装した意味ではない。 [sourceAdjustmentSchema.ts](../../src/planning/sourceAdjustmentSchema.ts) [SourceAdjustmentsEditor.tsx](../../src/client/pages/SourceAdjustmentsEditor.tsx) | AC-EXPENSE |
| REQ-EXPENSE-03 | 設備・自宅・直接費 | 設備の普通定額法、10万円未満の供用年費用化、10万円以上20万円未満の3年一括償却を、設備全体額・年度条件・前年残高から共通費用基礎へ接続。自宅・直接費の根拠と複数配分も維持し、私用転用・特殊償却等の未対応条件を通常計算へ置き換えない。 [equipmentDepreciation.ts](../../src/core/equipmentDepreciation.ts) [equipmentPool.ts](../../src/core/equipmentPool.ts) [workspaceCosts.ts](../../src/core/workspaceCosts.ts) | AC-BASIS |
| REQ-COST-01 | 原額・基礎・寄与・処理・残高の分離 | 共通projectionの最終配分と既存残高・原価追跡を使い、複数年度の同一ソフト製作原価を二重加算せず一つの取得価額へ振替。原額・費用基礎・寄与・取得価額・選択方法・実際の年額・採用残高を分離し、不明範囲は既知小計を全体額へ昇格させない。 [softwareAcquisitionDraft.ts](../../src/core/softwareAcquisitionDraft.ts) [softwareAcquisitionBasis.ts](../../src/core/softwareAcquisitionBasis.ts) [softwareMethod.ts](../../src/core/softwareMethod.ts) [balanceLotTrace.ts](../../src/core/balanceLotTrace.ts) | AC-BASIS、AC-DECISION |
| REQ-COST-02 | 直接対応・複数配分 | 設備・自宅・直接費の複数対象と未確認率を保存。私用・通常業務・未配分・捕捉外・端数を分離し、親寄与の二重使用を拒否する。 [businessAllocation.ts](../../src/core/businessAllocation.ts) [costProjection.ts](../../src/core/costProjection.ts) | AC-ALLOC |
| REQ-COST-03 | 契約・期間別の捕捉外 | 契約の履歴選択・捕捉外状態を分母に適用。不明の全額を勝手に配分せず、既定率を本人確認済みと解釈しない。旧設定の互換は明示する。 [contractUsage.ts](../../src/core/contractUsage.ts) [ChargeUsageEditor.tsx](../../src/client/pages/ChargeUsageEditor.tsx) | AC-CAPTURE |
| REQ-COST-04 | 方法・期間・時間帯 | 方法版・期間・時間帯・取得来歴を保存版へ保持。契約別の利用範囲が曖昧なら配分待ち。観測していない稼働時間は生成しない。 [captureProvenance.ts](../../src/core/captureProvenance.ts) [dashboard.ts](../../src/server/dashboard.ts) | AC-METHOD、AC-TIME |
| REQ-COST-05 | 多段階原価・二重費用化 | 親原価・最終配分・増加・残額使用の既存上限照合を維持。候補からの増加案も既存の未使用原価補完を使用し、段階ごとに元額を再計上しない。 [balanceCostDraft.ts](../../src/core/balanceCostDraft.ts) [balanceLotTrace.ts](../../src/core/balanceLotTrace.ts) [costTreatmentDraft.ts](../../src/core/costTreatmentDraft.ts) | AC-GRAPH |
| REQ-DECISION-01 | 事実から候補・判断・残高案 | 全費用の最終配分へ作業実態を結び、通常費用・ソフト製作原価等の候補へ接続。複数年のソフト取得価額は既存残高へ一度だけ振替し、本人が確認した方法から年額を計算して既存の費用化・年度採用へ渡す。普通経費や取得価額を架空の別台帳へ二重記帳しない。 [costTreatments.ts](../../src/core/costTreatments.ts) [softwareAcquisitionDraft.ts](../../src/core/softwareAcquisitionDraft.ts) [softwareMethodDraft.ts](../../src/core/softwareMethodDraft.ts) [SoftwareMethodPanel.tsx](../../src/client/pages/SoftwareMethodPanel.tsx) | AC-DECISION |
| REQ-DECISION-02 | 不足・矛盾・未対応 | 対象額・期間・出典・条件IDと状態を返す。根拠変更はstale、不明金額はnull。候補元不一致は年度採用の既存参照確認へ問題として返す。 [treatmentDecisionReferences.ts](../../src/core/treatmentDecisionReferences.ts) [reviewMaterials.ts](../../src/server/reviewMaterials.ts) | AC-DECISION、AC-FACT |
| REQ-DECISION-03 | 方法別の年次比較 | 個人・業務専用・通常条件の資産全体額について、普通定額法、10万円未満の供用年費用化、3年一括償却、確認済みの青色少額資産特例を同じ年次比較エンジンで評価。選択した方法・根拠・制度条件は資産へ保存し、年額は再入力せず残高・年度採用へ接続。試算の表示期間や未採用案は採用済み事実・過年度資料を無効化しない。 [annualMethodComparison.ts](../../src/core/annualMethodComparison.ts) [softwareMethod.ts](../../src/core/softwareMethod.ts) [softwareMethodDraft.ts](../../src/core/softwareMethodDraft.ts) [SoftwareMethodPanel.tsx](../../src/client/pages/SoftwareMethodPanel.tsx) | AC-METHOD |
| REQ-DECISION-04 | 相談回答の反映 | 問いと事実・方法の回答、解消の判断、対象年、回答時点を保持。候補元が変わった解消も再確認へ戻す。個別フィールドの全自動反映は行わない。 [consultationResolution.ts](../../src/core/consultationResolution.ts) [treatmentDecisionReferences.ts](../../src/core/treatmentDecisionReferences.ts) | AC-CONSULT |
| REQ-YEAR-01 | 種類別残高・単一振替 | 制作中・資産・前払の保存則、単一振替と原価使用案を維持。候補からの増加先は制作物と種類を確認し、残高画面の未保存draftへだけ追加。 [annualBalances.ts](../../src/core/annualBalances.ts) [TreatmentBalanceDraftPanel.tsx](../../src/client/pages/TreatmentBalanceDraftPanel.tsx) | AC-YEAR、AC-GRAPH |
| REQ-YEAR-02 | 期首・繰越・未知 | 外部期首と既存の前年資料参照、原価繰越し、不明額を維持。候補や将来比較の額で翌期首を自動置換しない。 [externalOpening.ts](../../src/core/externalOpening.ts) [openingLotCarry.ts](../../src/core/openingLotCarry.ts) | AC-YEAR |
| REQ-RECORD-01 | 観測・入力・結果の固定 | 同一snapshotの入力・観測・費用・条件・候補・比較案と未判断を年度採用資料へ固定。判断の候補元はworkspaceの同じsavepointで保存。 [reviewMaterials.ts](../../src/server/reviewMaterials.ts) [decisionTreatmentBindingsRepository.ts](../../src/server/decisionTreatmentBindingsRepository.ts) | AC-RECORD |
| REQ-RECORD-02 | 更新・削除と保存版の分離 | 原本がなくても固定資料を読取可能。通常起動を経由しないdata:readも同じhash検証を使用。旧資料へ新計算を補完しない。 [storedReview.ts](../../src/server/storedReview.ts) [reviewArchive.ts](../../src/server/reviewArchive.ts) | AC-RECORD、AC-SOURCE |
| REQ-RECORD-03 | 訂正・後年度差分 | 元版・訂正版・後年度を分離。実際に参照する当年・過年度の条件と証拠を比較し、無関係な将来入力を混ぜない。 [reviewHistory.ts](../../src/core/reviewHistory.ts) [reviewComparison.ts](../../src/core/reviewComparison.ts) | AC-CORRECTION |
| REQ-UX-01 | 目的に沿う主導線 | 支払と配分、残高と繰越し、今年の概要、根拠、記録と相談の既存導線へ接続。条件から判断・残高案へ移動。製品仕様の生涯全体ビューは残る目標。 [App.tsx](../../src/App.tsx) [CostsPage.tsx](../../src/client/pages/CostsPage.tsx) | AC-UX |
| REQ-UX-02 | 保存・競合・復旧 | workspaceの版照合・要求控え・3版比較、残高draft復旧を維持。費用処理条件とソフト方法の未送信入力はdataset・編集対象・元revisionを持つ別控えとして復旧し、自動送信しない。既存ウィザードの判断編集も保存元との比較を通す。容量不足・別dataset・競合では元入力を保持する。 [editorRecovery.ts](../../src/client/editorRecovery.ts) [useEditorRecovery.ts](../../src/client/useEditorRecovery.ts) [workspaceRecovery.ts](../../src/client/workspaceRecovery.ts) [workspaceMerge.ts](../../src/core/workspaceMerge.ts) | AC-SAVE |
| REQ-UX-03 | local失敗とdemo | 明示demoと実データを分離し、local失敗時は再試行を表示。失敗した個人の数値を合成値へ置換しない。 [dashboard.ts](../../src/client/dashboard.ts) [App.tsx](../../src/App.tsx) | AC-MODE |
| REQ-UX-04 | 変更だけの確認 | メモ保存・計算影響・年度採用を区別し、同じ制作物の作業目的・資産種類・直接対応・根拠を安全な範囲で再利用。支払・提供・年末状態や確認済み判断は流用しない。未採用の比較期間・方法案だけの変更は製作事実や採用済み年額を失効させない。 [treatmentFactsReuse.ts](../../src/core/treatmentFactsReuse.ts) [reviewHistory.ts](../../src/core/reviewHistory.ts) [CostTreatmentFactsEditor.tsx](../../src/client/pages/CostTreatmentFactsEditor.tsx) [workspaceImpact.ts](../../src/server/workspaceImpact.ts) | AC-UX |
| REQ-EXPORT-01 | 同版の全資料出力 | 共通projectionと固定版から画面・JSON・Markdownへ出力。ソフトウェアは保存した取得価額・選択方法・根拠・実際に記録した年度額・元原価年を固定版から描画し、現在の計算規則で旧版を再計算しない。方法未収録の旧版へ新しい欄を補完しない。 [reviewExport.ts](../../src/core/reviewExport.ts) [softwareMethodExport.ts](../../src/core/softwareMethodExport.ts) [storedReview.ts](../../src/server/storedReview.ts) | AC-EXPORT |
| REQ-EXPORT-02 | 相談資料の境界 | 専用localReferenceを構造上除外。自由記述・理由・相談回答は匿名化済みとせず共有前に確認。data:readの個人用backupと相談資料を区別。 [reviewArchiveCli.ts](../../src/server/reviewArchiveCli.ts) [READING-SAVED-REVIEWS.md](../../docs/READING-SAVED-REVIEWS.md) | AC-PRIVACY、AC-EXPORT |
| REQ-RESTORE-01 | 全DBのbackup・復元 | 全DBとsaltの一貫snapshot、schema・hash・整合検査、新規復元先限定と再接続保留を維持。原本のない停止取得元を保持し変更cacheのみ失効。 [dataBundle.ts](../../src/server/dataBundle.ts) [restoreSources.ts](../../src/server/restoreSources.ts) | AC-RESTORE |
| REQ-RESTORE-02 | 利用終了後の読取り | data:readは通常起動・復元・移行なしで保存資料v1を検証し、選択版を新規ファイルへ出力。将来の未知schemaの互換を保証せず、restore条件は緩めない。 [reviewArchive.ts](../../src/server/reviewArchive.ts) [read-review.ts](../../scripts/read-review.ts) | AC-RESTORE、AC-EXPORT |
| REQ-PRIVACY-01 | 秘密参照・本文・公開境界 | 原本本文と秘密参照を通常DTO・保存資料に追加しない。loopback・Origin・CSRF、出力先の非上書きとbackup内書込み拒否を維持。 [security.ts](../../src/server/security.ts) [reviewArchiveCli.ts](../../src/server/reviewArchiveCli.ts) | AC-PRIVACY |

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

## 検証範囲と残る製品上の境界

- 実装済み経路と製品全体の受入を分ける。是正コードは候補HEADへ接続済みだが、Node24・実API/React・Windows・展示導線の最終受入は別環境で行う。
- ソフトウェアの通常経路は個人・業務専用・通常条件を明示した資産を対象とする。私用転用、特殊調整、中断・終了後は通常計算へ置き換えず別処理へ引き渡す。
- 複数年度の制作中原価は既存の原価追跡と単一振替で一つの取得価額へまとめる。既に繰越した同じ原価を再加算せず、不明・外部期首の未追跡範囲は明示して全体確定額にしない。
- 普通定額、供用年全額費用、3年一括、確認済み青色少額資産特例は代替方法で、方法間の額を合算しない。制度条件・所得区分・供用・貸付用途等を方法ごとに確認し、税額・節税額の自動確定は行わない。
- 未送信の費用条件・方法入力はローカル控えへ保持し、dataset・元revision・編集対象を照合して復旧する。控えの復旧だけでDB保存・確認済み判断・年度採用を実行しない。
- 正式なNode24/lockfileの全体Vitest・型検査・build・lint・format・privacy・Release、HTTP/API・React代表操作、Windows・狭い画面等はC06の同一候補HEADで実施する。
- すべての外部請求形式の自動取込、法人一般会計、私用転用・特殊償却の自動計算、クラウド同期、生涯全体画面は今回の通常個人開発経路の完成範囲外として明示する。

この表と設計図は `current-design.json` と `acceptance-scenarios.md` から同時生成する。金額の保存則は実製品の試験で検査し、この文書検査に算術定数を再記述して合格を作らない。
