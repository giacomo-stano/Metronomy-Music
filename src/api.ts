export type Album = { id: string; name: string; artist?: string; coverArt?: string; year?: number };
export type Song = { id: string; title: string; artist: string; album?: string; albumId?: string; artistId?: string; starred?: boolean; duration: number; coverArt?: string };
export type HomeResponse = { recentAlbums: Album[]; madeForYou: Song[] };
export type SearchResponse = { artists: Array<{ id: string; name: string }>; albums: Album[]; songs: Song[] };
export type Lyrics = { synced: boolean; offset?: number; line: { start?: number; value: string }[] };
export type Account = { token: string; username: string; admin: boolean; expires: number; destinations: { id: string; label: string }[]; baseURL: string; offline?: boolean };
type LocalAccess = { read: (path: string, body?: unknown) => Promise<unknown>; cover: (id: string) => string | undefined };
let local: LocalAccess | undefined;
export function configureLocal(value?: LocalAccess) { local = value; }
let account: Account | null = null;
let expired: (() => void) | undefined;
export const currentAccount = () => account;
export function configureAccount(value: Account | null) { account = value; local = undefined; }
export function onSessionExpired(callback?: () => void) { expired = callback; }
export function accountStorageKey(name: string) { const a = configuration(); return 'metronomy.' + name + ':' + encodeURIComponent(a.baseURL) + ':' + encodeURIComponent(a.username); }

export async function endSession() {
  const previous = account;
  configureAccount(null); // Local logout never waits for a reachable server.
  if (!previous || previous.offline) return;
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 5000);
  try { await fetch(previous.baseURL + '/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + previous.token, 'Content-Type': 'application/json' }, body: '{}', signal: controller.signal, redirect: 'error' }); }
  catch { /* Server session will expire normally if revocation cannot be delivered. */ }
  finally { clearTimeout(timer); }
}

export async function login(base: string, username: string, password: string): Promise<Account> {
  const url = new URL(base.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Inserisci un URL HTTP/HTTPS del bridge, senza credenziali o parametri.');
  const baseURL = url.toString().replace(/\/+$/, '');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(baseURL + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: username.trim(), password }), signal: controller.signal, redirect: 'error' });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : 'Login non riuscito. Controlla URL del bridge e credenziali Navidrome.');
    if (!data?.token || !data?.username || !Array.isArray(data.destinations) || !Number.isFinite(data.expires)) throw new Error('Risposta login non valida. Usa l’URL del bridge, porta 8180.');
    return { ...data, baseURL };
  } finally { clearTimeout(timer); }
}

export async function request<T>(path: string, timeoutMs = 15000, body?: unknown): Promise<T> {
  const active = configuration(); const { baseURL, token } = active;
  if (active.offline) {
    if (!local) throw new Error('Archivio offline in apertura. Riprova.');
    const data = await local.read(path, body);
    if (account !== active) throw new Error('Account cambiato: risposta ignorata.');
    return data as T;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseURL}/${path}`, { method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }, signal: controller.signal, redirect: 'error' });
    if (account !== active) throw new Error('Account cambiato: risposta ignorata.');
    if (response.status === 401) { expired?.(); throw new Error('Sessione scaduta. Accedi nuovamente.'); }
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(typeof error?.detail === 'string' ? error.detail : response.status === 404 ? 'Aggiorna il bridge sul server per questa funzione.' : `Errore del server (${response.status}). Riprova.`);
    }
    const data = await response.json() as T;
    if (account !== active) throw new Error('Account cambiato: risposta ignorata.');
    return data;
  } finally { clearTimeout(timeout); }
}

function configuration() {
  if (!account) throw new Error('Accedi con il tuo account Navidrome.');
  return account;
}

export async function getHome(): Promise<HomeResponse> {
  return request<HomeResponse>('home');
}

export async function searchLibrary(query: string): Promise<SearchResponse> {
  return request<SearchResponse>('search?q=' + encodeURIComponent(query));
}

export function streamURL(songId: string): string {
  if (configuration().offline) throw new Error('Questo brano non è scaricato sull’iPhone.');
  const { baseURL, token } = configuration();
  return `${baseURL}/stream/${encodeURIComponent(songId)}?access_token=${encodeURIComponent(token)}`;
}

export function coverURL(coverArtId?: string): string | undefined {
  if (!coverArtId) return undefined;
  const cached = local?.cover(coverArtId);
  if (cached) return cached;
  if (configuration().offline) return undefined;
  const { baseURL, token } = configuration();
  return `${baseURL}/cover/${encodeURIComponent(coverArtId)}?access_token=${encodeURIComponent(token)}`;
}
