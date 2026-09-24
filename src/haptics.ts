import {
  nativeAppleMusicHapticsActive,
  nativeAppleMusicHapticsTrackAvailable,
  nativeMusicHapticsAvailable,
  playNativeMusicHaptic,
  setNativeMusicHapticsISRC,
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
