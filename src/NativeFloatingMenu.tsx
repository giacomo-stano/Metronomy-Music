import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Keyboard, Modal, StyleSheet, View } from 'react-native';
import { NativeMenuView } from './NativeControls';
import { NativeMenuContext, NativeMenuContent } from './NativeMenuContext';
import { NativeMenuModel } from './nativeMenuModel';
import { measureMenuAnchor, type MenuAnchor } from './menuAnchor';
import { useTheme } from './theme';

export default function NativeFloatingMenu({ children, onClose, busy = false }: { children: ReactNode; onClose: () => void; busy?: boolean }) {
  const { isDark } = useTheme();
  const model = useMemo(() => new NativeMenuModel(), []);
  const items = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null), [measured, setMeasured] = useState(false), [shown, setShown] = useState(false);
  useEffect(() => {
    Keyboard.dismiss();
    return measureMenuAnchor(point => { setAnchor(point); setMeasured(true); });
  }, []);
  return <Modal transparent animationType="none" onShow={() => setShown(true)} onRequestClose={onClose}>
    <View style={{ flex: 1 }} accessibilityViewIsModal onAccessibilityEscape={onClose}>
      <NativeMenuContext.Provider value={model}>
        <View pointerEvents="none" accessibilityElementsHidden style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}><NativeMenuContent>{children}</NativeMenuContent></View>
      </NativeMenuContext.Provider>
      {NativeMenuView && <NativeMenuView style={StyleSheet.absoluteFill} configuration={{ items, busy, dark: isDark, anchor: anchor ?? {}, ready: shown && measured }} onAction={event => {
        if (event.nativeEvent.action === 'dismiss') onClose();
        else if (event.nativeEvent.action === 'select' && typeof event.nativeEvent.id === 'string') model.select(event.nativeEvent.id, busy);
      }} />}
    </View>
  </Modal>;
}
