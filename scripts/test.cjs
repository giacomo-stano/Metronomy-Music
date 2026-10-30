// Run every suite, including new regressions, without maintaining a second list.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const suites = fs.readdirSync(path.join(root, 'tests')).filter(name => name.endsWith('.cjs')).sort();
let failed = 0;
for (const name of suites) {
  console.log(`\n--- ${name} ---`);
  const result = spawnSync(process.execPath, [path.join(root, 'tests', name)], {
    cwd: root, stdio: 'inherit', timeout: 120000,
  });
  if (result.error) console.error(result.error.message);
  if (result.error || result.status !== 0) failed++;
}
console.log(`\n${suites.length - failed}/${suites.length} suites passed.`);
process.exitCode = !suites.length || failed ? 1 : 0;
