const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const esc = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const cell = value => String(value).replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ');
const hash = value => createHash('sha256').update(value).digest('hex');
const outputNames = ['docs/design/requirements-matrix.md', 'docs/design/workflow-blueprint.html'];
function readInputs(root) {
  const model = JSON.parse(fs.readFileSync(path.join(root, 'docs/design/current-design.json'), 'utf8'));
  const acceptance = fs.readFileSync(path.join(root, 'docs/design/acceptance-scenarios.md'), 'utf8');
  validate(model, acceptance);
  return { model, acceptance };
}
function validate(model, acceptance) {
  assert.equal(model.version, 1);
  assert.match(model.updatedOn, /^\d{4}-\d{2}-\d{2}$/);
  if (model.contracts) {
    const rows = acceptance.split(/\r?\n/).filter(line => line.startsWith('| AC-')).join('\n') + '\n';
    assert.equal(hash(rows), model.contracts.acceptanceRowsSha256, 'acceptance contract changed');
  }
  assert.match(model.baseline, /^[a-f0-9]{40}$/);
  const unique = (values, label) => assert.equal(values.length, new Set(values).size, label);
  unique(model.requirements.map(r => r.id), 'duplicate requirement');
  unique(model.works.map(w => w.id), 'duplicate work');
  unique(model.api.map(r => r.method + ' ' + r.path), 'duplicate route');
  const accepted = [...acceptance.matchAll(/^\| (AC-[A-Z]+) \|/gm)].map(m => m[1]);
  unique(accepted, 'duplicate acceptance');
  assert.ok(accepted.length > 0, 'no acceptance scenarios');
  for (const r of model.requirements) {
    assert.match(r.id, /^REQ-[A-Z]+-\d+$/);
    assert.ok(r.acceptance.length, r.id + ': no acceptance mapping');
    for (const id of r.acceptance) assert.ok(accepted.includes(id), 'unknown acceptance: ' + id);
    for (const file of r.refs) assert.ok(/^(src|scripts|docs)\/[A-Za-z0-9_./-]+$/.test(file) && !file.split('/').includes('..'), 'unsafe reference');
  }
  for (const r of model.api) {
    assert.ok(['GET','POST','PUT','PATCH','DELETE'].includes(r.method));
    assert.match(r.path, /^\/api\/[A-Za-z0-9_/:.-]+$/);
    assert.ok(Object.hasOwn(model.sourceBlobs, r.source), 'unknown route registration source');
  }
  assert.deepEqual(model.works.map(w => w.id), ['W01','W02','W03','W04','W05','W06','W07','W08']);
}
function renderMatrix(model, acceptance) {
  return '# DevTax v0.5 要件・実装・受入対応表\n\n' +
    `更新日: ${model.updatedOn}\n実装差分基点: \`${model.baseline}\`。${model.delivery}\n\n` +
    '製品仕様v0.5の要求・既存の受入条件を維持する。以下は現在の接続範囲であり、各ACの総合受入済みを示さない。実機確認は別枠、正式環境の全体試験は未実施として区別する。\n\n' +
    '現在地は[CURRENT](../evidence/v05-revision/CURRENT.md)、完了条件は[実装計画](implementation-plan.md)、設計目標は[製品仕様](../../PRODUCT_SPEC.md)を参照。\n\n' +
    '## 要件からコードと受入条件への対応\n\n| 要件ID | 責務 | 現行の接続状態と根拠 | 受入条件 |\n| --- | --- | --- | --- |\n' +
    model.requirements.map(r => `| ${r.id} | ${cell(r.title)} | ${cell(r.state)} ${r.refs.map(file => `[${path.basename(file)}](../../${file})`).join(' ')} | ${r.acceptance.join('、')} |`).join('\n') +
    '\n\n' + acceptance.trimEnd() + '\n\n## 検証範囲と残る製品上の境界\n\n' +
    model.boundaries.map(s => '- ' + s).join('\n') + '\n\n' +
    'この表と設計図は `current-design.json` と `acceptance-scenarios.md` から同時生成する。金額の保存則は実製品の試験で検査し、この文書検査に算術定数を再記述して合格を作らない。\n';
}
function renderHtml(model, acceptance) {
  const ref = file => `<a class="source" href="../../${esc(file)}">${esc(file)}</a>`;
  const table = (headers, rows) => `<div class="scroll" tabindex="0"><table><thead><tr>${headers.map(h => '<th>'+esc(h)+'</th>').join('')}</tr></thead><tbody>${rows.map(row => '<tr>'+row.map(v => '<td>'+v+'</td>').join('')+'</tr>').join('')}</tbody></table></div>`;
  const diagram = (id, title, steps) => `<figure id="${id}"><figcaption>${esc(title)}</figcaption><div class="flow">${steps.map((s,i) => `${i ? '<span class="arrow" aria-hidden="true">→</span>' : ''}<div><strong>${esc(s[0])}</strong><p>${esc(s[1])}</p></div>`).join('')}</div></figure>`;
  const acRows = acceptance.split('\n').filter(line => /^\| AC-/.test(line)).map(line => line.split('|').slice(1,-1).map(s => s.trim()));
  return `<!doctype html>\n<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DevTax | 現行実装とW01–W08の対応</title>
<style>
:root{color-scheme:light;--ink:#182c3c;--muted:#506472;--line:#d4dfe3;--accent:#126a65}*{box-sizing:border-box}body{margin:0;background:#f5f7f7;color:var(--ink);font:16px/1.9 system-ui,"Yu Gothic",Meiryo,sans-serif}a{color:var(--accent);overflow-wrap:anywhere}a:focus-visible,[tabindex]:focus-visible{outline:3px solid #af6d22;outline-offset:4px}.shell{max-width:1480px;margin:auto;display:grid;grid-template-columns:230px minmax(0,1fr)}aside{background:#182f40;padding:30px 20px;color:#fff;position:sticky;top:0;height:100vh;overflow:auto}aside a{color:#d8ebe8;display:block;padding:8px 0;text-decoration:none}aside strong{font-size:28px}main{min-width:0;padding:40px}h1{font-size:clamp(28px,4vw,42px);line-height:1.4}h2{font-size:26px;margin-top:0}h3{font-size:20px}section{padding:30px 0;border-bottom:1px solid var(--line);scroll-margin:24px}.lead{font-size:18px}.muted,.source{color:var(--muted);font-size:13px}.note{padding:20px;border-left:4px solid var(--accent);background:#e7f0ed}.warning{background:#fff2df;border-left-color:#ab792c}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;min-width:720px;background:white;margin:18px 0}th,td{text-align:left;vertical-align:top;padding:13px 15px;border-bottom:1px solid var(--line)}th{background:#e5ecef}td{overflow-wrap:anywhere}figure{margin:24px 0;background:white;border:1px solid var(--line);padding:20px}figcaption{font-weight:700;margin-bottom:16px}.flow{display:flex;align-items:stretch;gap:12px;flex-wrap:wrap}.flow>div{padding:14px;background:#eaf2ef;flex:1;min-width:150px}.flow p{margin:6px 0;font-size:14px}.arrow{align-self:center}code,pre{font-family:Consolas,monospace}pre{white-space:pre-wrap;background:#edf1f3;padding:20px}.work{margin:18px 0;padding:22px;background:white;border:1px solid var(--line)}.tag{font-size:13px;color:var(--accent);font-weight:700}footer{padding:30px 0;font-size:13px}details{margin:12px 0}summary{cursor:pointer;font-weight:600} @media(max-width:850px){.shell{display:block}aside{position:static;height:auto}aside nav{display:flex;gap:14px;flex-wrap:wrap}main{padding:24px 18px}.arrow{display:none}}@media print{aside{display:none}.shell{display:block}main{padding:0}body{background:white;font-size:11pt}.scroll{overflow:visible}table{min-width:0}tr,figure,.work{break-inside:avoid}section{break-before:auto}*{print-color-adjust:exact}}
</style></head><body><div class="shell"><aside><strong>DevTax</strong><p>現行実装と受入の対応</p><nav><a href="#status">現在地</a><a href="#flow">保存と計算</a><a href="#methods">方法比較</a><a href="#works">W01–W08</a><a href="#requirements">要件対応</a><a href="#api">API一覧</a><a href="#security">秘密境界・復元</a><a href="#acceptance">受入条件</a><a href="#verification">検証と残件</a></nav></aside><main>
<section id="status"><span class="tag">CURRENT IMPLEMENTATION / ${esc(model.updatedOn)}</span><h1>費用の入力から、判断・年次資料へ</h1><p class="lead">原額・費用基礎・最終配分・条件付き候補・採用版を区別し、どこで保存し、何を検査するかを示します。</p><p>基点 <code>${esc(model.baseline)}</code></p><div class="note warning">${esc(model.delivery)} 各Wの総合受入完了や税務適用の認定を示す図ではありません。</div><p>目標仕様・P1–R6の設計意図は ${ref('PRODUCT_SPEC.md')}、${ref('docs/design/purpose-led-redesign.md')} と ${ref('docs/design/workflow-blueprint.legacy.html')} に保持しています。以前の手作業の行番号・旧API・旧数値を現行経路として再利用しません。</p></section>
<section id="flow"><h2>同じ入力版から、同じ数値を使う</h2>${diagram('flow-costs','1. 費用・条件・候補の経路', [['入力','料金・設備・自宅・直接費、事実と根拠'],['workspace保存','期待版・要求ID・SAVEPOINT、競合時は比較'],['共通費用projection','原額→費用基礎→最終配分。未知はnull'],['条件付き候補','確認元一致・事実・例外を検査。自動採用なし']])}${diagram('flow-records','2. 判断と採用の経路', [['判断案','候補元を固定した未確認の判断'],['本人確認','既存の判断記録で確認。変更後は未確認'],['残高の入力案','既存原価補完で未使用分のみ。作業中draftへ追加'],['年度採用','最新入力と候補元・原価・前年度をサーバー再照合']])}<p>${ref('src/core/costTreatmentDraft.ts')} / ${ref('src/core/treatmentDecisionReferences.ts')} / ${ref('src/server/reviewMaterials.ts')}</p><div class="note">通常経費を架空の残高へ増減させません。供用・振替・費用化には既存の残額使用経路を利用し、原価の各段階を重ねて合計しません。</div></section>
<section id="methods"><h2>方法ごとの年次費用・残高を比較</h2><p>少額等の判定に最終配分の一部分や設備の年額償却分を使いません。設備は原額、ソフトは明示確認した資産全体原価を使い、原価不足・条件不足は比較できない理由を返します。</p>${table(['比較','計算と制限'],[['普通定額法','既存と共通の償却率表、供用月、残存額、現実の前年残高を使用。過去の償却実績を推定しない。'],['少額・3年一括・青色特例','所得・取得時期・貸付用途・上限・明細等を明示確認。制度期限後を延長済みと仮定しない。'],['比較上の端数','切上げと最終年上限を明示した試算条件として確認する。実申告の端数処理を認定した説明ではない。'],['記録への影響','比較表は代替案。相互に合算せず、保存済み費用・残高を自動変更しない。']])}<p>${ref('src/core/annualMethodComparison.ts')} / ${ref('src/core/costMethodConnection.ts')} / ${ref('docs/design/method-comparison-rule.md')}</p></section>
<section id="works"><h2>W01–W08の実装上の現在地</h2>${model.works.map(w => `<article class="work" id="${w.id}"><span class="tag">${w.id}</span><h3>${esc(w.title)}</h3><p>${esc(w.implementation)}</p>${ref(w.source)}</article>`).join('')}<p>変更していない完了条件は ${ref('docs/design/implementation-plan.md')} を参照してください。</p></section>
<section id="requirements"><h2>${model.requirements.length}要件の対応</h2>${table(['要件','責務と現在の接続','根拠・受入ID'],model.requirements.map(r => [`<strong>${esc(r.id)}</strong>`, `<strong>${esc(r.title)}</strong><p>${esc(r.state)}</p>`,r.refs.map(ref).join('<br>')+'<p>'+r.acceptance.map(esc).join(' / ')+'</p>']))}</section>
<section id="api"><h2>登録されたAPI：${model.api.length}ルート</h2><p>3つの登録元と対応させます。CLIはHTTP API数へ含めません。型引数付き登録も抽出し、記載漏れと撤去済み経路の残記載を双方向に検査します。</p>${table(['Method / path','責務','登録元'],model.api.map(r => [`<code>${r.method} ${esc(r.path)}</code>`,esc(r.purpose),ref(r.source)]))}</section>
<section id="security"><h2>秘密参照・出力・復元の境界</h2>${diagram('flow-portability','3. 記録を持ち出し、原本なしで読む', [['個人用backup','全DBとsalt。元本文や証拠ファイル本体は含まない'],['verify / restore','hash・schema・整合性。新規保存先のみ'],['data:read','通常起動・原本接続・移行なしで固定版を読取'],['相談用出力','指定版のJSON/Markdown。自由記述は共有前確認']])}<p>loopback / Origin / CSRFの境界を保持。専用localReferenceを出力へ足さず、自由記述を匿名化済みと称しません。生成器も個人DB・HOME・元履歴を読み取りません。</p><p>${ref('src/server/security.ts')} / ${ref('docs/READING-SAVED-REVIEWS.md')}</p><pre>npm run data:read -- list "DATA_OR_BACKUP_DIRECTORY"\nnpm run data:read -- export "DATA_OR_BACKUP_DIRECTORY" "REVIEW_ID" markdown "NEW_FILE.md"</pre></section>
<section id="acceptance"><h2>維持する${acRows.length}受入シナリオ</h2><p>以下は合格条件であり、実施済み結果一覧ではありません。基点c2950f6にある条件文をそのまま保持しています。</p>${table(['ID','入力・操作','合格条件'],acRows.map(row => row.map(esc)))}<details id="R6"><summary>R6の配分例・2年例について</summary><p>AC-ALLOCのR6は従来の設計の4費用合成例を参照します。上の受入条件と ${ref('docs/design/purpose-led-redesign.md')} の設計を維持し、文書内の定数の足算を製品試験の代わりにしません。</p></details></section>
<section id="verification"><h2>検証と、完了宣言の境界</h2>${model.boundaries.map(s => '<p class="note">'+esc(s)+'</p>').join('')}<p>今回の実行範囲・ログ・未実施は ${ref('docs/evidence/v05-revision/CURRENT.md')} に集約します。旧成功件数を新HEADの全体成功へ加算しません。</p><pre>node scripts/design/build-workflow-blueprint.cjs\nnode scripts/design/build-workflow-blueprint.cjs --check\nnode scripts/design/verify-docs.cjs</pre><p>生成チェックは元ファイルを自動修復しません。要件表だけが古い場合も失敗させ、生成元・生成物の不一致を隠しません。</p></section>
<footer>生成モデル ${esc(model.updatedOn)} / 元資料SHA-256 ${hash(JSON.stringify(model)+'\n'+acceptance)}<br>現行実装の説明。製品全体の受入結果とは別。</footer></main></div></body></html>\n`;
}
function artifacts(root) {
  const { model, acceptance } = readInputs(root);
  return { [outputNames[0]]: renderMatrix(model, acceptance), [outputNames[1]]: renderHtml(model, acceptance) };
}
function generate(root, { check = false, verifyInputs = false } = {}) {
  const values = artifacts(root);
  if (verifyInputs) assert.equal(fs.readFileSync(path.join(root, outputNames[0]), 'utf8'), values[outputNames[0]], 'requirements-matrix.md is stale');
  for (const [name, text] of Object.entries(values)) {
    const file = path.join(root, name);
    if (check) assert.equal(fs.readFileSync(file, 'utf8'), text, name + ' is stale');
    else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text, 'utf8'); }
  }
  return { scope: 'generated documentation only; not product acceptance', artifacts: Object.fromEntries(Object.entries(values).map(([name,text])=>[name,{bytes:Buffer.byteLength(text),sha256:hash(text)}])), checked: check };
}
module.exports = { validate, readInputs, renderMatrix, renderHtml, artifacts, generate };
