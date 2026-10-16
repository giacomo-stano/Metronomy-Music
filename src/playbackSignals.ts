import type { AudioStatus } from 'expo-audio';

export function playbackSignals(status: AudioStatus) {
  return { playing: status.playing, isBuffering: !!status.isBuffering, didJustFinish: status.didJustFinish, listened: status.currentTime >= 5 };
}
export function samePlaybackSignals(a: ReturnType<typeof playbackSignals>, b: ReturnType<typeof playbackSignals>) {
  return a.playing === b.playing && a.isBuffering === b.isBuffering && a.didJustFinish === b.didJustFinish && a.listened === b.listened;
}
