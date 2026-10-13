import { createContext, useContext, useState, type ReactNode } from 'react';
import { SafeAreaView, StyleSheet, View } from 'react-native';

const Insets = createContext({ top: 0, bottom: 0 });
export const useScreenInsets = () => useContext(Insets);

// Measure the same native safe area used by the app, without device-model constants.
export function ScreenInsetsProvider({ children }: { children: ReactNode }) {
  const [frame, setFrame] = useState(0);
  const [content, setContent] = useState({ y: 0, height: 0 });
  return <View style={{ flex: 1 }} onLayout={e => setFrame(e.nativeEvent.layout.height)}>
    <Insets.Provider value={{ top: content.y, bottom: Math.max(0, frame - content.y - content.height) }}>{children}</Insets.Provider>
    <SafeAreaView pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
      <View collapsable={false} style={{ flex: 1 }} onLayout={e => { const { y, height } = e.nativeEvent.layout; setContent(old => old.y === y && old.height === height ? old : { y, height }); }} />
    </SafeAreaView>
  </View>;
}
