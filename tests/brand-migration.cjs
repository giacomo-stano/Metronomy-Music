const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const values = new Map(), dirs = new Map();
const old = 'file:///documents/aurora-offline/', next = 'file:///documents/metronomy-offline/';
let moves = 0, failWrite = false;
const storage = {
  getAllKeys: async () => [...values.keys()], getItem: async k => values.get(k) ?? null,
  setItem: async (k, v) => { if (failWrite) throw new Error('disk full'); values.set(k, v); },
  removeItem: async k => values.delete(k),
};
const native = {
  documentDirectory: 'file:///documents/',
  getInfoAsync: async p => ({ exists: dirs.has(p), isDirectory: dirs.has(p) }),
  moveAsync: async ({from,to}) => { assert.equal(from, old); assert.equal(to, next); assert(!dirs.has(to)); moves++; dirs.set(to, dirs.get(from)); dirs.delete(from); },
};
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/brandMigration.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, {
  exports: exportsObject, require: name => name.includes('async-storage') ? storage : native,
});
(async () => {
  const migrate = exportsObject.migrateBrandData;
  dirs.set(old, ['audio', 'covers']);
  values.set('aurora.offline.v1:user', '{"folder":"abc","tracks":[]}');
  values.set('aurora.appearance', 'dark'); values.set('unrelated', 'keep');
  await Promise.all([migrate(), migrate()]);
  assert.equal(moves, 1); assert.deepEqual(dirs.get(next), ['audio', 'covers']);
  assert.equal(values.get('metronomy.appearance'), 'dark'); assert(!values.has('aurora.appearance'));
  assert.equal(values.get('unrelated'), 'keep');
  await migrate(); assert.equal(moves, 1);
  values.set('aurora.searches:x', 'search'); failWrite = true;
  await assert.rejects(migrate()); assert.equal(values.get('aurora.searches:x'), 'search');
  failWrite = false; await migrate(); assert.equal(values.get('metronomy.searches:x'), 'search');
  dirs.set(old, ['old']); await assert.rejects(migrate(), /conflitto/); assert.deepEqual(dirs.get(old), ['old']);
  dirs.delete(old); values.set('aurora.appearance', 'light'); await assert.rejects(migrate(), /conflitto/);
  assert.equal(values.get('metronomy.appearance'), 'dark');
  console.log('Brand migration: preserved files/keys, idempotency, concurrency, retry and collision protection passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
