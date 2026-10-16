export type MusicTab = 'Home' | 'Novità' | 'Libreria' | 'Cerca';

// A drag/long press selects a tab but must never count as a double tap.
// Reset after a successful pair so three taps don't reset twice.
export class TabPressTracker {
  private last: { tab: MusicTab; time: number } | null = null;
  press(tab: MusicTab, time: number, tap = true): boolean {
    const reset = tap && this.last?.tab === tab && time >= this.last.time && time - this.last.time <= 350;
    this.last = tap && !reset ? { tab, time } : null;
    return !!reset;
  }
}
