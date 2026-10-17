import type { MusicTab } from './tabNavigation';
import { validPlayerOrigin, type PlayerOrigin } from './dockMotion';

export const dockTabs: MusicTab[] = ['Home', 'Novità', 'Libreria', 'Cerca'];
export type DockCommand = { action: string; index?: number; reset?: boolean; trackID?: string; x?: number; y?: number; width?: number; height?: number };
export type DockHandlers = { onTab: (tab: MusicTab, reset: boolean) => void; onExpand: () => void; onOpen: (origin?: PlayerOrigin) => void; onToggle: () => void; onNext: () => void; onOptions: () => void };

// A native menu may stay open while the queue advances. Never apply its action to
// a different song; native tap/reselection has no JS double-tap timer.
export function dispatchDockCommand(command: DockCommand, trackID: string, canNext: boolean, handlers: DockHandlers) {
  if (command.action === 'expand') { handlers.onExpand(); return; }
  if (command.action === 'tab') {
    if (Number.isInteger(command.index) && command.index! >= 0 && command.index! < dockTabs.length) {
      handlers.onTab(dockTabs[command.index!], command.reset === true);
    }
    return;
  }
  if (!trackID || command.trackID !== trackID) return;
  switch (command.action) {
    case 'open':
      if (validPlayerOrigin(command)) handlers.onOpen({ x: command.x, y: command.y, width: command.width, height: command.height });
      else handlers.onOpen();
      break;
    case 'toggle': handlers.onToggle(); break;
    case 'next': if (canNext) handlers.onNext(); break;
    case 'options': handlers.onOptions(); break;
  }
}
