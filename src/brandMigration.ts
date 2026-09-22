import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FS from 'expo-file-system/legacy';

// Old names are used ONLY to recover data from an existing installation.
let running: Promise<void> | undefined;
export function migrateBrandData(): Promise<void> {
  if (!running) running = migrate().finally(() => { running = undefined; });
  return running;
}
async function migrate() {
  if (!FS.documentDirectory) throw new Error('Archivio locale non disponibile.');
  const from = FS.documentDirectory + 'aurora-offline/';
  const to = FS.documentDirectory + 'metronomy-offline/';
  const old = await FS.getInfoAsync(from);
  if (old.exists) {
    const target = await FS.getInfoAsync(to);
    if (!old.isDirectory || target.exists) throw new Error('Sono presenti archivi locali in conflitto. Nessun file sovrascritto: conserva i dati e richiedi assistenza.');
    // Fixed application-owned directory, never a server or user-selected path.
    await FS.moveAsync({ from, to });
  }
  // Copy first, then retire each legacy key. Interrupted migrations can resume.
  for (const key of await AsyncStorage.getAllKeys()) {
    if (!key.startsWith('aurora.')) continue;
    const replacement = 'metronomy.' + key.slice('aurora.'.length);
    const value = await AsyncStorage.getItem(key);
    if (value === null) continue;
    const existing = await AsyncStorage.getItem(replacement);
    if (existing !== null && existing !== value) throw new Error('Preferenze locali in conflitto. Nessun dato sovrascritto.');
    if (existing === null) await AsyncStorage.setItem(replacement, value);
    await AsyncStorage.removeItem(key);
  }
}
