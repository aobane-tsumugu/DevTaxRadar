// Evidence helper only. This is not the product's Node24/Vitest acceptance gate.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ts = require(process.env.DEVTAX_TEST_TYPESCRIPT || 'typescript');
const root = path.resolve(__dirname, '../../..');
const files = [
  'src/server/bundleFile.ts',
  'tests/server/bundleFile.test.ts',
  'tests/server/designDocs.test.ts',
];
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'devtax-focused-evidence-'));
try {
  const hashes = {};
  fs.writeFileSync(path.join(stage, 'package.json'), '{"type":"module"}\n');
  for (const file of files) {
    const original = fs.readFileSync(path.join(root, file), 'utf8');
    hashes[file] = createHash('sha256').update(original).digest('hex');
    if (file.startsWith('tests/') && (original.match(/from 'vitest'/g) || []).length !== 1)
      throw new Error('Expected exactly one test-framework import: ' + file);
    const source = original.replace("from 'vitest'", "from 'node:test'");
    const result = ts.transpileModule(source, {
      fileName: file,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      reportDiagnostics: true,
    });
    if (result.diagnostics.length) throw new Error('Transpile diagnostics: ' + file);
    const destination = path.join(stage, file.replace(/\.ts$/, '.js'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, result.outputText);
  }
  const verifier = 'scripts/design/verify-docs.cjs';
  const bytes = fs.readFileSync(path.join(root, verifier));
  hashes[verifier] = createHash('sha256').update(bytes).digest('hex');
  fs.mkdirSync(path.join(stage, 'scripts/design'), { recursive: true });
  fs.writeFileSync(path.join(stage, verifier), bytes);
  console.error(JSON.stringify({
    scope: 'checksum helper and document verifier with synthetic fixtures only',
    node: process.version, typescript: ts.version, platform: process.platform,
    frameworkChange: 'vitest import to node:test only',
    validationSubstituted: false, fullTypecheck: false, fullVitest: false,
    actualProductHtmlVerified: false, productApiExecuted: false, hashes,
  }, null, 2));
  const run = spawnSync(process.execPath, [
    '--test', 'tests/server/bundleFile.test.js', 'tests/server/designDocs.test.js',
  ], { cwd: stage, encoding: 'utf8', timeout: 30000 });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  if (run.error) throw run.error;
  process.exitCode = run.status === 0 ? 0 : 1;
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
