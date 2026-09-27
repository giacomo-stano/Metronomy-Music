import { useEffect, useRef, useState } from 'react';

import { request, type Song } from './api';
import {
  appleMusicHapticsActive,
  appleMusicHapticsTrackAvailable,
  configureAppleMusicHapticsISRC,
  nativeMusicHapticsAvailable,
  nativeNowPlayingMusicHapticsISRC,
  onAppleMusicHapticsActiveChanged,
  onAppleMusicHapticsPlaybackChanged,
  startAppleMusicHapticsStatusObservers,
  stopAppleMusicHapticsStatusObservers,
} from './haptics';

export type AppleMusicHapticsState = {
  coreSupported: boolean;
  active: boolean;
  playing: boolean;
  available: boolean | null;
  isrc: string;
  nativeIsrc: string;
};

export function normalizeISRC(value?: string | null) {
  return (value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function isValidISRC(value: string) {
  return /^[A-Z0-9]{12}$/.test(value);
}

function firstISRC(value: unknown): string {
  if (typeof value === 'string') {
    const normalized = normalizeISRC(value);
    return isValidISRC(normalized) ? normalized : '';
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const normalized = firstISRC(item);
      if (normalized) return normalized;
    }
  }

  return '';
}

async function resolveSongISRC(song: Song) {
  const embedded = normalizeISRC(song.isrc);

  if (isValidISRC(embedded)) {
    return embedded;
  }

  try {
    const detail = await request<{
      info?: Record<string, unknown>;
      isrc?: unknown;
    }>(
      'songs/' + encodeURIComponent(song.id),
      15000
    );

    return firstISRC(
      detail.isrc ??
      detail.info?.isrc ??
      detail.info?.ISRC
    );
  } catch (error) {
    console.warn(
      '[MusicHaptics] Impossibile risolvere ISRC:',
      error
    );
    return '';
  }
}

export function useAppleMusicHaptics(
  song?: Song
): AppleMusicHapticsState {
  const [active, setActive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [available, setAvailable] =
    useState<boolean | null>(null);
  const [isrc, setISRC] = useState('');
  const [nativeIsrc, setNativeISRC] = useState('');

  const generation = useRef(0);
  const currentISRC = useRef('');
  const cache = useRef(new Map<string, string>());

  /*
   * Register JS listeners BEFORE asking the native manager to emit its
   * current state. This prevents the initial isActive event from being lost.
   */
  useEffect(() => {
    if (!nativeMusicHapticsAvailable) return;

    const activeSubscription =
      onAppleMusicHapticsActiveChanged(value => {
        setActive(value);
      });

    const playbackSubscription =
      onAppleMusicHapticsPlaybackChanged(event => {
        const eventISRC = normalizeISRC(event.isrc);

        // Ignore delayed callbacks belonging to a previous Now Playing item.
        if (
          !eventISRC ||
          eventISRC !== currentISRC.current
        ) {
          return;
        }

        setPlaying(event.playing);
      });

    // Seed synchronously as well, then start native status observation.
    setActive(appleMusicHapticsActive());
    startAppleMusicHapticsStatusObservers();

    return () => {
      activeSubscription?.remove();
      playbackSubscription?.remove();
      stopAppleMusicHapticsStatusObservers();
    };
  }, []);

  /*
   * This is the single owner of the Apple Music Haptics state for the
   * current track. No playback function writes the ISRC independently.
   */
  useEffect(() => {
    const run = ++generation.current;
    let cancelled = false;

    currentISRC.current = '';
    setPlaying(false);
    setAvailable(null);
    setISRC('');
    setNativeISRC('');

    if (!song) {
      configureAppleMusicHapticsISRC(null);
      return () => {
        cancelled = true;
      };
    }

    const apply = async () => {
      let resolved = cache.current.get(song.id) ?? '';

      if (!resolved) {
        resolved = await resolveSongISRC(song);

        if (resolved) {
          cache.current.set(song.id, resolved);
        }
      }

      if (
        cancelled ||
        run !== generation.current
      ) {
        return;
      }

      if (!isValidISRC(resolved)) {
        configureAppleMusicHapticsISRC(null);
        currentISRC.current = '';
        setISRC('');
        setNativeISRC('');
        // Apple cannot match a track without a valid ISRC, so fallback is OK.
        setAvailable(false);
        return;
      }

      currentISRC.current = resolved;
      setISRC(resolved);

      configureAppleMusicHapticsISRC(resolved);

      const nativeValue = normalizeISRC(
        nativeNowPlayingMusicHapticsISRC()
      );

      setNativeISRC(nativeValue);

      /*
       * Do not ask Apple about a different state than the actual Now Playing
       * state. A readback mismatch is treated as indeterminate, never as NO.
       */
      if (nativeValue !== resolved) {
        console.warn(
          '[MusicHaptics] Now Playing ISRC mismatch:',
          { requested: resolved, native: nativeValue }
        );
        setAvailable(null);
        return;
      }

      try {
        const result =
          await appleMusicHapticsTrackAvailable(resolved);

        if (
          cancelled ||
          run !== generation.current ||
          currentISRC.current !== resolved
        ) {
          return;
        }

        setAvailable(result);
      } catch (error) {
        if (
          !cancelled &&
          run === generation.current
        ) {
          console.warn(
            '[MusicHaptics] Availability check failed:',
            error
          );
          setAvailable(null);
        }
      }
    };

    void apply();

    return () => {
      cancelled = true;
    };
  }, [song?.id]);

  return {
    coreSupported: nativeMusicHapticsAvailable,
    active,
    playing,
    available,
    isrc,
    nativeIsrc,
  };
}
