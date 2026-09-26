import { requireOptionalNativeModule } from 'expo-modules-core';

type Subscription = { remove: () => void };

type MusicHapticsNativeModule = {
  isCoreHapticsSupported: () => boolean;
  isAppleMusicHapticsActive: () => boolean;
  checkAppleTrackAvailability: (isrc: string) => Promise<boolean>;
  setNowPlayingISRC: (isrc?: string | null) => void;
  startAppleMusicHapticsObservers: () => void;
  stopAppleMusicHapticsObservers: () => void;
  addListener: (
    eventName:
      | 'onAppleMusicHapticsActiveChanged'
      | 'onAppleMusicHapticsPlaybackChanged',
    listener: (event: any) => void
  ) => Subscription;
  pulse: (intensity: number, sharpness: number) => void;
  stop: () => void;
};

type RemoteControlsNativeModule = {
  setEnabled: (enabled: boolean) => void;
  addListener: (
    eventName: 'onNextTrack' | 'onPreviousTrack',
    listener: () => void
  ) => Subscription;
};

const RemoteControls = requireOptionalNativeModule(
  'MetronomyRemoteControls'
) as RemoteControlsNativeModule | null;

const MusicHaptics = requireOptionalNativeModule(
  'MetronomyMusicHaptics'
) as MusicHapticsNativeModule | null;

export function remoteControlsAvailable() {
  return !!RemoteControls;
}

export function setRemoteControlsEnabled(enabled: boolean) {
  RemoteControls?.setEnabled(enabled);
}

export function addRemoteNextListener(listener: () => void) {
  return RemoteControls?.addListener('onNextTrack', listener);
}

export function addRemotePreviousListener(listener: () => void) {
  return RemoteControls?.addListener('onPreviousTrack', listener);
}

export const nativeMusicHapticsAvailable =
  !!MusicHaptics && !!MusicHaptics.isCoreHapticsSupported();

export function nativeAppleMusicHapticsActive() {
  return MusicHaptics?.isAppleMusicHapticsActive() ?? false;
}

export async function nativeAppleMusicHapticsTrackAvailable(isrc: string) {
  return (await MusicHaptics?.checkAppleTrackAvailability(isrc)) ?? false;
}

export function setNativeMusicHapticsISRC(isrc?: string | null) {
  MusicHaptics?.setNowPlayingISRC(isrc ?? null);
}

export function startNativeAppleMusicHapticsObservers() {
  MusicHaptics?.startAppleMusicHapticsObservers();
}

export function stopNativeAppleMusicHapticsObservers() {
  MusicHaptics?.stopAppleMusicHapticsObservers();
}

export function addNativeAppleMusicHapticsActiveListener(
  listener: (active: boolean) => void
) {
  return MusicHaptics?.addListener(
    'onAppleMusicHapticsActiveChanged',
    event => listener(!!event?.active)
  );
}

export function addNativeAppleMusicHapticsPlaybackListener(
  listener: (event: { isrc?: string; playing: boolean }) => void
) {
  return MusicHaptics?.addListener(
    'onAppleMusicHapticsPlaybackChanged',
    event =>
      listener({
        isrc:
          typeof event?.isrc === 'string'
            ? event.isrc
            : undefined,
        playing: !!event?.playing,
      })
  );
}

export function playNativeMusicHaptic(
  intensity: number,
  sharpness: number
) {
  MusicHaptics?.pulse(
    Math.max(0, Math.min(1, intensity)),
    Math.max(0, Math.min(1, sharpness))
  );
}

export function stopNativeMusicHaptics() {
  MusicHaptics?.stop();
}

export * from './src';
