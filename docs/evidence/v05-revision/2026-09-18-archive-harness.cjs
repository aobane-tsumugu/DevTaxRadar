// Limited evidence runner, not the Node24/Vitest or release acceptance gate.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ts = require(process.env.DEVTAX_TEST_TYPESCRIPT || 'typescript');
const root = path.resolve(__dirname, '../../..');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'devtax-archive-evidence-'));
const files = [
  'src/server/storedReview.ts', 'src/server/reviewArchive.ts', 'src/server/reviewArchiveCli.ts',
  'src/core/reviewExport.ts', 'src/core/costExport.ts', 'src/core/costLotLabel.ts',
  'src/core/consultationResolution.ts', 'scripts/read-review.ts',
  'tests/server/reviewArchive.test.ts',
];
const fixtures = ['stored-review-v1.json', 'stored-review-materials-v1.json'];
try {
  const hashes = {};
  fs.writeFileSync(path.join(stage, 'package.json'), '{"type":"module"}\n');
  for (const file of files) {
    const original = fs.readFileSync(path.join(root, file), 'utf8');
    hashes[file] = createHash('sha256').update(original).digest('hex');
    if (file.startsWith('tests/') && (original.match(/from 'vitest'/g) || []).length !== 1)
      throw new Error('Expected exactly one test-framework import: ' + file);
    const source = file.startsWith('tests/')
      ? original.replace("from 'vitest'", "from 'node:test'") : original;
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
  for (const name of fixtures) {
    const file = 'fixtures/archive/' + name;
    const bytes = fs.readFileSync(path.join(root, file));
    hashes[file] = createHash('sha256').update(bytes).digest('hex');
    fs.mkdirSync(path.join(stage, 'fixtures/archive'), { recursive: true });
    fs.writeFileSync(path.join(stage, file), bytes);
  }
  const run = spawnSync(process.execPath, ['--test', 'tests/server/reviewArchive.test.js'], {
    cwd: stage, encoding: 'utf8', timeout: 30000,
  });
  console.error(JSON.stringify({
    parentCommit: 'c4a1a5b04292a86205fad936fd3f0a6c249dd20b',
    node: process.version, typescript: ts.version, platform: process.platform,
    scope: 'real SQLite saved-record reading and existing renderers; synthetic stored v1 fixtures',
    frameworkChange: 'vitest import to node:test only',
    databaseSubstituted: false, validationSubstituted: false, exportSubstituted: false,
    cliChildProcessExecuted: true, fullTypecheck: false, fullVitest: false,
    fullProductApiExecuted: false, releaseLifecycleExecuted: false, deviceAcceptance: false,
    exitStatus: run.status,
    tests: Number(run.stdout?.match(/^# tests (\d+)/m)?.[1] ?? 0),
    passed: Number(run.stdout?.match(/^# pass (\d+)/m)?.[1] ?? 0),
    failed: Number(run.stdout?.match(/^# fail (\d+)/m)?.[1] ?? 0),
    skipped: Number(run.stdout?.match(/^# skipped (\d+)/m)?.[1] ?? 0),
    tapSha256: createHash('sha256').update(run.stdout || '').digest('hex'), hashes,
  }, null, 2));
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  if (run.error) throw run.error;
  process.exitCode = run.status === 0 ? 0 : 1;
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
