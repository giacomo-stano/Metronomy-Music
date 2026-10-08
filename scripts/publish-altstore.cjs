const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { planRelease, validateManifest, updateSource } = require('./altstore.cjs');

async function publish({ plan, manifest, ipa, notes, api }) {
  assert(['beta', 'stable'].includes(plan.channel), 'Not a publication build');
  validateManifest(plan, manifest);
  assert.equal(ipa.length, manifest.size, 'IPA size changed after inspection');
  assert.equal(crypto.createHash('sha256').update(ipa).digest('hex'), manifest.sha256, 'IPA checksum changed');
  const root = `/repos/${plan.repository}`;
  assert.equal((await api('GET', root)).private, false, 'AltStore requires public assets/source in this workflow');
  const sourcePath = `${root}/contents/${plan.sourceFile}`;
  const readSource = async () => {
    const file = await api('GET', sourcePath + '?ref=' + plan.branch);
    const source = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
    return { file, updated: updateSource(source, plan, manifest, notes) };
  };
  await readSource(); // Fail before creating a release when the channel/version is wrong.
  const existing = await api('GET', `${root}/releases/tags/${plan.tag}`, undefined, true);
  assert(!existing, 'Release/tag already used. Never overwrite an existing IPA; inspect any failed draft first.');
  const release = await api('POST', root + '/releases', {
    tag_name: plan.tag, target_commitish: plan.sha,
    name: `${plan.name} ${plan.version} (${plan.buildVersion})`,
    body: `${notes || ''}\n\nCommit: ${plan.sha}\nCanale: ${plan.channel}\nSHA-256 IPA: ${manifest.sha256}`,
    draft: true, prerelease: plan.channel === 'beta', make_latest: 'false',
  });
  const uploaded = await api('POST', `https://uploads.github.com${root}/releases/${release.id}/assets?name=${plan.assetName}`, ipa);
  assert.equal(uploaded.state, 'uploaded', 'IPA upload not complete');
  assert.equal(uploaded.size, manifest.size, 'Uploaded IPA size mismatch');
  await api('POST', `https://uploads.github.com${root}/releases/${release.id}/assets?name=ipa-manifest.json`, Buffer.from(JSON.stringify(manifest, null, 2)));
  // Recheck the feed after uploading, before making the draft public.
  await readSource();
  await api('PATCH', `${root}/releases/${release.id}`, {
    draft: false, prerelease: plan.channel === 'beta', make_latest: plan.channel === 'beta' ? 'false' : 'true',
  });
  // Only advertise an IPA after it exists publicly. Contents API uses the latest
  // file SHA; never force-push or replace unrelated commits on main/develop.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { file, updated } = await readSource();
    try {
      await api('PUT', sourcePath, { branch: plan.branch, sha: file.sha,
        message: `chore: publish ${plan.channel} ${plan.version} (${plan.buildVersion}) to AltStore`,
        content: Buffer.from(JSON.stringify(updated, null, 2) + '\n').toString('base64') });
      return { sourceURL: plan.sourceURL, releaseURL: `https://github.com/${plan.repository}/releases/tag/${plan.tag}` };
    } catch (error) { if (error.status !== 409 || attempt === 2) throw error; }
  }
}

async function githubAPI(method, path, body, allow404 = false) {
  const url = path.startsWith('https://uploads.github.com/repos/') ? path : 'https://api.github.com' + path;
  const response = await fetch(url, { method, signal: AbortSignal.timeout(180000), headers: {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(body ? { 'Content-Type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json' } : {}),
  }, body: body ? Buffer.isBuffer(body) ? body : JSON.stringify(body) : undefined });
  if (allow404 && response.status === 404) return null;
  if (!response.ok) { const error = new Error(`GitHub ${method} failed (${response.status}). Check Actions permissions, branch protection and release state.`); error.status = response.status; throw error; }
  return response.status === 204 ? null : response.json();
}

async function main() {
  assert(process.env.GITHUB_TOKEN, 'Missing workflow token');
  const plan = JSON.parse(fs.readFileSync('build/release-plan.json', 'utf8'));
  // Revalidate the immutable build plan against this workflow's actual inputs.
  const expected = planRelease({ channel: process.env.RELEASE_CHANNEL, ref: process.env.GITHUB_REF,
    sha: process.env.GITHUB_SHA, runNumber: process.env.GITHUB_RUN_NUMBER, attempt: process.env.GITHUB_RUN_ATTEMPT,
    repository: process.env.GITHUB_REPOSITORY, confirmStable: process.env.CONFIRM_STABLE === 'true', version: require('../app.json').expo.version });
  assert.deepEqual(plan, expected, 'Publication plan does not match this run');
  const result = await publish({ plan, manifest: JSON.parse(fs.readFileSync('build/ipa-manifest.json', 'utf8')),
    ipa: fs.readFileSync('build/Metronomy.ipa'), notes: process.env.RELEASE_NOTES || '', api: githubAPI });
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## ${plan.name}\n\n[Source AltStore](${result.sourceURL}) · [IPA e dettagli](${result.releaseURL})\n`);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { publish, githubAPI };
