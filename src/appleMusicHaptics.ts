// Pure orchestration: testable without an iPhone. Availability is never playback.
export type NativeHapticsState = {
  key: string; supported: boolean; active: boolean; playing: boolean; nativeIsrc: string;
  nowPlayingReady: boolean; audioPlaying: boolean; observerRegistered: boolean;
  callbackReceived?: boolean; callbackCount?: number; callbackCode?: string; callbackAt?: number;
  duration?: number; elapsed?: number; rate?: number; isLive?: boolean; timelineValid?: boolean;
  ownerReady?: boolean; plistEnabled?: boolean; integrationVersion?: number;
  audioCategory?: string; audioMode?: string; audioRoute?: string;
  elapsedAnchor?: number; publicationCount?: number; activeChangeCount?: number; observerRegistrations?: number;
};
export type AppleHapticsState = NativeHapticsState & {
  phase: 'idle' | 'native-missing' | 'checking' | 'missing-isrc' | 'ready' | 'error';
  isrc: string; available: boolean | null; error: string;
};
export type HapticsTrack = { id: string; title: string; artist: string; isrc?: unknown; isrcs?: unknown; ISRC?: unknown };
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
  if (Array.isArray(value)) return collectISRCs(value)[0] ?? '';
  if (typeof value !== 'string') return '';
  // Accept an explicit metadata label, never extract a code from free text or
  // a title match. Apple needs the identifier of this actual recording.
  const code = value.trim().toUpperCase().replace(/^ISRC\s*:\s*/, '').replace(/[\s-]/g, '');
  return /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/.test(code) ? code : '';
}

export function collectISRCs(...values: unknown[]): string[] {
  const codes = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const code = normalizeISRC(value);
    if (code) codes.add(code);
  };
  values.forEach(visit);
  return [...codes];
}

export function detailISRCs(detail: any): string[] {
  // Navidrome/OpenSubsonic and cached metadata can expose multiple codes.
  // Preserve every authoritative value, not only the first syntactically valid one.
  return collectISRCs(detail?.isrc, detail?.isrcs, detail?.ISRC,
    detail?.info?.isrc, detail?.info?.isrcs, detail?.info?.ISRC,
    detail?.song?.isrc, detail?.song?.isrcs, detail?.song?.ISRC);
}

