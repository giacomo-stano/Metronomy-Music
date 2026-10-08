const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { planRelease, validateManifest, updateSource, checkSource } = require('../scripts/altstore.cjs');
const { publish } = require('../scripts/publish-altstore.cjs');
const channels = require('../release/channels.json');
// Keep test versions independent of the live feeds, which change on each release.
const stableSource = structuredClone(require('../altstore-source.json'));
stableSource.apps[0].versions = [{ version: '0.2.2', buildVersion: '1', downloadURL: 'https://example.test/old.ipa', size: 123 }];
const betaSource = { ...require('../altstore-beta.json'), apps: [] };
const base = { channel: 'beta', ref: 'refs/heads/develop', sha: 'a'.repeat(40), runNumber: 100, attempt: 1, version: '0.2.3', repository: channels.repository };
const plan = planRelease(base);
const ipa = Buffer.from('test IPA bytes, never uploaded');
const manifest = { name: plan.name, bundleIdentifier: plan.bundleIdentifier, version: plan.version,
  buildVersion: plan.buildVersion, minOSVersion: '16.4', size: ipa.length,
  sha256: crypto.createHash('sha256').update(ipa).digest('hex'), appPermissions: { entitlements: [], privacy: { NSMicrophoneUsageDescription: 'Audio' } } };

