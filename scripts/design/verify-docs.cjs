const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { tmpdir } = require('node:os');
const { extractRoutes } = require('./route-inventory.cjs');

function requireRegularFile(file) {
  assert.ok(fs.lstatSync(file).isFile(), file + ': expected a regular file, not a symbolic link');
}

/** Rebuild in isolation: a check must not repair or overwrite the file it checks. */
function verifyGeneratedBlueprint(root) {
  const output = 'docs/design/workflow-blueprint.html';
  requireRegularFile(path.join(root, output));
  const committed = fs.readFileSync(path.join(root, output));
  const stage = fs.mkdtempSync(path.join(tmpdir(), 'devtax-blueprint-'));
  try {
    // Only the current generator and its declared inputs are needed. Application
    // sources, fixtures, history, dependencies and user settings are not copied.
    const inputs = [
      'scripts/design/build-workflow-blueprint.cjs',
      'scripts/design/render-current-design.cjs',
      'docs/design/current-design.json',
      'docs/design/acceptance-scenarios.md',
      'docs/design/requirements-matrix.md',
    ];
    for (const name of inputs) {
      const parts = name.split('/');
      for (let end = 1; end <= parts.length; end++) {
        const source = path.join(root, ...parts.slice(0, end));
        const entry = fs.lstatSync(source);
        assert.ok(!entry.isSymbolicLink(), parts.slice(0, end).join('/') + ': symbolic link is not a generator input');
        assert.ok(end === parts.length ? entry.isFile() : entry.isDirectory(), name + ': unsupported generator input');
      }
      const destination = path.join(stage, name);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(root, name), destination);
    }
    const generatedPath = path.join(stage, output);
    const generate = () => {
      fs.rmSync(generatedPath, { force: true });
      execFileSync(process.execPath, [path.join(stage, 'scripts/design/build-workflow-blueprint.cjs'), '--verify-inputs'], {
        cwd: stage,
        timeout: 60_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      requireRegularFile(generatedPath);
      return fs.readFileSync(generatedPath);
    };
    const first = generate();
    const second = generate();
    assert.ok(first.equals(second), 'blueprint regeneration is not deterministic');
    assert.ok(first.equals(committed), 'workflow-blueprint.html is stale; regenerate it from the current source');
    return { bytes: first.length, sha256: createHash('sha256').update(first).digest('hex'), passes: 2 };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

function verifyDocs(root = path.resolve(__dirname, '../..')) {
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
  const apiStart = html.indexOf('<section id="api"');
  const apiEnd = html.indexOf('<section id="security"', apiStart);
  assert.ok(apiStart >= 0 && apiEnd > apiStart, 'missing API/security sections');
  const api = html.slice(apiStart, apiEnd);
  const routeSource = ['src/server/index.ts', 'src/server/balanceRoutes.ts', 'src/server/observationRoutes.ts']
    .map(read).join('\n');
  const routes = extractRoutes(routeSource);
  const registered = new Set(routes.map(([, method, route]) => method.toUpperCase() + ' ' + route));
  assert.equal(registered.size, routes.length, 'duplicate registered API route');
  const documented = new Set([...api.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\/api\/[A-Za-z0-9_:.-][A-Za-z0-9_/:.-]*)/g)]
    .map(([, method, route]) => method + ' ' + route));
  for (const route of registered) assert.ok(documented.has(route), 'undocumented route: ' + route);
  for (const route of documented) assert.ok(registered.has(route), 'documented route is not registered: ' + route);
  const documents = ['PRODUCT_SPEC.md', 'TECHNICAL_DESIGN.md', 'README.md', 'docs/design/README.md', 'docs/design/implementation-plan.md', 'docs/design/purpose-led-redesign.md', 'docs/design/requirements-matrix.md'];
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
  const acceptanceIds = [...matrix.matchAll(/^\| (AC-[A-Z]+) \|/gm)].map(m => m[1]);
  const acceptance = new Set(acceptanceIds);
  assert.equal(acceptanceIds.length, acceptance.size, 'duplicate acceptance scenario id');
  for (const line of matrix.split('\n').filter(line => line.startsWith('| REQ-'))) {
    const references = line.match(/AC-[A-Z]+/g) ?? [];
    assert.ok(references.length, line);
    for (const id of references) assert.ok(acceptance.has(id), id);
  }
  const currentInputs = fs.existsSync(path.join(root, 'docs/design/current-design.json'))
    ? require('./verify-current-inputs.cjs').verifyCurrentInputs(root) : undefined;
  // Financial invariants belong to tests of the actual calculation, not copied constants here.
  const regeneration = verifyGeneratedBlueprint(root);
  return { ...(currentInputs ? { currentInputs } : {}), requirements: requirements.length, acceptanceScenarios: acceptance.size,
    sections: (html.match(/<section id=/g) ?? []).length, diagrams: (html.match(/<figure id=/g) ?? []).length,
    apiRoutes: routes.length, encoding: 'UTF-8', regeneration, scope: 'document checks, not product acceptance' };
}

module.exports = { verifyDocs, verifyGeneratedBlueprint };
if (require.main === module) console.log(JSON.stringify(verifyDocs()));
