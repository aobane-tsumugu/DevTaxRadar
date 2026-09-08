const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const esc = s => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const refs = new Map();
function ref(file, symbol='') {
  const lines = fs.readFileSync(path.join(root,file),'utf8').split('\n');
  const line = symbol ? lines.findIndex(s=>s.includes(symbol))+1 : 1;
  if (!line) throw Error('Missing reference '+file+' '+symbol);
  refs.set(file+':'+line,{file,line,symbol});
  return `<a class="source" href="../../${file}" title="${esc(symbol || file)}">${esc(file)}:${line}</a>`;
}
const table = (heads,rows) => `<div class="table-wrap"><table><thead><tr>${heads.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map((v,i)=>`<${i===0?'th scope="row"':'td'}>${v}</${i===0?'th':'td'}>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const note = (s,kind='')=>`<div class="note ${kind}">${s}</div>`;
const tag = (s,kind='')=>`<span class="tag ${kind}">${s}</span>`;
let diagramN=0;
// Each node carries its execution owner; every edge direction is explicit.
function diagram(title,height,nodes,edges,bands=[]) {
  const id='figure-'+(++diagramN);
  const byId = Object.fromEntries(nodes.map(n=>[n[0],n]));
  function point(n,side) {const [,x,y,w,h]=n; return side==='t'?[x+w/2,y]:side==='b'?[x+w/2,y+h]:side==='l'?[x,y+h/2]:[x+w,y+h/2];}
  return `<figure id="${id}"><figcaption>${title}<span>各ノードを選択すると関連章へ移動</span></figcaption><div class="diagram-scroll" tabindex="0" aria-label="${esc(title)}の図。狭い画面では横スクロールできます"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1120 ${height}" width="1120" height="${height}" role="img" aria-labelledby="${id}-title"><title id="${id}-title">${esc(title)}。矢印に条件、ノードに実行主体を記載。</title><defs><marker id="${id}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b"/></marker></defs>${bands.map(([y,h,label])=>`<rect x="10" y="${y}" width="1100" height="${h}" rx="8" fill="#f0f4f8"/><text x="24" y="${y+23}" class="band-label">${esc(label)}</text>`).join('')}${edges.map(e=>{const [from,to,label='',s='b',t='t',via,tx,ty,dashed]=e;const a=point(byId[from],s),b=point(byId[to],t);const p=via||[a,b];const lx=tx??(a[0]+b[0])/2,ly=ty??(a[1]+b[1])/2-7;return `<polyline points="${p.map(v=>v.join(',')).join(' ')}" fill="none" stroke="#64748b" stroke-width="1.8" ${dashed?'stroke-dasharray="6 5"':''} marker-end="url(#${id}-arrow)"/>${label?`<text x="${lx}" y="${ly}" text-anchor="middle" class="edge-label">${esc(label)}</text>`:''}`}).join('')}${nodes.map(([key,x,y,w,h,owner,title,body,kind='',target=''])=>`<a href="#${target}" aria-label="${esc(title+' / '+owner)}"><g class="node ${kind}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8"/><text x="${x+15}" y="${y+22}" class="node-owner">${esc(owner)}</text><text x="${x+15}" y="${y+47}" class="node-title">${esc(title)}</text>${body.split('|').filter(Boolean).map((l,i)=>`<text x="${x+15}" y="${y+70+i*19}" class="node-body">${esc(l)}</text>`).join('')}</g></a>`).join('')}</svg></div></figure>`;
}
const sections=[];
function section(id,no,title,lead,body){sections.push({id,no,title,html:`<section id="${id}"><header class="section-head"><span>${no}</span><div><h2>${title}</h2><p>${lead}</p></div></header>${body}</section>`});}

require('./purpose-and-redesign.cjs')({section,table,note,tag,ref,diagram});

section('status','01','現在地と設計図の読み方','DevTaxの現行コードから、実行される経路と実装の接続範囲を描く。',
note('<strong>確認基準：2026-09-08 / HEAD d917885 / package 0.1.0</strong><br>以下の現行経路は、このHEADに未コミットのv0.5改訂を含む作業ツリーを基準とする。共通費用計算、残高入力・照合、年度資料の採用・訂正・出力、入力復旧、backup/restoreを接続済み。限定した設備年額計算と前年照合も含む。全費用の税務処理生成と全体受入は未完了。個人DB・公開デモの配信版の状態は示さない。検証の実施範囲はCURRENT.mdの各記録を参照。')+
`<div class="legend">${tag('接続済み','live')}${tag('分岐・保留','branch')}${tag('コードあり／接続限定','partial')}${tag('構想・未実装','planned')}</div>`+
table(['領域','現在の姿','実装根拠'],[
['現在の主な機能','Claude Code／Codexの定額料金を、履歴の利用量を配賦基準として制作物別に説明する。利用者が制作物・作業期間・費用・証拠を登録し、処理候補と不足情報を確認する。製品の目的全体はP1を参照。',ref('README.md')],
['ランタイム','React 19 + Vite 8 + TypeScript 6。Node.js 24.14以上 + Fastify 5 + node:sqlite。実行中のLLM呼出しやクラウド推論工程はない。Claude／Codexは履歴の生成元。',ref('package.json')],
['主経路','1台の集約PCが既定のローカル履歴と、OSから読める追加履歴フォルダを走査。DB・分類・料金・証拠メモの更新主体はそのPC。端末同士の同期はない。',ref('src/server/historySources.ts','async function executeHistoryScan')],
['最新の利用手順','履歴 → 候補整理 → 制作物 → 費用 → 結果。申告方式は先に決めさせず、雑所得／事業白色／事業青色の条件比較を結果に表示。',ref('src/client/pages/Onboarding.tsx',"const steps =")],
['記録済みの検証','既存証跡には8月22日時点で41ファイル・312テストの成功、ブラウザ受入済みとある。現在の追加ファイルと実行結果はv0.5検証記録で管理する。過去の成功記録であり、v0.5修正の追加検証はdocs/evidence/v05-revision/CURRENT.mdを参照。',ref('docs/evidence/product-planning-redesign/CURRENT.md')],
['資料の鮮度','PRODUCT_SPECとTECHNICAL_DESIGNはv0.5の採用設計へ更新。CURRENT.mdは過去証跡として保持。目標仕様と実装状態を分け、現行経路はsrcを基準に記述。',ref('TECHNICAL_DESIGN.md')]
])+
note('図中の数値・日付ルールは<strong>このコードが何をするか</strong>の説明。税制の現行適合性を認証する資料ではない。詳細な税務決定木と金額境界モジュールについては、実際の画面経路との未接続も併記する。','branch'));

section('topology','02','全体構成とデータの流れる境界','利用者・ブラウザ・集約PC・履歴フォルダ・公開配布を分ける。',
diagram('A. ローカル製品の全体構成',680,[
 ['user',30,50,300,100,'利用者 / ブラウザ','React UI','候補整理・料金・期間・証拠入力','','onboarding'],
 ['api',410,50,300,100,'集約PC / Node.js','Fastify API','127.0.0.1:4317 / CSRF保護','','api'],
 ['db',790,50,300,100,'集約PC / node:sqlite','SQLite + identifier-salt','設定・台帳・集約済み利用量','','data'],
 ['local',30,250,300,110,'履歴生成元 / Claude・Codex','既定ローカル履歴','~/.claude/projects|~/.codex/sessions','','adapters'],
 ['scan',410,250,300,110,'集約PC / Node filesystem','走査 → Adapter → 集約','ファイル単位キャッシュ|走査元単位の更新','','scan'],
 ['share',790,250,300,110,'OSの共有接続 / SMB等','追加した履歴フォルダ','UNC・マウント済みパス|共有認証・マウントはOSが担当','','sources'],
 ['dash',30,470,300,115,'集約PC / 純粋関数＋投影','共通の年別費用projection','AI・設備・自宅・直接費|原額・基礎・寄与・未算定','','allocation'],
 ['plan',410,470,300,115,'集約PC / 純粋関数＋DB','診断・残高・年度採用資料','作業版を計算・照合|確認内容は別の固定版へ保存','','ledger'],
 ['export',790,470,300,115,'Node API → ブラウザ','作業中資料／採用版の出力','費用・根拠・判断・残高|固定版はMarkdown / JSON','','outputs']
],[
 ['user','api','HTTP JSON','r','l'],['api','db','読取／保存','r','l'],
 ['local','scan','読み取りのみ','r','l'],['share','scan','読み取りのみ','l','r'],
 ['scan','api','走査結果','t','b'],
 ['db','plan','DB snapshot','b','r',[[940,150],[1102,150],[1102,420],[745,420],[745,527],[710,527]],1010,410],
 ['scan','dash','利用量＋設定','b','t',[[560,360],[560,402],[180,402],[180,470]],295,394],
 ['dash','plan','費用・寄与','r','l'],['plan','export','同じ版から生成','r','l'],['api','user','再読込で表示','t','t',[[560,50],[560,15],[180,15],[180,50]],370,11]
])+
table(['実行場所','何が動くか','読取・書込先／接続範囲'],[
['利用者のブラウザ','App.tsxと各ページ。入力draft、画面フィルター、診断プレビュー、ダウンロード。','実データモードでは同一originの /api を呼ぶ。公開originは合成データ。'],
['集約PCのNode.js','Fastify、Zod、走査キュー、filesystem Adapter、DB repository、配賦・診断・台帳。','原本JSONLは読取専用。SQLiteとsaltをローカル保存。任意操作のみClaude設定を書換え。'],
['他PC／NAS等','Claude Code／Codexが履歴を生成。共有サービスはOS側。','DevTax専用エージェント・秘密鍵・常駐クライアントは配置しない。追加フォルダの本文プレビューは提供しない。'],
['GitHub Actions','ソース取得、依存固定インストール、品質検査、タグ時のRelease生成。','合成fixtureだけを使用する定義。個人の履歴・DBを渡す経路はない。'],
['Cloudflare Pages','distの静的HTML／JS／CSSを配信。','ローカルNodeサーバー、SQLite、履歴走査は稼働しない。手動Direct Upload。']
]));

