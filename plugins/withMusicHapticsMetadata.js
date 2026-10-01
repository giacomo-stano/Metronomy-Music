const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod } = require('expo/config-plugins');

// expo-audio owns Now Playing. Extend its metadata record instead of racing
// a second writer against its playback, seek, artwork and lock-screen updates.
const marker = '// Metronomy Music Haptics metadata v1';
function replaceOnce(source, needle, replacement) {
  if (source.split(needle).length !== 2) throw new Error('Music Haptics: expo-audio source changed; review the native integration.');
  return source.replace(needle, replacement);
}
function patchRecords(source) {
  if (source.includes(marker)) return source;
  return replaceOnce(source, 'struct Metadata: Record {', `struct Metadata: Record {
  ${marker}
  @Field var metronomyTrackId: String?
  @Field var metronomyISRC: String?
  @Field var metronomyDuration: Double?`);
}
function patchController(source) {
  if (source.includes(marker)) return source;
  source = replaceOnce(source, '    nowPlayingInfoCenter.nowPlayingInfo = nowPlayingInfo',
    '    applyMetronomyMetadata(&nowPlayingInfo, for: player)\n    nowPlayingInfoCenter.nowPlayingInfo = nowPlayingInfo');
  return replaceOnce(source, '  private func applyPlaybackInfo(', `  ${marker}
  private func applyMetronomyMetadata(_ info: inout [String: Any], for player: AudioPlayer) {
    guard let metadata = player.metadata, let trackId = metadata.metronomyTrackId else { return }
    info[MPNowPlayingInfoPropertyExternalContentIdentifier] = "metronomy:" + trackId
    // Library songs are finite recordings, not live radio. AVPlayer may not yet
    // know a remote/transcoded stream's duration; keep the real catalog duration
    // until it does. Never replace a valid AVPlayer duration with a guessed one.
    info[MPNowPlayingInfoPropertyIsLiveStream] = false
    let duration = player.duration
    let catalogDuration = metadata.metronomyDuration ?? 0
    if duration.isFinite && duration > 0 {
      info[MPMediaItemPropertyPlaybackDuration] = duration
    } else if catalogDuration.isFinite && catalogDuration > 0 {
      info[MPMediaItemPropertyPlaybackDuration] = catalogDuration
    } else {
      info.removeValue(forKey: MPMediaItemPropertyPlaybackDuration)
    }
    let elapsed = player.currentTime
    info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = elapsed.isFinite ? max(0, elapsed) : 0
    if #available(iOS 18.0, *) {
      if let code = metadata.metronomyISRC,
         code.range(of: "^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$", options: .regularExpression) != nil {
        info[MPNowPlayingInfoPropertyInternationalStandardRecordingCode] = code
      } else {
        // Do not carry the preceding song's identity to a track with no ISRC.
        info.removeValue(forKey: MPNowPlayingInfoPropertyInternationalStandardRecordingCode)
      }
    }
  }

  private func applyPlaybackInfo(`);
}
function applyPatch(projectRoot) {
  const packagePath = require.resolve('expo-audio/package.json', { paths: [projectRoot] });
  if (JSON.parse(fs.readFileSync(packagePath, 'utf8')).version !== '57.0.5') {
    throw new Error('Music Haptics integration is verified for expo-audio 57.0.5 only. Review before upgrading.');
  }
  const root = path.dirname(packagePath);
  const patches = [['AudioRecords.swift', patchRecords], ['MediaController.swift', patchController]];
  // Validate both transformations before touching either source.
  const updates = patches.map(([name, transform]) => {
    const file = path.join(root, 'ios', name);
    return [file, transform(fs.readFileSync(file, 'utf8'))];
  });
  for (const [file, content] of updates) fs.writeFileSync(file, content);
}
module.exports = config => withDangerousMod(config, ['ios', async config => {
  applyPatch(config.modRequest.projectRoot);
  return config;
}]);
module.exports.patchRecords = patchRecords;
module.exports.patchController = patchController;
module.exports.applyPatch = applyPatch;
