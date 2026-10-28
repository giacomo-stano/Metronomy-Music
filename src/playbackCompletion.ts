import type { AudioPlayer, AudioStatus } from 'expo-audio';

// Consume native EOF immediately, before React can batch it with the next
// periodic status (whose didJustFinish is false). Never infer EOF from duration.
export function observePlaybackCompletion(
  player: Pick<AudioPlayer, 'addListener'>,
  session: () => number | null,
  complete: () => void,
) {
  let finishedSession: number | null = null;
  return player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
    const current = session();
    if (current === null) return; // Replacing, logging out or clearing the queue.
    if (status.didJustFinish) {
      if (finishedSession === current) return;
      finishedSession = current; // Claim before callback, which may start a source.
      complete();
    } else if (finishedSession === current && status.playing &&
      status.currentTime < status.duration) {
      // The user may seek back and replay the last track without replacing it.
      finishedSession = null;
    }
  });
}
