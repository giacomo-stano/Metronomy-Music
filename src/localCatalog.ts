import type { Album, Song } from './api';
import type { LocalTrack } from './offlineStore';

export function localCatalog(tracks: LocalTrack[], path: string, body?: unknown) {
  if (body !== undefined) throw new Error('Questa operazione richiede l’accesso online a Navidrome.');
  const [route, query] = path.split('?'); const params = new URLSearchParams(query);
  const songs = tracks.map(t => t.song);
  const albumId = (s: Song) => s.albumId || 'local:' + (s.album ?? '') + ':' + s.artist;
  const albums = [...new Map(songs.map(s => [albumId(s), { id: albumId(s), name: s.album ?? s.title, artist: s.artist, coverArt: s.coverArt } as Album])).values()];
  const artists = [...new Map(songs.map(s => [s.artistId || s.artist, { id: s.artistId || s.artist, name: s.artist }])).values()];
  if (route === 'home') return { recentAlbums: albums, madeForYou: songs.slice(0, 20) };
  if (route === 'albums' || route === 'library/recent') return { albums, hasMore: false };
  if (route === 'library/songs') return { songs, hasMore: false };
  if (route === 'library/favorites') return { songs: songs.filter(s => s.starred), hasMore: false };
  if (route === 'library/artists') return { artists };
  if (route === 'library/playlists' || route === 'playlists') return { playlists: [] };
  if (route === 'network/downloads') return { jobs: [] };
  if (route.startsWith('library/artists/')) { const id = decodeURIComponent(route.slice(16)); return { albums: albums.filter(a => songs.some(s => albumId(s) === a.id && (s.artistId || s.artist) === id)) }; }
  if (route.startsWith('albums/')) { const id = decodeURIComponent(route.slice(7)); if (id.includes('/')) throw new Error('Gestione del server non disponibile offline.'); return { album: albums.find(a => a.id === id), songs: songs.filter(s => albumId(s) === id) }; }
  if (route === 'search') {
    const q = (params.get('q') ?? '').toLocaleLowerCase();
    return { songs: songs.filter(s => [s.title, s.artist, s.album].join(' ').toLocaleLowerCase().includes(q)), albums: albums.filter(a => [a.name, a.artist].join(' ').toLocaleLowerCase().includes(q)), artists: artists.filter(a => a.name.toLocaleLowerCase().includes(q)) };
  }
  if (route.startsWith('lyrics/')) return tracks.find(t => t.song.id === decodeURIComponent(route.slice(7)))?.lyrics ?? { lyrics: [], source: 'Testo non salvato sul dispositivo' };
  if (route.startsWith('songs/')) {
    const id = decodeURIComponent(route.slice(6)); const track = tracks.find(t => t.song.id === id);
    if (track) return { song: track.song, info: track.info ?? {} };
  }
  throw new Error('Funzione disponibile solo online. Stai utilizzando la musica salvata sull’iPhone.');
}
