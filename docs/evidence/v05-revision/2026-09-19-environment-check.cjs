// Reproduce the scoped environment checks without replacing product validators.
// This evidence helper is not the Node24/lockfile CI acceptance gate.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const ts = require(process.env.DEVTAX_TEST_TYPESCRIPT || 'typescript');
const root = path.resolve(__dirname, '../../..');
const sources = [
  'src/core/taxDecision.ts', 'src/core/costTreatmentFacts.ts', 'src/core/costTreatments.ts',
  'src/core/costTreatmentExport.ts', 'src/core/workspaceMerge.ts', 'src/core/workspaceChange.ts',
  'src/core/reviewHistory.ts', 'src/core/annualMethodComparison.ts', 'src/core/straightLineRates.ts',
  'src/core/costMethodConnection.ts', 'src/core/treatmentDecisionBinding.ts',
  'src/core/costTreatmentDraft.ts', 'src/core/treatmentDecisionReferences.ts',
  'src/core/balanceCostDraft.ts', 'src/core/decisionConfirmation.ts',
  'src/server/costTreatmentFactsRepository.ts', 'src/server/decisionTreatmentBindingsRepository.ts',
  'src/client/treatmentProjectionRead.ts', 'tests/core/helpers/treatmentFixtures.ts',
];
const syntaxOnly = ['src/client/pages/TreatmentBalanceDraftPanel.tsx'];
const tests = [
  'tests/core/treatmentEvidenceClosure.test.ts', 'tests/core/costTreatments.test.ts',
  'tests/core/costTreatmentDraft.test.ts', 'tests/core/annualMethodComparison.test.ts',
  'tests/core/costTreatmentIntegration.test.ts', 'tests/server/costTreatmentFactsRepository.test.ts',
  'tests/server/decisionTreatmentBindingsRepository.test.ts', 'tests/server/currentDesign.test.ts',
  'tests/server/currentDesignInputs.test.ts', 'tests/server/designInputIsolation.test.ts',
  'tests/client/treatmentProjectionRead.test.ts',
];
const copiedInputs = [
  'scripts/design/route-inventory.cjs', 'scripts/design/render-current-design.cjs',
  'scripts/design/build-workflow-blueprint.cjs', 'scripts/design/verify-docs.cjs',
  'scripts/design/verify-current-inputs.cjs', 'docs/design/current-design.json',
  'docs/design/acceptance-scenarios.md', 'docs/design/requirements-matrix.md',
  'docs/design/workflow-blueprint.html', 'src/server/observationRoutes.ts',
];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const gitBlob = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'devtax-environment-completion-'));
try {
  const inputs = {};
  function read(name) {
    const source = path.join(root, name);
    if (!fs.lstatSync(source).isFile()) throw new Error('Expected a regular verification source: ' + name);
    const bytes = fs.readFileSync(source);
    inputs[name] = { bytes: bytes.length, sha256: digest(bytes), gitBlob: gitBlob(bytes) };
    return bytes;
  }
  function write(name, bytes) {
    const destination = path.join(stage, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes);
  }
  write('package.json', '{"type":"module"}\n');
  for (const name of [...sources, ...syntaxOnly, ...tests]) {
    const original = read(name).toString('utf8');
    const isTest = tests.includes(name);
    if (isTest && (original.match(/from 'vitest'/g) || []).length !== 1)
      throw new Error('Unexpected test-framework import: ' + name);
    const source = isTest ? original.replace("from 'vitest'", "from 'node:test'") : original;
    const result = ts.transpileModule(source, {
      fileName: name, reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
    });
    if (result.diagnostics.length) throw new Error('Syntax diagnostics: ' + name);
    write(name.replace(/\.tsx?$/, '.js'), result.outputText);
  }
  for (const name of copiedInputs) write(name, read(name));
  const generated = JSON.parse(execFileSync(process.execPath,
    [path.join(stage, 'scripts/design/build-workflow-blueprint.cjs'), '--check'],
    { cwd: stage, encoding: 'utf8', timeout: 20000 }));
  const run = spawnSync(process.execPath, ['--test', ...tests.map(name => name.replace(/\.ts$/, '.js'))], {
    cwd: stage, encoding: 'utf8', timeout: 40000, maxBuffer: 10 * 1024 * 1024,
  });
  const count = key => Number(run.stdout?.match(new RegExp('^# ' + key + ' (\\d+)', 'm'))?.[1] ?? 0);
  const result = {
    node: process.version, typescript: ts.version, platform: process.platform,
    scope: 'W06-W08 scoped execution, not the full repository acceptance suite',
    frameworkChange: 'vitest import to node:test only',
    productionLogicSubstituted: false, databaseSubstituted: false,
    datasetReadTests: 'injected readers; no HTTP server',
    fullTypecheck: false, fullNode24Vitest: false, fullApi: false, reactInteraction: false,
    fullCheckoutDocumentationCheck: false, deviceAcceptance: false,
    tests: count('tests'), suites: count('suites'), passed: count('pass'), failed: count('fail'),
    skipped: count('skipped'), cancelled: count('cancelled'), exitStatus: run.status,
    syntaxOnly, selectedTests: tests, generated, inputs,
    rawTapSha256: digest(run.stdout || ''),
  };
  process.stdout.write(run.stdout || '');
  if (run.stderr) process.stderr.write(run.stderr);
  process.stderr.write(JSON.stringify(result, null, 2) + '\n');
  if (run.error) throw run.error;
  process.exitCode = run.status === 0 && result.tests > 0 && result.failed === 0 &&
    result.cancelled === 0 && result.skipped === 0 ? 0 : 1;
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
