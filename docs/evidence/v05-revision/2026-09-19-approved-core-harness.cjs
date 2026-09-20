// Evidence-only: this does not replace the Node24/lockfile Vitest acceptance gate.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ts = require(process.env.DEVTAX_TEST_TYPESCRIPT || 'typescript');
const root = path.resolve(__dirname, '../../..');
const files = [
  'src/core/taxDecision.ts', 'src/core/costTreatmentFacts.ts', 'src/core/costTreatments.ts',
  'src/core/costTreatmentExport.ts', 'src/server/costTreatmentFactsRepository.ts',
  'tests/core/helpers/treatmentFixtures.ts', 'tests/core/costTreatments.test.ts',
  'tests/server/costTreatmentFactsRepository.test.ts',
  'src/core/annualMethodComparison.ts', 'src/core/straightLineRates.ts',
  'src/core/costMethodConnection.ts', 'src/core/treatmentDecisionBinding.ts',
  'src/core/costTreatmentDraft.ts', 'src/core/treatmentDecisionReferences.ts',
  'src/core/balanceCostDraft.ts', 'src/core/decisionConfirmation.ts',
  'src/server/decisionTreatmentBindingsRepository.ts',
  'tests/core/annualMethodComparison.test.ts', 'tests/core/costTreatmentDraft.test.ts',
  'tests/server/decisionTreatmentBindingsRepository.test.ts',
];
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'devtax-approved-core-'));
try {
  fs.writeFileSync(path.join(stage, 'package.json'), '{"type":"module"}\n');
  const hashes = {}, tests = [];
  for (const file of files) {
    const original = fs.readFileSync(path.join(root, file), 'utf8');
    hashes[file] = createHash('sha256').update(original).digest('hex');
    const isTest = file.endsWith('.test.ts');
    if (isTest && (original.match(/from 'vitest'/g) || []).length !== 1)
      throw new Error('Unexpected test-framework imports: ' + file);
    const source = isTest ? original.replace("from 'vitest'", "from 'node:test'") : original;
    const result = ts.transpileModule(source, {
      fileName: file, reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    });
    if (result.diagnostics.length) throw new Error('Syntax diagnostics: ' + file);
    const relative = file.replace(/\.ts$/, '.js'), output = path.join(stage, relative);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, result.outputText);
    if (isTest) tests.push(relative);
  }
  if (tests.length !== 5) throw new Error('Expected the five scoped regression files');
  const run = spawnSync(process.execPath, ['--test', ...tests], {
    cwd: stage, encoding: 'utf8', timeout: 40000,
  });
  const count = name => Number(run.stdout?.match(new RegExp('^# ' + name + ' (\\d+)', 'm'))?.[1] ?? 0);
  const result = {
    codeCommit: '417b9aa96f88b0d7d4a98ccea83724d4b5e807e7',
    testsCommit: '003d44fc4225f163c3d093052f344db354af9ff5',
    scope: 'Standalone treatment core and SQLite adapters only; application integration excluded',
    node: process.version, typescript: ts.version, platform: process.platform,
    frameworkChange: 'vitest import to node:test only',
    productionLogicSubstituted: false, databaseSubstituted: false,
    fullTypecheck: false, fullNode24Vitest: false, fullApi: false,
    reactInteraction: false, actualBlueprintRegenerated: false, deviceAcceptance: false,
    tests: count('tests'), suites: count('suites'), passed: count('pass'),
    failed: count('fail'), skipped: count('skipped'), cancelled: count('cancelled'),
    exitStatus: run.status, sourceHashes: hashes,
    rawTapSha256: createHash('sha256').update(run.stdout || '').digest('hex'),
  };
  process.stdout.write(run.stdout || '');
  if (run.stderr) process.stderr.write(run.stderr);
  process.stderr.write(JSON.stringify(result, null, 2) + '\n');
  if (run.error) throw run.error;
  process.exitCode = run.status === 0 && result.tests > 0 ? 0 : 1;
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
