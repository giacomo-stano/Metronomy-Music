import AsyncStorage from '@react-native-async-storage/async-storage';
import { accountStorageKey } from './api';
import { useSyncExternalStore } from 'react';
type Seed = { id: string; plays: number; last: number };
let writes = Promise.resolve();
let revision = 0;
const listeners = new Set<() => void>();
const subscribe = (callback: () => void) => { listeners.add(callback); return () => { listeners.delete(callback); }; };
export const useListeningRevision = () => useSyncExternalStore(subscribe, () => revision, () => revision);
async function read(key: string): Promise<Seed[]> {
  const data = JSON.parse(await AsyncStorage.getItem(key) || '[]');
  return Array.isArray(data) ? data.filter(s => typeof s?.id === 'string' && Number.isInteger(s.plays) && s.plays > 0 && Number.isFinite(s.last)).slice(0, 100) : [];
}
export function rememberTrack(id: string) {
  const key = accountStorageKey('taste.v1');
  writes = writes.then(async () => {
    const previous = await read(key).catch(() => []);
    const plays = Math.min(1000, (previous.find(s => s.id === id)?.plays ?? 0) + 1);
    await AsyncStorage.setItem(key, JSON.stringify([{ id, plays, last: Date.now() }, ...previous.filter(s => s.id !== id)].slice(0, 100)));
    revision++; listeners.forEach(notify => notify());
  }).catch(() => {});
}
export async function listeningSeeds() {
  const key = accountStorageKey('taste.v1');
  await writes;
  const values = await read(key).catch(() => []);
  const score = (s: Seed) => s.plays / (1 + Math.max(0, Date.now() - s.last) / (7 * 86400000));
  return values.sort((a, b) => score(b) - score(a)).slice(0, 12).map(({ id, plays }) => ({ id, plays }));
}
