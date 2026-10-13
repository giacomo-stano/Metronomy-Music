import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ActivityIndicator, AppState, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { currentAccount, request } from './api';
import type { CatalogItem } from './networkCatalog';
import { useTheme } from './theme';
import { useMotionPreferences } from './motionPreferences';
import { ServerDownloadStore, serverState, serverLabel, albumCounts, type ServerJob } from './serverDownloadState';

const Context = createContext<ServerDownloadStore | null>(null);
export function ServerDownloadsProvider({ offline, children }: { offline: boolean; children: ReactNode }) {
  const [store] = useState(() => new ServerDownloadStore());
  useEffect(() => () => store.dispose(), [store]);
  useEffect(() => {
    if (offline) return;
    let live = true, inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      if (!live || inFlight || AppState.currentState === 'background' || AppState.currentState === 'inactive') return;
      inFlight = true;
      const owner = currentAccount(), version = store.version;
      try {
        const data = await request<{ jobs: ServerJob[] }>('network/downloads');
        if (live && currentAccount() === owner) store.accept(data.jobs, version);
      } catch { /* Keep known jobs on transient errors. Other requests expose connectivity. */ }
      finally { inFlight = false; if (live) timer = setTimeout(poll, 5000); }
    }
    void poll();
    const subscription = AppState.addEventListener('change', state => { clearTimeout(timer); if (state === 'active') void poll(); });
    return () => { live = false; clearTimeout(timer); subscription.remove(); };
  }, [offline, store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useServerDownloads() {
  const store = useContext(Context);
  if (!store) throw new Error('ServerDownloadsProvider mancante');
  return { store, ...useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot) };
}
export function useServerCompletion() {
  const store = useContext(Context);
  if (!store) throw new Error('ServerDownloadsProvider mancante');
  return useSyncExternalStore(store.subscribe, () => store.getSnapshot().completion, () => 0);
}
export function ServerDownloadBadge({ item, label = false }: { item: CatalogItem; label?: boolean }) {
  const { jobs, pending } = useServerDownloads();
  const { colors: c } = useTheme();
  const { reduceMotion } = useMotionPreferences();
  const state = serverState(item, jobs, pending);
  if (state === 'none') return null;
  const busy = state === 'submitting' || state === 'queued' || state === 'downloading';
  const color = state === 'failed' ? c.accent : c.secondary;
  const caption = serverLabel(item, state);
  const count = albumCounts(item);
  return <View accessible accessibilityLabel={caption} accessibilityState={{ busy }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, minWidth: 22, minHeight: 24 }}>
    {busy && !reduceMotion ? <ActivityIndicator size="small" color={c.accent} /> : <Ionicons size={20} color={color} name={busy ? 'hourglass-outline' : state === 'failed' ? 'alert-circle-outline' : state === 'partial' ? 'cloud-outline' : state === 'completed' ? 'cloud-download-outline' : 'cloud-done-outline'} />}
    {(label || count) && <Text style={{ fontSize: 12, color, flexShrink: 1 }}>{label ? caption : count}</Text>}
  </View>;
}
