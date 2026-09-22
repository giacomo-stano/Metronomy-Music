import * as FS from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { accountStorageKey, currentAccount, request, type Account, type Song, type Lyrics } from './api';
import { localCatalog } from './localCatalog';

export type LocalTrack = { song: Song; file: string; bytes: number; savedAt: number; cover?: string; lyrics?: { lyrics: Lyrics[]; source?: string; instrumental?: boolean }; info?: Record<string, unknown> };
export type Transfer = { state: 'queued' | 'downloading' | 'error'; progress: number | null; error?: string };
type Job = { cancelled: boolean; task?: FS.DownloadResumable };
const safeFile = /^[a-z0-9-]+\.(flac|mp3|m4a|aac|wav|aiff|ogg|opus|alac)$/;
const uid = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
// Serialize persistence across a rapid logout/login of the same account.
const pendingSaves = new Map<string, Promise<void>>();
const pendingOperations = new Map<string, Promise<void>>();

export class OfflineStore {
  readonly key = accountStorageKey('offline.v1');
  readonly account: Account = currentAccount()!;
  tracks: Record<string, LocalTrack> = {};
  transfers: Record<string, Transfer> = {};
  error = '';
  ready = false;
  syncing = false;
  syncMessage = '';
  private folder = '';
  private stopped = false;
  private version = 0;
  private libraryVersion = 0;
  private covers: Map<string, string> | undefined;
  private listeners = new Set<() => void>();
  private jobs = new Map<string, Job>();
  private queue: Promise<void> = Promise.resolve();
  readonly loading: Promise<void>;
  constructor() { this.loading = this.load(pendingOperations.get(this.key)); pendingOperations.set(this.key, this.loading); }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.version;
  librarySnapshot = () => this.libraryVersion;
  private emit(progressOnly = false) { this.version++; if (!progressOnly) { this.libraryVersion++; this.covers = undefined; } this.listeners.forEach(l => l()); }
  private get root() {
    if (!FS.documentDirectory || !/^[a-z0-9-]+$/.test(this.folder)) throw new Error('Archivio locale non disponibile.');
    return FS.documentDirectory + 'metronomy-offline/' + this.folder + '/';
  }
  private file(name: string) {
    if (!safeFile.test(name) && !/^[a-z0-9-]+\.(part|jpg)$/.test(name)) throw new Error('File locale non valido.');
    return this.root + name;
  }
  private async save() {
    const value = JSON.stringify({ folder: this.folder, tracks: Object.values(this.tracks) });
    const pending = (pendingSaves.get(this.key) ?? Promise.resolve()).catch(() => {}).then(() => AsyncStorage.setItem(this.key, value));
    pendingSaves.set(this.key, pending); await pending;
  }
  private async load(previous?: Promise<void>) {
    try {
      await previous?.catch(() => {});
      await pendingSaves.get(this.key)?.catch(() => {});
      const raw = await AsyncStorage.getItem(this.key);
      const data = raw ? JSON.parse(raw) : { folder: uid(), tracks: [] };
      if (!/^[a-z0-9-]+$/.test(data.folder) || !Array.isArray(data.tracks)) throw new Error('Indice locale non valido; nessun file modificato.');
      this.folder = data.folder;
      await FS.makeDirectoryAsync(this.root, { intermediates: true });
      for (const entry of data.tracks) {
        if (!safeFile.test(entry?.file) || typeof entry?.song?.id !== 'string') continue;
        const info = await FS.getInfoAsync(this.file(entry.file));
        if (info.exists && !info.isDirectory && info.size > 0 && info.size === entry.bytes) {
          if (entry.cover) {
            const cover = /^[a-z0-9-]+\.jpg$/.test(entry.cover) ? await FS.getInfoAsync(this.file(entry.cover)) : null;
            if (!cover?.exists || cover.isDirectory) delete entry.cover;
          }
          this.tracks[entry.song.id] = entry;
        }
      }
      // Only owned, generated filenames: never recurse or delete a music folder.
      const retained = new Set(Object.values(this.tracks).flatMap(t => [t.file, t.cover].filter(Boolean)));
      for (const name of await FS.readDirectoryAsync(this.root)) {
        if ((safeFile.test(name) || /^[a-z0-9-]+\.(part|jpg)$/.test(name)) && !retained.has(name)) {
          const info = await FS.getInfoAsync(this.file(name));
          if (info.exists && !info.isDirectory) await FS.deleteAsync(this.file(name), { idempotent: true });
        }
      }
      await this.save();
    } catch (e) { this.error = e instanceof Error ? e.message : 'Archivio locale non disponibile.'; }
    finally { this.ready = true; this.emit(); }
  }
  async source(songId: string): Promise<string | undefined> {
    await this.loading;
    const entry = this.tracks[songId];
    if (!entry) return;
    const info = await FS.getInfoAsync(this.file(entry.file));
    if (info.exists && !info.isDirectory && info.size === entry.bytes) return this.file(entry.file);
    delete this.tracks[songId]; await this.save(); this.emit();
  }
  async download(song: Song) {
    await this.loading;
    if (this.stopped || currentAccount() !== this.account) return;
    if (this.account.offline) throw new Error('Accedi online per scaricare altri brani.');
    if (this.error) throw new Error(this.error);
    if (this.jobs.has(song.id) || await this.source(song.id)) return;
    if (this.jobs.has(song.id) || this.stopped) return;
    const job: Job = { cancelled: false };
    this.jobs.set(song.id, job); this.transfers[song.id] = { state: 'queued', progress: null }; this.emit();
    const work = this.queue.then(async () => {
      let part = ''; let final = '';
      const alive = () => !job.cancelled && !this.stopped && currentAccount() === this.account;
      try {
        if (!alive()) return;
        const info = await request<{ song: Song; suffix: string; size: number }>('songs/' + encodeURIComponent(song.id) + '/offline-info');
        if (!alive()) return;
        const name = uid(); final = name + '.' + info.suffix; part = name + '.part';
        if (!safeFile.test(final)) throw new Error('Formato non supportato.');
        const free = await FS.getFreeDiskStorageAsync();
        if (info.size > 0 && free < info.size + 20 * 1048576) throw new Error('Spazio insufficiente sull’iPhone.');
        this.transfers[song.id] = { state: 'downloading', progress: null }; this.emit();
        let last = 0;
        job.task = FS.createDownloadResumable(this.account.baseURL + '/offline/' + encodeURIComponent(song.id), this.file(part), {
          headers: { Authorization: 'Bearer ' + this.account.token }, sessionType: FS.FileSystemSessionType.FOREGROUND,
        }, progress => {
          if (!alive() || Date.now() - last < 120) return; last = Date.now();
          this.transfers[song.id] = { state: 'downloading', progress: progress.totalBytesExpectedToWrite > 0 ? Math.min(.99, progress.totalBytesWritten / progress.totalBytesExpectedToWrite) : null }; this.emit(true);
        });
        const result = await job.task.downloadAsync();
        if (!alive()) return;
        const contentType = Object.entries(result?.headers ?? {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
        const downloaded = await FS.getInfoAsync(this.file(part));
        if (!result || result.status !== 200 || /json|xml|html/i.test(contentType) || !downloaded.exists || downloaded.isDirectory || downloaded.size <= 0 || (info.size > 0 && downloaded.size !== info.size)) throw new Error('Download incompleto o accesso negato. Riprova.');
        await FS.moveAsync({ from: this.file(part), to: this.file(final) });
        if (!alive()) return;
        this.tracks[song.id] = { song: info.song, file: final, bytes: downloaded.size, savedAt: Date.now() };
        try { await this.save(); } catch { delete this.tracks[song.id]; throw new Error('Impossibile salvare l’indice del download.'); }
        final = ''; // Committed file must survive cleanup and logout.
        await this.enrich(song.id, job);
      } catch (e) {
        if (alive()) this.transfers[song.id] = { state: 'error', progress: null, error: e instanceof Error ? e.message : 'Download non riuscito. Controlla rete e spazio disponibile.' };
      } finally {
        for (const name of [part, final]) if (name) await FS.deleteAsync(this.file(name), { idempotent: true }).catch(() => {});
        this.jobs.delete(song.id);
        if (this.transfers[song.id]?.state !== 'error' || job.cancelled) delete this.transfers[song.id];
        this.emit();
      }
    });
    this.queue = work.catch(() => {});
    pendingOperations.set(this.key, this.queue);
    await work;
  }
  async favorite(id: string, starred: boolean) {
    await this.loading;
    if (this.tracks[id]) {
      this.tracks[id] = { ...this.tracks[id], song: { ...this.tracks[id].song, starred } }; this.emit();
      await this.save().catch(() => {});
    }
  }
  cover = (id: string) => {
    if (!this.covers) {
      this.covers = new Map();
      for (const t of Object.values(this.tracks)) if (t.song.coverArt && t.cover && !this.covers.has(t.song.coverArt)) this.covers.set(t.song.coverArt, this.file(t.cover));
    }
    return this.covers.get(id);
  };
  read = async (path: string, body?: unknown) => {
    await this.loading;
    return localCatalog(Object.values(this.tracks).sort((a,b) => b.savedAt - a.savedAt), path, body);
  };
  async lyricsFor(id: string): Promise<{ lyrics: Lyrics[]; source?: string; instrumental?: boolean }> {
    await this.loading;
    const cached = this.tracks[id]?.lyrics;
    if (cached) return cached;
    if (this.account.offline) return { lyrics: [], source: 'Testo non salvato sul dispositivo' };
    const result = await request<{ lyrics: Lyrics[]; source?: string; instrumental?: boolean }>('lyrics/' + encodeURIComponent(id), 35000);
    if (!this.stopped && this.tracks[id] && Array.isArray(result.lyrics)) {
      this.tracks[id] = { ...this.tracks[id], lyrics: result }; await this.save().catch(() => {}); this.emit();
    }
    return result;
  }
  async enrich(id: string, job: Job = { cancelled: false }) {
    const alive = () => !this.stopped && !job.cancelled && currentAccount() === this.account && !!this.tracks[id];
    if (!alive() || this.account.offline) return;
    const original = this.tracks[id];
    let cover = original.cover;
    let newCover = '';
    let lyrics = original.lyrics;
    let info = original.info;
    try {
      if (!cover && original.song.coverArt) {
        newCover = uid() + '.jpg';
        job.task = FS.createDownloadResumable(this.account.baseURL + '/cover/' + encodeURIComponent(original.song.coverArt), this.file(newCover), { headers: { Authorization: 'Bearer ' + this.account.token }, sessionType: FS.FileSystemSessionType.FOREGROUND });
        const result = await job.task.downloadAsync();
        const type = Object.entries(result?.headers ?? {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1] ?? '';
        if (result?.status === 200 && type.startsWith('image/') && alive()) cover = newCover;
      }
    } catch { /* Audio remains playable even without cover art. */ }
    if (alive() && (!lyrics || (!lyrics.instrumental && !lyrics.lyrics.some(l => l.line?.length)))) {
      try {
        const result = await request<{ lyrics: Lyrics[]; source?: string; instrumental?: boolean }>('lyrics/' + encodeURIComponent(id), 35000);
        if (Array.isArray(result.lyrics)) lyrics = { lyrics: result.lyrics, source: result.source, instrumental: result.instrumental };
      } catch { /* Leave unset so a later enrichment can retry. */ }
    }
    if (alive() && !info) {
      try {
        const result = await request<{ info: Record<string, unknown> }>('songs/' + encodeURIComponent(id));
        const allowed = ['genre', 'year', 'bitRate', 'samplingRate', 'bitDepth', 'suffix', 'isrc'];
        info = Object.fromEntries(Object.entries(result.info ?? {}).filter(([key]) => allowed.includes(key)));
      } catch {}
    }
    if (alive()) {
      this.tracks[id] = { ...this.tracks[id], cover, lyrics, info };
      try { await this.save(); newCover = cover === newCover ? '' : newCover; }
      catch { this.tracks[id] = { ...this.tracks[id], cover: original.cover, lyrics: original.lyrics, info: original.info }; }
      this.emit();
    }
    if (newCover) await FS.deleteAsync(this.file(newCover), { idempotent: true }).catch(() => {});
  }
  async syncExtras() {
    await this.loading;
    if (this.account.offline || this.syncing || this.stopped) return;
    this.syncing = true; this.syncMessage = 'Salvataggio copertine e testi…'; this.emit();
    const work = this.queue.then(async () => {
      for (const id of Object.keys(this.tracks)) {
        if (this.stopped || currentAccount() !== this.account) break;
        const job: Job = { cancelled: false }; this.jobs.set('extras:' + id, job);
        try { await this.enrich(id, job); } finally { this.jobs.delete('extras:' + id); }
      }
      const tracks = Object.values(this.tracks);
      this.syncMessage = `${tracks.filter(t => t.cover).length}/${tracks.length} copertine · ${tracks.filter(t => t.lyrics?.lyrics.some(l => l.line?.length)).length}/${tracks.length} testi salvati. Alcuni contenuti possono non essere disponibili alla fonte.`;
    }).finally(() => { this.syncing = false; this.emit(); });
    this.queue = work.catch(() => {}); pendingOperations.set(this.key, this.queue); await work;
  }
  async cancel(id: string) {
    const job = this.jobs.get(id);
    if (job) { job.cancelled = true; delete this.transfers[id]; this.emit(); await job.task?.cancelAsync(); }
  }
  async remove(id: string) {
    await this.loading;
    const entry = this.tracks[id]; if (!entry) return;
    await FS.deleteAsync(this.file(entry.file), { idempotent: true });
    if (entry.cover) await FS.deleteAsync(this.file(entry.cover), { idempotent: true });
    delete this.tracks[id]; this.emit(); await this.save();
  }
  dispose() {
    this.stopped = true;
    for (const job of this.jobs.values()) { job.cancelled = true; void job.task?.cancelAsync().catch(() => {}); }
    this.listeners.clear();
  }
}
