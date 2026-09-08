module.exports = ({table,note,ref,diagram}) =>
table(['概要から採用版との差を確認','実行主体と対象','失敗と版の扱い'],[
 ['理由・原価・金額の変化','ReviewComparisonActionが明示操作で既存の比較APIを呼び、ReviewComparisonPanelを概要内に表示。金額差0でも理由や原価の指定変更を示す。','比較対象はDB保存入力。未保存編集は含めない。採用版IDと年を照合し、別版応答は表示しない。'],
 ['再確認と中断','資料変更/unmountで古い要求を無効化し、再比較では前の結果を消す。','取得失敗は差なしと扱わない。旧版の資料不足、前年の変更、比較元が訂正前の版であることは既存比較表示で区別する。'],
 ])+
`<p class="refs">${ref('src/client/pages/ReviewComparisonAction.tsx')} ${ref('tests/client/reviewComparisonAction.test.tsx')}</p>`+
table(['今年どうなる？の採用済み記録','実行と表示','分岐・責務の境界'],[
 ['作業中資料と採用版を併記','AnnualReviewSummaryがローカル時だけ年度資料一覧と対象年の採用版を取得。記録した費用化額、既知期末残高、不明残高、未判断、残高種類別の期末と理由を表示。','一覧読込時点の採用版。現在の入力との一致や全費用の税務確定を意味しない。残高・原価・保存版差分の画面へ概要と同じ年で移動できる。移動要求は接続先と要求番号を持ち、編集中の入力を再読込・保存せず表示年だけを変更。'],
 ['取得と更新','概要へ戻ると再取得し、読み直すボタンで手動更新。接続先変更は再マウントし、対象年変更後の古い応答は捨てる。','未採用・取得失敗・読込中を区別して0円にしない。別年度/別ID応答は拒否。前年訂正の未反映は警告。公開デモではAPIを呼ばない。'],
 ])+
`<p class="refs">${ref('src/client/pages/AnnualReviewSummary.tsx')} ${ref('tests/client/annualReviewSummary.test.tsx')}</p>`+
table(['前年原価 → 当年期首','実行主体・固定する資料','不足と不整合'],[
 ['採用期末の原価残額を照合','checkOpeningLotCarryが直前年度の採用資料の残高・原価追跡と当年projectionの期首を照合。原価ごとの残額を集め、前年の名称で表示。','取得時の原額ではなく前年残額を引き継ぐ。前年資料未接続・原価未収録・不明額は区別して保持する。'],
 ['採用前/保存版/Markdown','previewBalanceReviewがopeningLotCarryを資料hashに含め、採用後も前年の資料ID・原価内訳・未追跡額・問題を固定。OpeningLotCarryPanelとMarkdownで同じ版を読む。','前年期末と当年期首、対象・種類、前年の追跡残額が不一致ならinvalid。画面とサーバーで採用停止。'],
 ['台帳の継続','過去の増減を保持し、新たな増加を作らず期首の原価説明を接続する。','外部資料だけによる初回期首原価の登録、年度履歴を切り離した移行、全税務条件の確認は未完了。'],
 ])+
`<p class="refs">${ref('src/core/openingLotCarry.ts')} ${ref('src/client/pages/OpeningLotCarryPanel.tsx')}</p>`+
table(['原価を識別する表示','取得元と実行主体','版と不足の扱い'],[
 ['費用名・対象期間・制作物名・ID','costLotLabelが同じ費用projectionの原資料名、費用基礎の期間、制作物名を結ぶ。原価候補・使用額入力・採用前/保存版・Markdownに併記。','IDから名称・日付を推測しない。未収録はそのまま表示。同名・別年度も費用年とIDを保持して識別。'],
 ['編集中と保存版','GET balances/draftは既存の同一workspace読取内で、参照費用の名称とworkspaceRevisionを返す。保存成功時は読込時の表示名を保持。再読込で更新する。','採用前/保存版は同じmaterials.costLinks.costsを参照する。現在の名称を過去版へ混ぜない。新規の未読込参照は名称未収録で示す。'],
 ])+
