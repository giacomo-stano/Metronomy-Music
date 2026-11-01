import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View, processColor, type NativeSyntheticEvent, type PressableProps, type GestureResponderEvent, type ViewProps } from 'react-native';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import { rememberMenuTrigger } from './menuAnchor';
import { useTheme } from './theme';
import { dispatchSliderAction, type SliderAction } from './nativeSliderCommands';

export const nativeControlsAvailable = Platform.OS === 'ios' && !!requireOptionalNativeModule('MetronomyControls');
type NativeProps = ViewProps & { configuration: Record<string, unknown>; onAction: (event: NativeSyntheticEvent<Record<string, unknown>>) => void };
function nativeView(name: string) { return nativeControlsAvailable ? requireNativeViewManager<NativeProps>('MetronomyControls', name) : null; }
const Button = nativeView('MetronomyButtonView'), Slider = nativeView('MetronomySliderView'), Segments = nativeView('MetronomySegmentsView');
export const NativeMenuView = nativeView('MetronomyMenuView');
export function nativeColor(color: string) {
  const value = processColor(color);
  return typeof value === 'number' ? [(value >>> 16 & 255) / 255, (value >>> 8 & 255) / 255, (value & 255) / 255, (value >>> 24 & 255) / 255] : undefined;
}
export type ButtonContent = { title?: string; symbol?: string; color?: string; fontSize?: number; iconSize?: number; bold?: boolean; loading?: boolean; glass?: boolean };
export function NativeButton({ content, children, style, onPress, onPressIn, onPressOut, onLongPress, disabled, delayLongPress, accessibilityLabel, accessibilityHint, accessibilityState, onLayout, testID }: Omit<PressableProps, 'children'> & { content: ButtonContent; children?: ReactNode }) {
  const { isDark, colors } = useTheme();
  const latest = useRef({ onPress, onPressIn, onPressOut, onLongPress, disabled });
  latest.current = { onPress, onPressIn, onPressOut, onLongPress, disabled };
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const base = typeof style === 'function' ? style({ pressed: false }) : style;
  const flat = StyleSheet.flatten(base);
  const inset = typeof flat?.paddingHorizontal === 'number' ? flat.paddingHorizontal : typeof flat?.padding === 'number' ? flat.padding : 0;
  const hold = !!onLongPress, selected = !!accessibilityState?.selected;
  const { title, symbol, color, fontSize, iconSize, bold, loading, glass } = content;
  const configuration = useMemo(() => ({ title, symbol, fontSize, iconSize, bold, loading, glass, color: nativeColor(color ?? colors.text), dark: isDark,
    inset, disabled: !!disabled, selected, label: accessibilityLabel ?? title, hint: accessibilityHint, longPress: hold, delayLongPress }),
  [title, symbol, fontSize, iconSize, bold, loading, glass, color, colors.text, isDark, inset, disabled, selected, accessibilityLabel, accessibilityHint, hold, delayLongPress]);
  const handleAction = useCallback((event: NativeSyntheticEvent<Record<string, unknown>>) => {
      const current = latest.current, command = event.nativeEvent;
      if (!alive.current || current.disabled) return;
      if (command.action === 'press' || command.action === 'begin' || command.action === 'longPress') {
        const { x, y, width, height } = command;
        if ([x, y, width, height].every(v => typeof v === 'number' && Number.isFinite(v))) {
          rememberMenuTrigger({ measureInWindow: callback => callback(x as number, y as number, width as number, height as number) });
        }
      }
      const responderEvent = event as unknown as GestureResponderEvent;
      if (command.action === 'press') current.onPress?.(responderEvent);
      else if (command.action === 'begin') current.onPressIn?.(responderEvent);
      else if (command.action === 'end') current.onPressOut?.(responderEvent);
      else if (command.action === 'longPress') current.onLongPress?.(responderEvent);
  }, []);
  if (!Button) return null;
  return <View onLayout={onLayout} testID={testID} style={[{ minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' }, base,
    glass && { overflow: 'visible', borderWidth: 0, backgroundColor: 'transparent' }]}>
    {children && <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ opacity: 0, flexDirection: flat?.flexDirection, gap: flat?.gap }}>{children}</View>}
    <Button style={StyleSheet.absoluteFill} onStartShouldSetResponder={() => true} configuration={configuration} onAction={handleAction} />
  </View>;
}
export function NativeSlider(p: { value: number; onChange: (value: number) => void; onPreview?: (value: number | null) => void; live?: boolean; enabled?: boolean; color: string; track: string; label: string }) {
  const latest = useRef(p); latest.current = p;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return Slider ? <Slider style={{ height: 32 }} onStartShouldSetResponder={() => true} onResponderTerminationRequest={() => false} configuration={{ value: p.value, enabled: p.enabled ?? true, color: nativeColor(p.color), track: nativeColor(p.track), label: p.label }} onAction={event => {
    if (alive.current) dispatchSliderAction(event.nativeEvent as SliderAction, latest.current);
  }} /> : null;
}
export function NativeSegments({ labels, selected, onSelect, label, style }: { labels: string[]; selected: number; onSelect: (index: number) => void; label: string; style?: ViewProps['style'] }) {
  const { isDark } = useTheme();
  const [revision, acknowledge] = useState(0);
  return Segments ? <Segments style={[{ height: 36 }, style]} configuration={{ labels, selected, dark: isDark, label, revision }} onAction={event => {
    const index = event.nativeEvent.index;
    if (typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < labels.length && index !== selected) {
      // Reassert the controlled value even when the caller rejects a choice
      // (for example Qobuz in offline mode) without changing React state.
      acknowledge(value => value + 1);
      onSelect(index);
    }
  }} /> : null;
}
