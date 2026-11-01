import { Platform, type PressableProps } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { Ionicons } from '@expo/vector-icons';
import Pressable from './SpringPressable';
import { musicChrome } from './musicChrome';
import { useTheme } from './theme';

// Keep the same SF Symbol, optical size and touch target wherever a menu opens.
export default function MusicControlButton({ kind = 'options', color, style, ...props }:
  Omit<PressableProps, 'children'> & { kind?: 'options' | 'filter'; color?: string }) {
  const { colors } = useTheme();
  const tint = color ?? colors.text;
  return <Pressable {...props} accessibilityRole="button" accessibilityLabel={props.accessibilityLabel ?? (kind === 'filter' ? 'Filtra e ordina' : 'Altre opzioni')} style={state => [
    { alignItems: 'center', justifyContent: 'center' },
    typeof style === 'function' ? style(state) : style,
    { minWidth: musicChrome.control.target, minHeight: musicChrome.control.target },
  ]}>
    {Platform.OS === 'ios' ? <SymbolView name={kind === 'filter' ? 'line.3.horizontal.decrease' : 'ellipsis'}
      size={musicChrome.control.icon} weight="semibold" tintColor={tint} /> :
      <Ionicons name={kind === 'filter' ? 'filter' : 'ellipsis-horizontal'} size={musicChrome.control.icon} color={tint} />}
  </Pressable>;
}
