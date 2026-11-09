// In-memory diagnostic snapshots. No song title, ID, URL or account information.
export type TimelineSample = {
  label: string;
  nativeDuration: number;
  catalogDuration: number;
  nativePosition: number;
  playing: boolean;
  buffering: boolean;
  elapsedMs: number;
};
const samples: TimelineSample[] = [];
const begin = Date.now();
const safe = (n: number | undefined) => Number.isFinite(n) && n! >= 0 ? n! : 0;
export function captureTimeline(label: string, status: {
  duration?: number; currentTime?: number; playing?: boolean; isBuffering?: boolean;
}, catalogDuration: number) {
  samples.unshift({
    label, nativeDuration: safe(status.duration), catalogDuration: safe(catalogDuration),
    nativePosition: safe(status.currentTime), playing: !!status.playing,
    buffering: !!status.isBuffering, elapsedMs: Date.now() - begin,
  });
  if (samples.length > 30) samples.length = 30;
}
export function timelineSamples() { return samples.map(entry => ({ ...entry })); }
export function clearTimelineSamples() { samples.length = 0; }
