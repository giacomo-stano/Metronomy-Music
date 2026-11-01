export type MenuEntry = { id: string; kind: 'row' | 'quick' | 'separator'; label?: string; icon?: string; subtitle?: string; disabled?: boolean; destructive?: boolean; selected?: boolean };
type Registration = { entry: MenuEntry; path: number[]; action?: () => void };
export class NativeMenuModel {
  private entries = new Map<string, Registration>();
  private listeners = new Set<() => void>();
  private snapshot: MenuEntry[] = [];
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  private changed() {
    this.snapshot = [...this.entries.values()].sort((a, b) => {
      for (let i = 0; i < Math.max(a.path.length, b.path.length); i++) {
        const difference = (a.path[i] ?? -1) - (b.path[i] ?? -1);
        if (difference) return difference;
      }
      return a.entry.id.localeCompare(b.entry.id);
    }).map(item => item.entry);
    this.listeners.forEach(listener => listener());
  }
  register(entry: MenuEntry, path: number[], action?: () => void) {
    const previous = this.entries.get(entry.id);
    this.entries.set(entry.id, { entry, path, action });
    if (!previous || JSON.stringify([previous.entry, previous.path]) !== JSON.stringify([entry, path])) this.changed();
  }
  remove(id: string) { if (this.entries.delete(id)) this.changed(); }
  select(id: string, busy: boolean) {
    const registration = this.entries.get(id);
    if (!busy && registration && !registration.entry.disabled && registration.entry.kind !== 'separator') registration.action?.();
  }
}
