const channels = require('../release/channels.json');
const assert = require('node:assert/strict');
const versionPattern = /^\d+\.\d+\.\d+$/;
function compare(a, b) {
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
}
function planRelease({ channel = 'artifact', ref, sha, runNumber, attempt, confirmStable, version, repository }) {
  assert(['artifact', 'beta', 'stable'].includes(channel), 'Invalid channel');
  assert.equal(repository, channels.repository, 'Publishing is restricted to the configured repository');
  assert.match(version, versionPattern, 'Use a numeric MAJOR.MINOR.PATCH in app.json');
  assert.match(sha, /^[a-f0-9]{40}$/);
  assert.match(String(runNumber), /^[1-9]\d{0,3}$/);
  assert.match(String(attempt), /^[1-9]\d?$/);
  const target = channels[channel === 'artifact' ? 'stable' : channel];
  if (channel !== 'artifact') assert.equal(ref, 'refs/heads/' + target.branch, 'Wrong branch for this channel');
  if (channel === 'stable') assert.equal(confirmStable, true, 'Explicit stable confirmation required');
  const buildVersion = `${runNumber}.${attempt}`;
  return { ...target, channel, repository, sha, version, buildVersion,
    tag: channel === 'beta' ? `v${version}-beta.${buildVersion}` : `v${version}`,
    sourceURL: `https://raw.githubusercontent.com/${repository}/${target.branch}/${target.sourceFile}` };
}
function validateManifest(plan, manifest) {
  for (const key of ['bundleIdentifier', 'version', 'buildVersion']) assert.equal(manifest[key], plan[key], `IPA ${key} mismatch`);
  assert.equal(manifest.name, plan.name, 'IPA name mismatch');
  assert(Number.isSafeInteger(manifest.size) && manifest.size > 0, 'Empty IPA');
  assert.match(manifest.sha256, /^[a-f0-9]{64}$/);
  assert.match(manifest.minOSVersion, /^\d+(\.\d+){0,2}$/);
  assert(Array.isArray(manifest.appPermissions?.entitlements));
  assert(manifest.appPermissions?.privacy && typeof manifest.appPermissions.privacy === 'object');
}
function checkSource(source, plan) {
  assert.notEqual(plan.channel, 'artifact', 'Artifact builds must never publish');
  assert.equal(source.identifier, plan.sourceIdentifier, 'Unexpected source identity');
  assert.equal(source.sourceURL, plan.sourceURL, 'Unexpected source URL');
  assert(Array.isArray(source.apps) && source.apps.length <= 1, 'Unexpected apps in source');
  const previous = source.apps[0];
  if (previous) assert.equal(previous.bundleIdentifier, plan.bundleIdentifier, 'Source/IPA identity mismatch');
  const versions = previous?.versions || [];
  assert(!versions.some(v => v.version === plan.version && v.buildVersion === plan.buildVersion), 'Version/build already published');
  if (versions[0]) {
    const order = compare(plan.version, versions[0].version);
    assert(order >= 0, 'Refusing a version downgrade');
    if (plan.channel === 'stable') assert(order > 0, 'Bump app.json version before a stable release');
    else if (!order) assert(compare(plan.buildVersion, versions[0].buildVersion) > 0, 'Refusing an older beta build');
  }
}
function updateSource(source, plan, manifest, notes, date = new Date().toISOString()) {
  validateManifest(plan, manifest);
  checkSource(source, plan);
  const previous = source.apps[0];
  const versions = previous?.versions || [];
  const entry = { version: plan.version, buildVersion: plan.buildVersion,
    marketingVersion: `${plan.version}${plan.channel === 'beta' ? ' Beta' : ''} (${plan.buildVersion})`, date,
    localizedDescription: notes || (plan.channel === 'beta' ? 'Build di test.' : 'Release stabile.'),
    downloadURL: `https://github.com/${plan.repository}/releases/download/${plan.tag}/${plan.assetName}`,
    size: manifest.size, minOSVersion: manifest.minOSVersion };
  return { ...source, apps: [{
    developerName: 'Giacomo Stano', subtitle: 'La tua musica, sul tuo server.',
    localizedDescription: 'Client Navidrome con ascolto offline e integrazione Qobuz.' + (plan.channel === 'beta' ? ' Versione di test: dati locali separati dalla stabile. Le operazioni sul server restano reali.' : ''),
    tintColor: plan.channel === 'beta' ? '#AF52DE' : '#111111',
    ...previous, name: plan.name, bundleIdentifier: plan.bundleIdentifier,
    iconURL: `https://raw.githubusercontent.com/${plan.repository}/${plan.sha}/assets/metronomy-icon-v2.png`,
    appPermissions: manifest.appPermissions, versions: [entry, ...versions],
  }] };
}
module.exports = { planRelease, validateManifest, checkSource, updateSource, compare };