section('startup','03','起動・モード判定・再読込','自動走査は起動時の一回。画面のポーリングと、履歴の再走査を区別する。',
diagram('B. 起動から初回案内まで',710,[
 ['entry',35,35,310,95,'起動コマンド / Node','APIを起動','dev:api または npm start','','delivery'],
 ['migrate',405,35,310,95,'database.ts / SQLite','DBを開く・スキーマ移行','WAL / 必要時の検証済みbackup','','data'],
 ['listen',775,35,310,95,'Fastify','loopbackでlisten','既存distがあれば静的配信','','api'],
 ['autoscan',775,205,310,105,'起動後 / バックグラウンド','AUTO_SCAN ≠ 0 ?','Yes: enabled走査元を増分走査|No: 保存済みデータで開始','branch','scan'],
 ['host',35,205,310,105,'ブラウザ / isLocalRuntime','ローカル実データモードか','loopback ＋ mode≠demo','branch','startup'],
 ['demo',35,395,310,105,'ブラウザ / 合成fixture','明示的な合成デモ','公開origin / mode=demo|API探索・永続保存なし','partial','outputs'],
 ['runtime',405,205,310,105,'ブラウザ → API','runtime・画面データを取得','CSRF / GET workspace|同版の入力・集計・診断','','api'],
 ['poll',405,395,310,105,'ブラウザ / 250ms間隔','起動走査の進捗を待つ','完了後に画面データを再読込|5分でloading解除、監視は継続','','startup'],
 ['error',35,570,310,105,'React / 読込エラー','再読込を案内する','合成金額へ置き換えない|ボタンで初期読込を再実行','branch','startup'],
 ['ready',775,570,310,105,'React / 自動初回案内','実データ画面を表示','料金なし または session数0|なら初回案内を一度表示','','onboarding']
],[
 ['entry','migrate','','r','l'],['migrate','listen','','r','l'],['listen','autoscan'],
 ['host','runtime','Yes','r','l'],['host','demo','No'],['runtime','poll','取得成功'],
 ['runtime','error','API取得失敗','b','t',[[560,310],[560,352],[370,352],[370,535],[190,535],[190,570]],436,342],
 ['poll','ready','完了後refresh','r','t',[[715,447],[930,447],[930,570]],829,437],
 ['autoscan','poll','progress応答','b','r',[[930,310],[930,354],[750,354],[750,447],[715,447]],824,345]
])+
table(['操作／条件','実行プロセス','結果・留意点'],[
['開発起動','npm run dev → concurrently → tsx watch + Vite。5173の /api を4317へproxy。','ブラウザとAPIを別プロセスで動かす。PORT変更時はViteの固定proxy先との整合が必要。'],
['通常ローカル起動','npm run build → npm start。ソース版startはtsx。Release版startはbundle済みindex.mjs。','APIサーバーがdistも配信し、通常は4317の1ポート。'],
['起動時DB処理','getDatabase → 必要なら移行backup → BEGIN IMMEDIATE → schema作成・移行 → COMMIT。','移行失敗時はROLLBACK。初期化／listen失敗時はエラー記録しexitCode=1。'],
['自動走査','listen成功後、DEVTAX_RADAR_AUTO_SCAN が文字列 0 以外ならscanHistorySources。','定期スケジューラやfilesystem watchではない。手動走査は別トリガー。'],
['初期画面読込','runtime成功後refreshUsageViews。起動走査progressは250msごと。','失敗時はエラーと再読込。合成データへ切替えない。起動待ち5分でloading解除し、完了またはunmountまで監視。'],
['手動走査の表示','Onboardingがbusyかつ履歴ステップ中にprogressを700msごと取得。','ポーリング失敗は表示を壊さず、走査本体の成功／失敗通知を優先。'],
['ルール変更後','POST /workspace/previewで期間・配分の影響を確認し、hash付きPUT /workspaceで料金と変更後planningを一括保存。返却された同版の集計・診断で更新しfoldersを再取得。','履歴原本を読み直さず再分類。画面の単なるProvider／制作物フィルターはDBを書き換えない。'],
['計画変更後','PUT /workspace → 同じtransactionで計画・料金・集計・診断を返す。','診断文や配賦結果をDBに固定保存する処理ではない。']
])+`<p class="refs">${ref('src/App.tsx','const startupDeadline')} ${ref('src/server/index.ts',"await app.listen")} ${ref('src/client/dashboard.ts','export function isLocalRuntime')} ${ref('vite.config.ts')}</p>`);

section('onboarding','04','利用者のワークフローと保存点','5段階の各ステップで、入力・分岐・保存されるものを特定する。',
diagram('C. 候補整理から結果確認への流れ',450,[
 ['s1',20,35,200,115,'利用者＋走査API','1 履歴','走査元を選ぶ|増分／全走査','','scan'],
 ['s2',240,35,200,115,'利用者＋React','2 候補整理','全候補を仕分け|グループ番号で統合','','grouping'],
 ['s3',460,35,200,115,'利用者＋React','3 制作物','用途・開発段階|出来事・完成条件','','diagnosis'],
 ['s4',680,35,200,115,'利用者＋React','4 費用','請求・設備等|按分・証拠','','ledger'],
 ['s5',900,35,200,115,'React＋API','5 結果','3申告条件の比較|現在地・不足情報','','outputs'],
 ['draft',240,280,350,110,'途中保存 / PUT workspace','料金と計画を一括保存','候補整理中はルールと制作物を生成|料金・請求履歴の入力も保存対象','branch','data'],
 ['final',680,280,420,110,'最終保存 / preview → PUT workspace','影響確認 → hash照合 → 一括保存','一つのtransaction。保存・計算失敗は|料金・計画・版番号をまとめて戻す。','branch','api']
],[
 ['s1','s2','走査完了','r','l',undefined,230,24],['s2','s3','整理','r','l',undefined,450,24],['s3','s4','名称確認','r','l',undefined,670,24],['s4','s5','保存成功','r','l',undefined,890,24],
 ['s2','draft','途中保存'],['s3','draft','途中保存','b','r',[[560,150],[560,220],[622,220],[622,335],[590,335]],610,210],
 ['s4','final','必須項目と料金確認後'],['final','s5','再集計結果','r','b',[[1100,335],[1110,335],[1110,200],[1000,200],[1000,150]],1035,193]
])+
table(['段階','利用者が決めること','内部処理／動かすもの','分岐と保存点'],[
['1 履歴','Claude／Codex、走査元、増分／全走査、任意の保持日数変更。','HistorySourceManager + scanHistory API。既定ローカルと追加sourceを区別。','選択providerなし／enabled sourceなしなら進行を止める。読めないsourceがあっても正常sourceを更新し、注意表示して候補整理へ。デモは走査せず次へ。'],
['2 候補整理','各履歴候補を制作物／私用／一般学習／あとでに仕分け。同じ番号を付けた候補は同じ制作物。','data.productsの全候補をsession数順に表示。検索は表示だけを絞る。applyCandidateDestinationsでtaxUnits／projectRulesを生成。','制作物番号は正の整数。候補生成だけではDB保存しない。途中保存は料金と計画snapshotをworkspaceへPUT。'],
['3 制作物','正式名称、対象年、自己利用／外部提供／両方、収益化、早期準備／過去整理、状態、旧版、完成条件、実際の出来事。','planningDraftに更新。diagnosePlanningをブラウザ内で再実行してプレビュー。','空の制作物名を拒否。自己利用開始と外部公開は別イベント。段階を変更しても期間分類ルールを自動推定し直す設計ではない。'],
['4 費用','料金の対象期間・実請求額、旧方式の月額／月別額／契約期間、未取得割合。設備・自宅費用・直接費・証拠。','UI検証 → POST workspace/preview → 各年の影響確認 → hash付きPUT workspace → 一括保存。','必須項目不足・逆転日付・不正料金を拒否。料金なしは一度警告し、同じ対象providerへの再操作で確認済み扱い。未取得割合は空欄＝不明、0＝捕捉外なし、正の値＝推定（上限95%）。不明に戻す操作を持つ。'],
['途中保存','それまで入力した料金と計画を保存。','step 1（候補整理）ならグループを実体化後、onSaveWorkspace。','料金・請求履歴・割合も保存する。表示中の履歴月以外の保存済み月別料金も保持。構造不正は入力を残して拒否。デモでは保存しない。'],
['5 結果','保存済みの対象年の全費用、未算定理由、原額と配分、現在地、次の行動、不足事実を確認。','AnnualOverview + CostsPage + diagnosePlanning。data.costProjectionの同じ資料を表示し、編集中の計画は不足情報の確認に使う。','別年・資料未取得をAI額で補わない。合成デモは表示例と明示。申告区分へAI額を同額で並べる旧表示を廃止し、適用条件に基づく処理比較は未接続と示す。']
])+`<p class="refs">${ref('src/client/pages/Onboarding.tsx','async function advance')} ${ref('src/client/pages/Onboarding.tsx','async function saveProgress')} ${ref('src/client/pages/AnnualOverview.tsx')}</p>`);

section('sources','05','走査元の管理と複数PC','自動認証・端末同期ではなく、読めるフォルダを登録するpull方式。',
table(['操作・分岐','処理と条件','データへの影響','実装'],[
['既定source','local-claude／local-codexを初期化。ホーム下の既定パス。','従来salt・既存session/project識別子を維持。既定sourceの更新・削除は409。',ref('src/server/database.ts','export function updateHistorySource')],
['接続テスト','絶対パスを正規化しroot到達性をprobe。JSONLファイルを列挙し件数を返す。','本文のAdapter解析や形式互換性確認、登録、importはしない。共有接続は利用者側で準備。',ref('src/server/historySources.ts','export async function testHistorySource')],
['追加','provider、表示名、絶対root、enabledをZod検証しUUIDで保存。','provider＋正規化rootが重複なら409。登録だけで直ちに走査はしない。',ref('src/server/database.ts','export function createHistorySource')],
['設定変更','追加sourceのみ更新可。providerは変更不可。','root変更はそのsourceのfile cacheだけを失効。既存の集約値は次の正常走査まで残る。',ref('src/server/database.ts','const rootChanged')],
['無効化','enabled=falseで将来の走査対象から除く。','保存済みのusage自体は削除しない。getUsageSessionsは残存usageを取得するため、無効化を過去金額の除外操作と解釈しない。',ref('src/server/database.ts','export function getUsageSessions')],
['削除','追加sourceのみ。source操作キュー内でtransaction。','当該sourceのusage、references、file cache、scans、source設定を削除。元履歴は触らない。制作物・期間ルールの一括削除処理はない。',ref('src/server/database.ts','export function removeHistorySource')],
['同時操作','走査／source追加／更新／削除は同じPromiseキューで直列化。','途中のroot変更や削除とscan commitが競合するのを避ける。全API共通の排他ロックではない。',ref('src/server/historySources.ts','function enqueueSourceOperation')],
['複数PCの同一プロジェクト','追加sourceはsource別salt、OS差を扱うportable project key。','同名フォルダを自動統合しない。別PCの候補を同一taxUnitへまとめるのは利用者の候補整理。',ref('src/adapters/identifiers.ts')]
]));

