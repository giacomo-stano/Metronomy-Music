import * as Haptics from 'expo-haptics';

const fire = (action: Promise<void>) => {
  void action.catch(() => {
    // Haptics are best-effort: unsupported/disabled devices must never
    // interrupt a music interaction.
  });
};

export const hapticSelection = () =>
  fire(Haptics.selectionAsync());

export const hapticLight = () =>
  fire(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));

export const hapticMedium = () =>
  fire(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));

export const hapticRigid = () =>
  fire(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid));

export const hapticSuccess = () =>
  fire(
    Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Success
    )
  );