(async () => {
  assert.notEqual(channels.beta.bundleIdentifier, channels.stable.bundleIdentifier);
  assert.equal(channels.stable.bundleIdentifier, stableSource.apps[0].bundleIdentifier);
  for (const overrides of [{ channel: 'stable' }, { ref: 'refs/heads/main' }, { version: '1.2.3-beta' }, { attempt: 100 }, { runNumber: '1\nINJECT=yes' }, { repository: 'other/repo' }]) {
    assert.throws(() => planRelease({ ...base, ...overrides }));
  }
  assert.throws(() => planRelease({ ...base, channel: 'stable', ref: 'refs/heads/main' }), /confirmation/);
  assert.equal(plan.tag, 'v0.2.3-beta.100.1');
  const stablePlan = planRelease({ ...base, channel: 'stable', ref: 'refs/heads/main', confirmStable: true });
  const stableManifest = { ...manifest, name: stablePlan.name, bundleIdentifier: stablePlan.bundleIdentifier };
  const stableNext = updateSource(stableSource, stablePlan, stableManifest, 'Stable notes');
  assert.deepEqual(stableNext.apps[0].versions.slice(1), stableSource.apps[0].versions, 'Preserve version history');
  assert.equal(stableNext.apps[0].versions[0].downloadURL.endsWith('/v0.2.3/Metronomy.ipa'), true);
  assert.throws(() => checkSource(stableSource, { ...stablePlan, version: '0.2.2' }), /Bump/);
  assert.throws(() => validateManifest(plan, stableManifest), /mismatch/);
  assert.throws(() => updateSource(stableSource, plan, manifest), /identity/);
  const next = updateSource(betaSource, plan, manifest, 'Beta notes');
  assert.equal(next.apps[0].versions[0].marketingVersion, '0.2.3 Beta (100.1)');
  assert.deepEqual(next.apps[0].appPermissions, manifest.appPermissions);
  assert.throws(() => updateSource(next, plan, manifest), /already published/);
  assert.throws(() => updateSource(next, { ...plan, buildVersion: '99.1' }, { ...manifest, buildVersion: '99.1' }), /older beta/);
  assert.throws(() => updateSource(betaSource, { ...plan, channel: 'artifact' }, manifest), /never publish/);
  const originalEnv = { ...process.env };
  const config = require('../app.config.js');
  process.env.METRONOMY_CHANNEL = 'beta'; process.env.METRONOMY_BUILD_NUMBER = '100.1';
  const beta = config({ config: require('../app.json').expo });
  assert.equal(beta.name, 'Metronomy Beta'); assert.equal(beta.ios.bundleIdentifier, channels.beta.bundleIdentifier);
  process.env.METRONOMY_CHANNEL = 'stable';
  assert.equal(config({ config: require('../app.json').expo }).ios.bundleIdentifier, channels.stable.bundleIdentifier);
  process.env = originalEnv;

  const operations = [];
  let conflicts = 1;
  const api = async (method, path, body) => {
    operations.push({ method, path, body });
    if (method === 'GET' && path === '/repos/' + channels.repository) return { private: false };
    if (method === 'GET' && path.includes('/contents/')) return { sha: 'latest-file-sha', content: Buffer.from(JSON.stringify(betaSource)).toString('base64') };
    if (method === 'GET' && path.includes('/releases/tags/')) return null;
    if (method === 'POST' && path.endsWith('/releases')) return { id: 123 };
    if (method === 'POST' && path.includes('/assets?')) return { state: 'uploaded', size: body.length };
    if (method === 'PATCH') return {};
    if (method === 'PUT') { if (conflicts-- > 0) { const error = Error('conflict'); error.status = 409; throw error; } return {}; }
    throw Error('Unexpected operation');
  };
  const result = await publish({ plan, manifest, ipa, notes: 'Beta', api });
  assert.equal(result.sourceURL, betaSource.sourceURL);
  const release = operations.find(o => o.method === 'POST' && o.path.endsWith('/releases'));
  assert.equal(release.body.draft, true); assert.equal(release.body.prerelease, true); assert.equal(release.body.make_latest, 'false');
  const publicIndex = operations.findIndex(o => o.method === 'PATCH');
  const feedIndex = operations.findIndex(o => o.method === 'PUT');
  assert(publicIndex < feedIndex, 'Public asset before feed update');
  assert.equal(operations[publicIndex].body.make_latest, 'false');
  const feedWrites = operations.filter(o => o.method === 'PUT');
  assert.equal(feedWrites.length, 2, 'Retry concurrent feed changes');
  assert(feedWrites.every(o => o.body.branch === 'develop' && o.path.endsWith('/altstore-beta.json')));
  assert.equal(JSON.parse(Buffer.from(feedWrites[1].body.content, 'base64')).apps[0].versions[0].size, ipa.length);
  const stableOps = [];
  await publish({ plan: stablePlan, manifest: stableManifest, ipa, api: async (...args) => {
    stableOps.push(args);
    if (args[0] === 'GET' && args[1].includes('/contents/')) return { sha: 'stable-file-sha', content: Buffer.from(JSON.stringify(stableSource)).toString('base64') };
    return api(...args);
  } });
  const stablePublic = stableOps.find(([method]) => method === 'PATCH')[2];
  assert.equal(stablePublic.prerelease, false); assert.equal(stablePublic.make_latest, 'true');
  const stableWrite = stableOps.find(([method]) => method === 'PUT');
  assert.equal(stableWrite[2].branch, 'main'); assert(stableWrite[1].endsWith('/altstore-source.json'));
  await assert.rejects(publish({ plan, manifest, ipa: Buffer.from('tampered'), api }), /size|checksum/);
  const failed = [];
  await assert.rejects(publish({ plan, manifest, ipa, api: async (...args) => {
    failed.push(args); if (args[1].includes('/assets?')) throw Error('upload failed'); return api(...args);
  } }), /upload failed/);
  assert(!failed.some(([method]) => method === 'PUT' || method === 'PATCH'), 'Failed upload must not go live');
  await assert.rejects(publish({ plan, manifest, ipa, api: async (...args) => args[1].includes('/releases/tags/') ? { id: 123 } : api(...args) }), /already used/);
  const workflow = fs.readFileSync('.github/workflows/build-ios.yml', 'utf8');
  assert(workflow.includes('default: artifact') && !/^  push:/m.test(workflow), 'No automatic publication on push');
  console.log('AltStore: channel/branch guards, separate identities, metadata, history, versions, checksums, publication ordering, conflict retry and failure safety passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