section('scan','06','増分走査の状態遷移と失敗処理','source全体の失敗と、1ファイルだけの保留は異なる。現行実装の最も重要な分岐。',
diagram('D. 走査元単位・ファイル単位の二段階判定',900,[
 ['start',390,25,340,95,'historySources / 操作キュー','enabled sourceを順番に処理','起動自動 または POST /api/scan','','scan'],
 ['root',390,165,340,100,'Node fs / realpath・opendir','root・全ツリーを列挙できるか','境界外リンク・読取I/Oも検査','branch','scan'],
 ['fail',20,165,305,115,'source単位 / DB','前回正常snapshotを保持','unavailable または failed記録|このsourceを飛ばし次へ','branch','scan'],
 ['cache',390,325,340,105,'ファイルごと / cacheMatches','増分かつfingerprint一致か','size・mtime・adapter・schema|valid cache の全条件','branch','scan'],
 ['reuse',790,325,300,105,'history_file_cache','前回の寄与を再利用','ファイル本文は開かない|filesReusedを加算','','scan'],
 ['parse',390,490,340,100,'Claude / Codex Adapter','ファイル読取・形式と安定性検査','変更あり／新規／全走査で実行','','adapters'],
 ['defer',20,490,305,115,'1ファイル単位 / cache','変更中・形式非互換は保留','旧cacheあり: 旧寄与を残す|なし: 寄与0、次回再試行','branch','scan'],
 ['aggregate',390,650,340,100,'sessionAggregation / Node','寄与を合流・セッション集約','Claudeメッセージ重複除去|source内の全寄与で再構成','','adapters'],
 ['commit',390,800,340,80,'SQLite / transaction','usage＋cacheを原子的に更新','','','data']
],[
 ['start','root'],['root','fail','不可','l','r'],['root','cache','列挙成功'],
 ['cache','reuse','Yes','r','l'],['cache','parse','No / full'],
 ['parse','defer','unstable / incompatible','l','r',undefined,350,473],
 ['parse','fail','I/O失敗: source全体を保持','l','b',[[390,555],[353,555],[353,307],[172,307],[172,280]],177,299],
 ['parse','aggregate','accepted'],
 ['reuse','aggregate','復元した寄与','b','r',[[940,430],[940,700],[730,700]],940,621],
 ['defer','aggregate','旧寄与または0','b','l',[[172,605],[172,700],[390,700]],251,690],
 ['aggregate','commit','成功時のみ保存']
])+
table(['判定点','条件','採用する値／更新','次の挙動'],[
['source選択','enabled＋指定provider。内部関数はsourceIdsも受ける。公開scan APIの入力はprovider配列とmode。','選択sourceを逐次処理。','beginScanが現在source名・providerを進捗へ載せる。'],
['root確認','存在なし／読み取れない。','当該sourceの前回正常値を保持、失敗状態だけ記録。','他sourceを続行。'],
['列挙','canonical root内のみ。realpath既訪問を記録し循環回避。JSONLを対象。','列挙I/O失敗や境界外junction等ならsourceを更新しない。','完全に列挙できない状態で削除差分をcommitしない。'],
['cache key','source別salt＋canonical相対identityのHMAC-SHA256。','DBに実ファイル名をcache keyとして保存しない。','Windowsは相対identityの大文字小文字を正規化。'],
['再利用','incremental＋valid＋size一致＋mtime一致＋Adapter名一致＋schema一致。','events_jsonを復元。localReferenceを持たない。','本文走査とhash再計算を省略。'],
['新規・変更・全走査','上の再利用条件を満たさない。','Adapterがstreamで読む。前後のsize／mtimeを比較。','全走査でも読取安全性・保留条件は維持。'],
['accepted','既知の形式かつusageの整合条件を満たし、前後snapshotが安定。','新規寄与を採用、cache upsertを準備。','既知形式のuser-only／中断履歴等は、正当な利用量0として旧寄与を置換しうる。'],
['unstable / incompatible','読取中変更／既知形式でない／usage必須カウンタ不正。','そのファイルだけvalidな旧cacheを維持。初見なら寄与0。filesDeferred加算。','正常な別ファイルは同じscanで更新できる。古い「source全体拒否」の説明から変更済み。'],
['I/O失敗','ファイルを途中までしか読めない等。','準備した変更も含め、このsource全体の更新を拒否。','次sourceを続行。'],
['見つからなくなったファイル','完全列挙成功時に旧cache keyがseenにない。','そのcacheを削除し、sourceのusageを残る寄与から再構成。','元履歴が消えた後の正常再走査では利用量も減る。履歴の恒久アーカイブではない。'],
['保存','aggregateSessions後、replaceHistorySourceSessions。','usageをsource単位で置換、cache更新／削除、references再構成、scan完了。','transaction失敗はROLLBACK。既定ローカルのcache再利用では過去referenceを引き継ぐ。'],
['増分の検出限界','内容だけ変わってsizeとmtimeが変わらない。','cache再利用では検出できない。','明示的な全走査が必要。mtime条件だけを根拠に「内容不変」と断定しない。']
])+`<p class="refs">${ref('src/server/historySources.ts','async function readSourceIncrementally')} ${ref('src/server/historySources.ts','async function executeHistoryScan')} ${ref('src/adapters/jsonl.ts','async function* walkJsonlFiles')} ${ref('src/server/database.ts','export function replaceHistorySourceSessions')}</p>`);

section('adapters','07','Adapter・識別子・セッションの粒度','ClaudeとCodexは同じJSONLでも読んでいるデータと時間粒度が異なる。',
table(['比較軸','Claude Code','Codex','後段への影響'],[
['入力','messageを持つ既知user／assistant envelope。assistantのusageから利用量を読む。','session_meta、turn_context、event_msg/token_count または直接token_count。','任意のJSONを一律にusageとして取り込まない。'],
['イベント生成','有効usageのメッセージごと。timestamp、cwd、sessionId、message.id等が必要。','ファイル内で最後に受理した累積 total_token_usage を1つ採用。last_token_usage差分の逐次集計ではない。','Codexの累積snapshotを複数回足すことはしない。'],
['重複除去','saltでhashしたmessage idをsource内で重複排除。cacheと新規解析を合流した後も同じ規則。','同一sourceの集約keyで後段に集約。複製ファイルを内容hashで横断排除する工程はない。','別source間はsaltが異なり、同じnative idでも混ざらない。共有した履歴の重複登録にも注意が必要。'],
['月・時刻','各メッセージtimestampをPCのローカル月へ変換。','session_metaのtimestampをローカル月へ変換。累積利用をsession開始月へ帰属。','共通集約器は月またぎ分割できるが、Codex Adapter自体は月別トークン内訳を生成しない。'],
['入力／キャッシュ','input_tokens、cache_read_input_tokens、cache_creation_input_tokens。','input_tokens、cached_input_tokens、cache_write_input_tokensを各フィールドへそのまま移す。','現行コードにはinputからcacheを差し引く処理はない。ここでは実装上の読み方を示す。'],
['出力／推論','output_tokens、reasoning=0。','output_tokens、reasoning_output_tokens。','集約時にoutputへreasoningを加算。後段ではoutput重み3で扱う。'],
['集約行','provider × sessionKey × projectKey × month。started/endedは観測時刻の最小／最大、messageCountを加算。','同じ集約器を通るが、通常1ファイル＝1正規化イベント。','CodexのmessageCountを実際の会話メッセージ数と同一視しない。'],
['品質情報','Adapter名、schema version、confidence B、malformed／unsupported／invalid等の診断。','同様。usage必須カウンタは非負整数。','共通集約のBはmediumへ変換。信頼度は税務上の確定を表さない。'],
['ローカル参照','既定sourceのみ、nativeSessionId／sourcePath／cwd／SHA-256を別参照テーブルへ。','既定sourceのみ同様。','追加sourceはroot設定以外の各原本パスやnative idを保存せず、preview/resume不可。']
])+`<p class="refs">${ref('src/adapters/claude.ts','function normalizeClaudeRow')} ${ref('src/adapters/codex.ts','function consumeTokenSnapshot')} ${ref('src/adapters/codex.ts','function normalizeCodexSession')} ${ref('src/server/sessionAggregation.ts','export function aggregateSessions')} ${ref('src/adapters/localTime.ts')}</p>`+
note('<strong>正規化と保存の2層：</strong> history_file_cacheには本文を除いたファイル寄与（NormalizedUsage）が残る。usage_eventsにはセッション×フォルダ×月の集約行が残る。いずれも原本JSONLのコピーではない。既定ローカルだけがsession_references経由で原本を読み直せる。'));

section('grouping','08','制作物への対応・期間分類・再分類','フォルダを見ただけでは業務目的は確定しない。利用者のルールをセッション開始日に適用する。',
diagram('E. 候補から制作物へ、セッションから分類へ',590,[
 ['c',30,30,305,105,'Dashboard → React','全履歴フォルダ候補','同じsource内のprojectKeyで集約|session数で並べ替え','','grouping'],
 ['dest',400,30,325,105,'利用者 / CandidateDestinations','制作物・私用・学習・あとで','制作物はグループ番号を付ける','branch','grouping'],
 ['unit',790,30,300,105,'candidateGrouping / React','taxUnit＋初期ルールを生成','同じ番号の複数候補を統合|最初の観測日から有効','','grouping'],
 ['rules',790,225,300,110,'利用者 → API → SQLite','期間付きルールを編集・保存','フォルダ／provider／期間|taxUnit／分類／理由','','api'],
 ['session',30,225,305,110,'DB / usage_events','セッション行を取り出す','projectKey・provider|startedAtのローカル日付','','adapters'],
 ['resolve',400,225,325,110,'sessionAssignment / Node','候補ルールを検索し優先順解決','provider指定 → 開始日が新しい|→ idの辞書順が小さい','branch','grouping'],
 ['mapped',400,445,325,100,'dashboard / projection','classificationViewへ渡す','制作物・期間・分類ごとに集計|AI配賦明細の分類になる','','tax'],
 ['none',30,445,305,100,'dashboard / projection','未分類で保持','一致なし／不正な日付|taxUnit・ruleはnull','branch','tax']
],[
 ['c','dest','','r','l'],['dest','unit','制作物等','r','l'],['unit','rules'],
 ['session','resolve','','r','l'],['rules','resolve','保存ルール','l','r'],
 ['resolve','mapped','一致あり'],['resolve','none','一致なし','b','r',[[562,335],[562,383],[355,383],[355,495],[335,495]],380,374]
])+
table(['処理','詳細な規則','保存・影響'],[
['グループ番号','1以上の整数文字列を正規化。同じgroupを選んだ候補が1制作物になる。既存taxUnitIdが指定されていれば再利用。','新規IDはtax-unit-history-group-{group}。代表名はsession数が最大の候補。正式名称・用途等は利用者が確認。'],
['新規候補の既定値','unitType=new-software、状態developing、journeyMode=retrospective、用途／収益モデルundecided。','初期分類はnew-development。履歴内容をLLMが判定した結果ではない。'],
['期間開始','firstObservedAtの日付文字列 → なければ最初の観測月の1日 → なければ対象年1月1日。','現行candidateGroupingはtimestamp.slice(0,10)を使う。分類解決はローカル日付なので時差境界の差を設計上認識する。'],
['私用・一般学習','taxUnitを必須としない期間ルールを生成。','該当利用量は消さず、配賦で私用bucket／reviewへ残す。'],
['あとで','そのprojectの最初のeffectiveFromにあるルールを除く。後から始まる期間ルールは残す。','全期間を未分類に初期化する動作とは異なる。'],
['ルール適用','projectKey一致、provider未指定または一致、開始日以上、終了日以下（両端含む）。','重複はprovider指定を優先し、開始日降順、id昇順で決定。ルール重複自体を一律拒否しない。'],
['配賦明細から変更','選択明細のmonthKeyの1日を開始日としたruleを保存。taxUnitIdを引き継ぐ。','単一セッションだけの上書きではない。既存終了日がなければ終了期限なしで後続期間にも作用する。'],
['再走査との関係','参照は安定したprojectKey＋日付。usage_eventsの自動採番idを分類キーにしない。','再走査で行を置換しても期間分類を再適用できる。source削除後にルールが残る場合は用途を別途確認。']
])+`<p class="refs">${ref('src/client/candidateGrouping.ts','export function applyCandidateDestinations')} ${ref('src/server/sessionAssignment.ts','export function resolveSessionAssignment')} ${ref('src/App.tsx','async function reclassifyAllocation')}</p>`);

