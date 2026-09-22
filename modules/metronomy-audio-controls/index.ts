import { requireOptionalNativeModule } from 'expo-modules-core';

type Subscription = { remove: () => void };

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

export * from './src';
