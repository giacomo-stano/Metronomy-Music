import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Platform, Share } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { AudioPlayer } from 'expo-audio';
import { coverURL, request, type Song } from './api';
import { nowPlayingMetadata } from './nowPlayingMetadata';
import { AppleHapticsSession, emptyHapticsState, withTimeout, type AppleHapticsNative, type NativeHapticsState } from './appleMusicHaptics';
import { setRemoteControlsEnabled } from '../modules/metronomy-audio-controls';
import { withExclusiveDiagnostic } from './nativeHapticsDiagnostic';

const diagnostic = Platform.OS === 'ios' ? requireOptionalNativeModule<{
  run(uri: string, code: string, title: string, artist: string, duration: number): Promise<string>;
  cancel(): Promise<void>;
}>('MetronomyHapticsDiagnostic') : null;

type NativeModule = AppleHapticsNative & {
  prepareObserver?(): Promise<void>;
  addListener(name: 'onStateChanged', listener: (state: NativeHapticsState) => void): { remove(): void };
};
const native = Platform.OS === 'ios'
  ? requireOptionalNativeModule<NativeModule>('MetronomyMusicHaptics') : null;

export function useAppleMusicHaptics(song: Song | undefined, audioPlaying: boolean,
  player: AudioPlayer, activeTrack: { current: Song | undefined },
  activeSource: { current: string | undefined }) {
  const [state, setState] = useState(emptyHapticsState);
  const diagnosticBusy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (diagnosticBusy.current) void diagnostic?.cancel().catch(() => {});
    };
  }, []);
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
      if (diagnosticBusy.current || current?.id !== track.id) return;
      player.updateLockScreenMetadata(nowPlayingMetadata(current, coverURL(current.coverArt), code));
    }), [player, activeTrack]);

  useEffect(() => {
    // Subscribe before select() can emit the initial state.
    const subscription = native?.addListener('onStateChanged', value => {
      if (diagnosticBusy.current) return;
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
      if (AppState.currentState !== 'active' || refreshing || diagnosticBusy.current) return;
      refreshing = true;
      void session.refresh().finally(() => { refreshing = false; });
    };
    // Read-only diagnostics. No metadata rewriting, audio taps or 250ms renders.
    const timer = setInterval(refresh, 2000);
    const appState = AppState.addEventListener('change', next => {
      if (next === 'active' && !diagnosticBusy.current) {
        void session.refresh(true);
      }
    });
    return () => { clearInterval(timer); appState.remove(); };
  }, [session, song?.id]);

  const runDiagnostic = async () => {
    if (diagnosticBusy.current) return;
    const track = activeTrack.current;
    const uri = activeSource.current;
    const code = session.state.isrc;
    if (!diagnostic || !track || !uri || song?.id !== track.id || session.state.phase !== 'ready'
      || session.state.nativeIsrc !== code || !/^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/.test(code)) {
      Alert.alert('Test non disponibile', 'Serve la nuova build iOS e un brano con ISRC verificato.');
      return;
    }
    const isCurrent = () => mounted.current && activeTrack.current === track;
    try {
      const report = await withExclusiveDiagnostic({
        busy: diagnosticBusy, isCurrent,
        suspend: () => {
          player.pause();
          player.setActiveForLockScreen(false);
          setRemoteControlsEnabled(false);
        },
        // Allow the alert to dismiss and Expo's delayed pause to settle.
        settle: () => new Promise(resolve => setTimeout(resolve, 500)),
        open: async () => {
          if (AppState.currentState !== 'active') return;
          return diagnostic.run(uri, code, track.title, track.artist, track.duration);
        },
        restorePaused: () => {
          player.setActiveForLockScreen(true, nowPlayingMetadata(track, coverURL(track.coverArt), code),
            { showSeekBackward: false, showSeekForward: false, isLiveStream: false });
          setRemoteControlsEnabled(true);
        },
      });
      if (mounted.current && report) Alert.alert('Test nativo terminato',
        'La riproduzione normale resta in pausa. Il report non contiene URL o credenziali; controllalo prima di condividerlo.', [
          { text: 'Chiudi', style: 'cancel' },
          { text: 'Condividi report', onPress: () => { void Share.share({ message: report }).catch(() => {}); } },
        ]);
    } catch {
      if (mounted.current) Alert.alert('Test non avviato', 'Impossibile aprire il player diagnostico. La riproduzione normale resta in pausa.');
    } finally {
      if (isCurrent()) void session.retry();
    }
  };

  return { state, diagnosticBusy, runDiagnostic, inspect: () => session.state, retry: () => { if (!diagnosticBusy.current) void session.retry(); },
    prepare: async () => {
      // Subscribe before the audio owner can publish/play the new recording.
      // Missing/old native modules must never prevent normal audio playback.
      try { if (native?.prepareObserver) await withTimeout(native.prepareObserver(), 1000); } catch { /* Audio remains usable. */ }
    },
  };
}