section('allocation','09','料金の期間分割・契約判定・AI配賦','利用量は実請求額そのものではなく、利用者が入力した料金を振り分けるための重み。',
diagram('F. 日付付き請求と旧月額方式の合流',870,[
 ['config',400,20,320,100,'DB / provider別','そのproviderにchargePeriodsあり?','利用期間・請求日・実請求額','branch','allocation'],
 ['period',30,190,470,110,'chargePeriods / 純粋関数','日付付き料金を暦月へ日割り','開始・終了両日を含む日数比|端数は剰余の大きい月、同値なら早い月','','allocation'],
 ['legacy',620,190,470,110,'dashboard / 旧設定互換','月別額 → なければ基本月額','契約と交差する履歴月・明示請求月|日付付き料金のあるproviderでは使わない','','allocation'],
 ['sessions',30,375,470,115,'Node / 契約・期間解決','利用対象期間内のセッションを抽出','開始日のローカル日付で判定|期間外は分母から除き0円明細へ','branch','allocation'],
 ['weight',620,375,470,115,'allocation / 純粋関数','provider内で加重利用量を計算','入力1 / cache読取0.25 / cache作成1|出力3（集約時に推論を含める）','','allocation'],
 ['ready',380,555,360,110,'allocation / 純粋関数','割合が既知、かつ捕捉量 > 0 ?','保存nullは不明 / 0は捕捉外なし|正の値は入力された推定率','branch','allocation'],
 ['money',30,720,470,115,'allocateSubscriptions → assertAllocationInvariant','配分 → 各行切捨て → 端数調整','請求行×暦月の円額を保存。|私用・未分類も分母に保持。','','tax'],
 ['pending',620,720,470,115,'core → dashboard → React','配分未算定として支払額を保持','割合はnull / 配分額を生成しない|全額未取得や0%と断定しない','partial','allocation']
],[
 ['config','period','Yes','b','t',[[560,120],[560,153],[265,153],[265,190]],349,145],
 ['config','legacy','No','b','t',[[560,120],[560,153],[855,153],[855,190]],762,145],
 ['period','sessions','請求ごとの期間'],['legacy','weight','旧契約内の行'],
 ['sessions','weight','分類済み利用量','r','l'],['weight','ready','','b','t',[[855,490],[855,530],[560,530],[560,555]]],
 ['ready','money','Yes','b','t',[[560,665],[560,695],[265,695],[265,720]],350,689],
 ['ready','pending','No','b','t',[[560,665],[560,695],[855,695],[855,720]],770,689]
])+
`<div class="formula"><strong>実装の配賦式（割合が既知、かつ捕捉量が正の場合）</strong><code>Wᵢ = inputᵢ + 0.25 × cacheReadᵢ + cacheWriteᵢ + 3 × (outputᵢ + reasoningᵢ)</code><code>捕捉行の円額 = floor(請求対象額 × (1 − 未取得割合) × Wᵢ / ΣW)</code><code>未取得額 = floor(請求対象額 × 未取得割合)</code><code>丸め調整額 = 請求対象額 − 捕捉行の合計 − 未取得額</code><p>推論はsessionAggregation時にoutputへ加算済み。dashboardではそのoutputへ重み3を1回掛ける。</p></div>`+
table(['判定／入力','具体的な処理','出力・限界'],[
['料金優先順位','providerにchargePeriodsが1件でもあれば日付付き方式。なければmonthlyCharges[provider,month]、さらにcharges[provider]。','別providerは別方式のままでもよい。旧設定との二重加算を防ぐ。'],
['請求日と利用期間','月額の帰属はserviceStartedOn〜serviceEndedOnの日数。billedOnは保存するが配賦月を決める入力ではない。','年をまたぐ請求も期間に応じて複数月へ分割。請求単位の円額合計を保存。'],
['端数（日割り）','各月のexact額を切捨て、残額を剰余降順・月昇順に1円ずつ追加。','後段の利用量配賦のrounding-adjustmentとは別工程。'],
['日付付き請求の重複','同じproviderの期間が重複しても別の実請求行として各々配賦。','二重登録の自動判定はない。期間が重なる実請求を登録する意味は利用者が確認。'],
['契約内判定','日付付き方式はそのproviderのいずれかの利用期間に開始日が入るか。旧方式はstartedOn／endedOn。','期間外セッションは0円のreview明細に残す。契約未入力なら旧方式は制限なし。'],
['読めない開始日時','withinContractは除外せず保持する。ただし日付付き請求の個別配賦行では有効日付が必要。','通常のAdapterは不正日時を弾く。2段階の条件が同一ではないことを明示。'],
['配賦の単位','旧方式: provider×month。日付付き: charge.id×month×provider。','ClaudeとCodexのWは同じ分母に混ぜない。同一請求期間の中でのみ按分。'],
['未取得割合','新規設定はnull（不明）。UI空欄は不明、0は捕捉外なし、正の値は推定。APIはnullまたは0〜95%。','10%／25%の暗黙採用を撤去。既存値は保持し本人確認済みと断定しない。まだ全体1値であり契約×期間別の状態保存は未接続。'],
['捕捉利用量0／割合不明','coreはstatus=pending、対象支払額をpendingAmountJpyに保持し、配分明細を生成しない。','dashboardは配分未算定のreview明細へ。率はnull表示。対象額全額を未取得利用と判断したものではない。'],
['金額保存則','捕捉全行＋未取得＋丸め調整＋配分未算定額＝対象請求額をassert。','違反は明示エラー。不明な入力だけを保留し、他の算定可能な入力は継続する。'],
['対象年','APIは履歴・請求の全月とmonthKeyを返す。SummaryPageはannualAiViewでplanning.profile.taxYearへ絞る。年不明の月は除外し件数を表示する。','概要は対象年の共通costProjectionを表示。AIフィルターはAI内訳だけに適用。根拠画面・初期設定の結果・参考境界には従来の全期間経路が残る。']
])+`<p class="refs">${ref('src/core/chargePeriods.ts','export function monthlyAmountsForCharge')} ${ref('src/server/dashboard.ts','export function buildDashboard')} ${ref('src/core/allocation.ts','export const DEFAULT_USAGE_WEIGHTS')} ${ref('src/core/allocation.ts','export function allocateMonthlySubscription')}</p>`);

section('tax','10','分類マトリックスと税務エンジンの接続範囲','実際の画面分類と、別モジュールに存在する詳細決定木を混同しない。',
note('<strong>現行画面経路：</strong>期間ルール → classificationView → current／future／review。<br><strong>詳細core：</strong>decideTaxCandidate、guideAssetThresholdsは実装・テストあり。ただし通常dashboardは両関数を呼ばず、固定マッピングと独自の金額境界表示を用いる。','partial')+
table(['保存されたclassification','3グループ','画面の税務候補','画面が行うこと'],[
['new-development','future / 翌年以後へ残る原価','取得価額','利用者が新規開発と登録した行をfutureへ。その場で供用日や直接対応を詳細決定木へ渡して再判定する処理はない。'],
['maintenance','current / 今年の必要経費','通常経費','保守・障害修正のルールをcurrentへ。'],
['feature-addition','future','資本的支出','一つの改良計画の候補。実際の当年償却額は算定しない。'],
['general-learning','review / 対象外・要確認','対象外','利用量を削除しない。'],
['private','review','私用','配賦bucketもprivate。'],
['unclassified／未知の分類値','review','未分類','未設定の制作物・作業目的を確認する。'],
['未取得・丸め調整','review','未分類','source scope別に自動明細。丸め調整0円は表示しない。'],
['配分未算定','review','未判断','割合不明または利用基準なし。支払額を保持し、利用率や制作物別の配分額を仮定しない。'],
['契約期間外','review','契約期間外','金額0。除外を明細で説明。']
])+`<p class="refs">${ref('src/server/dashboard.ts','const classificationView')}</p>`+
`<h3>詳細決定木：decideTaxCandidate の順序</h3>`+
table(['優先順・条件（上から判定）','返す候補／分岐','不足情報・金額の扱い'],[
['1 私用、趣味、一般学習、私的調査','private-use','私用分を業務候補から除く。private／mixed／unknownの業務比率確認は別途行う。'],
['2 当期にサービス未提供','prepaid-expense','当年経費0、将来残高に業務額を置く候補。'],
['3 sales-production','期末制作中=true → production-cost。それ以外 → unclassified。','販売済み／完成在庫／制作中の事実を求める。'],
['4 販売型収益モデル＋期末制作中','production-cost','software-sale／contract-development／digital-content-saleが対象。'],
['5 供用前＋new-development＋直接対応=true','software-acquisition-cost','当年0／将来残高に業務額。直接対応false／不明はunclassifiedにして共通費配賦や直接対応を確認。'],
['6 供用前＋通常業務・保守・修繕','unclassified / lifecycle conflict','供用前と保守の矛盾を指摘し実際の供用状況を確認。'],
['7 供用後＋ordinary-operation／maintenance／bug-fix／restoration','ordinary-expense','業務額を当年経費候補、将来0。'],
['8 供用後＋feature-addition／improvement／value-increase／life-extension','capital-expenditure','供用日・耐用年数・方法が必要。当年／将来額ともnull、not-calculated。'],
['9 供用後＋new-development','unclassified','既存資産から独立した新しい資産単位か確認。'],
['10 残る未知・不整合','unclassified','供用状況、作業目的、作業実態等をmissingFactsに追加。金額はnull。'],
['共通出力','candidate / confidence / appliedRuleIds / reasons / missingFacts / userConfirmationRequired','未確認、混在用途、足りない事実の数等でconfidenceを決める。保存用の確定税務処理ではない。']
])+`<p class="refs">${ref('src/core/taxDecision.ts','export function decideTaxCandidate')}</p>`+
`<h3>金額境界：画面とcoreの違い</h3>`+
table(['経路','実装している判定','接続と範囲'],[
['dashboardのboundary','AIのfuture明細をproduct×asset×candidateで累積。新規:10万／20万境界。資本的支出:改良計画の20万形式基準を別表示。','設備等のledger額を足していない。assets.inServiceはfalse、futureBalanceはAI配賦累積を設定する表示モデル。'],
['core / 未供用','not-yet-depreciable。','guideAssetThresholdsの入力事実に基づく。通常dashboardは呼ばない。'],
['core / 供用済みの基本線','10万円未満:即時経費候補。10万以上20万未満:通常償却または3年一括。20万以上:通常償却。','境界ちょうどは「未満」に入れない。修繕・改良の20万とは区別。'],
['core / 青色特例のコード値','取得・製作日によって30万／40万円未満を選択する定数・期限分岐あり。年間上限300万円×事業月数/12。','日付、所得区分、青色、事業者要件、供用、年使用額、貸付、3年一括選択等を確認。これはコード内ルールの説明で、現行法検証ではない。'],
['core / 追加要件','明細準備不足、日付不足、要件未知をmissingFactsへ。重複特例や主要事業以外の貸付を制限。','全例外を入力・確定するUIは未接続。独立テストが存在する。']
])+`<p class="refs">${ref('src/server/dashboard.ts','const boundaries =')} ${ref('src/core/assetThresholds.ts','export function guideAssetThresholds')} ${ref('tests/core/taxDecision.test.ts')} ${ref('tests/core/assetThresholds.test.ts')}</p>`);

