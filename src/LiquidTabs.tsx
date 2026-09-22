import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, PanResponder, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import GlassBackground from './GlassBackground';
import { useTheme } from './theme';
import Pressable from './SpringPressable';

type Tab = { name: string; icon: keyof typeof Ionicons.glyphMap };
export default function LiquidTabs({ tabs, selected, onSelect }: { tabs: Tab[]; selected: string; onSelect: (name: string) => void }) {
  const { colors: c, isDark } = useTheme();
  const container = useRef<View>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const position = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(1)).current;
  const reduced = useRef(true);
  const tracking = useRef(false);
  const bounds = useRef({ x: 0, y: 0, width: 0 });
  const live = useRef({ tabs, selected, onSelect, width, hover });
  live.current = { tabs, selected, onSelect, width, hover };
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then(v => { if (active) reduced.current = v; });
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', v => { reduced.current = v; });
    return () => { active = false; listener.remove(); position.stopAnimation(); lift.stopAnimation(); };
  }, []);
  function move(index: number, dragging: boolean) {
    const cell = (live.current.width - 8) / live.current.tabs.length;
    const x = Math.max(0, index * cell);
    if (reduced.current) { position.setValue(x); lift.setValue(1); return; }
    Animated.parallel([
      Animated.spring(position, { toValue: x, stiffness: 430, damping: 30, mass: .6, useNativeDriver: true }),
      Animated.spring(lift, { toValue: dragging ? 1.18 : 1, stiffness: 380, damping: 23, mass: .6, useNativeDriver: true }),
    ]).start();
  }
  useEffect(() => { if (!tracking.current) move(Math.max(0, tabs.findIndex(t => t.name === selected)), false); }, [selected, width]);
  function indexAt(x: number, y: number) {
    const b = bounds.current;
    if (!b.width || x < b.x - 12 || x > b.x + b.width + 12 || y < b.y - 45 || y > b.y + 100) return null;
    return Math.max(0, Math.min(live.current.tabs.length - 1, Math.floor((x - b.x - 4) / ((b.width - 8) / live.current.tabs.length))));
  }
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 5 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderGrant: event => {
      tracking.current = true;
      const index = indexAt(event.nativeEvent.pageX, event.nativeEvent.pageY);
      setHover(index); if (index !== null) move(index, true);
    },
    onPanResponderMove: (_, g) => { const i = indexAt(g.moveX, g.moveY); setHover(i); if (i !== null) move(i, true); },
    onPanResponderRelease: (_, g) => {
      const i = indexAt(g.moveX, g.moveY); tracking.current = false; setHover(null);
      if (i !== null) { live.current.onSelect(live.current.tabs[i].name); move(i, false); }
      else move(Math.max(0, live.current.tabs.findIndex(t => t.name === live.current.selected)), false);
    },
    onPanResponderTerminate: () => { tracking.current = false; setHover(null); move(Math.max(0, live.current.tabs.findIndex(t => t.name === live.current.selected)), false); },
    onPanResponderTerminationRequest: () => true,
  })).current;
  const active = hover ?? tabs.findIndex(t => t.name === selected);
  return <View ref={container} {...responder.panHandlers} onLayout={event => {
    setWidth(event.nativeEvent.layout.width);
    container.current?.measureInWindow((x, y, w) => { bounds.current = { x, y, width: w }; });
  }} onTouchStart={() => container.current?.measureInWindow((x, y, w) => { bounds.current = { x, y, width: w }; })} style={{ height: 64, marginTop: 8, borderRadius: 34, padding: 4, borderWidth: .5, borderColor: c.border }}>
    <View pointerEvents="none" style={{ position: 'absolute', inset: 0, borderRadius: 34, overflow: 'hidden' }}><GlassBackground /></View>
    {!!width && <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 4, top: 4, bottom: 4, width: (width - 8) / tabs.length, borderRadius: 30, backgroundColor: isDark ? '#ffffff20' : '#ffffffaa', borderWidth: .5, borderColor: c.border, shadowColor: '#000', shadowOpacity: hover === null ? 0 : .18, shadowRadius: 12, shadowOffset: { width: 0, height: 3 }, transform: [{ translateX: position }, { scale: lift }] }} />}
    <View style={{ flexDirection: 'row', flex: 1 }}>{tabs.map((tab, i) => <Pressable key={tab.name} accessibilityRole="tab" accessibilityLabel={tab.name} accessibilityState={{ selected: selected === tab.name }} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} onLongPress={() => { setHover(i); move(i, true); }} delayLongPress={180} onPressOut={() => { if (!tracking.current) { setHover(null); move(Math.max(0, tabs.findIndex(t => t.name === selected)), false); } }} onPress={() => { onSelect(tab.name); move(i, false); }}>
      <Animated.View style={{ alignItems: 'center', transform: [{ scale: hover === i ? lift : 1 }] }}><Ionicons name={tab.icon} size={25} color={active === i ? c.accent : c.text} /><Text style={{ color: active === i ? c.accent : c.text, fontSize: 10, fontWeight: '600', marginTop: 2 }}>{tab.name}</Text></Animated.View>
    </Pressable>)}</View>
  </View>;
}
