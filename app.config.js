const channels = require('./release/channels.json');

module.exports = ({ config }) => {
  const channel = process.env.METRONOMY_CHANNEL || 'stable';
  if (!['beta', 'stable', 'dev'].includes(channel)) throw new Error('Invalid Metronomy channel');
  const buildNumber = process.env.METRONOMY_BUILD_NUMBER || config.ios?.buildNumber || '1';
  if (!/^[1-9]\d{0,3}(\.\d{1,2}){0,2}$/.test(buildNumber)) throw new Error('Invalid iOS build number');
  if (channel === 'dev') {
    return {
      ...config,
      name: 'Metronomy Dev',
      scheme: 'metronomy-dev',
      plugins: [...(config.plugins || []), 'expo-dev-client'],
      ios: {
        ...config.ios,
        bundleIdentifier: 'com.anonymous.metronomy.dev',
        buildNumber,
        infoPlist: {
          ...config.ios?.infoPlist,
          NSAppTransportSecurity: {
            ...config.ios?.infoPlist?.NSAppTransportSecurity,
            NSAllowsLocalNetworking: true,
          },
        },
      },
    };
  }
  return {
    ...config,
    name: channels[channel].name,
    ios: { ...config.ios, bundleIdentifier: channels[channel].bundleIdentifier, buildNumber },
  };
};
