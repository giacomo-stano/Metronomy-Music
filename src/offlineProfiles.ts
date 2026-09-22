import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FS from 'expo-file-system/legacy';
import type { Account } from './api';
export type OfflineProfile = { username: string; baseURL: string; count: number };
export function offlineAccount(p: OfflineProfile): Account { return { username: p.username, baseURL: p.baseURL, token: '', admin: false, expires: 0, destinations: [], offline: true }; }
export async function offlineProfiles(): Promise<OfflineProfile[]> {
  const profiles: OfflineProfile[] = [];
  for (const key of await AsyncStorage.getAllKeys()) {
    if (!key.startsWith('metronomy.offline.v1:')) continue;
    try {
      const [, url, user] = key.split(':'); const baseURL = decodeURIComponent(url); const username = decodeURIComponent(user);
      if (!['http:', 'https:'].includes(new URL(baseURL).protocol)) continue;
      const data = JSON.parse(await AsyncStorage.getItem(key) || '{}');
      if (!/^[a-z0-9-]+$/.test(data.folder) || !Array.isArray(data.tracks) || !FS.documentDirectory) continue;
      let count = 0;
      for (const t of data.tracks) {
        if (!/^[a-z0-9-]+\.(flac|mp3|m4a|aac|wav|aiff|ogg|opus|alac)$/.test(t.file)) continue;
        const info = await FS.getInfoAsync(FS.documentDirectory + 'metronomy-offline/' + data.folder + '/' + t.file);
        if (info.exists && !info.isDirectory && info.size > 0 && info.size === t.bytes) count++;
      }
      if (count) profiles.push({ username, baseURL, count });
    } catch { /* An invalid index cannot grant access to any other path. */ }
  }
  return profiles;
}
