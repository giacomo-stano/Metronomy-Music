const channels = require('./release/channels.json');

module.exports = ({ config }) => {
  const channel = process.env.METRONOMY_CHANNEL || 'stable';
  if (!['beta', 'stable'].includes(channel)) throw new Error('Invalid Metronomy channel');
  const buildNumber = process.env.METRONOMY_BUILD_NUMBER || config.ios?.buildNumber || '1';
  if (!/^[1-9]\d{0,3}(\.\d{1,2}){0,2}$/.test(buildNumber)) throw new Error('Invalid iOS build number');
  return {
    ...config,
    name: channels[channel].name,
    ios: { ...config.ios, bundleIdentifier: channels[channel].bundleIdentifier, buildNumber },
  };
};
