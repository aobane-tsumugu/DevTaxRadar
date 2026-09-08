module.exports = ({table,note,ref,diagram}) =>
table(['保存版を読む','実行と保持','分岐'],[
 ['資料状態の表示','CostsPageのrecordStateで作業中/採用前/保存版を明示。編集不可のreadOnlyとは別契約。','保存版を作業中と表示せず、採用前確認も採用済みとは表示しない。'],
 ['指定した版の画面表示','ReviewRecordsPanelの「この保存版を読む」→ GET /api/balances/reviews/:id → StoredReviewPanel。資料ID一致を確認し、固定された残高・費用・設備配分/計算を表示する。設備配分には同じ資料の設備名・制作物名とIDを併記。自宅費用も対象年の支払額・業務割合・制作物別割合・計算根拠・採用理由をHomeAllocationPanelで表示する。採用前確認とMarkdownも同じ資料の名称を使い、未収録名を現在値で埋めない。','失敗・ID不一致はエラー。資料なしを現在の入力や0円で補わない。再読込と別版の選択は古い表示を解除し、世代番号で遅い応答を無視する。'],
 ['当時の根拠を再確認','設備配分は対象年度の記録だけ表示。未確認と0%を分離。全判断・未解決事項・根拠は全説明と全JSONでも参照できる。','保存版の閲覧と現在の入力との差分を別操作にする。閲覧は再計算APIや保存APIを呼ばない。'],
])+`<p class="refs">${ref('src/client/pages/StoredReviewPanel.tsx')} ${ref('src/client/pages/EquipmentAllocationPanel.tsx')}</p>`+
note('<strong>残高の現在の接続：</strong>balanceRepositoryを製品DB初期化と9 APIへ接続。入力された残高と増減を検証・保存・年別計算し、保存済み採用版を読める。BalancesPageで期首と増減の入力・年別表示を接続。制作物・資料の存在と判断の確認状態・年・制作物を照合して問題を表示。ReviewAdoptionPanelで資料を確認し、POSTから採用・訂正できる。費用配分と増加額の明示対応・全対象年の上限照合を接続。全費用からの残高生成、期首や減少後の個別原価・税務適用条件の照合は未完了。')+
diagram('G12. 対応額から元の支払へたどる',870,[
 ['select',25,25,510,110,'CostsPage / CostTracePanel','最終の対応額か未算定の基礎を選択','表示中のAnnualCostProjectionだけを使用|追加のAPI読取・金額再計算はしない','','api'],
 ['refs',585,25,510,110,'costTrace / 参照グラフの探索','配分 → 基礎 → 親の配分 → 元の支払','複数の親をすべてたどる|同じ参照を重複表示せず、元から順に並べる','','ledger'],
 ['check',585,235,510,110,'参照先の存在と探索中の状態','欠落・重複ID・循環を検出','資料にない内容を推定しない|問題を利用者へ表示する','branch','ledger'],
 ['missing',25,445,510,110,'不完全な参照 / 表示','不足する参照ID・循環を明示','存在する資料を示し、欠落を0で補わない|税務上の妥当性の検査とは別','partial','api'],
 ['route',585,445,510,110,'依存順の説明 / 画面表示','原額・期間・方法版・計算式・対応先','自宅費用は業務割合・制作物割合・丸め順を表示|証拠はIDを表示、原本の確認済みとはしない','','outputs'],
 ['limits',585,655,510,110,'金額の意味を維持','途中の金額と最終額を合計しない','未知は不明・未算定のまま|残高・税務処理の説明は別の接続範囲','','outputs']
],[
 ['select','refs','対象を指定','r','l'],['refs','check','元の参照を探索'],
 ['check','missing','問題あり','b','t',[[840,345],[840,385],[280,385],[280,445]],380,378],
 ['check','route','記録された経路を表示'],['route','limits','意味を確認']
])+ '<p class="refs">'+ref('src/core/costTrace.ts')+' '+ref('src/client/pages/CostTracePanel.tsx')+'</p>'+
diagram('G11. 料金・計画の編集中入力を復旧する',880,[
 ['edit',25,25,510,110,'Onboarding / React入力state','料金・計画・候補整理・表示手順を控える','未完成の日付・空欄数値・不明額を保持|保存元の版と内容を同じ控えへ含める','','api'],
 ['store',585,25,510,110,'localStorage / 編集後のeffect','新しいUUIDの控えを書いて旧控えを整理','DBとブラウザの保存を区別|容量不足は通知し、画面入力を保持','','data'],
 ['restore',585,235,510,110,'再読込後 / 全入力を確認して復旧','datasetを照合し、元の入力画面へ戻す','別の入力が編集中なら復旧を停止|金額や日付を保存可能な値へ変換しない','','api'],
 ['latest',25,445,510,110,'保存操作 / runtime + GET workspace','現在の保存内容と復旧入力を比較','入力が既に保存済みなら再書込しない|保存元の内容変更は同じ版番号でも比較する','branch','ledger'],
 ['compare',585,445,510,110,'WorkspaceConflictPanel / 3版比較','保存元・復旧入力・最新を記録単位で比較','独立変更は両立、競合は利用者が選ぶ|比較後の保存も最新の版を照合','','ledger'],
 ['save',25,655,510,110,'既存の影響確認 / PUT workspace','保存条件を検査して料金と計画を一括保存','保存成功後に対象の控えを整理|APIの保存用schemaは従来の条件を維持','','outputs']
],[
 ['edit','store','編集後に控える','r','l'],['store','restore','再読込'],
 ['restore','latest','保存操作','b','t',[[840,345],[840,385],[280,385],[280,445]],380,378],
 ['latest','compare','保存元と相違','r','l'],['latest','save','保存元と一致'],
 ['compare','save','比較して保存','b','r',[[840,555],[840,710],[535,710]],860,628]
])+ '<p class="refs">'+ref('src/client/workspaceRecovery.ts')+' '+ref('src/planning/schema.ts')+'</p>'+
diagram('G10. 年度資料の保存要求を再読込後に再試行',870,[
 ['confirm',25,25,510,110,'React / 確認済みpreviewと理由','利用者が年度資料の保存を操作','年・残高版・全資料hash・理由・要求UUID|最新runtimeのdatasetIdを照合','','api'],
 ['persist',585,25,510,110,'localStorage / reviewRecovery','送信前に保存要求を不変キーで控える','同じdataset・要求IDを保持|保存領域への記録失敗は送信前に停止','','data'],
 ['reopen',585,235,510,110,'再読込後 / 利用者が控えを確認','全要求を表示し、同じ要求を明示再送','未入力の理由や資料全体は復旧対象外|控えの削除は年度資料の取消ではない','','api'],
 ['check',25,445,510,110,'POST reviews / SQLite transaction','dataset照合後、要求IDと内容hashを照合','保存済みなら入力更新後も元の資料を返す|未保存なら現在のpreviewと全条件を再照合','branch','ledger'],
 ['reject',585,445,510,110,'入力・資料の変更あり / 409','保存を拒否して控えと理由を保持','同じIDで別内容の採用も拒否|新たな資料確認と採用操作が必要','partial','api'],
 ['saved',25,655,510,110,'既存資料を返す / または一致する内容を採用','資料IDとダウンロード先を表示','成功応答後に対象要求の控えだけを削除|削除失敗は保存成功と分けて通知','','outputs']
],[
 ['confirm','persist','同期保存','r','l'],['persist','reopen','再読込・結果不明'],
 ['reopen','check','同じ要求を再試行','b','t',[[840,345],[840,385],[280,385],[280,445]],380,378],
 ['check','reject','条件不一致','r','l'],['check','saved','保存済み / 条件一致']
])+ '<p class="refs">'+ref('src/client/reviewRecovery.ts')+'</p>'+
diagram('G9. ブラウザ終了後の残高入力の復旧',1100,[
 ['edit',25,25,510,110,'React / 編集・比較選択・保存要求前','入力と保存元、表示年、要求IDを控える','空欄の数値をNaNとして別符号化|未知のnull・確認した0を分離','','api'],
 ['store',585,25,510,110,'localStorage / 同じブラウザのorigin','資料ID・編集画面ID・記録IDで分離','新しい入力は別キーへ保存してから旧版整理|容量不足・利用不可は警告、画面入力を保持','','data'],
 ['open',585,235,510,110,'再起動・再読込 / 利用者の選択','同じ資料の復旧候補を表示','読めない形式は自動削除しない|控えた全入力を展開して確認','','api'],
 ['latest',25,445,510,110,'GET balances/draft / datasetIdentity','資料IDと保存元の版・全内容を照合','違う資料への復旧・保存は拒否|版が同じでも内容変更は比較へ進む','branch','ledger'],
 ['same',585,445,510,110,'現在の保存内容と一致','保存済みと表示して重ねて保存しない','応答不明でも同じ入力なら再書込しない|異なる内容は保存元との比較が必要','','outputs'],
 ['compare',25,655,510,110,'変更あり / BalanceConflictPanel','元・復旧入力・最新を記録単位で比較','独立した変更を両立、競合は明示選択|比較を閉じても復旧入力を保持','','ledger'],
 ['resume',585,855,510,110,'編集へ戻る → PUT draft / receipt','入力を確認して保存する','元が同じなら保存要求IDも引継ぎ|保存成功後に使った控えを整理、新しい別編集は保持','','data']
],[
 ['edit','store','同期的な控え','r','l'],['store','open','同じ接続先で開く'],
 ['open','latest','復旧操作','b','t',[[840,345],[840,385],[280,385],[280,445]],380,378],
 ['latest','same','入力と一致','r','l'],['latest','compare','保存元と変更あり'],
 ['compare','resume','選択後に保存'],['latest','resume','保存元と同じ','b','l',[[5,555],[5,910],[585,910]],260,902]
])+ '<p class="refs">'+ref('src/client/balanceRecovery.ts')+' '+ref('src/server/datasetIdentity.ts')+'</p>'+
diagram('G8. 費用配分と残高増加の金額対応',1040,[
 ['costs',25,25,510,110,'React / GET projections','同じ制作物の最終配分を選ぶ','組入れ済みの中間配分・私用・未算定は選択不可|費用の年・配分ID・対応額を明示する','','ledger'],
 ['draft',585,25,510,110,'PUT draft / Zod + SQLite','増加記録と金額対応を一緒に保存','整数円・重複・増加額以内を検証|対応情報がない旧記録はそのまま保持','','data'],
 ['read',585,235,510,110,'reviewMaterials / 同じDB snapshot','採用年までの増加と関連年の費用を読む','現在年と明示された関連年を計算|将来の増加は過去の照合へ混入させない','','api'],
 ['check',25,445,510,110,'balanceCostProvenance / 年＋配分ID','存在・制作物・原額参照・上限を照合','全対象年・全残高への対応額を合算|振替は新たな費用消費として数えない','branch','ledger'],
 ['invalid',585,445,510,110,'不整合あり / HTTP 400','年度資料の採用を拒否','同じ配分の過剰使用、別制作物、中間配分|未来費用、根拠欠落、整数範囲超過','partial','api'],
 ['incomplete',25,655,510,110,'対応不足 / 明示したまま記録','増加額・対応額・未対応額を分離','原額不明や未対応を0扱いで完了させない|未使用配分を税務上の費用と断定しない','partial','ledger'],
 ['fixed',585,855,510,110,'確認hash → transaction再照合 → immutable','費用と照合結果を同じ年度資料へ固定','Markdownと全JSONへ保存|期首の由来・減少後の個別原価・税務条件は別責務','','outputs']
],[
 ['costs','draft','選択と入力','r','l'],['draft','read','年度資料を確認'],
 ['read','check','関連資料を取得','b','t',[[840,345],[840,385],[280,385],[280,445]],380,378],
 ['check','invalid','不整合','r','l'],['check','incomplete','未対応あり'],
 ['incomplete','fixed','不足を残して確認'],['check','fixed','対応が整合','b','l',[[5,555],[5,910],[585,910]],260,902]
])+ '<p class="refs">'+ref('src/core/balanceCostProvenance.ts')+' '+ref('src/client/pages/BalanceCostLinksEditor.tsx')+' '+ref('src/client/pages/BalanceCostProvenancePanel.tsx')+'</p>'+
diagram('G3. 未判断の登録・繰越し・解消',830,[
 ['input',25,25,510,110,'React / PendingBalanceEditor','制作物・発生年・金額・問い・根拠を記録','額が不明なら理由とnullを保持|関連残高は未登録なら選択不要','','api'],
 ['save',585,25,510,110,'Zod + annualBalances → PUT draft','構造を検証して版付き下書き保存','元の問いを保持|参照の問題は画面へ表示','','data'],
 ['branch',585,230,510,110,'annualBalances / 表示する年度','その年度までに解消しているか','発生年前には表示しない|解消年を発生年より前に設定できない','branch','ledger'],
 ['carry',25,435,510,110,'年度projection','未判断として翌年へ繰り越す','解消前の年では元の問いを表示|金額を残高へ自動加算しない','','ledger'],
 ['resolved',585,435,510,110,'React + balanceReferences','解消年・判断ID・理由を記録','同じ制作物・解消年の確認済み判断を照合|不整合があれば年度資料の採用を拒否','','ledger'],
 ['record',250,655,620,110,'年度採用 → immutable資料 → Markdown / JSON','元の問いと解消理由を同じ資料に残す','解消後は繰越対象から外す|費用化・振替等の残高移動は別に記録','','outputs']
],[
 ['input','save','作業中保存','r','l'],
 ['save','branch','指定年で計算'],
 ['branch','carry','未解消','b','t',[[840,340],[840,385],[280,385],[280,435]],380,378],
 ['branch','resolved','解消あり'],
 ['carry','record','未判断も保存'],
 ['resolved','record','根拠付きで保存']
])+diagram('G4. 残高draft保存の通信断・再送・別更新',850,[
 ['edit',25,25,510,110,'React / BalancesPage','入力と保存元の版に要求UUIDを割り当てる','通信結果不明の再試行は同じUUID|内容変更・成功後・再読込で次の要求へ','','api'],
 ['read',585,25,510,110,'PUT draft → BEGIN IMMEDIATE','要求IDの成功記録があるか','IDに対応するhashと保存後revisionを読む|APIのUUIDを検証','branch','data'],
 ['old',585,240,510,110,'成功記録あり','同じ内容か、保存後に別更新があるか','内容変更400|成功後の別更新409（保存成功済みと明示）','branch','data'],
 ['new',25,240,510,110,'成功記録なし','expectedRevisionが現在の版と一致するか','古い版409|一致なら残高と成功記録を一括commit','branch','data'],
 ['saved',25,460,510,110,'SQLite','残高保存と成功記録は両方成功する','片方の失敗でrollback|成功記録はID・hash・版番号のみ','','data'],
 ['replay',585,460,510,110,'同一要求かつ同じ保存後の版','保存済み結果を返す','再書込・版番号増加なし|サーバー再起動後も認識','','outputs'],
 ['ui',250,675,620,110,'HTTP → React','成功なら入力を保存済みへ更新','409は入力を残し最新資料の確認へ|通信結果不明は同じ要求で再試行','','api']
],[
 ['edit','read','保存要求','r','l'],
 ['read','old','あり'],
 ['read','new','なし','b','t',[[840,135],[840,190],[280,190],[280,240]],380,183],
 ['new','saved','版一致'],
 ['old','replay','同内容・同版'],
 ['saved','ui','保存成功'],
 ['replay','ui','成功応答']
])+diagram('G5. 残高競合の3版比較と選択',820,[
 ['conflict',25,25,510,110,'PUT draft / 409 → React','入力と編集開始時の保存内容を保持','最新との比較を利用者が選択|読取失敗でも元の入力は維持','','api'],
 ['read',585,25,510,110,'GET draft → mergeBalanceDrafts','変更前・自分の入力・最新をIDで比較','別記録の変更と同一変更は両立|記録の並び順で対応付けない','','ledger'],
 ['branch',585,235,510,110,'BalanceConflictPanel','同じ記録に異なる変更があるか','削除対更新・同じIDの異なる追加も競合|振替両側・金額・理由・解消を一件で扱う','branch','ledger'],
 ['choose',25,440,510,110,'React / 3列の内容比較','残す側を記録ごとに選択','全競合の選択が必要|閉じれば元の入力を保持','','api'],
 ['apply',585,440,510,110,'選択結果を編集へ戻す','最新の版を保存元として編集を継続','この操作では保存しない|参照・日別残高等の不整合は修正する','','ledger'],
 ['save',250,655,620,110,'作業中の残高を保存 → 版照合','保存直前に再更新があれば再び409','再比較は新しい3版で行う|通信結果不明は同じ要求で再送','','data']
],[
 ['conflict','read','比較を開始','r','l'],
 ['read','branch','内容照合'],
 ['branch','choose','異なる変更','b','t',[[840,345],[840,390],[280,390],[280,440]],380,383],
 ['branch','apply','競合なし'],
 ['choose','apply','全件選択','r','l'],
 ['apply','save','内容確認後に保存']
])+diagram('G6. DB全体のバックアップ・検証・復元基盤',830,[
 ['source',25,25,510,110,'CLI create / read-only SQLite','DB全体と既存identifier-saltを取得','VACUUM INTOでWALも一貫したsnapshotへ|salt欠損を新規設定で補わない','','data'],
 ['stage',585,25,510,110,'新規stage / dataBundle','整合性・参照・hash・schemaを検証','DBとsaltのSHA-256/サイズ|integrity_check・foreign_key_check','branch','data'],
 ['publish',585,235,510,110,'新規フォルダへrename','manifest・説明文・DB・saltを公開','既存保存先は拒否|途中失敗はstageを除去','','outputs'],
 ['verify',25,435,510,110,'CLI verify / strict manifest','破損・未知の版や項目を拒否','schemaとuser_version/application_idも照合|出所の署名検証ではない','','ledger'],
 ['restore',585,435,510,110,'CLI restore / restoreDataBundle','現行の空DBとschema照合して新規展開','コピー後に再hash照合・既存DBは上書きしない|復元保留を付けて元source rootとIDを保持','','data'],
 ['remaining',250,655,620,110,'Node / Release同梱CLI','配布版から復元・再接続','npm run data:backup / data:reconnect|新保存先を指定して起動、画面で再接続確認','','api']
],[
 ['source','stage','snapshot作成','r','l'],
 ['stage','publish','検証成功'],
 ['publish','verify','持出し後の検査','b','t',[[840,345],[840,385],[280,385],[280,435]],380,378],
 ['verify','restore','schema適合','r','l'],
 ['restore','remaining','起動は行わない']
])+diagram('G7. 復元sourceの再接続・保留解除・走査再開',820,[
 ['preview',25,25,510,110,'React / GET または CLI preview','全source ID・元root・enabledを確認','復元保留情報・source設定・識別子をhashで結ぶ|新しいJSONへ計画を出力','','api'],
 ['edit',585,25,510,110,'利用者 / 再接続画面または計画JSON','同じ元履歴の接続先と走査対象を指定','原本不在はenabled=false|全source IDを一度ずつ残す','','ledger'],
 ['check',585,230,510,110,'POST / 操作キュー または CLI apply','確認後の変更・重複・接続可否を照合','古いhash・ID不足・重複は拒否|有効な接続先は読取可能なフォルダ','branch','data'],
 ['commit',25,435,510,110,'SQLite transaction','元IDを保ってrootとenabledを更新','変更sourceのcacheだけ無効化|数値資料・採用履歴は保持、receiptも原子保存','','data'],
 ['release',585,435,510,110,'commit後 / 保留ファイル解除','走査保留を解除する','解除失敗は保留のまま、同じ計画で再試行|別の復元を古い成功記録で解除しない','','api'],
 ['scan',250,655,620,110,'通常の手動走査・起動時設定','同じsource IDと識別子で走査を再開','CLI apply自体は走査しない|再起動しても明示した接続先を保持','','outputs']
],[
 ['preview','edit','接続先の確認','r','l'],
 ['edit','check','計画を適用'],
 ['check','commit','確認一致','b','t',[[840,340],[840,385],[280,385],[280,435]],380,378],
 ['commit','release','原子保存成功','r','l'],
 ['release','scan','保留解除後']
])+diagram('G1. 残高の保存・年度計算・固定版の読取',910,[
 ['boot',25,25,510,105,'Node / getDatabase','既存DBに残高表・再送記録表があるか','なければ検証済みbackup後に表と保護triggerを追加|初期化transactionの失敗はrollback','','data'],
 ['input',585,25,510,105,'React / BalancesPage → HTTP','期首・増減・振替を入力して保存','snapshotとexpectedRevision|UI・API両方で構造と計算を検証','','api'],
 ['check',585,230,510,105,'Zod + annualBalances','構造・日付・参照・金額が整合するか','既知/未知・単一振替・日別非負・整数円を検証|外部参照の問題は下書き保存を止めず、読取・画面で表示','branch','ledger'],
 ['draft',25,425,510,105,'SQLite / BEGIN IMMEDIATE','作業中残高を版付きで保存','版を再照合してbalance_draftへ一括保存|古い版409・不正400・途中失敗rollback','','data'],
 ['reject',585,425,510,105,'HTTP / 400 または 409','保存せず理由を返す','不正構造・金額・日付・参照・古い版|保存済みの入力は維持','partial','api'],
 ['preview',25,635,510,110,'React / annualBalances と GET preview','指定年の期首・増減・期末を計算','UIは保存済みまたは編集中draftから計算|APIは同じ読取snapshotの費用・判断・利用量もhashに含める','','ledger'],
 ['review',585,635,510,110,'GET reviews / repository','保存済み採用版を検証して読取','content hash・schema・IDを照合|費用・判断を含む保存版も元の結果のまま返す','','outputs'],
 ['limit',250,805,620,80,'未接続の責務','金額の由来・処理条件・後年度差額・相談回答','費用基礎を残高へ自動コピーしない','partial','ledger']
],[
 ['input','check','入力検証'],
 ['check','draft','整合','b','t',[[840,335],[840,380],[280,380],[280,425]],380,373],
 ['check','reject','不正・競合'],
 ['boot','draft','schema準備'],
 ['draft','preview','保存済み入力'],
 ['preview','limit','draftの計算範囲'],
 ['review','limit','読取のみ']
])+
diagram('G2. 年度資料の確認・採用・訂正・再送',1010,[
 ['preview',25,25,510,110,'GET preview / SQLite読取snapshot','保存する資料一式を取得','料金・計画・利用量・費用結果・残高・参照確認|全入力と計算結果を確認hashへ結び付ける','','api'],
 ['screen',585,25,510,110,'React / ReviewAdoptionPanel','費用・未算定・判断・残高を確認','未保存・競合中の残高からは進めない|理由を入力して年度資料として保存','','ledger'],
 ['request',585,235,510,110,'POST reviews / Fastify + Zod','CSRF・Origin・入力形式を検証','year・残高版・hash・理由・UUID要求キーのみ|ブラウザから資料本体は受け付けない','branch','api'],
 ['read',25,435,510,110,'BEGIN IMMEDIATE / readReviewMaterials','保存対象を再読取して照合','同一要求の成功済み再送は既存版を返す|新規要求はhash・参照・前年期末・過年度根拠を照合','branch','data'],
 ['reject',585,435,510,110,'HTTP 400 / 409','不正・古い確認・参照問題・前年不整合','書込せずrollback|画面は理由を残して再確認へ戻る','partial','api'],
 ['commit',25,650,510,110,'SQLite / immutable payload + head','費用・判断・残高を一つの資料に固定','新規年度は初版、同年は訂正元IDを保持|元の保存版は更新・削除しない','','data'],
 ['result',585,650,510,110,'HTTP + React','保存した資料IDを表示','結果不明なら同じ内容と要求キーで再送|保存版に固定したダウンロードへ接続','','outputs'],
 ['limit',250,860,620,100,'記録の固定と税務検証を区別','未算定・未登録も理由と状態を保存','taxTreatmentVerified=false|金額の由来・適用条件・後年度差額は別途検証','partial','ledger']
],[
 ['preview','screen','確認資料','r','l'],
 ['screen','request','理由付き保存'],
 ['request','read','正当な要求','b','t',[[840,345],[840,390],[280,390],[280,435]],380,383],
 ['request','reject','不正'],
 ['read','reject','確認不一致','r','l'],
 ['read','commit','確認一致'],
 ['commit','result','commit成功','r','l'],
 ['result','limit','保存の意味'],
 ['commit','limit','固定範囲']
])+
table(['残高APIの契約','保存と計算','未完了の責務'],[
 ['作業中の入力','残高専用revision。GETで読取、PUTで旧版拒否・原子保存。workspaceの料金/計画の版とは別。','入力UIは期首・増減・振替・未判断の登録と解消に接続。UUID・hash・保存後revisionのreceiptを同じtransactionで記録。同一要求・同一保存後版の再送は再書込しない。共通費用と残高の一括commitは未接続。'],
 ['年次preview','保存済みdraft、当年・前年head、料金・計画・観測を同じ読取snapshotで読む。ReviewMaterialsに費用結果・判断・数値利用量・走査時点を含め、全体を確認hashへ結び付ける。','repositoryは資料一式をBEGIN IMMEDIATE内で再読取し、同じhashの内容だけ固定保存できる。UI・POSTで資料一式の採用へ接続。税務条件・金額の由来の検証は未接続。'],
 ['入力画面の保持','Appで一度開いたBalancesPageを主画面移動時も保持する。背景の計画更新ではdraftを置換しない。競合409は入力を残して保存を停止する。','利用者が入力破棄・保存済み再読込を明示的に選べる。残高の3版比較を接続。全競合の記録単位選択後、最新の版を保存元として編集へ戻す。残高の編集中入力は同じブラウザ・接続先の控えから復旧し、最新と比較できる。料金・計画の編集中入力も同じ接続先の控えから復旧する。復旧後の保存時に最新内容を比較する。'],
 ['過年度資料との整合','採用時に前年から接続済みの過年度版をたどり、各年の費用結果・直接費/自宅費用/関係設備・判断・根拠・利用量・引継いだ未判断を現在と照合する。残高同額でも不一致なら対象年を示して409。','workspace版や最新の走査日時だけは過年度の内容変更としない。当該年に関係しない未来の入力も除外。税務適用条件の妥当性・金額の由来そのものを自動証明するものではない。'],
 ['年度資料の採用・訂正','ReviewAdoptionPanelは残高の未保存・競合を解消後にpreviewを取得し、費用明細・残高小計・判断・全入力を表示。理由を添えて保存する。CSRF、hash、参照、前年整合をサーバーで再照合。','確認後の変更は409でpreviewを破棄。通信結果不明の再送は同じUUIDを使う。訂正は旧版を保持。これは記録の固定であり、税務適用条件の検証完了ではない。'],
 ['保存済み各年への影響','GET impactは各年の現行headだけを選び、同じ時点の入力と観測で各年を再計算して比較する。期首・期末の差額は両方が既知の場合だけ表示。過年度訂正の未反映を併記。','旧版の結果は再計算しない。単独の変更原因の推定、税務方式による差額、未保存入力の影響は対象外。未登録の将来年度は生成しない。'],
 ['固定版と現在の比較','GET compareで指定年の旧保存版と現在の保存済みdraft・費用・判断・観測を一貫した読取で比較。IDで対応付け、追加・削除・項目変更と前後の値をすべて返す。画面は変更箇所を展開して確認できる。','未保存入力は比較に含まない。旧版にない費用・判断は比較不可。現在の記録による各保存年の差額と訂正操作は接続。税務方式から後年度への差額を自動生成する処理は未接続。'],
 ['固定版の出力','ReviewRecordsPanelで資料一覧を読み、資料IDを指定してMarkdownまたはJSONを保存。Markdownは費用・判断・残高の説明と全JSONを含む。旧版の不足は補完しない。','GET exportは検証済みの保存payloadだけから生成。現在の料金・計画・観測を読み直さない。全プロジェクトのbackup・復元ではない。'],
 ['固定版の読取','一覧に現行版・前年訂正の未反映を表示。個別版は保存済みprojectionを返す。','採用writeはPOST /api/balances/reviews。合成試験では資料一式の固定・再送・元資料変更後の保持を検証。資料付き版を残高だけの版へ退行させない。後年度への費用変更の意味の照合は未完了。'],
 ['判断記録の登録','月次確認の費用画面でDecisionEditorが扱い・根拠・確認先を編集。本人確認を操作すると確認日時を記録し、内容の編集でpendingへ戻す。workspaceの保存・競合・previewを通る。','manual-decision/1は人が記録した扱い。税務条件の自動判定・採用版の固定ではない。旧版の不完全なconfirmedは保持するが、確認済み選択肢から外す。'],
 ['入力と根拠','未知の期首は理由を必須化。移動は根拠IDと判断ID・理由を必須化。残高内の参照を検証する。','GET draft/previewはworkspaceと同じ読取snapshotで制作物・資料の存在、参照衝突、判断の確認状態・年・制作物を検査。referenceCheckに問題とworkspaceRevisionを返す。金額の由来・適用条件は未照合。']
])+'<p class="refs">'+ref('src/accounting/balanceSchema.ts')+' '+ref('src/core/annualBalances.ts')+' '+ref('src/server/balanceRepository.ts')+' '+ref('src/server/balanceRoutes.ts')+' '+ref('src/client/pages/BalancesPage.tsx')+' '+ref('src/accounting/balanceWorkspace.ts')+' '+ref('src/client/pages/DecisionEditor.tsx')+' '+ref('src/core/decisionConfirmation.ts')+' '+ref('src/core/balanceReferences.ts')+' '+ref('src/server/reviewMaterials.ts')+' '+ref('src/accounting/reviewMaterials.ts')+' '+ref('src/core/reviewExport.ts')+' '+ref('src/client/pages/ReviewRecordsPanel.tsx')+' '+ref('src/core/reviewComparison.ts')+' '+ref('src/client/pages/ReviewComparisonPanel.tsx')+' '+ref('src/client/pages/ReviewAdoptionPanel.tsx')+' '+ref('src/core/reviewHistory.ts')+' '+ref('src/client/pages/RestoreSourcesPanel.tsx')+' '+ref('src/server/restoreSources.ts')+' '+ref('scripts/restore-sources.ts')+' '+ref('src/server/dataBundle.ts')+' '+ref('scripts/data-backup.ts')+' '+ref('src/core/balanceMerge.ts')+' '+ref('src/client/pages/BalanceConflictPanel.tsx')+' '+ref('src/client/pages/PendingBalanceEditor.tsx')+'</p>';
