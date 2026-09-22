import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const dark = { background: '#000000', text: '#ffffff', secondary: '#a1a1a6', surface: '#1c1c1e', border: '#303033', accent: '#ff375f', glass: 'rgba(30,30,32,0.65)', muted: '#636366' };
export const light: typeof dark = { background: '#ffffff', text: '#18181a', secondary: '#6c6c72', surface: '#f2f2f7', border: '#dedee3', accent: '#d91e48', glass: 'rgba(250,250,252,0.72)', muted: '#8e8e93' };
export type Palette = typeof dark;
type Mode = 'system' | 'light' | 'dark';
const Context = createContext({ colors: dark, isDark: true, mode: 'system' as Mode, setMode: (_: Mode) => {} });
export const useTheme = () => useContext(Context);
export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, update] = useState<Mode>('system');
  const touched = useRef(false);
  const writes = useRef(Promise.resolve());
  useEffect(() => { AsyncStorage.getItem('metronomy.appearance').then(value => { if (!touched.current && (value === 'dark' || value === 'light' || value === 'system')) update(value); }).catch(() => {}); }, []);
  const setMode = (value: Mode) => { touched.current = true; update(value); writes.current = writes.current.then(() => AsyncStorage.setItem('metronomy.appearance', value)).catch(() => Alert.alert('Aspetto', 'Tema applicato, ma non salvato per il prossimo avvio.')); };
  const isDark = mode === 'system' ? system !== 'light' : mode === 'dark';
  return <Context.Provider value={{ colors: isDark ? dark : light, isDark, mode, setMode }}>{children}</Context.Provider>;
}
