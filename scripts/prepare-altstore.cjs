const fs = require('node:fs');
const { planRelease, checkSource } = require('./altstore.cjs');
const { githubAPI } = require('./publish-altstore.cjs');
async function main() {
  const plan = planRelease({
    channel: process.env.RELEASE_CHANNEL || 'artifact', ref: process.env.GITHUB_REF,
    sha: process.env.GITHUB_SHA, runNumber: process.env.GITHUB_RUN_NUMBER,
    attempt: process.env.GITHUB_RUN_ATTEMPT, confirmStable: process.env.CONFIRM_STABLE === 'true',
    version: require('../app.json').expo.version, repository: process.env.GITHUB_REPOSITORY,
  });
  if (plan.channel !== 'artifact') {
    const file = await githubAPI('GET', `/repos/${plan.repository}/contents/${plan.sourceFile}?ref=${plan.branch}`);
    checkSource(JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')), plan);
  }
  fs.mkdirSync('build', { recursive: true });
  fs.writeFileSync('build/release-plan.json', JSON.stringify(plan, null, 2) + '\n');
  console.log(`${plan.name} ${plan.version} (${plan.buildVersion}) · ${plan.channel}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
