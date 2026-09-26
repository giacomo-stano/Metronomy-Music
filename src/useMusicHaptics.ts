import { useEffect, useRef, useState } from 'react';
import {
  useAudioSampleListener,
  type AudioPlayer,
} from 'expo-audio';

import { musicBeatHaptic } from './haptics';

type State = {
  baseline: number;
  fastEnvelope: number;
  previousEnergy: number;
  lastPulse: number;
  lastTimestamp: number;
};

const INITIAL_STATE: State = {
  baseline: 0.018,
  fastEnvelope: 0,
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

    /*
     * Two envelopes with different time constants:
     * - baseline follows the overall loudness slowly;
     * - fastEnvelope follows attacks quickly.
     *
     * The old detector compared consecutive PCM blocks. With Expo's small
     * sampling blocks the difference between two adjacent blocks is usually
     * tiny, so it detected almost no beats even on rhythmic music.
     */
    const baseline =
      current.baseline * 0.992 + energy * 0.008;
    const fastEnvelope =
      current.fastEnvelope * 0.72 + energy * 0.28;

    const envelopeLift = fastEnvelope - baseline;
    const instantRise = energy - current.previousEnergy;
    const sinceLastPulse = timestamp - current.lastPulse;

    const strongTransient =
      energy > Math.max(0.010, baseline * 1.08) &&
      (
        envelopeLift > Math.max(0.0018, baseline * 0.055) ||
        instantRise > Math.max(0.0025, baseline * 0.075)
      );

    /*
     * 140 ms allows rhythmic material up to about 7 pulses/s while still
     * preventing a single drum hit from producing several haptic events.
     */
    if (strongTransient && sinceLastPulse >= 0.14) {
      current.lastPulse = timestamp;
      counters.current.transients += 1;

      const relativeLift =
        envelopeLift / Math.max(baseline, 0.006);
      const relativeEnergy =
        energy / Math.max(baseline, 0.006) - 1;

      const strength = Math.min(
        1,
        Math.max(
          0,
          relativeLift * 2.2 + relativeEnergy * 0.75
        )
      );

      musicBeatHaptic(
        0.34 + strength * 0.52,
        0.24 + strength * 0.46
      );
      counters.current.pulses += 1;
    }

    current.baseline = Math.max(0.006, baseline);
    current.fastEnvelope = fastEnvelope;
    current.previousEnergy = energy;
  });

  return diagnostics;
}
