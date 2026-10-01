import { useEffect, useMemo, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { AudioPlayer } from 'expo-audio';
import { coverURL, request, type Song } from './api';
import { nowPlayingMetadata } from './nowPlayingMetadata';
import { AppleHapticsSession, emptyHapticsState, withTimeout, type AppleHapticsNative, type NativeHapticsState } from './appleMusicHaptics';

type NativeModule = AppleHapticsNative & {
  prepareObserver?(): Promise<void>;
  addListener(name: 'onStateChanged', listener: (state: NativeHapticsState) => void): { remove(): void };
};
const native = Platform.OS === 'ios'
  ? requireOptionalNativeModule<NativeModule>('MetronomyMusicHaptics') : null;

export function useAppleMusicHaptics(song: Song | undefined, audioPlaying: boolean,
  player: AudioPlayer, activeTrack: { current: Song | undefined }) {
  const [state, setState] = useState(emptyHapticsState);
  const session = useMemo(() => new AppleHapticsSession(native,
    id => request('songs/' + encodeURIComponent(id), 8000), next => setState(previous => {
      // Keep the latest position in session.state for on-demand diagnostics,
      // without rerendering the entire app just because the clock advanced.
      const { elapsed: _previousElapsed, ...previousStatus } = previous;
      const { elapsed: _nextElapsed, ...nextStatus } = next;
      return JSON.stringify(previousStatus) === JSON.stringify(nextStatus) ? previous : next;
    }), 10000,
    (track, code) => {
      // The audio source can change before React commits the next render.
      // Consult the synchronous source identity, not a captured song object.
      const current = activeTrack.current;
      if (current?.id !== track.id) return;
      player.updateLockScreenMetadata(nowPlayingMetadata(current, coverURL(current.coverArt), code));
    }), [player, activeTrack]);

  useEffect(() => {
    // Subscribe before select() can emit the initial state.
    const subscription = native?.addListener('onStateChanged', value => {
      const activated = value.key === session.state.key && value.active && !session.state.active;
      session.accept(value);
      if (activated) void session.refresh(true);
    });
    return () => { subscription?.remove(); session.dispose(); };
  }, [session]);

  const codes = JSON.stringify([song?.isrc, song?.isrcs]);
  useEffect(() => { void session.select(song); }, [session, song?.id, codes]);
  useEffect(() => { void session.refresh(); }, [session, audioPlaying]);
  useEffect(() => {
    if (!native || !song) return;
    let refreshing = false;
    const refresh = () => {
      if (AppState.currentState !== 'active' || refreshing) return;
      refreshing = true;
      void session.refresh().finally(() => { refreshing = false; });
    };
    // Read-only diagnostics. No metadata rewriting, audio taps or 250ms renders.
    const timer = setInterval(refresh, 2000);
    const appState = AppState.addEventListener('change', next => {
      if (next === 'active') {
        void session.refresh(true);
      }
    });
    return () => { clearInterval(timer); appState.remove(); };
  }, [session, song?.id]);

  return { state, inspect: () => session.state, retry: () => { void session.retry(); },
    prepare: async () => {
      // Subscribe before the audio owner can publish/play the new recording.
      // Missing/old native modules must never prevent normal audio playback.
      try { if (native?.prepareObserver) await withTimeout(native.prepareObserver(), 1000); } catch { /* Audio remains usable. */ }
    },
  };
}