`<p class="refs">${ref('src/core/costLotLabel.ts')} ${ref('tests/core/costLotLabel.test.ts')}</p>`+
table(['残高から元費用への追跡','実行主体・結果の固定','分岐・未完了'],[
 ['増加 → 振替 → 費用化/減少 → 残り','traceBalanceLotsが費用配分との対応と残高段階間の照合を通過した記録を依存順にたどる。明示した原価内訳、単一原価の一部使用、複数原価の全額移動を追跡。','BalanceLotUseEditorで対応元ごとに使用原価と額を指定。未指定の複数原価または未確認原価を含む元の一部使用は内訳未確定。FIFO・比例配分・入力順で消費原価を選ばない。'],
 ['同版の画面と持ち出し','ReviewMaterials.balanceLotTraceに計算版・移動別原価・残額内訳・未追跡・問題を固定。BalanceLotTracePanelとMarkdown/JSONで同じ結果を表示。','旧版の欠落は未収録。原価の残額未確定と既知0を分ける。段階別金額は合算しない。'],
 ['不整合と不足','対応元・費用配分の不整合時は追跡結果を生成せず問題を示す。','原価別使用合計の上限超過・存在しない原価はinvalidとして画面とサーバーで採用を停止。期首原価の由来と税務上の扱いは未完了。追跡のconsistentは税務適用確認ではない。'],
 ])+
`<p class="refs">${ref('src/core/balanceLotTrace.ts')} ${ref('src/client/pages/BalanceLotTracePanel.tsx')} ${ref('tests/core/balanceLotTrace.test.ts')}</p>`+
table(['残高移動の明示的な対応元','現在の処理','分岐・未接続'],[
 ['期首/増加/振替受入 → 費用化/減少/振替','balanceAllocationsに対応元の種類・ID・額を保存。API schema、snapshotコピー、編集控えに接続。','BalanceFlowEditorで対応元を選択し使用額を入力。払出元・日付に合う候補を表示し、候補外の既存参照は保持。未指定分はincomplete。FIFOや原価内訳を推測しない。'],
 ['対応元の残額と依存を照合','checkBalanceFlowLinksで残高先・日付・元額超過・不明期首・循環を検査。','全体残高に余裕があっても特定の対応元の超過はinvalid。同日の明示依存は扱うが循環は拒否。'],
 ['年度資料へ固定','ReviewMaterials.balanceFlowCheckを固定し、invalidは採用拒否。BalanceFlowPanelで採用前/保存版の対応元・使用額・残額・未対応・問題を表示し、不整合時は画面からも採用を停止。Markdownにも同じ保存版の対応元・使用額・残額・未対応・問題を記載し、旧版の未収録結果は補完しない。','残高段階間の対応であり、期首の原価由来や複数原価の一部消費内訳の完成ではない。旧資料へ現在値を補完しない。'],
 ])+
`<p class="refs">${ref('src/core/balanceFlowLinks.ts')} ${ref('tests/core/balanceFlowLinks.test.ts')}</p>`+
table(['直接費の複数制作物への配分','実行主体・保存先','分岐・保持する内容'],[
 ['配分先と割合を入力','Onboarding / AllocationTargetsEditor → planning_direct_costs.targets_json','明示切替で旧単一対応を解除。原額・日付・証拠・メモを保持。0.01%単位、nullは未確認、空配列は全額未配分。一般業務との併用・合計超過・参照不正は保存拒否。'],
 ['原額から対応額へ','workspaceCosts / allocateBusinessTargets','原額は一度だけ保持。最大剰余法・同率はID順で円額を配分。未確認と残余は未配分。原額/日付不明は全配分先に未算定の影響。旧版残高を新規支払へ加算しない。'],
 ['年度採用・訂正・出力','ReviewMaterials / historicalReviewMaterials / reviewExport','当時の割合と制作物名を固定。DirectAllocationPanelで採用前/保存版の原額・不明理由・メモ・対応先・割合を表示し、現在値で補完しない。使用中の割合変更を差分として検知。旧単一対応の無効な値を再採用しない。全費用の税務処理・返金・複数期間は別の残作業。'],
 ])+
`<p class="refs">${ref('src/server/directCostMigration.ts')} ${ref('tests/core/directTargetProjection.test.ts')}</p>`+
table(['画面へ到達する経路','実行主体','失敗時の分岐'],[
 ['HTMLとJavaScriptを取得','Fastify / staticFiles / dist','要求時にファイルを解決し、起動後に追加されたassetも配信。HTMLはno-store。存在しないJS/CSS/APIは404で、HTMLへ置換しない。'],
 ['画面内URLを直接開く','GET/HEAD・HTML受入・文書宛ての判定','API/asset領域外、拡張子なしの文書要求だけindexへ戻す。index欠落も404。'],
 ['JavaScriptの起動前','index.html → React','読込中の案内をHTMLに保持。表示が続く場合は再読込、更新後ならサーバー再起動を案内。React起動後は通常画面へ置換。実行中の配布更新の原子性を保証する機構ではない。'],
 ])+
