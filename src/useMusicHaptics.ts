import { useEffect, useRef, useState } from 'react';
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
export type MusicHapticsDiagnostics = {
  pcmSamples: number;
  transients: number;
  pulses: number;
};

export function useMusicHaptics(
  player: AudioPlayer,
  enabled: boolean,
  trackId?: string
): MusicHapticsDiagnostics {
  const state = useRef<State>({ ...INITIAL_STATE });
  const enabledRef = useRef(enabled);
  const counters = useRef<MusicHapticsDiagnostics>({
    pcmSamples: 0,
    transients: 0,
    pulses: 0,
  });
  const lastPublish = useRef(0);
  const [diagnostics, setDiagnostics] =
    useState<MusicHapticsDiagnostics>(counters.current);

  enabledRef.current = enabled;

  useEffect(() => {
    state.current = { ...INITIAL_STATE };
    counters.current = {
      pcmSamples: 0,
      transients: 0,
      pulses: 0,
    };
    setDiagnostics(counters.current);
  }, [trackId]);

  useAudioSampleListener(player, sample => {
    if (!sample.channels.length) return;

    counters.current.pcmSamples += 1;

    const now = Date.now();
    if (now - lastPublish.current >= 500) {
      lastPublish.current = now;
      setDiagnostics({ ...counters.current });
    }

    if (!enabledRef.current) return;

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
      counters.current.transients += 1;

      const strength = Math.min(
        1,
        Math.max(0, (energy / Math.max(baseline, 0.008) - 1.3) / 1.8)
      );

      musicBeatHaptic(
        0.42 + strength * 0.46,
        0.30 + strength * 0.34
      );
      counters.current.pulses += 1;
    }

    current.baseline = Math.max(0.008, baseline);
    current.previousEnergy = energy;
  });

  return diagnostics;
}
