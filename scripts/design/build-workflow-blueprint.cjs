const path = require('node:path');
const { generate } = require('./render-current-design.cjs');
const args = process.argv.slice(2);
if (args.some(arg => !['--check', '--verify-inputs'].includes(arg))) throw new Error('Unknown design generation option');
console.log(JSON.stringify(generate(path.resolve(__dirname, '../..'), {
  check: args.includes('--check'), verifyInputs: args.includes('--verify-inputs'),
})));
