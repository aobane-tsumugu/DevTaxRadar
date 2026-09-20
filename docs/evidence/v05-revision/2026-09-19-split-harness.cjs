// Evidence runner for the independently pushed modules, not full application acceptance.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const ts = require(process.env.DEVTAX_TEST_TYPESCRIPT || 'typescript');
const root = path.resolve(__dirname, '../../..');
const stage = fs.mkdtempSync(path.join(os.tmpdir(),'devtax-split-check-'));
const files = ['src/core/annualMethodComparison.ts','src/core/straightLineRates.ts',
  'tests/core/annualMethodAlternatives.test.ts','tests/server/routeInventory.test.ts',
  'scripts/design/route-inventory.cjs','src/server/observationRoutes.ts'];
try {
  fs.writeFileSync(path.join(stage,'package.json'),'{"type":"module"}\n');
  const hashes = {};
  for (const file of files) {
    const original = fs.readFileSync(path.join(root,file),'utf8');
    hashes[file] = createHash('sha256').update(original).digest('hex');
    let output = original;
    let name = file;
    if (file.endsWith('.ts') && !file.endsWith('observationRoutes.ts')) {
      const source = file.endsWith('.test.ts') ? original.replace("from 'vitest'","from 'node:test'") : original;
      const result = ts.transpileModule(source,{fileName:file,reportDiagnostics:true,
        compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
      if (result.diagnostics.length) throw new Error('Syntax diagnostics: '+file);
      output=result.outputText; name=file.replace(/\.ts$/,'.js');
    }
    const target=path.join(stage,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,output);
  }
  const run=spawnSync(process.execPath,['--test','tests/core/annualMethodAlternatives.test.js','tests/server/routeInventory.test.js'],
    {cwd:stage,encoding:'utf8',timeout:30000});
  const field=k=>Number(run.stdout?.match(new RegExp('^# '+k+' (\\d+)','m'))?.[1]??0);
  const result={baseCommit:'c2950f655134bd38a51e8714f23364c7e255c90d',
    scope:'Only independent annual method alternatives and route extraction; not the unpublished integration',
    node:process.version,typescript:ts.version,platform:process.platform,
    frameworkChange:'vitest import to node:test only',productionLogicSubstituted:false,
    fullVitest:false,fullTypecheck:false,applicationApi:false,deviceAcceptance:false,
    tests:field('tests'),passed:field('pass'),failed:field('fail'),skipped:field('skipped'),exitStatus:run.status,
    hashes};
  process.stdout.write(run.stdout || '');
  if (run.stderr) process.stderr.write(run.stderr);
  process.stderr.write(JSON.stringify(result,null,2)+'\n');
  if(run.error)throw run.error;
  process.exitCode=run.status===0?0:1;
} finally {fs.rmSync(stage,{recursive:true,force:true});}
