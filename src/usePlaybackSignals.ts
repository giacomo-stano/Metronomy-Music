import { useEffect, useState } from 'react';
import type { AudioPlayer } from 'expo-audio';
import { playbackSignals, samePlaybackSignals } from './playbackSignals';

// Navigation only needs state changes, not four whole-screen renders per second.
export function usePlaybackSignals(player: AudioPlayer) {
  const [signals, setSignals] = useState(() => playbackSignals(player.currentStatus));
  useEffect(() => {
    let previous = playbackSignals(player.currentStatus);
    setSignals(value => samePlaybackSignals(value, previous) ? value : previous);
    const update = (status: typeof player.currentStatus) => {
      const next = playbackSignals(status);
      if (samePlaybackSignals(previous, next)) return;
      previous = next;
      setSignals(next);
    };
    const subscription = player.addListener('playbackStatusUpdate', update);
    return () => subscription.remove();
  }, [player]);
  return signals;
}

// Precise progress updates are confined to the visible player sheet.
export function useVisiblePlaybackStatus(player: AudioPlayer, visible: boolean) {
  const [status, setStatus] = useState(() => player.currentStatus);
  useEffect(() => {
    if (!visible) return;
    setStatus(player.currentStatus);
    const subscription = player.addListener('playbackStatusUpdate', setStatus);
    return () => subscription.remove();
  }, [player, visible]);
  return status;
}