`<p class="refs">${ref('src/server/staticFiles.ts')} ${ref('index.html')} ${ref('tests/server/staticFiles.test.ts')}</p>`+
table(['保存を取りこぼさない目的','実行主体・保存先','分岐と復帰先'],[
 ['送信前に要求を保持','App → workspaceAttempt → ブラウザlocalStorage','資料ID・要求UUID・保存元の版と内容・送信内容・影響確認hashを保存。構造不正や容量不足なら送信前に停止する。'],
 ['再読込後に保存結果を確認','WorkspaceAttemptPanel → GET runtime → PUT workspace','本人が控えを選ぶ。対象年と保存元から送信時までの変更を、金額・理由・割合の日本語表示で確認。現在保存との差分とは区別する。現在の資料IDが違えば送信しない。同じ要求を再送し、直前に保存済みなら再書込せず結果を返す。'],
 ['別の保存が進んでいた場合','workspace_last_save / workspaceMerge','直前要求以外や版の不一致は409。保持した変更前・送信内容・最新内容の比較へ戻り、控えは残す。'],
 ['成功・失敗・控えの削除','App / localStorageの内容照合','成功応答を反映した後、同じ内容の控えだけ削除。失敗や読めない控えは保持。本人による控えだけの削除はDBを変更しない。別PCへのバックアップと比較途中の選択復旧はこの機構の対象外。'],
 ])+
`<p class="refs">${ref('src/client/workspaceAttempt.ts')} ${ref('src/client/pages/WorkspaceAttemptPanel.tsx')} ${ref('tests/client/workspaceAttempt.test.ts')}</p>`+
table(['年度別の費用項目確認','実行する仕組み','分岐・保存する内容'],[
 ['本人の記録','planning.costPresence / 年度×設備・自宅費用・直接費','該当なし・保留、理由、日時、ID。空の費用一覧から確認を自動生成しない。Onboardingの費用段階で状態・理由を入力。RecordStatusPanelは年度別の本人記録と不一致を表示。診断は該当なしの有無確認を止め、保留と不一致の問い・理由を残す。'],
 ['保存と再読込','workspace API → planning SAVEPOINT → SQLite planning_cost_presence','同年度/項目の重複は400。SQL失敗は料金・計画とともにrollback。既存DBのテーブル追加前にVACUUM backupとintegrity_check。'],
 ['競合と入力控え','workspaceMerge / workspaceRecovery','年度×項目で比較し、別IDの同時新規入力も競合。理由・状態・日時を一組で選択。未完成理由はブラウザ控えに保持できるが保存時は検証。'],
 ['採用と過年度','ReviewMaterials → 保存JSON・Markdown / historicalReviewMaterials','当時の本人記録を固定し、現在の理由で置換しない。対象年の変更は差分、未来年だけの追加は過去の変更にしない。対象年の判定と方式版を固定。不一致は採用前画面とtransaction内の再読取で拒否し、保留・未確認はその状態で残す。旧版の欠落は補完しない。'],
 ])+
