import { request, streamURL, type Song } from './api';
import { playbackSource } from './playbackSource';
export async function songPlaybackSource(song: Song, offline: boolean, localSource: (id: string) => Promise<string | undefined>) {
  if (!song.qobuzId) return playbackSource(song.id, offline, localSource, streamURL);
  if (offline) throw new Error('La riproduzione Qobuz richiede internet. Usa i brani scaricati nella Libreria.');
  // Resolve each start afresh: signed Qobuz URLs expire and must not be persisted.
  const data = await request<{ url: string }>('network/playback/' + encodeURIComponent(song.qobuzId), 45000);
  if (!/^https:\/\//i.test(data.url ?? '')) throw new Error('Risposta di riproduzione Qobuz non valida.');
  return { uri: data.url };
}
