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

const hasAirPlayModule =
  Platform.OS === 'ios' &&
  !!requireOptionalNativeModule('MetronomyAirPlay');

const NativeAirPlayView = hasAirPlayModule
  ? requireNativeViewManager<NativeControlProps>('MetronomyAirPlay')
  : null;

export const nativeAirPlayAvailable = !!NativeAirPlayView;

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
