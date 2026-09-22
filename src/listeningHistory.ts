import AsyncStorage from '@react-native-async-storage/async-storage';
import { accountStorageKey, type Album } from './api';
let writes = Promise.resolve();
export async function recentAlbums(key = accountStorageKey('listening')): Promise<Album[]> {
  const value = JSON.parse(await AsyncStorage.getItem(key) || '[]');
  return Array.isArray(value) ? value.filter(a => typeof a?.id === 'string' && typeof a?.name === 'string').slice(0, 24) : [];
}
export function rememberAlbum(album: Album) {
  const key = accountStorageKey('listening');
  writes = writes.then(async () => {
    const previous = await recentAlbums(key).catch(() => []);
    await AsyncStorage.setItem(key, JSON.stringify([album, ...previous.filter(a => a.id !== album.id)].slice(0, 24)));
  }).catch(() => {});
}
