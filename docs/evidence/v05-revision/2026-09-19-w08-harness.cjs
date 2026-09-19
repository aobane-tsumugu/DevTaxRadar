// Evidence-only runner: source and validation stay intact, only the test-framework import is adapted.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const ts = require(process.env.DEVTAX_TEST_TYPESCRIPT || 'typescript');
const root = path.resolve(__dirname, '../../..');
const integrated = root;
const originalRoot = root;
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'devtax-w08-focus-'));
const files = [
  'src/core/taxDecision.ts', 'src/core/costTreatmentFacts.ts', 'src/core/costTreatments.ts',
  'src/core/costTreatmentExport.ts', 'src/server/costTreatmentFactsRepository.ts',
  'src/core/workspaceMerge.ts', 'src/core/workspaceChange.ts', 'src/core/reviewHistory.ts',
  'tests/core/helpers/treatmentFixtures.ts', 'tests/core/costTreatments.test.ts', 'tests/server/costTreatmentFactsRepository.test.ts',
  'tests/core/costTreatmentIntegration.test.ts',
  'src/core/annualMethodComparison.ts', 'src/core/straightLineRates.ts', 'src/core/costMethodConnection.ts',
  'src/core/treatmentDecisionBinding.ts', 'src/core/costTreatmentDraft.ts', 'src/core/treatmentDecisionReferences.ts',
  'src/core/balanceCostDraft.ts', 'src/core/decisionConfirmation.ts',
  'src/server/decisionTreatmentBindingsRepository.ts',
  'tests/core/annualMethodComparison.test.ts', 'tests/core/costTreatmentDraft.test.ts',
  'tests/server/decisionTreatmentBindingsRepository.test.ts',
  'tests/server/currentDesign.test.ts', 'tests/server/currentDesignInputs.test.ts',
];
try {
  fs.writeFileSync(path.join(stage, 'package.json'), '{"type":"module"}\n');
  const sources = {};
  const tests = [];
  for (const file of files) {
    const modified = path.join(integrated, file);
    const originalPath = path.join(originalRoot, file);
    const filename = fs.existsSync(modified) ? modified : originalPath;
    if (!fs.existsSync(filename)) throw new Error('Missing exact verification source: '+file);
    let original = fs.readFileSync(filename, 'utf8');
    if (file.endsWith('.test.ts') && (original.match(/from 'vitest'/g) || []).length !== 1)
      throw new Error('Unexpected test framework imports: '+file);
    sources[file] = createHash('sha256').update(original).digest('hex');
    const source = file.startsWith('tests/') ? original.replace("from 'vitest'", "from 'node:test'") : original;
    const result = ts.transpileModule(source, {fileName:file, reportDiagnostics:true,
      compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
    if (result.diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(result.diagnostics, {
      getCurrentDirectory:()=>root,getCanonicalFileName:f=>f,getNewLine:()=> '\n'}));
    const destination = path.join(stage,file.replace(/\.ts$/,'.js'));
    fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,result.outputText);
    if (file.endsWith('.test.ts')) tests.push(file.replace(/\.ts$/,'.js'));
  }

  for (const file of ['scripts/design/route-inventory.cjs','scripts/design/render-current-design.cjs',
    'scripts/design/build-workflow-blueprint.cjs','scripts/design/verify-docs.cjs','scripts/design/verify-current-inputs.cjs',
    'docs/design/current-design.json','docs/design/acceptance-scenarios.md',
    'docs/design/requirements-matrix.md','docs/design/workflow-blueprint.html','src/server/observationRoutes.ts']) {
    const filename = fs.existsSync(path.join(integrated,file)) ? path.join(integrated,file) : path.join(originalRoot,file);
    const bytes = fs.readFileSync(filename);
    const destination = path.join(stage,file);
    fs.mkdirSync(path.dirname(destination),{recursive:true});
    fs.writeFileSync(destination,bytes);
    sources[file] = createHash('sha256').update(bytes).digest('hex');
  }
  if (!tests.length) throw new Error('No tests were selected');
  const run=spawnSync(process.execPath,['--test',...tests],{cwd:stage,encoding:'utf8',timeout:40000});
  const field = key=>Number(run.stdout?.match(new RegExp('^# '+key+' (\\d+)','m'))?.[1]??0);
  const result={baseCommit:'6f574c4606e5e069640df96065d72bd081a33414',documentationCommit:'f4e92ef2d75f3006d101f4d693a62331da43bd15',node:process.version,typescript:ts.version,
    platform:process.platform,frameworkChange:'vitest import to node:test only',
    existingTaxDecisionBlob:'70b3bf5cc3128e120f82ad70cb846f844eae2e89',
    productValidationSubstituted:false,databaseSubstituted:false,
    fullNode24Vitest:false,fullTypecheck:false,reactInteraction:false,fullApi:false,
    actualBlueprintRegenerated:true,fullCheckoutDocumentationCheck:false,deviceAcceptance:false,
    tests:field('tests'),passed:field('pass'),failed:field('fail'),skipped:field('skipped'),exitStatus:run.status,
    sourceHashes:sources};
  process.stdout.write(run.stdout || '');
  if (run.stderr) process.stderr.write(run.stderr);
  process.stderr.write(JSON.stringify(result,null,2)+'\n');
  if (run.error) throw run.error;
  process.exitCode=run.status===0 && result.tests>0 ? 0 : 1;
} finally { fs.rmSync(stage,{recursive:true,force:true}); }
