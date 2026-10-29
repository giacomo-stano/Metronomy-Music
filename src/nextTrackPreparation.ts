type Source = { uri: string };
type Entry = {
  owner: unknown; key: string; controller: AbortController;
  source?: Source; ready: boolean; expires: number;
  timer?: ReturnType<typeof setTimeout>;
};

// At most one upcoming remote track. Native registry changes are serialized so
// an obsolete async preload cannot clear a newer entry with the same URI.
export class NextTrackPreparation {
  private entry?: Entry;
  private held = 0;
  private lane: Promise<unknown> = Promise.resolve();
  constructor(
    private warm: (source: Source) => Promise<void>,
    private clearNative: (source: Source) => Promise<void>,
    private now: () => number = () => Date.now(),
    private ttl = 45000,
  ) {}
  private native(work: () => Promise<void>) {
    const result = this.lane.then(work);
    this.lane = result.catch(() => {});
    return result;
  }
  clear() {
    const e = this.entry;
    this.entry = undefined;
    if (!e) return;
    e.controller.abort();
    if (e.timer) clearTimeout(e.timer);
    if (e.ready && e.source) {
      const source = e.source;
      e.ready = false;
      void this.native(() => this.clearNative(source));
    }
  }
  prepare(owner: unknown, key: string, resolve: (signal: AbortSignal) => Promise<Source>) {
    if (!owner || this.held || (this.entry?.owner === owner && this.entry.key === key)) return;
    this.clear();
    const e: Entry = { owner, key, controller: new AbortController(), ready: false, expires: 0 };
    this.entry = e;
    void (async () => {
      try {
        const source = await resolve(e.controller.signal);
        if (this.entry !== e || e.controller.signal.aborted) return;
        // Offline files are fast to open and must be revalidated at selection.
        if (!/^https?:\/\//i.test(source.uri)) return;
        await this.native(async () => {
          if (this.entry !== e || this.held) return;
          try { await this.warm(source); }
          catch { await this.clearNative(source); return; }
          if (this.entry !== e || e.controller.signal.aborted) {
            await this.clearNative(source);
            return;
          }
          e.source = source; e.ready = true; e.expires = this.now() + this.ttl;
          e.timer = setTimeout(() => { if (this.entry === e) this.clear(); }, this.ttl);
        });
      } catch { /* Optional optimization. A normal start always retries fresh. */ }
    })();
  }
  take(owner: unknown, key: string) {
    const e = this.entry;
    if (!e || e.owner !== owner || e.key !== key || !e.ready || !e.source || this.now() >= e.expires) {
      this.clear();
      return undefined; // Never hold up a tap waiting for speculative work.
    }
    this.entry = undefined;
    if (e.timer) clearTimeout(e.timer);
    this.held++;
    let released = false;
    return {
      source: e.source,
      release: () => {
        if (released) return;
        released = true;
        // replace() has already consumed the item, or the start was cancelled.
        // Block new preloads until this cleanup has been queued.
        void this.native(() => this.clearNative(e.source!));
        this.held--;
      },
    };
  }
}

export function upcomingTrack<T>(
  queue: T[], index: number, shuffle: boolean, repeat: 'off' | 'one' | 'all',
): T | undefined {
  if (shuffle || repeat === 'one' || index < 0 || queue.length < 2) return;
  return queue[index + 1] ?? (repeat === 'all' ? queue[0] : undefined);
}
