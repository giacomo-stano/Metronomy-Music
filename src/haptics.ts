import {
  addNativeAppleMusicHapticsActiveListener,
  addNativeAppleMusicHapticsPlaybackListener,
  nativeAppleMusicHapticsActive,
  nativeAppleMusicHapticsTrackAvailable,
  nativeMusicHapticsAvailable,
  playNativeMusicHaptic,
  setNativeMusicHapticsISRC,
  startNativeAppleMusicHapticsObservers,
  stopNativeAppleMusicHapticsObservers,
  stopNativeMusicHaptics,
} from '../modules/metronomy-audio-controls';

export { nativeMusicHapticsAvailable };

export function musicBeatHaptic(
  intensity = 0.55,
  sharpness = 0.42
) {
  playNativeMusicHaptic(intensity, sharpness);
}

export function stopMusicHaptics() {
  stopNativeMusicHaptics();
}

export function configureAppleMusicHapticsISRC(
  isrc?: string | null
) {
  setNativeMusicHapticsISRC(isrc);
}

export async function appleMusicHapticsWillHandleTrack(
  isrc?: string | null
) {
  const code = isrc?.trim();

  if (!code || !nativeAppleMusicHapticsActive()) {
    return false;
  }

  return nativeAppleMusicHapticsTrackAvailable(code);
}

export function startAppleMusicHapticsStatusObservers() {
  startNativeAppleMusicHapticsObservers();
}

export function stopAppleMusicHapticsStatusObservers() {
  stopNativeAppleMusicHapticsObservers();
}

export function onAppleMusicHapticsActiveChanged(
  listener: (active: boolean) => void
) {
  return addNativeAppleMusicHapticsActiveListener(listener);
}

export function onAppleMusicHapticsPlaybackChanged(
  listener: (event: { isrc?: string; playing: boolean }) => void
) {
  return addNativeAppleMusicHapticsPlaybackListener(listener);
}

export function testCoreMusicHaptic() {
  musicBeatHaptic(1, 0.65);
}
