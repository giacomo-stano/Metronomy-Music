import React from 'react';
import {
  Platform,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import {
  requireNativeViewManager,
  requireOptionalNativeModule,
} from 'expo-modules-core';

type NativeControlProps = ViewProps;

const hasSystemVolumeModule =
  Platform.OS === 'ios' &&
  !!requireOptionalNativeModule('MetronomySystemVolume');

const hasAirPlayModule =
  Platform.OS === 'ios' &&
  !!requireOptionalNativeModule('MetronomyAirPlay');

const NativeSystemVolumeView = hasSystemVolumeModule
  ? requireNativeViewManager<NativeControlProps>('MetronomySystemVolume')
  : null;

const NativeAirPlayView = hasAirPlayModule
  ? requireNativeViewManager<NativeControlProps>('MetronomyAirPlay')
  : null;

export const nativeSystemVolumeAvailable = !!NativeSystemVolumeView;
export const nativeAirPlayAvailable = !!NativeAirPlayView;

export function SystemVolumeSlider({
  style,
  ...props
}: ViewProps & { style?: StyleProp<ViewStyle> }) {
  if (!NativeSystemVolumeView) {
    return <View {...props} style={style} />;
  }

  return (
    <NativeSystemVolumeView
      {...props}
      style={[{ width: '100%', height: 34 }, style]}
    />
  );
}

export function AirPlayButton({
  style,
  ...props
}: ViewProps & { style?: StyleProp<ViewStyle> }) {
  if (!NativeAirPlayView) {
    return <View {...props} style={style} />;
  }

  return (
    <NativeAirPlayView
      {...props}
      style={[{ width: 44, height: 44 }, style]}
    />
  );
}
