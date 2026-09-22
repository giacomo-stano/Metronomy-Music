import { requireNativeModule } from 'expo-modules-core';

type Subscription = { remove: () => void };

type RemoteControlsNativeModule = {
  setEnabled: (enabled: boolean) => void;
  addListener: (
    eventName: 'onNextTrack' | 'onPreviousTrack',
    listener: () => void
  ) => Subscription;
};

const RemoteControls = requireNativeModule(
  'MetronomyRemoteControls'
) as RemoteControlsNativeModule;

export function setRemoteControlsEnabled(enabled: boolean) {
  RemoteControls.setEnabled(enabled);
}

export function addRemoteNextListener(listener: () => void) {
  return RemoteControls.addListener('onNextTrack', listener);
}

export function addRemotePreviousListener(listener: () => void) {
  return RemoteControls.addListener('onPreviousTrack', listener);
}