export function detailISRC(detail: unknown): string {
  return detailISRCs(detail)[0] ?? '';
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
  private confirmedISRC = '';
  constructor(private native: AppleHapticsNative | null,
    private readDetail: (id: string) => Promise<unknown>,
    private publish: (state: AppleHapticsState) => void,
    private timeoutMs = 10000,
    private publishISRC?: (track: HapticsTrack, code: string) => void) {}

  private update(patch: Partial<AppleHapticsState>) {
    const next = { ...this.state, ...patch };
    if (JSON.stringify(next) !== JSON.stringify(this.state)) {
      this.state = next;
      this.publish(next);
    }
  }

  accept(snapshot: NativeHapticsState) {
    if (snapshot.key !== this.key || !this.key) return;
    const confirmed = snapshot.playing && !!this.state.isrc && snapshot.nativeIsrc === this.state.isrc;
    if (confirmed) this.confirmedISRC = this.state.isrc;
    // A positive playback callback is stronger evidence than a stale negative
    // catalog response. Pausing later must not erase that availability proof.
    this.update({ ...snapshot, ...(confirmed ? { available: true, phase: 'ready' as const, error: '' } : {}) });
  }

  private hasPlaybackConfirmation() {
    return !!this.state.isrc && this.confirmedISRC === this.state.isrc;
  }

  private async attach(key: string, track: HapticsTrack, code: string) {
    if (key !== this.key || !this.native) return;
    this.update({ isrc: code, playing: false });
    // Publish through the audio owner so the ISRC and playback timeline share
    // one metadata record. The observer is deliberately a read-only consumer.
    this.publishISRC?.(track, code);
    if (key !== this.key) return;
    const snapshot = await withTimeout(this.native.setISRC(key, code), this.timeoutMs);
    if (key === this.key) this.accept(snapshot);
  }

  async select(track?: HapticsTrack) {
    const oldKey = this.key;
    const key = this.key = `${Date.now()}:${++sequence}`;
    this.track = track;
    this.confirmedISRC = '';
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
      let codes = detailISRCs(track);
      let readDetails = false;
      let hadError = false;
      const checked = new Set<string>();
      const extraCodes = async () => {
        readDetails = true;
        try { return detailISRCs(await withTimeout(this.readDetail(track.id), this.timeoutMs)); }
        catch { hadError = true; return []; }
      };
      if (!codes.length) codes = await extraCodes();
      if (key !== this.key) return;
      if (!codes.length) {
        if (hadError) throw new Error('Unable to read recording metadata');
        this.update({ phase: 'missing-isrc' }); return;
      }

      // Attach the first real code immediately. Check other candidates without
      // repeatedly replacing Now Playing; switch only when Apple accepts one.
      await this.attach(key, track, codes[0]);
      while (key === this.key) {
        for (const code of codes) {
          if (key !== this.key) return;
          if (this.hasPlaybackConfirmation()) {
            this.update({ available: true, phase: 'ready', error: '' }); return;
          }
          if (checked.has(code)) continue;
          checked.add(code);
          let available: boolean;
          try { available = await withTimeout(this.native.checkAvailability(code), this.timeoutMs); }
          catch { hadError = true; continue; }
          if (key !== this.key) return;
          if (this.hasPlaybackConfirmation()) {
            this.update({ available: true, phase: 'ready', error: '' }); return;
          }
          if (available) {
            this.update({ available: true });
            if (this.state.isrc !== code) await this.attach(key, track, code);
            if (key === this.key) this.update({ phase: 'ready', error: '' });
            return;
          }
        }
        if (key !== this.key) return;
        // A list response may contain only the first code: always try the
        // detailed record before concluding that this song is unsupported.
        if (!readDetails) { codes = await extraCodes(); continue; }
        if (this.hasPlaybackConfirmation()) this.update({ available: true, phase: 'ready', error: '' });
        else if (hadError) throw new Error('Incomplete availability check');
        else this.update({ available: false, phase: 'ready' });
        return;
      }
    } catch {
      if (key === this.key && !this.hasPlaybackConfirmation()) {
        this.update({ phase: 'error', available: this.state.available === true ? true : null,
          error: 'Impossibile completare la verifica ISRC o Music Haptics. Riprova con il server e Internet raggiungibili.' });
      }
    }
  }

  async refresh(recheckUnavailable = false) {
    if (!this.native || !this.track) return;
    const key = this.key;
    try {
      const snapshot = await withTimeout(this.native.getState(), this.timeoutMs);
      if (key !== this.key) return;
      this.accept(snapshot);
      // Only foreground/system activation requests re-query a negative or
      // unknown result. The normal 2-second diagnostic poll stays inexpensive.
      if (recheckUnavailable && this.state.supported && this.state.available !== true && this.state.phase !== 'checking') {
        await this.select(this.track);
      }
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
  if (!state.audioPlaying) return 'Music Haptics in pausa';
  return 'Music Haptics: in attesa di iOS';
}

export function hapticsDiagnostics(h: AppleHapticsState): string {
  const yesNo = (value?: boolean) => value === undefined ? 'non rilevato' : value ? 'sì' : 'no';
  const seconds = (value?: number) => value === undefined || value < 0 ? 'assente' : value.toFixed(1) + ' s';
  const guidance = h.playing ? 'iOS conferma la riproduzione della traccia aptica.'
    : h.phase === 'native-missing' ? 'Serve una build iOS nativa: Expo Go non include questo modulo.'
    : !h.supported ? 'API Music Haptics non disponibile su questo dispositivo/build.'
    : h.integrationVersion !== 3 || !h.ownerReady ? 'Installa una nuova build iOS con il plugin dei metadati Music Haptics. Il solo aggiornamento JavaScript non basta.'
    : h.phase === 'missing-isrc' ? 'I metadati del file non contengono un ISRC valido. Non sostituiamo il codice con quello di una registrazione cercata per titolo.'
    : h.phase === 'error' ? 'La verifica non è stata completata: controlla server e Internet, poi riprova.'
    : h.phase === 'checking' ? 'Verifica degli identificatori della registrazione in corso.'
    : h.plistEnabled === false ? 'Questa build non dichiara MusicHapticsSupported. Ricostruisci il progetto iOS.'
    : !h.active ? 'Attiva Music Haptics in Impostazioni iPhone → Accessibilità.'
    : h.available === false ? 'Apple non segnala una traccia aptica per gli ISRC reali verificati. La versione nel catalogo Apple Music può essere una registrazione diversa.'
    : !h.nowPlayingReady || h.nativeIsrc !== h.isrc ? 'Il Now Playing di iOS non corrisponde ancora alla registrazione selezionata.'
    : h.available === null ? 'La disponibilità della traccia Apple non è ancora stata verificata.'
    : !h.timelineValid ? 'La durata o la posizione inviata a iOS non è ancora valida: la disponibilità da sola non conferma la sincronizzazione.'
    : !h.audioPlaying ? 'L’audio risulta in pausa: avvia la riproduzione.'
    : h.callbackReceived ? 'Apple ha risposto per questo ISRC, ma non conferma la riproduzione aptica. Disponibilità e vibrazione effettiva sono due stati distinti.'
    : 'La traccia è stata verificata, ma non è ancora arrivata una conferma da iOS per questo ISRC. La registrazione dell’observer non avvia la vibrazione.';
  return hapticsLabel(h) + '\n\n' + guidance + '\n\n' + [
    'Integrazione nativa: ' + (h.integrationVersion ?? 'precedente'),
    'ISRC brano: ' + (h.isrc || 'assente'), 'ISRC iOS: ' + (h.nativeIsrc || 'assente'),
    'Abilitato da iOS: ' + yesNo(h.active),
    'Traccia Apple: ' + (h.available === null ? 'non verificata' : h.available ? 'disponibile' : 'non disponibile'),
    'Now Playing pronto: ' + yesNo(h.nowPlayingReady), 'Metadati player: ' + yesNo(h.ownerReady),
    'MusicHapticsSupported: ' + yesNo(h.plistEnabled),
    'Durata: ' + seconds(h.duration), 'Posizione: ' + seconds(h.elapsed),
    'Velocità: ' + (h.rate ?? 'assente') + ' · Live: ' + yesNo(h.isLive),
    'Timeline valida: ' + yesNo(h.timelineValid), 'Riproduzione dichiarata nel Now Playing: ' + yesNo(h.audioPlaying),
    'Posizione base pubblicata: ' + seconds(h.elapsedAnchor),
    'Pubblicazioni player: ' + (h.publicationCount ?? 'non rilevate'),
    'Observer Apple: ' + (h.observerRegistered ? 'registrato' : 'non registrato'),
    'Registrazioni observer: ' + (h.observerRegistrations ?? 'non rilevate'),
    'Notifiche attivazione iOS: ' + (h.activeChangeCount ?? 'non rilevate'),
    'Risposta per questo ISRC: ' + (h.callbackReceived === undefined ? 'non rilevata dalla vecchia build' : h.callbackReceived ? 'ricevuta' : 'non ancora ricevuta'),
    'Callback totali: ' + (h.callbackCount ?? 0) + ' · Ultimo ISRC: ' + (h.callbackCode || 'nessuno'),
    'Riproduzione aptica confermata: ' + yesNo(h.playing),
    'Uscita audio: ' + (h.audioRoute || 'non rilevata'),
    'Sessione: ' + (h.audioCategory || 'non rilevata') + ' / ' + (h.audioMode || 'non rilevata'),
  ].join('\n') + (h.error ? '\n\n' + h.error : '');
}
