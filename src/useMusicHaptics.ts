import { useEffect, useRef } from 'react';
import {
  useAudioSampleListener,
  type AudioPlayer,
} from 'expo-audio';

import { musicBeatHaptic } from './haptics';

type State = {
  baseline: number;
  previousEnergy: number;
  lastPulse: number;
  lastTimestamp: number;
};

const INITIAL_STATE: State = {
  baseline: 0.018,
  previousEnergy: 0,
  lastPulse: -10,
  lastTimestamp: -1,
};

/*
 * Lightweight real-time onset detector.
 *
 * expo-audio gives us PCM frames for the audio that is actually being played,
 * so the haptic pulse follows musical transients instead of a guessed BPM.
 * The adaptive energy floor keeps the detector usable across quiet/loud tracks,
 * while the refractory interval prevents a "buzz" on dense material.
 */
export function useMusicHaptics(
  player: AudioPlayer,
  enabled: boolean,
  trackId?: string
) {
  const state = useRef<State>({ ...INITIAL_STATE });
  const enabledRef = useRef(enabled);

  enabledRef.current = enabled;

  useEffect(() => {
    state.current = { ...INITIAL_STATE };
  }, [trackId]);

  useAudioSampleListener(player, sample => {
    if (!enabledRef.current || !sample.channels.length) return;

    const timestamp = Number.isFinite(sample.timestamp)
      ? sample.timestamp
      : 0;

    const current = state.current;

    // A seek/restart invalidates the previous envelope history.
    if (
      current.lastTimestamp >= 0 &&
      timestamp + 0.08 < current.lastTimestamp
    ) {
      state.current = {
        ...INITIAL_STATE,
        lastTimestamp: timestamp,
      };
      return;
    }

    current.lastTimestamp = timestamp;

    let sumSquares = 0;
    let count = 0;

    for (const channel of sample.channels) {
      const frames = channel.frames;

      // Subsampling is enough for an amplitude envelope and keeps JS work low.
      const stride = Math.max(1, Math.floor(frames.length / 96));

      for (let i = 0; i < frames.length; i += stride) {
        const value = frames[i] ?? 0;
        sumSquares += value * value;
        count++;
      }
    }

    if (!count) return;

    const energy = Math.sqrt(sumSquares / count);

    // Slow envelope: describes the local loudness of the current passage.
    const baseline =
      current.baseline * 0.965 + energy * 0.035;

    const rise = energy - current.previousEnergy;
    const sinceLastPulse = timestamp - current.lastPulse;

    const strongTransient =
      energy > Math.max(0.025, baseline * 1.62) &&
      rise > Math.max(0.006, baseline * 0.24);

    /*
     * 220 ms caps the detector below ~4.5 pulses/s. At ordinary musical
     * tempos this lets kicks/snares through while suppressing rapid waveform
     * fluctuations inside a single hit.
     */
    if (strongTransient && sinceLastPulse >= 0.22) {
      current.lastPulse = timestamp;

      musicBeatHaptic(
        energy > baseline * 2.35 ? 'medium' : 'light'
      );
    }

    current.baseline = Math.max(0.008, baseline);
    current.previousEnergy = energy;
  });
}
