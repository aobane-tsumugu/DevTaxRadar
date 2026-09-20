const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { extractRoutes } = require('./route-inventory.cjs');
const { readInputs } = require('./render-current-design.cjs');
const digest = value => createHash('sha256').update(value).digest('hex');
const gitBlob = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const registrationSources = ['src/server/index.ts', 'src/server/balanceRoutes.ts', 'src/server/observationRoutes.ts'];

/** Check the actual checkout, not a fixed count or a hand-written route sample. */
function verifyCurrentInputs(root) {
  const { model, acceptance } = readInputs(root);
  const spec = fs.readFileSync(path.join(root, 'PRODUCT_SPEC.md'), 'utf8');
  const required = [...spec.matchAll(/^(REQ-[A-Z]+-\d+):/gm)].map(match => match[1]);
  assert.equal(new Set(required).size, required.length, 'duplicate specification requirement');
  assert.deepEqual([...required].sort(), model.requirements.map(row => row.id).sort(), 'specification requirement coverage');
  assert.deepEqual(Object.keys(model.sourceBlobs).sort(), [...registrationSources].sort(), 'API registration sources changed');
  const actual = [];
  for (const source of registrationSources) {
    const bytes = fs.readFileSync(path.join(root, source));
    // sourceBlobs records the reviewed historical baseline, not an everyday gate.
    // Comments, formatting and handler internals do not change a route contract.
    for (const [, method, route] of extractRoutes(bytes.toString('utf8')))
      actual.push(method.toUpperCase() + ' ' + route + ' ' + source);
  }
  assert.equal(new Set(actual.map(row => row.split(' ').slice(0, 2).join(' '))).size, actual.length, 'duplicate registered API route');
  const documented = model.api.map(row => row.method + ' ' + row.path + ' ' + row.source);
  assert.deepEqual(actual.sort(), documented.sort(), 'API inventory differs from registered routes or source modules');
  const refs = new Set([...model.requirements.flatMap(row => row.refs), ...model.works.map(row => row.source)]);
  for (const ref of refs) {
    assert.ok(/^(src|scripts|docs)\/[A-Za-z0-9_./-]+$/.test(ref) && !ref.split('/').includes('..'), 'unsafe source reference');
    assert.ok(fs.statSync(path.join(root, ref)).isFile(), ref + ': not a source file');
  }
  const plan = fs.readFileSync(path.join(root, 'docs/design/implementation-plan.md'), 'utf8');
  const conditions = plan.split(/\r?\n/).filter(line => line.startsWith('完了条件:'));
  assert.equal(conditions.length, 8, 'missing W01-W08 completion conditions');
  assert.ok(model.contracts, 'missing preserved acceptance contract');
  assert.equal(digest(conditions.join('\n') + '\n'), model.contracts.completionLinesSha256, 'W01-W08 completion conditions changed');
  const rows = acceptance.split(/\r?\n/).filter(line => line.startsWith('| AC-'));
  return { requirements: required.length, apiRoutes: actual.length, references: refs.size,
    acceptanceScenarios: rows.length, completionConditions: conditions.length,
    scope: 'checkout documentation contracts, not product acceptance' };
}
module.exports = { verifyCurrentInputs, gitBlob };
