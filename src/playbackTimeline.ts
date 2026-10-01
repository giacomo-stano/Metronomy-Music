// Position and duration must describe the SAME native media timeline. Catalog
// duration is only a loading fallback, never an override of a known asset length.
export function playbackTimeline(status: { currentTime?: number; duration?: number }, catalogDuration = 0) {
  const positive = (value: number | undefined) => Number.isFinite(value) && value! > 0 ? value! : 0;
  const duration = positive(status.duration) || positive(catalogDuration);
  const rawPosition = positive(status.currentTime);
  const position = duration > 0 ? Math.min(rawPosition, duration) : rawPosition;
  return { duration, position, remaining: Math.max(0, duration - position),
    progress: duration > 0 ? position / duration : 0 };
}

type Request = { target: number; generation: number; resolve: (applied: boolean) => void; reject: (error: unknown) => void };

// AVPlayer can cancel an earlier seek when another starts. Serialize native
// calls, coalesce queued drags to the latest target, and invalidate on replace.
export class SeekQueue {
  private generation = 0;
  private invalidating = 0;
  private pending?: Request;
  private active?: Promise<void>;
  constructor(private perform: (target: number) => Promise<void>) {}

  seek(target: number): Promise<boolean> {
    if (this.invalidating || !Number.isFinite(target)) return Promise.resolve(false);
    return new Promise((resolve, reject) => {
      this.pending?.resolve(false);
      this.pending = { target: Math.max(0, target), generation: this.generation, resolve, reject };
      this.pump();
    });
  }

  async invalidate(): Promise<void> {
    this.invalidating++;
    this.generation++;
    this.pending?.resolve(false);
    this.pending = undefined;
    // Wait before replacing the source: an old native completion must not seek
    // or resume the new song. The old caller resolves false, not successful.
    try { await this.active; } finally { this.invalidating--; }
  }

  private pump() {
    if (this.invalidating || this.active || !this.pending) return;
    const request = this.pending;
    this.pending = undefined;
    this.active = Promise.resolve().then(() => this.perform(request.target)).then(
      () => request.resolve(request.generation === this.generation && !this.pending),
      error => {
        if (request.generation === this.generation && !this.pending) request.reject(error);
        else request.resolve(false);
      },
    ).finally(() => { this.active = undefined; this.pump(); });
  }
}

type SeekPlayer = { seekTo(seconds: number, before?: number, after?: number): Promise<void>; currentStatus: { duration: number; isLoaded: boolean } };
const queues = new WeakMap<SeekPlayer, SeekQueue>();
function queue(player: SeekPlayer) {
  let result = queues.get(player);
  if (!result) {
    // Zero tolerances request the selected instant instead of AVPlayer's default
    // approximate seek. Use this for slider, lyrics, previous and replay alike.
    result = new SeekQueue(target => player.seekTo(target, 0, 0));
    queues.set(player, result);
  }
  return result;
}
export function seekPlayback(player: SeekPlayer, seconds: number, catalogDuration = 0) {
  if (!player.currentStatus.isLoaded) return Promise.resolve(false);
  const { duration } = playbackTimeline(player.currentStatus, catalogDuration);
  return queue(player).seek(duration > 0 ? Math.min(duration, seconds) : seconds);
}
export function invalidatePlaybackSeeks(player: SeekPlayer) { return queue(player).invalidate(); }