`<p class="refs">${ref('src/planning/costPresence.ts')} ${ref('src/server/costPresenceRepository.ts')} ${ref('tests/server/planningRepository.test.ts')}</p>`+
diagram('一括保存・競合・再送・途中失敗の実行経路', 790, [
 ['input',25,25,470,115,'React / 初期読取と編集draft','GET workspace → 料金と計画を編集','同じ読取版の入力・集計・診断を取得|途中保存も料金・請求履歴を含む','','onboarding'],
 ['request',625,25,470,115,'PUT workspace / CSRF + schema','expectedRevision + requestIdを送る','入力の構造・参照・期間を検証|失敗時は入力を残して400','','api'],
 ['check',625,235,470,115,'SQLite / BEGIN IMMEDIATE','直前要求・保存元の版を照合','同じ要求ID＋内容＋現行版なら再書込なし|古い版は409。ID使い回しの内容変更は400','branch','data'],
 ['stop',25,235,470,115,'React / 競合と比較','入力を保持して比較する','変更前・入力・最新を記録単位に比較|選択後も版と参照関係を再照合','partial','data'],
 ['write',625,445,470,115,'同じSQLite transaction / 同期処理','料金 → 計画 → 共通集計・診断','子のSAVEPOINTは外側commit前に確定しない|SQL例外・再計算失敗は全体rollback','','data'],
 ['rollback',25,445,470,115,'SQLite / ROLLBACK','変更前の料金・計画・版へ戻す','直前要求の記録も保存しない|同じ要求で再試行できる','branch','data'],
 ['done',300,655,520,115,'SQLite COMMIT → React','保存結果を一つの応答で画面へ反映','同じ版の入力・集計・診断と新revision|応答喪失時は同じ要求を再送して照合','','outputs'],
],[
 ['input','request','保存','r','l'],['request','check','検証成功'],
 ['check','stop','競合・要求不整合','l','r'],['check','write','版が一致'],
 ['write','rollback','書込・再計算失敗','l','r'],
 ['write','done','成功','b','t',[[860,560],[860,610],[560,610],[560,655]],755,602],
])+
table(['保存契約','現在の処理','未完了・保証の境界'],[
 ['月別上書きの編集','MonthlyChargesEditorで履歴月・保存済み月・明示追加した月の和集合を表示。履歴に出ない保存月も編集できる。','入力欄追加だけでは保存しない。金額入力でprovider×月の上書きを作り、空欄で解除。0円と上書きなしを区別。料金不明を明示するとnullと理由を保存。既定月額で補わない。'],
 ['旧日付の修復','planningDateIssuesを保存schemaとPlanningDateRepairPanelで共有。記録名・元の不正値・修正日を表示し、本人の操作で編集内容へ反映する。','必須日は空欄へ戻せない。任意日は未入力へ戻せる。修正後は通常のworkspace保存・版照合を通す。古い修正対象が既に変わっていれば適用しない。'],
 ['計画日付の整合','planningSaveSchemaで活動開始・ルール開始/終了・出来事・設備注文/納品/取得/利用開始・直接費発生・証拠発生の10種類を実在する日付として検証。旧計画APIとworkspace APIは不正400。ルール専用APIも開始/終了日を検証。','既存記録は読取時に消さず、設備・直接費の不正日付は理由付きunknownにする。直接費の表示期間は確認対象年であり帰属済み期間ではない。元入力・原額を保持し、正常な費用の計算を継続する。'],
 ['日付の入力','DateInputがinput/changeの両イベントから日付文字列を取り出してReactの編集状態へ渡す。計画と残高の14か所に適用。保存APIはこの編集状態を送る。','設備利用開始日の入力・空欄への取消・保存・再表示を合成データの実ブラウザで確認。月単位の入力欄は別処理。'],
 ['保存範囲','configurationとplanningを1 transactionで更新。新UIの途中保存・最終保存・分類変更が同じPUT workspaceを使う。','履歴走査、原本、保持期間設定、採用残高は含まない。自由な未完成入力を扱う新schemaは未接続。'],
 ['版番号','app_settings.workspace_revision。料金・計画・旧ルールAPIの各保存で増加。一括保存では料金と計画の2回増加が同じcommitで公開される。','編集内容が同じ値へ戻るABA変更も検出。履歴走査版・税務方法版を固定する採用revisionとは別。'],
 ['再送','app_settings.workspace_last_saveに直前要求ID・fingerprint・結果版を保持。直前と同じ要求で現行版も一致すれば書込を繰り返さず現行viewを返す。','最後の要求1件だけを照合する。間に別保存があれば409で停止。任意に古い要求の成功応答や採用snapshotを再生する仕組みではない。'],
 ['失敗','構造不正400、古い版409、書込・共通計算失敗はrollbackして5xx。クライアントは成功応答だけで入力・表示・保存元の版を更新。','通信失敗は未保存を意味しない。同じ入力の再試行は同じ要求ID。競合時は3版を比較して選択・再保存。hash付き保存は書込前に影響previewを再照合。不一致は再確認。詳細は次の影響確認図を参照。'],
 ['旧個別API','config/planning/rulesの個別APIは共有版番号を増加させ、新UIの古い保存を拒否できる。','旧API自身はexpectedRevisionを要求しない。全書込経路の新契約への統一は未完了。'],
 ['保存済み月の保持','既存の月別上書きを保持し、明示した月だけ追加/変更/解除。年度切替・履歴追加だけでは0円等の上書きを生成しない。既定月額変更で過去の上書きを一括置換しない。','月別上書きの原額不明はnullと理由で保存できる。空欄は上書き解除。通常月額自体の原額不明は未対応。'],
 ['編集と再読込','画面を開いた時点の料金・計画・版をeditorBaseとして保持。履歴再走査で最新viewを取得しても、編集中の料金・計画・保存元の版を置換しない。新しい履歴月は表示だけに使い、月額上書きを自動生成しない。','保存・previewは編集元の版を送るため、別画面の保存は競合として検出。自分の保存成功で編集元を更新。編集控えはworkspaceRecovery、送信済み要求はworkspaceAttemptで復旧。比較途中の個々の選択の復旧は未接続。'],
 ['遅れて届く読取','再読込に連番を付け、より新しい再読込や保存成功後に返る古い結果は適用しない。','比較画面の最新読取・preview取消はそれぞれ専用の応答照合で管理。履歴元の追加・削除・走査自体を取消す機能ではない。'],
])+
diagram('競合を比較して編集を継続する経路', 850, [
 ['base',20,25,340,105,'App / 編集開始時のsnapshot','変更前の入力を保持','版・料金・計画をclone|比較中の基準として使用','','data'],
 ['local',390,25,340,105,'App / 拒否された保存要求','この画面の入力を保持','要求ID・料金・計画|比較を閉じても入力を残す','','onboarding'],
 ['latest',760,25,340,105,'GET workspace / 同版読取','最新の保存内容を読む','失敗は再試行。入力を上書きせず|比較画面にだけ読み込む','','api'],
 ['merge',300,250,520,115,'workspaceMerge / 純粋関数','IDで追加・削除・変更を比較','片方の変更はその側を選択|両方が同じ変更なら競合にしない','','data'],
 ['choose',300,450,520,115,'React / 3列比較と明示選択','異なる変更は記録単位で選ぶ','金額・期間・割合・理由を一組として比較|全て選ぶまで保存ボタンは無効','branch','onboarding'],
 ['save',300,650,520,115,'PUT workspace / 既存の原子保存','選択内容を最新の版で再確認','確認付き経路は新preview → 保存|途中draftは直接保存。再競合は再比較','','api'],
 ],[
 ['base','merge','','b','t',[[190,130],[190,195],[560,195],[560,250]]],
 ['local','merge'],
 ['latest','merge','','b','t',[[930,130],[930,195],[560,195],[560,250]]],
 ['merge','choose','差分を表示'],['choose','save','選択完了・保存操作'],
 ['save','latest','再競合','r','r',[[820,707],[1110,707],[1110,77],[1100,77]],1048,408],
 ])+