section('ledger','11','全費用の共通基礎・配分と旧計算の分離','原額・費用基礎・寄与を分け、全費用を同じ年度projectionへ接続する。',
require('./current-costs.cjs')({table,note,ref,diagram})+
require('./current-balances.cjs')({table,note,ref,diagram})+
`<details><summary>旧buildPlanningLedgerの処理（製品API・実データ画面からは切離し済み）</summary><p>以下は旧コードを理解するための保存説明。現在の製品台帳と混同しない。旧コードとそのテストは残るが、/api/ledgerとexportは共通projectionへ切替済み。</p>`+
diagram('G. 費用台帳の3入力と保存則',520,[
 ['eq',30,30,310,115,'planning_equipment','設備','取得額／転用残高・供用日|耐用年数・業務率・制作物率','','ledger'],
 ['home',405,30,310,115,'planning_home_costs','自宅費用','対象年の月・金額|方式・計算式・採用理由','','ledger'],
 ['direct',780,30,310,115,'planning_direct_costs','直接費','対象年の発生日・金額|直接対応・treatment・制作物','','ledger'],
 ['calc',290,245,540,105,'core / buildPlanningLedger','費用基礎額 → 業務額 → 制作物への配賦','不確かな根拠・配賦先不明は未配賦へ|証拠不足はwarningとして保持','branch','ledger'],
 ['out',290,420,540,85,'API ledger → UI / export','contributions / totals / byTaxUnit','各費用源の内訳と、制作物別候補を返す','','outputs']
],[
 ['eq','calc','','b','l',[[185,145],[185,297],[290,297]]],['home','calc'],['direct','calc','','b','r',[[935,145],[935,297],[830,297]]],['calc','out','都度再計算']
])+
table(['費用・分岐','算定と判断','残る不確実性／保存先'],[
['設備の基礎額','通常は取得価額。私用から転用ならopeningUnamortizedBalance。','転用残高なしなら年額は算定せず、基礎額（fallbackは取得額）を未配賦に置く。'],
['10万円未満の非転用設備','有効な業務供用年が対象年なら取得額全体を当年候補。前年度／翌年度供用なら0。','その後に業務率・制作物率を適用。'],
['耐用年数なし／不正','基礎額をforceUnallocatedで返す。','この場合grossAmountは年額償却候補ではなく未確定の基礎額。単純な当年支出総額と読むと誤る。'],
['年額償却候補','round(基礎額 / 耐用年数 × 対象年の使用月数 / 12)。以前の年に開始なら12か月、翌年なら0。','開始日なしは取得日の月を候補にする。詳細な法定償却率・耐用期限・累積残高まで追跡する本格固定資産台帳ではない。'],
['自宅費用','monthが対象年の行のみ。原額×業務率、さらに制作物率。','計算式basis／採用理由rationaleが空なら未配賦。methodは保存する説明で、面積や電力量を式から自動計算するエンジンではない。'],
['一般管理の自宅費用','treatment=generalは制作物へ配賦しない。','業務額を未配賦に残す。通常経費の確定値へ自動転記はしない。'],
['直接費','incurredOnが対象年。directlyAttributable=true かつ treatment=direct かつ taxUnitありの場合に全額を配賦。','それ以外は未配賦。現行direct costのbusinessRatioは1固定で、私用率専用入力はない。'],
['証拠不足','evidenceIdsなしをwarningへ。','全ての証拠不足が配賦を禁止するわけではない。根拠式や直接対応の不足とは異なる。'],
['円単位処理','grossをround、business=round(gross×率)、private=gross−business、allocated=round(business×制作物率)、unallocated=business−allocated。','差額で残りを算定して保存則を維持。'],
['byTaxUnit','制作物ごとにallocatedAmountを合計し、unitTypeから取得価額／資本的支出／制作原価の候補を表示。','ライフサイクルの全事実で税務決定木を再実行する処理ではない。'],
['配賦先の表現','設備・自宅費用の1レコードは1つのtaxUnitIdと1つのprojectAllocationRatio。','同じ原額を複数レコードで重複入力した場合の横断的な二重計上拒否は確認できない。設計文書の複数制作物への割合合計検査と区別。']
])+`<div class="formula"><code>gross = business + private</code><code>business = allocated + unallocated</code><p>旧方式の各行と全体の金額保存則。現在の共通projectionの検査とは別。</p></div><p class="refs">${ref('src/core/planningLedger.ts','function equipmentContribution')} ${ref('src/core/planningLedger.ts','export function buildPlanningLedger')} ${ref('tests/core/planningLedger.test.ts')}</p></details>`);

section('diagnosis','12','現在地診断とライフサイクル','利用者の登録事実をもとに、今行うことと、出来事が起きた時に記録することを再生成する。',
table(['入力状態','診断分岐','返すアクション／不足事実'],[
['制作物0件','現在地が未登録。','制作物・改良計画を登録する。'],
['制作物あり、期間ルール0件','履歴との対応が未設定。','AI履歴と税務単位を結ぶ期間ルールを登録する。'],
['early / retrospective','制作物ごとの値を優先し、なければprofileをfallback。','過去整理でdevelopment-startedがなければ節目を復元。開発日時と実際の日付を分けて残す。'],
['monetization=earning','初回売上イベントの有無を確認。','first-sale未登録なら日付と記録を要求。planned／noneは現在地説明を変える。'],
['usageMode=undecided','誰が使うか不明。','自己利用／外部提供／両方を確認。'],
['usageMode=mixed','自己利用版と外部版の関係を確認。','sameAsExternalVersionが未定なら資産境界を不足事実へ。'],
['prototype／developing／evaluating／improving','completionCriteriaが空か。','完成・正式採用条件を記録。'],
['internal または mixed','internal-use-startedがあるか。','正式採用した日に記録するアクション。既にin-use等なのにイベントがない場合は不足事実にも追加。'],
['external または mixed','external-releasedがあるか。','外部公開・提供した日に記録するアクション。自己利用開始とは独立。'],
['improvement-plan','improvement-startedがあるか。','改良計画の開始日を記録。'],
['predecessorIdあり','旧版にretiredイベントがあるか。','新版移行時に旧版を実際に使い終えた日を記録。旧版継続利用を勝手に終了扱いしない。'],
['帳簿／設備／自宅費用／証拠不足','hasBookkeeping、設備の年数・転用残高・evidence、自宅費用のbasis/rationale/evidence等。','必要な記録をimmediateActions／missingFactsへ。存在しない費用の入力を自動生成しない。'],
['readiness','9条件のboolean集計。制作物、ルール、用途、完成条件、利用開始イベント、帳簿、設備、自宅費用、証拠。','互換用の数値を返すが、画面の準備スコア・確認済み数としては表示しない。年度別の「該当なし・保留」はCostPresenceEditorで入力し、採用資料にも固定する。RecordStatusPanelは本人の年度記録と登録有無の不一致を区別し、Onboarding結果は不足事実を列挙する。']
])+`<p>ライフサイクルの状態は <code>idea / prototype / developing / evaluating / in-use / maintaining / improving / retired / abandoned</code>。記録可能な出来事は ${ref('src/planning/types.ts')} に定義される。出来事を登録すると診断材料になるが、期間分類や料金の帰属が自動確定するわけではない。</p><p class="refs">${ref('src/core/diagnosis.ts','export function diagnosePlanning')} ${ref('src/core/diagnosis.ts','const readinessChecks')}</p>`);

section('data','13','保存モデル・キー・トランザクション','SQLiteの物理テーブルと、画面のsnapshot／派生データの対応。',
table(['テーブル／ファイル','保存内容・主キー','更新主体／読取先'],[
['identifier-salt','アプリデータディレクトリ内の乱数salt。','paths.tsで初回作成。識別子hash・source別saltの基礎。'],
['devtax-radar.db','Windows既定: %LOCALAPPDATA%/DevTaxRadar。Mac: Application Support/DevTaxRadar。Linux: XDG_DATA_HOME等。','DEVTAX_RADAR_DATA_DIRで差替え可。Node DatabaseSync、WAL、foreign key有効、busy timeout 5秒。'],
['schema_migrations','移行id、checksum、適用時刻。','getDatabaseの起動処理。旧usage形式からの再作成では再走査が必要。複数source移行前にはVACUUM INTO＋integrity_check済みbackup。'],
['history_sources','id、provider、kind、name、root_path、root_key、enabled。UNIQUE(provider,root_key)。','source管理API。rootの露出先はsource設定APIに限定。'],
['history_file_cache','PK(source_id,provider,file_key)。size、mtime、adapter、schema、allowlist化events_json。','成功scanのtransactionで更新。元パス・native id・本文は入れない。'],
['usage_events','UNIQUE(source_id,provider,session_key,project_key,month)。時刻範囲、model、トークン、件数、schema、confidence。','source単位の集約snapshot。dashboard／folders／sessionsの基礎。'],
['session_references','PK(source_id,provider,session_key)。native id、source_path、cwd、hash、size、mtime。','既定ローカルのみ。detail要求時のpreview/resumeと変更件数検出。'],
['scans','自動採番id、source/provider、時刻、件数、timezone、状態、error_code。','成功・失敗結果を記録。画面用progress自体はプロセスメモリで別管理。'],
['provider_settings','provider主キー。旧基本月額、契約開始／終了。','POST config。旧方式の配賦に使用。'],
['provider_month_charges','PK(provider,month)、amount_jpy。','月別上書き設定。config保存で全置換。'],
['provider_charge_periods','id主キー、provider、plan名、service期間、billed_on、amount、note。','日付付き請求。configでchargePeriodsを渡した場合に全置換。'],
['app_settings','key/value。未取得割合等。','config保存。新規の未取得割合は文字列nullで保持しAPIではnull。既存の割合は保持。'],
['balance_draft','id=1、revision、payload。作業中のBalanceSnapshot。','専用版の照合後に全体を原子保存。workspace版とは独立。'],
['balance_reviews','id、year、payload、content_hash、idempotency_key UNIQUE、request_hash。','固定snapshotとprojectionを保存。更新・削除をtriggerで拒否。製品APIは読取のみ。'],
['balance_review_heads','year PRIMARY KEY、review_id外部キー。','年ごとの現行採用版を指す。前年訂正の未反映は参照チェーンで検出する。'],
['planning_profiles','singleton_id=1。対象年、所得／申告候補、帳簿、共通journey等。','planning snapshotのprofile。'],
['planning_tax_units','id。名前、単位種別、用途、収益、状態、journey、完成条件、旧版、外部版との関係。','候補整理＋制作物編集。'],
['planning_project_rules','id。project_key、任意provider、有効期間、tax_unit_id、classification、reason。','planning全保存 または rulesだけ全置換。セッションIDへの直接overrideではない。'],
['planning_lifecycle_events','id、tax_unit_id、event_type、occurred_on、recorded_at、evidence id配列、note。','実際の出来事と記録日を分ける。'],
['planning_equipment / planning_home_costs / planning_direct_costs','各費用の入力事実、tax_unit_id、割合、evidence id配列。','ledgerの入力。計算結果を固定保存しない。'],
['planning_evidence','id、evidence種別、strength、発生日、記録日、local_reference、note、任意tax_unit_id。','証拠ファイル本体の添付保存はしない。参照・メモを保存。'],
['planning_decisions','id、tax_unit_id、対象年、engine_version、候補、status、選択候補、理由、作成／確認時刻。','型・保存テーブルはある。確定UIと追記専用revision運用は未接続。'],
['派生データ（DBテーブルなし）','dashboard、allocation、diagnosis、ledger、filing scenarios、Markdown。','GET要求またはブラウザ表示で再生成。既存UIstateとDB snapshotは区別する。']
])+note('<strong>保存の原子性：</strong> 新UIはworkspaceで料金・計画を一括保存し、同じtransactionで集計を検証。expectedRevisionで古いタブを拒否する。旧config/planning/rulesの個別APIも共有版番号を増加させる。planningは参照検証後にDELETE→INSERT。scanは別のsource単位transactionであり、workspaceの採用履歴や走査版の固定ではない。')+
require('./current-workspace.cjs')({table,note,ref,diagram})+
require('./current-impact.cjs')({table,note,ref,diagram})+
`<p>Zodは重複id、制作物・旧版・証拠参照の存在、旧版の自己参照、期間逆転等を検証する。全APIの64KiB制限は、schema上の大きい配列件数上限とは別に先に効く。</p><p class="refs">${ref('src/server/database.ts','export function getDatabase')} ${ref('src/server/planningRepository.ts','export function savePlanningSnapshot')} ${ref('src/server/planningRepository.ts','export function replaceProjectRules')} ${ref('src/server/paths.ts','export function getAppDataDirectory')}</p>`);



