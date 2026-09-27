import {
  addNativeAppleMusicHapticsActiveListener,
  addNativeAppleMusicHapticsPlaybackListener,
  getNativeMusicHapticsISRC,
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

export function appleMusicHapticsActive() {
  return nativeAppleMusicHapticsActive();
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

export function nativeNowPlayingMusicHapticsISRC() {
  return getNativeMusicHapticsISRC();
}

export async function appleMusicHapticsTrackAvailable(
  isrc?: string | null
) {
  const code = isrc?.trim();
  if (!code) return false;
  return nativeAppleMusicHapticsTrackAvailable(code);
}
