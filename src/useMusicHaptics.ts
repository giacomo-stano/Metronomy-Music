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
  bassBaseline: number;
  bassFast: number;
  lowPassByChannel: number[];
  lastPulse: number;
  lastTimestamp: number;
};

const INITIAL_STATE: State = {
  baseline: 0.018,
  fastEnvelope: 0,
  previousEnergy: 0,
  bassBaseline: 0.008,
  bassFast: 0,
  lowPassByChannel: [],
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
    let bassSquares = 0;
    let count = 0;
    let bassCount = 0;

    /*
     * The full-band RMS of mastered music is often almost flat. For haptics
     * we care much more about kick/bass attacks, so build a lightweight
     * one-pole low-pass envelope per channel and measure that energy too.
     *
     * alpha ~= 0.03 places the useful region roughly in the bass/low-mid
     * range for normal 44.1/48 kHz material without needing the sample rate.
     */
    for (let channelIndex = 0; channelIndex < sample.channels.length; channelIndex++) {
      const frames = sample.channels[channelIndex].frames;
      const stride = Math.max(1, Math.floor(frames.length / 160));
      let low = current.lowPassByChannel[channelIndex] ?? 0;

      for (let i = 0; i < frames.length; i++) {
        const value = frames[i] ?? 0;
        low += 0.03 * (value - low);

        if (i % stride === 0) {
          sumSquares += value * value;
          bassSquares += low * low;
          count++;
          bassCount++;
        }
      }

      current.lowPassByChannel[channelIndex] = low;
    }

    if (!count || !bassCount) return;

    const energy = Math.sqrt(sumSquares / count);
    const bassEnergy = Math.sqrt(bassSquares / bassCount);

    const baseline =
      current.baseline * 0.994 + energy * 0.006;
    const fastEnvelope =
      current.fastEnvelope * 0.74 + energy * 0.26;

    const bassBaseline =
      current.bassBaseline * 0.985 + bassEnergy * 0.015;
    const bassFast =
      current.bassFast * 0.58 + bassEnergy * 0.42;

    const bassLift = bassFast - bassBaseline;
    const broadLift = fastEnvelope - baseline;
    const sinceLastPulse = timestamp - current.lastPulse;

    /*
     * Bass attacks are the primary trigger. The broadband envelope is kept
     * as a secondary path for snare/clap-heavy passages with little sub-bass.
     */
    const bassTransient =
      bassEnergy > Math.max(0.0015, bassBaseline * 1.025) &&
      bassLift > Math.max(0.00025, bassBaseline * 0.018);

    const broadTransient =
      energy > Math.max(0.006, baseline * 1.035) &&
      broadLift > Math.max(0.0008, baseline * 0.025);

    const strongTransient = bassTransient || broadTransient;

    if (strongTransient && sinceLastPulse >= 0.13) {
      current.lastPulse = timestamp;
      counters.current.transients += 1;

      const bassStrength =
        bassLift / Math.max(bassBaseline, 0.0015);
      const broadStrength =
        broadLift / Math.max(baseline, 0.006);

      const strength = Math.min(
        1,
        Math.max(0, bassStrength * 3.4 + broadStrength * 1.25)
      );

      musicBeatHaptic(
        0.38 + strength * 0.50,
        0.20 + strength * 0.42
      );
      counters.current.pulses += 1;
    }

    current.baseline = Math.max(0.006, baseline);
    current.fastEnvelope = fastEnvelope;
    current.previousEnergy = energy;
    current.bassBaseline = Math.max(0.0015, bassBaseline);
    current.bassFast = bassFast;
  });

  return diagnostics;
}
