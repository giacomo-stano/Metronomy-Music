import * as Haptics from 'expo-haptics';

export type MusicHapticStrength = 'light' | 'medium';

export function musicBeatHaptic(
  strength: MusicHapticStrength = 'light'
) {
  const style =
    strength === 'medium'
      ? Haptics.ImpactFeedbackStyle.Medium
      : Haptics.ImpactFeedbackStyle.Light;

  void Haptics.impactAsync(style).catch(() => {
    // Music haptics are best-effort and must never affect playback.
  });
}