table(['比較の分岐','処理・表示','保存結果'],[
 ['片方だけ変更','その側を選択。変更前・入力・最新を全て表示し、別の側へ選び直すこともできる。','選択だけではDBを変更しない。'],
 ['両方で同じ変更','内容が同じなら競合ではない。objectのキー順や省略したoptional値の違いだけでは競合にしない。','既存の保存内容を選択。記録配列は順序ではなくIDで照合。'],
 ['両方で異なる変更','同じ料金、profile、制作物、請求、費用、証拠、ルール、出来事、判断の記録を比較。','選択がない記録が残れば保存できない。項目単位で金額と理由を別々に混ぜない。'],
 ['削除と変更・同じIDの追加','片方の削除と他方の更新、両方の同じIDへの異なる新規追加も競合。記録なしを明示。','削除か残す内容を選び、最終的な制作物・証拠等の参照をサーバーで検証。'],
 ['別記録間の参照が破綻','各記録の選択が揃っても、制作物削除とその制作物への新規費用追加は両立しない場合がある。','schemaが400で拒否し、料金も含めて未保存。比較画面に理由を残し、選び直し・元入力への戻りを可能にする。'],
 ['比較の読取失敗・取消','最新読取は再試行できる。戻ると元の入力が残る。比較中は元の入力画面を隠してfocus trapを一時停止。','読取失敗・取消では保存元の版を進めない。元の要求を同じ内容で再試行できる。'],
 ['選択後の再競合','比較に使った最新を次の変更前、選択した内容を次の入力として新しい最新を読む。','古い選択を新しい内容へ無条件に適用しない。新しい比較で必要な選択を求める。'],
 ['選択後の通信失敗','選択と入力を保持。直後の再試行は同じ要求IDと内容を送る。','APIの直前要求照合を使用。成功後に入力・集計・診断を更新し、編集を続けられる。'],
 ])+
note('この接続は作業中draftの一貫保存と競合解消。採用・訂正・後年度影響・完全backupの完成を示さない。','partial')+
`<p class="refs">${ref('src/core/workspaceMerge.ts')} ${ref('src/client/pages/WorkspaceConflictPanel.tsx')} ${ref('tests/core/workspaceMerge.test.ts')}</p>`+
`<p class="refs">${ref('src/server/workspaceRepository.ts')} ${ref('src/server/workspaceRevision.ts')} ${ref('src/planning/workspace.ts')} ${ref('tests/server/planningApi.test.ts')} ${ref('tests/client/appLoadFailure.test.tsx')}</p>`;
