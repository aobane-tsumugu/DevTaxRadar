const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const html = read('docs/design/workflow-blueprint.html');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
assert.equal(ids.length, new Set(ids).size, 'duplicate HTML id');
for (const [, href] of html.matchAll(/<a\b[^>]*href="([^"]+)"/g)) {
  if (href.startsWith('#')) assert.ok(ids.includes(href.slice(1)), href);
  else if (href.startsWith('../../')) assert.ok(fs.existsSync(path.join(root, href.slice(6))), href);
  else assert.ok(href.startsWith('https://www.nta.go.jp/'), href);
}
assert.ok(!/<script\b[^>]+src=|<link\b/i.test(html), 'external resources');
for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(match[1]);
const api = html.slice(html.indexOf('<section id="api"'), html.indexOf('<section id="security"'));
const routes = [...(read('src/server/index.ts') + '\n' + read('src/server/balanceRoutes.ts')).matchAll(/app\.(get|post|put|patch|delete)\('([^']+)'/g)];
for (const [, method, route] of routes) assert.ok(api.includes(method.toUpperCase() + ' ' + route), route);
const documents = ['PRODUCT_SPEC.md', 'TECHNICAL_DESIGN.md', 'README.md', 'docs/design/purpose-led-redesign.md', 'docs/design/requirements-matrix.md'];
for (const name of documents) {
  const text = read(name);
  assert.ok(!text.includes('\uFFFD') && !/[\u{1F300}-\u{1FAFF}]/u.test(text), name + ': encoding/emoji');
  for (const [, href] of text.matchAll(/\]\(([^\s)]+)\)/g)) {
    if (/^https?:\/\/|^#/.test(href)) continue;
    assert.ok(fs.existsSync(path.resolve(root, path.dirname(name), href.split('#')[0])), name + ': ' + href);
  }
}
assert.ok(!html.includes('\uFFFD') && !/[\u{1F300}-\u{1FAFF}]/u.test(html));
const spec = read('PRODUCT_SPEC.md');
const matrix = read('docs/design/requirements-matrix.md');
const requirements = [...spec.matchAll(/^(REQ-[A-Z]+-\d+):/gm)].map(m => m[1]);
const mapped = [...matrix.matchAll(/^\| (REQ-[A-Z]+-\d+) \|/gm)].map(m => m[1]);
assert.equal(requirements.length, new Set(requirements).size);
assert.deepEqual([...requirements].sort(), [...mapped].sort(), 'requirement coverage');
const acceptance = new Set([...matrix.matchAll(/^\| (AC-[A-Z]+) \|/gm)].map(m => m[1]));
for (const line of matrix.split('\n').filter(line => line.startsWith('| REQ-'))) {
  const references = line.match(/AC-[A-Z]+/g) ?? [];
  assert.ok(references.length, line);
  for (const id of references) assert.ok(acceptance.has(id), id);
}
const allocations = [[3600, 1800, 1800, 800], [6000, 0, 3000, 3000], [3000, 0, 5000, 2000], [3000, 0, 0, 0]];
const sum = a => a.reduce((x, y) => x + y, 0);
assert.deepEqual(allocations.map(sum), [8000, 12000, 10000, 3000]);
assert.deepEqual([0, 1, 2, 3].map(i => sum(allocations.map(r => r[i]))), [15600, 1800, 9800, 5800]);
for (const [opening, incoming, outgoing, closing] of [[20000, 30000, 40000, 10000], [0, 40000, 4000, 36000], [10000, 12000, 15000, 7000], [36000, 15000, 6000, 45000]]) assert.equal(opening + incoming - outgoing, closing);
assert.equal(46000 + 12000 - 6000, 7000 + 45000);
console.log(JSON.stringify({requirements: requirements.length, acceptanceScenarios: acceptance.size, sections: (html.match(/<section id=/g) ?? []).length, diagrams: (html.match(/<figure id=/g) ?? []).length, apiRoutes: routes.length, encoding: 'UTF-8', scope: 'document checks, not product acceptance'}));
