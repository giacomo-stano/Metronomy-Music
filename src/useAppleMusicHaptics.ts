import { useEffect, useMemo, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { request, type Song } from './api';
import { AppleHapticsSession, emptyHapticsState, type AppleHapticsNative, type NativeHapticsState } from './appleMusicHaptics';

type NativeModule = AppleHapticsNative & {
  addListener(name: 'onStateChanged', listener: (state: NativeHapticsState) => void): { remove(): void };
};
const native = Platform.OS === 'ios'
  ? requireOptionalNativeModule<NativeModule>('MetronomyMusicHaptics') : null;

export function useAppleMusicHaptics(song: Song | undefined, audioPlaying: boolean) {
  const [state, setState] = useState(emptyHapticsState);
  const session = useMemo(() => new AppleHapticsSession(native,
    id => request('songs/' + encodeURIComponent(id), 8000), setState), []);

  useEffect(() => {
    // Subscribe before select() can emit the initial state.
    const subscription = native?.addListener('onStateChanged', value => session.accept(value));
    return () => { subscription?.remove(); session.dispose(); };
  }, [session]);

  useEffect(() => { void session.select(song); }, [session, song?.id, song?.isrc]);
  useEffect(() => { void session.refresh(); }, [session, audioPlaying]);
  useEffect(() => {
    if (!native || !song) return;
    let refreshing = false;
    const refresh = () => {
      if (AppState.currentState !== 'active' || refreshing) return;
      refreshing = true;
      void session.refresh().finally(() => { refreshing = false; });
    };
    // Repair/read back the actual shared Now Playing dictionary, not a cached
    // initial ISRC. No PCM listener and no 250ms root renders.
    const timer = setInterval(refresh, 2000);
    const appState = AppState.addEventListener('change', next => {
      if (next === 'active') {
        refresh();
        if (session.state.phase === 'error') void session.retry();
      }
    });
    return () => { clearInterval(timer); appState.remove(); };
  }, [session, song?.id]);

  return { state, retry: () => { void session.retry(); } };
}