section('api','14','API・実行主体・入出力マトリックス','現行index.tsとbalanceRoutes.tsに登録された全31ルートと静的配信。GET以外の変更系はCSRF／Origin検査を通る。',
table(['method / route','呼出元・トリガー','内部プロセス','出力／副作用・失敗'],[
['GET /api/balances/draft','残高入力の読取','getBalanceDraft','専用revision・snapshotと参照未照合scope。未登録は空のdraft。'],
['PUT /api/balances/draft','残高の入力保存','strict Zod → validateBalanceSnapshot → BEGIN IMMEDIATE → 版照合・保存','2 MiB上限。構造・金額・日付等不正400、版競合409。CSRF/Origin必須。採用操作ではない。'],
['GET /api/balances/preview','保存済み残高の年度計算','year検証 → SAVEPOINT → previewBalanceReview','期首・増減・期末・未判断とhash。未知は0補完しない。入力・採用headを同版読取。'],
['POST /api/balances/reviews','年度資料の採用・訂正','CSRF・strict schema → BEGIN IMMEDIATE → hash再照合','サーバーが資料一式を再読取。参照・前年残高・履歴を照合しimmutable保存。理由・UUID再送キーを必須化。古い確認409、不正400。同年は元版を残す訂正版。'],
['GET /api/balances/impact','保存済み各年への影響','同一snapshot → 現行headのみ → 各年比較','現在の料金・計画・観測を一度読取。保存した各年の現行版と比較し、期首/期末差額・過年度訂正未反映・全変更を返す。不明や片側未登録は差額null。採用版を自動更新しない。'],
['GET /api/balances/reviews','残高採用版一覧','SAVEPOINT → listBalanceReviews','各年の現行版と前年訂正の未反映。新規採用・訂正はPOSTと確認画面へ接続。'],
['GET /api/balances/reviews/:id','固定残高資料の読取','UUID検証 → getBalanceReview','schema・内容hash・ID検証後に保存済みprojectionを返す。ID不正400、存在なし404。再計算しない。'],
['GET /api/balances/reviews/:id/compare','保存版と現在の比較','UUID検証 → 同じ読取snapshot → compareReview','旧版の保存結果と現在の保存入力・計算結果を比較。全期間の入力、対象年の結果、原額・根拠・判断・観測の変更を省略せず返す。旧資料の不足は比較不可。書込みなし。'],
['GET /api/balances/reviews/:id/export','固定版の持ち出し','UUID・format検証 → getBalanceReview → reviewExport','保存版だけからMarkdownまたはJSONを生成。再計算・最新入力との混合なし。attachment、UTF-8、no-store。資料なし404・不正400。'],
['GET /api/health','ヘルス確認','定数応答','ok / service。'],
['GET /api/runtime','App初期化、CSRF再取得、保持期間変更後','履歴検出、保持設定／年齢cache、csrfToken','provider検出状態・retention・privacy。本文保存なし等の製品境界。'],
['GET /api/dashboard','初期化・走査・設定変更後','buildDashboard','AI明細、月別3群、assets、boundaries、guidance、候補products。DB書込なし。'],
['GET /api/projections','支払と配分の年切替','year検証 → buildDashboard → costProjection','対象年の全費用基礎・寄与・原額・未算定。DBの対象年を変更しない。year不正は400。採用版の結果ではない。'],
['GET /api/folders','フォルダ割当、refresh','buildFolderSummaries','フォルダ単位の件数・期間分類・割当状態。'],
['GET /api/sessions?projectKey=…','フォルダ詳細','getSessionsForProject → allowlist map','source表示名、provider、sessionKey、期間、model、件数等。localDetailAvailableを付与。'],
['GET /api/sessions/detail','セッションの確認','ローカルsource判定 → getSessionReference → readSessionPreview / buildResumeCommand','追加source／参照なし: available=false。既定ローカルでは原本の最初の発言previewと再開コマンド。実行はしない。'],
['GET /api/config','初期化・設定UI','getConfiguration','料金・契約・日付付き請求・未取得割合。'],
['POST /api/config','旧クライアント用の個別設定保存','Zod → saveConfiguration','設定を保存し共有版番号を増加。新UIはworkspaceを使用。重複月、重複id、不正日付等は400。'],
['GET /api/sources','走査元設定画面','listHistorySourceViews','設定rootを含む専用一覧、到達状態、scan状態。'],
['POST /api/sources/test','接続テスト','schema → testHistorySource','到達性とJSONL列挙件数。本文解析・形式互換性確認・設定の永続保存なし。'],
['POST /api/sources','走査元追加','schema → enqueue → createHistorySource','saved/sourceId。重複409。'],
['PATCH /api/sources/:id','走査元更新','schema → enqueue → updateHistorySource','追加sourceのみ更新。root変更でcacheを失効。既定／provider変更等409。'],
['DELETE /api/sources/:id','走査元削除','schema → enqueue → removeHistorySource','sourceと当該集約・cache・scanを削除。存在なし404、既定409。'],
['GET /api/workspace','一貫した編集読取','readWorkspace → SAVEPOINT → 入力・集計・診断','revisionと同じ読取snapshotのconfiguration/planning/dashboard/diagnosis。'],
['POST /api/workspace/preview','保存前の年別費用・分類比較','schema → readWorkspace → 同じ観測で変更前後を純粋計算','仮書込なし。登録範囲の全年度・全明細・分類変更件数とhash。版競合409、対象範囲不正400。'],
['PUT /api/workspace','途中保存・最終保存・分類変更','workspaceSaveSchema → saveWorkspace','expectedRevisionとrequestIdを照合。hash付きは書込前にpreviewを再計算・照合。不一致409。料金・計画・版・直前要求を一括保存。不正400、書込・計算失敗rollback。'],
['GET /api/planning','初期化／ルール保存後','getPlanningSnapshot','profile + taxUnits + rules + lifecycle + costs + evidence + decisions。'],
['PUT /api/planning','旧クライアント用の個別計画保存','schema → savePlanningSnapshot','planning全体の置換と共有版番号増加。新UIはworkspaceを使用。schema不適合400。'],
['PUT /api/planning/rules','旧クライアント用の個別ルール保存','projectRulesSchema → replaceProjectRules','ルール全置換と共有版番号増加。新UIの分類変更はworkspace。参照・期間不正は400。'],
['GET /api/diagnosis','planning変更後・表示','getPlanningSnapshot → diagnosePlanning','現在地・即時行動・出来事時行動・不足事実・readiness。'],
['GET /api/ledger','共通費用資料の読取（旧入口）','buildDashboard → costProjection','/api/projectionsの既定年と同じAnnualCostProjection。旧PlanningLedger DTOとは互換ではない。Appはdashboard.costProjectionを使用。'],
['GET /api/export?format=markdown','相談用Markdownボタン','一貫snapshot → planningMarkdown + costProjectionMarkdown','計画・事実・全費用の原額/基礎/寄与/未算定理由。作業中資料。text/markdown; charset=utf-8。format=csv等は400。'],
['POST /api/retention','利用者が保持日数を保存','days 1〜36500 → writeCleanupPeriod','Claude settingsの該当キーのみ。成功時backupFileName。書換え不可なら409。'],
['GET /api/restore/sources','復元元の接続先を確認','restoreSources → 全sourceと確認hash','source rootを再接続画面へ返す。通常dashboardには含めない。保留なし409。'],
['POST /api/restore/sources','確認した接続先を保存・保留解除','CSRF → 操作キュー → restoreSources transaction','strict入力・全ID・確認hash・有効rootを照合。競合409、入力不正400。数値資料を維持し、変更元cacheのみ無効化。保存操作は走査を開始しない。'],['GET /api/scan/progress','初期250ms／手動700msの監視','readScanProgress + startupScanPending','プロセス内の進捗を返すだけ。走査を開始しない。'],
['POST /api/scan','履歴を再走査','provider配列／mode検証 → enqueue → scanHistorySources','完了時刻・provider／source結果。source失敗は応答内statusで通知し、必ずしもHTTPエラーにならない。'],
['静的配信／未知ルート','非APIページへのアクセス等','dist存在時のnotFoundHandler','未知 /api/* は404。非APIはSPA index.htmlへfallback。これは追加APIルートではない。']
])+note('厳密には明示登録は<strong>31ルート</strong>（上表の最後はnotFoundHandler）。クライアントのgetPlanningExport型にはcsvが残るが、サーバーはmarkdownだけを受け付ける。','partial')+
`<p class="refs">${ref('src/server/index.ts')} ${ref('src/client/api.ts')}</p>`);

section('security','15','データ境界・詳細閲覧・保持期間変更','何を保存しないかに加え、限定的に何がブラウザへ返るかまで区別する。',
table(['データ／機能','永続保存','通常API／画面','例外・操作条件'],[
['原本のプロンプト・応答・コード本文','保存しない。file cacheにも入れない。','dashboard等には返さない。','既定ローカルのdetail明示要求では、原本を読み直し最初の発言previewをブラウザへ返す。'],
['元ファイル絶対パス・native session id','既定ローカルのsession_referencesだけ。','通常集計APIには返さない。','detailのresume情報にはローカルcwd等が含まれうる。追加sourceはこの経路を拒否。'],
['追加sourceのroot絶対パス','history_sourcesの設定として保存。','GET /sources専用。','表示名にはパス区切り・制御文字を拒否。'],
['hash／不透明key','saltによる識別子、既定原本のSHA-256、source別cache key。','集計には不透明キーが含まれる。原本hashは通常応答に載せず変更件数だけ。','同一利用者権限でDBも原本も変更可能。第三者証明・電子署名ではない。'],
['証拠','参照とメモ。ファイル本体は保存しない。','ローカルplanning snapshotにlocalReferenceを含める。','Markdownは構造上localReferenceを出力しないが、自由記述note／rationaleは出す。入力された秘密を一般的に匿名化する機能ではない。'],
['Hostガード','全methodのpreHandler。','127.0.0.1:現在port または localhost:現在portのみ。','不一致／欠落は403。DNS rebinding対策。'],
['Mutationガード','GET／HEAD／OPTIONS以外に適用。','Originがあるならhttp loopback＋任意ポートの形式を確認。CSRF headerはconstant-time比較。','OriginなしでもCSRF token必須。外部Origin／不正tokenは403。'],
['本文サイズ・入力検証','Fastify bodyLimit=64KiB、Zod strict schema等。','大きすぎる要求は413、入力不正は400。','same-originブラウザの保護であり、同一ユーザーのローカル悪意あるprocessを隔離する仕組みではない。'],
['保持期限検出','Claude settingsを読み、履歴file mtimeの最古日を検出。','runtimeに日数・推定損失日を返す。履歴年齢の走査結果は60秒cache。','変更対象は既定ローカルClaudeのみ。Codexの保持期間変更は現行製品では未実装。共有元の設定は変えない。'],
['保持日数変更','既存settings読取 → JSON構造確認 → 非上書きbackup → cleanupPeriodDays差替え → 同directoryのtemp → rename。既存ファイルがなければ新規作成。','成功後runtime再取得。backupのファイル名だけ返す。','壊れたJSON／I/O失敗時に元設定を上書きしない。履歴原本を書換え・削除・移動する処理はない。']
])+`<p class="refs">${ref('src/server/security.ts')} ${ref('src/server/sessionPreview.ts')} ${ref('src/server/retention.ts')} ${ref('docs/SECURITY.md')}</p>`);

