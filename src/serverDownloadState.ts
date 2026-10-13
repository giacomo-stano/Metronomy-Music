import type { CatalogItem } from './networkCatalog';

export type ServerJob = { id: string; target: string; destination: string; title: string; status: 'queued' | 'downloading' | 'completed' | 'failed'; message: string; created: number };
export type ServerState = 'none' | 'submitting' | 'queued' | 'downloading' | 'completed' | 'failed' | 'present' | 'partial';
export const serverLabels: Record<ServerState, string> = {
  none: '', submitting: 'Invio al server', queued: 'In coda sul server', downloading: 'Download sul server',
  completed: 'Download completato', failed: 'Download non riuscito', present: 'Presente sul server', partial: 'Contiene brani sul server',
};
export const catalogTarget = (item: CatalogItem) => item.kind + ':' + item.id;
export function albumCounts(item: CatalogItem): string | null {
  const present = item.libraryPresentCount, total = item.libraryTotalCount;
  return item.kind === 'album' && Number.isInteger(present) && Number.isInteger(total) && total! > 0 && present! >= 0 && present! <= total! ? `${present} / ${total}` : null;
}
export function isServerComplete(item: CatalogItem): boolean {
  return item.kind === 'album' ? !!albumCounts(item) && item.libraryComplete === true && item.libraryPresentCount === item.libraryTotalCount : item.kind === 'track' && !!item.libraryMatch;
}
export function serverLabel(item: CatalogItem, state: ServerState): string {
  const count = albumCounts(item);
  return count ? `${count} brani sul server${['submitting', 'queued', 'downloading', 'failed'].includes(state) ? ' · ' + serverLabels[state] : ''}` : serverLabels[state];
}
export function serverState(item: CatalogItem, jobs: ServerJob[], pending: string[], destination?: string): ServerState {
  if (item.kind === 'artist') return 'none';
  if (isServerComplete(item)) return 'present';
  const targets = [catalogTarget(item), ...(item.kind === 'track' && item.albumId ? ['album:' + item.albumId] : [])];
  if (pending.some(key => targets.some(target => key.startsWith(target + '|')) && (!destination || key.endsWith('|' + destination)))) return 'submitting';
  const matches = jobs.filter(job => targets.includes(job.target) && (!destination || job.destination === destination));
  const active = matches.find(job => job.status === 'downloading') ?? matches.find(job => job.status === 'queued');
  if (active) return active.status;
  const latest = [...matches].sort((a, b) => b.created - a.created)[0];
  if (latest?.status === 'failed') return 'failed';
  if (item.kind === 'album') return albumCounts(item) || item.libraryMatch ? 'partial' : 'none';
  // Album jobs also cover its tracks. Never match by title (different recordings).
  return latest?.status ?? 'none';
}

type Snapshot = { jobs: ServerJob[]; pending: string[]; completion: number };
export class ServerDownloadStore {
  private snapshot: Snapshot = { jobs: [], pending: [], completion: 0 };
  private listeners = new Set<() => void>();
  private requests = new Map<string, Promise<ServerJob>>();
  private disposed = false;
  version = 0;
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: Snapshot) {
    if (this.disposed || JSON.stringify(next) === JSON.stringify(this.snapshot)) return;
    this.snapshot = next; this.version++; this.listeners.forEach(listener => listener());
  }
  accept(jobs: ServerJob[], version = this.version) {
    if (version !== this.version || this.disposed) return;
    const completed = jobs.some(job => job.status === 'completed' && this.snapshot.jobs.find(old => old.id === job.id)?.status !== 'completed');
    this.publish({ ...this.snapshot, jobs: jobs.slice(0, 100), completion: this.snapshot.completion + (completed ? 1 : 0) });
  }
  enqueue(item: CatalogItem, destination: string, send: () => Promise<ServerJob>): Promise<ServerJob> {
    if (this.disposed) return Promise.reject(new Error('Account cambiato.'));
    const key = catalogTarget(item) + '|' + destination;
    const existing = this.requests.get(key);
    if (existing) return existing;
    this.publish({ ...this.snapshot, pending: [...this.snapshot.pending, key] });
    const promise = Promise.resolve().then(() => {
      if (this.disposed) throw new Error('Account cambiato.');
      return send();
    }).then(job => {
      this.accept([job, ...this.snapshot.jobs.filter(old => old.id !== job.id)]);
      return job;
    }).finally(() => {
      this.requests.delete(key);
      this.publish({ ...this.snapshot, pending: this.snapshot.pending.filter(value => value !== key) });
    });
    this.requests.set(key, promise);
    return promise;
  }
  dispose() { this.disposed = true; this.listeners.clear(); this.requests.clear(); }
}
