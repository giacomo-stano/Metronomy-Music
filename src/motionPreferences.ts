import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

let preferences = { reduceMotion: true, reduceTransparency: true };
const listeners = new Set<() => void>();
let subscriptions: { remove(): void }[] = [];
let generation = 0;
function update(value: Partial<typeof preferences>) {
  const next = { ...preferences, ...value };
  if (next.reduceMotion === preferences.reduceMotion && next.reduceTransparency === preferences.reduceTransparency) return;
  preferences = next;
  listeners.forEach(listener => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    const version = ++generation;
    void AccessibilityInfo.isReduceMotionEnabled().then(reduceMotion => {
      if (generation === version) update({ reduceMotion });
    }).catch(() => {});
    void AccessibilityInfo.isReduceTransparencyEnabled().then(reduceTransparency => {
      if (generation === version) update({ reduceTransparency });
    }).catch(() => {});
    subscriptions = [
      AccessibilityInfo.addEventListener('reduceMotionChanged', reduceMotion => update({ reduceMotion })),
      AccessibilityInfo.addEventListener('reduceTransparencyChanged', reduceTransparency => update({ reduceTransparency })),
    ];
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      generation++;
      subscriptions.forEach(subscription => subscription.remove());
      subscriptions = [];
    }
  };
}
const snapshot = () => preferences;
export const useMotionPreferences = () => useSyncExternalStore(subscribe, snapshot, snapshot);