section('outputs','16','画面・出力・再入力の循環','通常6画面と結果シナリオが、どの計算結果を使うかを対応させる。',
table(['表示／出力','使うデータ','使う人・次の行動','接続の範囲'],[
['支払と配分','dashboard.costProjectionまたはGET projectionsの指定年。','全費用の原額・費用基礎・最終対応先・未算定理由を確認。年切替と費用入力へ戻る。','作業中資料。方法別の税務処理・残高・採用版は未接続。'],
['残高と繰越し','GET draftの専用版・BalanceSnapshot、annualBalances、制作物・費用・既存判断。','期首・増減・単一振替を入力し、年別の期首・増減・期末・未知を確認。PUTで作業中の残高を保存。','判断記録は費用画面から入力・本人確認できる。制作物・資料の存在と判断の確認状態・年・制作物を照合して問題を表示。確認previewから年度資料の採用・訂正が可能。金額の由来・適用条件は未検証。計画と独立したdraft。主画面移動と競合時は入力を保持。'],
['今年どうなる？','対象年のcostProjectionとannualAiView、diagnosis、planning。','全費用の算定済み基礎・未算定を確認し、原額の明細へ戻る。AI内訳は対象年だけ表示。','税務上の当年費用・繰越残高は未算定。AIフィルターで全費用を変えない。'],
['なぜそうなる？','AI配賦明細、assets／boundaries、planning、costProjection、diagnosis。','明細を選び分類変更。設備・自宅費用・直接費と証拠を確認。Markdownを保存。','費用集計は支払と配分と同じcostProjection。AI分類・境界表示は旧経路が残り、最終取得価額の確定ではない。'],
['フォルダの割当','folders／sessions／projectRules／taxUnits。','フォルダ、期間、制作物、分類を修正して再集計。既定sourceならpreview/resume確認。','resumeコマンドの生成・コピーまで。DevTaxがCLIを起動して会話を再開する処理はない。'],
['税務QA','App.tsxの説明コンテンツ。','取得価額・改良・旧版／新版・正式利用開始等を理解する。','チャットLLMや税務相談APIとの通信ではない。'],
['5段階の結果・申告条件比較','buildFilingScenarios(data.months集計)。','雑所得、事業白色、事業青色それぞれの確認条件を比較。','3シナリオは同じ3群金額を返す。税額・控除の差を計算しない。'],
['相談用Markdown','一貫したDB snapshotのplanning + diagnosis + costProjection。','ブラウザでdevtax-{year}.mdとしてダウンロード。利用者が相談に使う。','制作物・出来事・証拠メモと、AIを含む全費用源の原額・期間・基礎・寄与・方法・未算定理由。採用版・税務rule結果・残高の出力は未接続。'],
['公開デモ','src/client/dashboard.ts内の合成Dashboard／Planning／Diagnosis／Ledger。','製品画面の例示。入力はブラウザ内draftのみ。','実際の請求・利用履歴・ローカルDBは読まない。任意入力で全dashboardを実データ同様に再計算する経路ではない。'],
['未接続の出力','CSV、仕訳帳、電子申告、税額、固定資産台帳の確定償却。','今後の実装範囲。','API型だけを根拠に提供済みとしない。']
])+`<p class="refs">${ref('src/App.tsx','function EvidencePage')} ${ref('src/server/planningRepository.ts','export function planningMarkdown')} ${ref('src/client/dashboard.ts','export async function getDashboardData')}</p>`);

section('delivery','17','開発・品質検査・Release・公開デモ','ローカル製品の配布と、合成データの静的デモ公開は別のライフサイクル。',
diagram('H. 開発から配布までの分岐',560,[
 ['code',395,20,330,95,'開発者 / Git','ソースを変更・コミット','npm ci / 合成fixtureで確認','','delivery'],
 ['ci',25,200,320,120,'PR・main push / GitHub Actions','CI verify','typecheck → test → lint|format:check → build → privacy','','delivery'],
 ['rel',395,200,330,120,'v* tag push / GitHub Actions','Release pipeline','typecheck → test → lint|build → privacy → release:pack','','delivery'],
 ['demo',775,200,320,120,'メンテナー / 手動CLI','deploy:cloudflare','build → privacy:check|wrangler pages deploy dist','','delivery'],
 ['zip',395,410,330,115,'esbuild → ZIP → GitHub Release','利用者のPCへ配布','Node 24.14以上でnpm start|追加のnpm installなし','','startup'],
 ['pages',775,410,320,115,'Cloudflare Pages','合成データの静的デモ','distだけを配信|実履歴APIなし','','outputs']
],[
 ['code','ci','PR / main','b','t',[[560,115],[560,156],[185,156],[185,200]],281,145],['code','rel','tag'],
 ['code','demo','手動','b','t',[[560,115],[560,156],[935,156],[935,200]],834,145],
 ['rel','zip','全ゲート成功'],['demo','pages','upload成功']
])+
table(['入口','実行するもの','検証する性質／成果物'],[
['npm ci','package-lock準拠のインストール。','依存取得。Nodeの最低バージョンは24.14.0。'],
['npm run typecheck / lint / format:check','tsc -b / oxlint / prettier --check。','型、静的問題、書式。'],
['npm test','Vitest。adapters／server／core／clientの合成テスト。','識別子、JSONL互換、増分cache、期間分類、契約、保存則、DB、セキュリティ、API、入力・画面等。現在のsourceでは41ファイル。'],
['npm run build','typecheck → Vite build。','Reactの静的dist。Node APIをbundleするのはこのコマンドではない。'],
['npm run privacy:check','scripts/privacy-check.ts。','追跡ソースや公開成果物のパス・識別子・禁止フィールド・ローカルファイル混入を検査。合成fixtureと許可したコードは扱いを区別。'],
['CI workflow','ubuntu-latest / Node 24 / timeout 15分。PRとmain push。','checkout、ci、typecheck、test、lint、format、build、privacy。Windows実行や共有元到達性の証明とは別。'],
['Release workflow','ubuntu-latest / Node 24 / timeout 20分。v* tag。','CI類似のゲートだがformat:checkは定義なし。release:pack後gh release createでZIPを公開。'],
['release:pack','distとREADME／LICENSE／SECURITYをallowlistでコピー。esbuildでNode serverとbackup/再接続CLIをruntimeへbundle。','release package.jsonにstartとdata:backup/data:reconnectを定義。プライバシー・構文検査後、隔離HOME/DBで実起動、静的配信、backup/復元・再接続・再起動を検証してZIP作成。'],
['ZIP検査','node_modules／fixtures／.git／履歴状態／DB等の混入を禁止。ファイル形式・文字列も検査。','依存込みruntime bundleなので利用者はnpm install不要。tagがsemver形式ならそのversionを使用。'],
['公開デモの手動deploy','npm run deploy:cloudflare。WranglerのDirect Upload。','このcheckoutにCloudflare自動deploy workflowはない。公開中のJS資産が最新distかどうかは別途確認が必要。']
])+`<p class="refs">${ref('.github/workflows/ci.yml')} ${ref('.github/workflows/release.yml')} ${ref('scripts/package-release.ts','function smokeTestBundle')} ${ref('scripts/release-smoke.ts')} ${ref('scripts/privacy-check.ts')} ${ref('docs/MAINTAINING.md')}</p>`);

section('gaps','18','実装と設計意図の差・次に検討する接続','新機能を実装したという図にせず、現時点でどこまでつながるかを明示する。',
table(['論点','現行コードの状態','採用設計へ接続する責務（実装状態は別）'],[
['詳細税務ルールの適用',tag('接続限定','partial')+' classificationViewが画面分類を決め、詳細coreを呼ばない。','どの入力事実をTaxDecisionInputへ渡すか、期間ごとの供用状況と作業目的を定義した上で接続する。'],
['AIと他費用の合算',tag('費用基礎を接続','partial')+' 原額・基礎・寄与の共通projectionを画面/APIへ接続。旧ledgerは製品経路から切離し。AI境界表示は旧経路。','限定した設備の年度条件・条件付き計算と採用資料への記録を接続。全費用の税務処理生成と個別原価の減少後追跡を完成させる。'],
['申告シナリオ',tag('条件比較のみ','partial')+' 金額は3シナリオ共通で、税額の比較ではない。','製品仕様の対象外である税額算定と分け、処理方法の条件・各年費用・残高の比較へ接続する。'],
['判断の確定・履歴',tag('年度採用・訂正を接続','partial')+' 作業中判断は編集可能。年度採用資料は入力・観測・結果を固定し、訂正版を追加する。','個々の事実・相談回答の訂正来歴と、全費用の税務適用条件の検証を完成させる。'],
['エクスポート',tag('作業中・固定版出力','partial')+' 作業中Markdownと、保存版の費用・判断・残高のMarkdown/JSONを提供。','相談回答の取り込みと、自由記述を含む共有範囲の確認を完成させる。'],
['履歴の時間精度',tag('Providerで差','branch')+' Codex累積はsession開始月。候補初期日付はslice、分類解決はlocal date。','長期セッションの月分割とローカル日付変換の統一を、実ログ形式の検証と合わせて決める。'],
['保存単位',tag('部分接続','branch')+' workspaceで料金・計画の一括保存、版照合、直後再送の重複抑止。','競合時の3版比較・選択・再保存を接続。登録範囲の年別費用・分類previewと書込前hash再照合を接続。自由な不完全入力、税務・採用残高の影響は未接続。'],
['source変更・削除',tag('手動操作','branch')+' 無効化はデータ保持、削除はimport済みデータも削除。','UI文言で金額への影響を説明し、分類ルールの残存や復帰時の対応を明確化する。'],
['恒久記録',tag('観測と固定版を分離','partial')+' 走査は現在の観測を更新し、年度採用資料は当時の入力・数値観測・結果を保持する。','全契約の捕捉状態とAdapter版を含む観測品質の固定を完成させる。'],
['候補の操作方法',tag('番号で統合','live')+' 全候補を検索・番号指定。drag-and-dropは証跡上deferred。','保存モデルCandidateDestinationsを維持して操作だけ追加できる。'],
['ワンクリック配布・代替collector',tag('将来構想','planned')+' Tauri等やSMB不可時のone-shot collectorは旧技術設計に残る選択肢。v0.5の完成条件は特定のwrapper導入を要求しない。','標準経路の単一hub／原本非送信の境界を維持するか検討。'],
['資料の更新',tag('古い説明あり','branch')+' 製品仕様・技術設計・READMEを現行機能と採用設計に分けて改訂。CURRENTは過去証跡のまま保持。','この設計図の確認HEADを起点に、将来の実装変更と同時に該当章を更新する。']
])+note('この章は現行実装とv0.5の採用設計の差を示す。正式仕様への反映と製品機能の実装完了は別。要件・実装・受入対応表で各責務の接続状態を追跡する。'));

// Cross-reference register makes the blueprint independently auditable.
section('references','19','実装根拠の索引','リンクはリポジトリ相対。表記の行番号は生成時の作業ツリーでの位置。ブラウザではファイル全体を開く。',
table(['ファイル','確認箇所（行番号）'],[...new Set([...refs.values()].map(r=>r.file))].map(file=>[
 `<a class="source" href="../../${file}">${esc(file)}</a>`,[...refs.values()].filter(r=>r.file===file).map(r=>`<span class="ref-entry">L${r.line} ${esc(r.symbol || 'ファイル全体')}</span>`).join('')
]))+
note('検証範囲：現行source／API登録／DB schema／CI定義／保存済み証跡を読み合わせ。HTMLは外部ライブラリ・CDN・外部通信なしで開ける。図と表の内容はすべて初期表示に含み、JavaScriptなしでも読める。印刷時は目次を省き本文を出力する。'));

