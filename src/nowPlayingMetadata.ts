import type { Song } from './api';
import { collectISRCs } from './appleMusicHaptics';

// Extra fields are read by our build-time expo-audio config plugin. Keeping
// them on the audio owner makes identity, timeline and playback one publication.
export function nowPlayingMetadata(song: Song, artworkUrl?: string, code?: string) {
  return {
    title: song.title, artist: song.artist, albumTitle: song.album, artworkUrl,
    metronomyTrackId: song.id,
    metronomyISRC: code ?? collectISRCs(song.isrcs, song.isrc)[0] ?? '',
    metronomyDuration: Number.isFinite(song.duration) && song.duration > 0 ? song.duration : 0,
  };
}
