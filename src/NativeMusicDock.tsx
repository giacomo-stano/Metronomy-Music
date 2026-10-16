import { memo, useCallback, useMemo, useRef } from 'react';
import { Platform, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import { useScreenInsets } from './ScreenInsets';
import { rememberMenuTrigger } from './menuAnchor';
import { dispatchDockCommand, dockTabs, type DockCommand, type DockHandlers } from './nativeDockCommands';
import type { MusicTab } from './tabNavigation';

type Configuration = {
  selected: number; trackID: string; title: string; artist: string; artwork: string;
  playing: boolean; buffering: boolean; canNext: boolean; compact: boolean; dark: boolean;
};
type NativeProps = ViewProps & { configuration: Configuration; onCommand: (event: NativeSyntheticEvent<DockCommand>) => void };
// Older installed binaries / Expo Go keep the working React Native fallback.
export const nativeMusicDockAvailable = Platform.OS === 'ios' && !!requireOptionalNativeModule('MetronomyDock');
const NativeView = nativeMusicDockAvailable ? requireNativeViewManager<NativeProps>('MetronomyDock') : null;
const DockSurface = memo(function DockSurface(props: NativeProps) {
  const { bottom } = useScreenInsets();
  return NativeView ? <NativeView {...props} style={{ position: 'absolute', left: 10, right: 10, bottom: Math.max(12, bottom + 4), height: 142, zIndex: 60 }} /> : null;
});

type Props = Omit<Configuration, 'selected'> & DockHandlers & { tab: MusicTab };
export default function NativeMusicDock(props: Props) {
  const latest = useRef(props);
  latest.current = props;
  const { tab, trackID, title, artist, artwork, playing, buffering, canNext, compact, dark } = props;
  // Deliberately exclude elapsed time, queue objects and JS callback identities.
  const configuration = useMemo(() => ({ selected: dockTabs.indexOf(tab), trackID, title, artist, artwork, playing, buffering, canNext, compact, dark }), [tab, trackID, title, artist, artwork, playing, buffering, canNext, compact, dark]);
  const onCommand = useCallback((event: NativeSyntheticEvent<DockCommand>) => {
    const command = event.nativeEvent;
    const current = latest.current;
    if (command.action === 'options' && command.trackID === current.trackID) {
      const { x, y, width, height } = command;
      if ([x, y, width, height].every(v => typeof v === 'number' && Number.isFinite(v))) {
        rememberMenuTrigger({ measureInWindow: callback => callback(x!, y!, width!, height!) });
      } else { rememberMenuTrigger(null); }
    }
    dispatchDockCommand(command, current.trackID, current.canNext, current);
  }, []);
  return <DockSurface configuration={configuration} onCommand={onCommand} />;
}
