export type MusicTab = 'Home' | 'Novità' | 'Libreria' | 'Cerca';

// Reselecting the active tab returns to its root, regardless of elapsed time.
// Drag/long-press navigation only switches tabs; it never resets their stacks.
export function shouldResetTab(selected: MusicTab, target: MusicTab, tap = true): boolean {
  return tap && selected === target;
}