const html=`<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>DevTax | 目的・再設計・ワークフロー設計図</title>
<style>
.nav-group{font-size:11px;font-weight:700;color:#89cfc8;padding:20px 9px 7px;letter-spacing:.05em}.reading-path{display:flex;flex-wrap:wrap;gap:10px;margin:25px 0}.reading-path a{border:1px solid #b5cbd9;padding:9px 13px;border-radius:5px;text-decoration:none;font-size:13px;background:white}.purpose-statement{padding:30px 32px;background:#e7f3f0;border-top:4px solid #087a70}.purpose-statement>span{font-size:12px;color:#087a70;font-weight:700;letter-spacing:.08em}.purpose-statement h2{font-size:clamp(22px,2.1vw,31px);line-height:1.65;margin:12px 0 22px}.purpose-statement p{font-size:16px;max-width:980px;margin:0}.verdict{font-size:19px;line-height:1.9;max-width:1050px}.proposed-screen{border:1px solid #a6bdb7;background:white;margin:30px 0;padding:28px;font-size:16px;border-radius:8px}.screen-label{font-size:12px;color:#5d6d75}.screen-title{font-size:24px;font-weight:700;margin:18px 0}.screen-title small{display:block;font-size:14px;font-weight:400;color:#526477}.screen-values{display:grid;grid-template-columns:1fr 1fr;border:1px solid #d4e0df;margin:24px 0}.screen-values>div{padding:20px;background:#f1f7f5}.screen-values>div+div{background:#fff5e5}.screen-values strong{display:block;font-size:32px;margin:8px 0}.screen-values small{display:block;font-size:14px}.screen-question{padding:22px;background:#f3f6fa}.screen-question>span{display:inline-block;padding:8px 12px;border:1px solid #b3c2ce;border-radius:4px;background:white;margin:5px 5px 0 0}.screen-caption{font-size:13px;color:#526477}.proposed-screen p{margin:14px 0}@media(max-width:700px){.nav-group{grid-column:1/-1}.purpose-statement{padding:21px}.screen-values{grid-template-columns:1fr}.proposed-screen{padding:18px}}@media print{.reading-path{display:none}.proposed-screen{break-inside:avoid}}

:root{--ink:#172638;--muted:#526477;--line:#d5dfe9;--blue:#195d92;--teal:#087a70;--bg:#f6f8fb}*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:28px}body{margin:0;color:var(--ink);background:var(--bg);font:15px/1.85 "Yu Gothic UI","Yu Gothic",Meiryo,system-ui,sans-serif}a{color:var(--blue);text-underline-offset:3px}a:hover{color:#093b60}a:focus-visible,button:focus-visible,[tabindex]:focus-visible{outline:3px solid #cf7900;outline-offset:3px}.shell{display:grid;grid-template-columns:244px minmax(0,1fr);max-width:1800px;margin:auto}aside{height:100vh;position:sticky;top:0;padding:28px 18px 24px 24px;overflow:auto;background:#142b40;color:#d6e3ee}.brand{font-size:26px;font-weight:800;color:white;letter-spacing:.01em}.brand small{display:block;font-size:11px;letter-spacing:.13em;font-weight:500;color:#8cbed7}aside p{font-size:12px;margin:16px 0;color:#aac2d3}nav a{display:flex;gap:10px;color:#ccdae7;text-decoration:none;font-size:12px;line-height:1.55;padding:8px 9px;border-left:2px solid transparent}nav a:hover,nav a.active{color:white;background:#22425a;border-left-color:#76c8d8}nav a span{color:#8fb9d0;font-variant-numeric:tabular-nums}.print{width:100%;margin-top:18px;padding:10px;background:#24465e;border:1px solid #547489;border-radius:5px;color:white;font:inherit;cursor:pointer;font-size:12px}main{min-width:0;padding:48px 42px 70px}.hero{margin-bottom:35px;border-bottom:2px solid #183c55;padding-bottom:32px}.eyebrow{font-size:12px;font-weight:700;letter-spacing:.13em;color:var(--teal)}h1{font-size:clamp(28px,3vw,46px);line-height:1.35;margin:16px 0 18px;letter-spacing:-.03em}.hero>p{max-width:900px;font-size:16px;color:#405569}.metadata{display:flex;flex-wrap:wrap;gap:10px 28px;margin-top:22px;font-size:12px;color:#405569}section{padding:28px 0 30px;border-bottom:1px solid #c8d5e1}.section-head{display:flex;gap:19px;margin-bottom:24px}.section-head>span{font-size:28px;color:var(--teal);font-weight:700;line-height:1.45;font-variant-numeric:tabular-nums}.section-head h2{margin:0;font-size:24px;line-height:1.5}.section-head p{margin:8px 0 0;color:var(--muted)}h3{margin:32px 0 14px;font-size:19px}.note{background:#eaf2f8;border-left:4px solid #44789e;padding:17px 21px;margin:18px 0;color:#243d51}.note.branch{background:#fff5e5;border-color:#b8781a}.note.partial{background:#f1ecfa;border-color:#7b5aa2}.legend{display:flex;gap:12px;flex-wrap:wrap;margin:24px 0}.tag{display:inline-block;vertical-align:middle;white-space:nowrap;border-radius:4px;padding:2px 8px;font-size:11px;line-height:1.8;margin-right:4px;background:#e9eef4;color:#355063}.tag.live{background:#e0f0eb;color:#126251}.tag.branch{background:#fff0d3;color:#88540f}.tag.partial{background:#ede6f6;color:#63458b}.tag.planned{background:#eef0f3;color:#5c6571;border:1px dashed #8995a4}.table-wrap{overflow-x:auto;margin:22px 0;border-top:2px solid #58748b;background:white}table{border-collapse:collapse;width:100%;min-width:750px;table-layout:fixed}thead{background:#eaf0f6}th,td{padding:13px 14px;border-bottom:1px solid var(--line);vertical-align:top;text-align:left;overflow-wrap:anywhere;line-height:1.85}thead th{font-size:12px;color:#314c64;letter-spacing:.02em}tbody th{font-size:13px;font-weight:700;color:#244760}tbody td{font-size:13px}th:first-child{width:19%}tbody tr:nth-child(even){background:#f9fbfd}tbody tr:hover{background:#edf5fb}code{font-family:Consolas,"Yu Gothic UI",monospace;font-size:.91em;overflow-wrap:anywhere;background:#edf2f7;padding:1px 4px;border-radius:3px}.source{font-family:Consolas,"Yu Gothic UI",monospace;font-size:11px;overflow-wrap:anywhere}.refs{display:flex;gap:10px 20px;flex-wrap:wrap;line-height:1.7;margin:10px 0 0}.ref-entry{display:block;font-size:12px}.formula{padding:22px;background:#142d43;color:#e8f1f8;margin:24px 0;overflow:auto}.formula strong{display:block;color:#a8dfd8;margin-bottom:12px}.formula code{display:block;white-space:normal;background:transparent;color:#e6f1f9;line-height:2.1;font-size:14px;padding:0}.formula p{font-size:12px;color:#bcd0df;margin:14px 0 0}figure{margin:22px 0 28px;background:#fff;border:1px solid var(--line)}figcaption{padding:13px 18px;background:#eaf0f5;font-weight:700;font-size:14px;border-bottom:1px solid var(--line)}figcaption span{display:block;font-weight:400;color:var(--muted);font-size:11px;margin-top:2px}.diagram-scroll{overflow:auto;padding:12px 0}.diagram-scroll svg{display:block;width:100%;min-width:900px;height:auto}.node rect{fill:#f1f7fb;stroke:#7795ad;stroke-width:1.3}.node.branch rect{fill:#fff5e3;stroke:#b28b4c}.node.partial rect{fill:#f1edf7;stroke:#9982b8}.node:hover rect{stroke:#153f60;stroke-width:2.5}.node-owner{font-size:12px;fill:#52697d;font-weight:600}.node-title{font-size:16px;fill:#17384f;font-weight:700}.node-body{font-size:13px;fill:#314b61}.edge-label{font-size:12px;fill:#33485c;paint-order:stroke;stroke:white;stroke-width:6px;stroke-linejoin:round}.band-label{font-size:12px;fill:#6b7d8b}footer{font-size:12px;color:var(--muted);margin-top:28px}.top-link{position:fixed;bottom:20px;right:20px;padding:8px 16px;border:1px solid #7592a7;border-radius:5px;background:#fff;color:#244c68;text-decoration:none;font-size:12px;box-shadow:0 3px 12px #1b395b18}@media(min-width:1550px){main{padding-left:56px;padding-right:56px}tbody td{font-size:14px}}@media(max-width:1050px){.shell{grid-template-columns:190px minmax(0,1fr)}aside{padding-left:12px;padding-right:10px}main{padding:30px 22px}nav a{font-size:11px;padding:7px 4px}.section-head h2{font-size:21px}}@media(max-width:700px){.shell{display:block}aside{position:relative;height:auto;padding:20px}nav{display:grid;grid-template-columns:1fr 1fr;gap:3px}nav a{font-size:11px}.brand small{display:inline;margin-left:10px}aside p{margin:8px 0}.print{width:auto;margin-top:8px}main{padding:28px 16px}.metadata{gap:5px 15px}.section-head{gap:10px}.section-head>span{font-size:24px}.section-head h2{font-size:20px}body{font-size:14px}.note{padding:12px 14px}figure{margin-left:0;margin-right:0}.top-link{bottom:10px;right:10px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}@media print{@page{size:A3 landscape;margin:14mm}html{scroll-behavior:auto}.shell{display:block}aside,.top-link{display:none}body{background:white;font-size:11pt}main{padding:0}.hero{margin-bottom:20px}section{break-before:page;padding-top:0}h1{font-size:30pt}.section-head h2{font-size:21pt}.table-wrap,.diagram-scroll{overflow:visible}table{min-width:0}thead{display:table-header-group}tbody tr{break-inside:avoid}figure{break-inside:avoid}.diagram-scroll svg{min-width:0;width:100%;max-height:190mm}.note{break-inside:avoid}a{color:inherit}.formula{background:#eaf0f6;color:#142d43}.formula code,.formula p,.formula strong{color:#142d43}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body id="top"><div class="shell"><aside><div class="brand">DevTax<small>WORKFLOW BLUEPRINT</small></div><p>目的・採用設計・現行の実行経路<br>確認日 2026-09-08</p><nav aria-label="設計図の目次">${sections.map(s=>`${s.no==='P1'?'<div class="nav-group">目的とあるべき完成像</div>':s.no==='R1'?'<div class="nav-group">採用した技術・画面設計</div>':s.no==='01'?'<div class="nav-group">現行実装の設計図</div>':''}<a href="#${s.id}"><span>${s.no}</span>${s.title}</a>`).join('')}</nav><button type="button" class="print" id="print-button">印刷 / PDFに保存</button></aside><main><header class="hero"><div class="eyebrow">PURPOSE / COMPLETE PRODUCT DESIGN / CURRENT WORKFLOW</div><h1>DevTax<br>どうあるべきかを描く設計図</h1><p>個人開発の先行支出を、制作物・開発実態・根拠へ結び付け、今年と翌年以後の扱いを説明できる記録にする。その目的から、開発の全期間と年をまたぐ費用・残高・判断の完成像を定め、現行の画面・API・計算・保存・配布まで照合する。</p><div class="reading-path"><a href="#purpose">P1–P6　目的・完成像・全期間・責務</a><a href="#redesign">R1–R6　構造・画面・記録・完成条件</a><a href="#status">01–19　現行の流れ・分岐・実行主体</a></div><div class="metadata"><span>基点HEAD <strong>d917885 + 作業ツリー改訂</strong></span><span>${sections.length}章 / ${diagramN}フロー図</span><span>採用仕様 v0.5 / 実装状態は別記</span><span>外部ライブラリ不要 / UTF-8</span></div></header>${sections.map(s=>s.html).join('\n')}<footer>DevTax workflow blueprint — 2026-09-08 / 基点HEAD d917885 + 未コミットのv0.5改訂。今後コードが変わった場合は、索引の行番号と接続状態を再確認する。</footer></main></div><a class="top-link" href="#top">先頭へ</a><script>
document.getElementById('print-button').addEventListener('click',()=>window.print());
const navLinks=[...document.querySelectorAll('nav a')];
const observer=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting){navLinks.forEach(link=>{const active=link.getAttribute('href')==='#'+entry.target.id;link.classList.toggle('active',active);if(active)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');});}}},{rootMargin:'-5% 0px -75% 0px'});
document.querySelectorAll('main>section').forEach(section=>observer.observe(section));
</script></body></html>`;
const output=path.join(root,'docs/design/workflow-blueprint.html');
fs.writeFileSync(output,html,'utf8');
console.log(JSON.stringify({output,bytes:Buffer.byteLength(html),sections:sections.length,diagrams:diagramN,references:refs.size}));
