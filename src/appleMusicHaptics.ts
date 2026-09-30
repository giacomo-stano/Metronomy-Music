// Pure orchestration: testable without an iPhone. Availability is never playback.
export type NativeHapticsState = {
  key: string; supported: boolean; active: boolean; playing: boolean; nativeIsrc: string;
  nowPlayingReady: boolean; audioPlaying: boolean; observerRegistered: boolean;
};
export type AppleHapticsState = NativeHapticsState & {
  phase: 'idle' | 'native-missing' | 'checking' | 'missing-isrc' | 'ready' | 'error';
  isrc: string; available: boolean | null; error: string;
};
export type HapticsTrack = { id: string; title: string; artist: string; isrc?: unknown };
export type AppleHapticsNative = {
  beginTrack(key: string, title: string, artist: string): Promise<NativeHapticsState>;
  setISRC(key: string, code: string): Promise<NativeHapticsState>;
  getState(): Promise<NativeHapticsState>;
  checkAvailability(code: string): Promise<boolean>;
  clearTrack(key: string): Promise<void>;
};
export const emptyHapticsState: AppleHapticsState = {
  key: '', supported: false, active: false, playing: false, nativeIsrc: '',
  nowPlayingReady: false, audioPlaying: false, observerRegistered: false,
  phase: 'idle', isrc: '', available: null, error: '',
};

export function normalizeISRC(value: unknown): string {
  if (Array.isArray(value)) return value.map(normalizeISRC).find(Boolean) ?? '';
  if (typeof value !== 'string') return '';
  const code = value.trim().toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/.test(code) ? code : '';
}

export function detailISRC(detail: any): string {
  // Do not let an empty/invalid first field hide a valid later field.
  return [detail?.isrc, detail?.ISRC, detail?.info?.isrc, detail?.info?.ISRC,
    detail?.song?.isrc, detail?.song?.ISRC].map(normalizeISRC).find(Boolean) ?? '';
}

export function withTimeout<T>(promise: Promise<T>, ms = 10000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Verifica scaduta. Tocca Riprova.')), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

let sequence = 0;
export class AppleHapticsSession {
  state = { ...emptyHapticsState };
  private key = '';
  private track?: HapticsTrack;
  constructor(private native: AppleHapticsNative | null,
    private readDetail: (id: string) => Promise<unknown>,
    private publish: (state: AppleHapticsState) => void,
    private timeoutMs = 10000) {}

  private update(patch: Partial<AppleHapticsState>) {
    const next = { ...this.state, ...patch };
    if (JSON.stringify(next) !== JSON.stringify(this.state)) {
      this.state = next;
      this.publish(next);
    }
  }

  accept(snapshot: NativeHapticsState) {
    if (snapshot.key === this.key && this.key) this.update(snapshot);
  }

  async select(track?: HapticsTrack) {
    const oldKey = this.key;
    const key = this.key = `${Date.now()}:${++sequence}`;
    this.track = track;
    this.update({ ...emptyHapticsState, key, phase: track ? 'checking' : 'idle' });
    if (!this.native) {
      if (track) this.update({ phase: 'native-missing' });
      return;
    }
    if (!track) {
      if (oldKey) await this.native.clearTrack(oldKey).catch(() => {});
      return;
    }
    try {
      const snapshot = await withTimeout(this.native.beginTrack(key, track.title, track.artist), this.timeoutMs);
      if (key !== this.key) return;
      this.accept(snapshot);
      if (!snapshot.supported) { this.update({ phase: 'ready' }); return; }
      const code = normalizeISRC(track.isrc) || detailISRC(await withTimeout(this.readDetail(track.id), this.timeoutMs));
      if (key !== this.key) return;
      if (!code) { this.update({ phase: 'missing-isrc' }); return; }
      this.update({ isrc: code });
      this.accept(await withTimeout(this.native.setISRC(key, code), this.timeoutMs));
      if (key !== this.key) return;
      // Query Apple's catalog even when Now Playing is still settling.
      const available = await withTimeout(this.native.checkAvailability(code), this.timeoutMs);
      if (key === this.key) this.update({ available, phase: 'ready' });
    } catch {
      if (key === this.key) this.update({ phase: 'error', error: 'Impossibile verificare ISRC o disponibilità Apple. Riprova con il server e Internet raggiungibili.' });
    }
  }

  async refresh() {
    if (!this.native || !this.track) return;
    const key = this.key;
    try {
      const snapshot = await withTimeout(this.native.getState(), this.timeoutMs);
      if (key === this.key) this.accept(snapshot);
    } catch { /* Keep last confirmed state; explicit retry remains available. */ }
  }
  retry() { return this.select(this.track); }
  dispose() {
    const key = this.key;
    this.key = '';
    this.track = undefined;
    if (key) void this.native?.clearTrack(key).catch(() => {});
  }
}

export function hapticsLabel(state: AppleHapticsState): string {
  if (state.phase === 'idle') return 'Music Haptics';
  if (state.phase === 'native-missing') return 'Richiede build iOS';
  if (state.phase === 'checking') return 'Verifica Music Haptics…';
  if (state.phase === 'error') return 'Music Haptics: riprova';
  if (!state.supported) return 'Music Haptics non supportato';
  if (state.phase === 'missing-isrc') return 'ISRC non disponibile';
  if (!state.active) return 'Music Haptics disattivato';
  if (state.available === false) return 'Brano aptico non disponibile';
  if (!state.nowPlayingReady || state.nativeIsrc !== state.isrc || !state.observerRegistered) {
    return 'Sincronizzazione aptica…';
  }
  if (state.playing) return 'Music Haptics in riproduzione';
  return 'Music Haptics attivo';
}
