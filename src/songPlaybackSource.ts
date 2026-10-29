import { request, streamURL, type Song, type RequestOptions } from './api';
import { playbackSource } from './playbackSource';
export async function songPlaybackSource(song: Song, offline: boolean, localSource: (id: string) => Promise<string | undefined>, options?: RequestOptions) {
  if (!song.qobuzId) return playbackSource(song.id, offline, localSource, streamURL);
  if (offline) throw new Error('La riproduzione Qobuz richiede internet. Usa i brani scaricati nella Libreria.');
  // Signed URLs are never persisted. Only nextTrackPreparation may hold one briefly.
  const data = await request<{ url: string }>('network/playback/' + encodeURIComponent(song.qobuzId), 45000, undefined, options);
  if (!/^https:\/\//i.test(data.url ?? '')) throw new Error('Risposta di riproduzione Qobuz non valida.');
  return { uri: data.url };
}
