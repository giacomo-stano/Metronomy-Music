import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, type TextStyle } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { Ionicons } from '@expo/vector-icons';
import GlassBackground from './GlassBackground';
import type { ButtonContent } from './NativeControls';

const symbols: Record<string, string> = {
  'chevron-back': 'chevron.left', 'chevron-forward': 'chevron.right', 'chevron-down': 'chevron.down',
  'close': 'xmark', 'close-circle': 'xmark.circle.fill', 'mic-outline': 'mic',
  'search': 'magnifyingglass', 'search-outline': 'magnifyingglass', 'person-circle-outline': 'person.crop.circle',
  'play': 'play.fill', 'pause': 'pause.fill', 'play-skip-forward': 'forward.end.fill', 'play-skip-back': 'backward.end.fill',
  'shuffle': 'shuffle', 'repeat': 'repeat', 'share-outline': 'square.and.arrow.up',
  'download-outline': 'arrow.down.circle', 'arrow-forward': 'arrow.right', 'checkmark': 'checkmark',
  'add': 'plus', 'remove': 'minus', 'ellipsis-horizontal': 'ellipsis', 'filter': 'line.3.horizontal.decrease',
  'star': 'star.fill', 'star-outline': 'star', 'heart': 'heart.fill', 'heart-outline': 'heart',
  'eye-outline': 'eye', 'eye-off-outline': 'eye.slash', 'refresh': 'arrow.clockwise', 'refresh-outline': 'arrow.clockwise',
};
// Only replace discrete controls. Rich rows, artwork, timed lyrics, nested
// actions and arbitrary render props must retain their own layout/semantics.
export function nativeButtonContent(children: ReactNode): { content: ButtonContent; sizing: ReactNode[] } | null {
  const content: ButtonContent = {}, sizing: ReactNode[] = [];
  let valid = true, texts = 0, icons = 0;
  function visit(nodes: ReactNode) {
    Children.forEach(nodes, child => {
      if (child == null || typeof child === 'boolean') return;
      if (!isValidElement<Record<string, unknown>>(child)) { valid = false; return; }
      const props = child.props;
      if (child.type === Fragment) { visit(props.children as ReactNode); return; }
      if (child.type === GlassBackground) { content.glass = true; return; }
      if (child.type === Text) {
        const parts = Children.toArray(props.children as ReactNode);
        if (++texts > 1 || parts.some(part => typeof part !== 'string' && typeof part !== 'number') || props.onPress || props.selectable) { valid = false; return; }
        content.title = parts.join('');
        const style = StyleSheet.flatten(props.style as TextStyle);
        if (style?.opacity != null || style?.textShadowColor || style?.textDecorationLine) { valid = false; return; }
        content.color = typeof style?.color === 'string' ? style.color : content.color;
        content.fontSize = style?.fontSize ?? 14;
        content.bold = style?.fontWeight === 'bold' || Number(style?.fontWeight) >= 600;
      } else if (child.type === SymbolView || child.type === Ionicons) {
        if (++icons > 1 || typeof props.name !== 'string') { valid = false; return; }
        content.symbol = child.type === SymbolView ? props.name : symbols[props.name];
        if (!content.symbol) valid = false;
        content.iconSize = typeof props.size === 'number' ? props.size : 22;
        content.iconWeight = child.type === SymbolView && typeof props.weight === 'string' ? props.weight : 'regular';
        const color = child.type === SymbolView ? props.tintColor : props.color;
        if (!content.color && typeof color === 'string') content.color = color;
      } else if (child.type === ActivityIndicator) {
        content.loading = true;
        if (typeof props.color === 'string') content.color = props.color;
      } else { valid = false; return; }
      sizing.push(child);
    });
  }
  visit(children);
  return valid && (texts > 0 || icons > 0 || content.loading) ? { content, sizing } : null;
}
