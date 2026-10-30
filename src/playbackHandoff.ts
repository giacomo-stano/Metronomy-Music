import type { AudioPlayer, AudioStatus } from 'expo-audio';

type Source = { uri: string };
type Player = Pick<AudioPlayer, 'replace' | 'play' | 'addListener' | 'currentStatus'>;

function cancelled() { return new Error('Riproduzione annullata.'); }
function check(signal: AbortSignal) { if (signal.aborted) throw cancelled(); }

// Install first, then wait for this item's native readiness. A URL resolved in
// advance is not proof that AVPlayer has loaded it successfully.
export function replaceAndPlay(
  player: Player, source: Source, signal: AbortSignal, installed: () => void,
  timeoutMs = 45000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false, replaced = false, starting = false;
    let subscription: { remove(): void } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      subscription?.remove();
      signal.removeEventListener('abort', abort);
      if (error !== undefined) reject(error); else resolve();
    };
    const abort = () => finish(cancelled());
    const observe = (status: AudioStatus) => {
      if (settled || !replaced) return;
      if (signal.aborted) { abort(); return; }
      if (status.didJustFinish) return; // A delayed EOF belongs to the old item.
      if (status.error || status.playbackState === 'error' || status.playbackState === 'failed') {
        finish(new Error('Il player non riesce a caricare questo brano.'));
      } else if (starting && status.playing) {
        finish();
      } else if (status.isLoaded && !starting) {
        starting = true; // play() can synchronously emit another ready status.
        try {
          player.play();
          // Do not treat a successful JS call as proof of native playback.
          // Keep watching for errors until iOS acknowledges the play request.
          observe(player.currentStatus);
        } catch (error) { finish(error); }
      }
    };
    try {
      check(signal);
      signal.addEventListener('abort', abort, { once: true });
      subscription = player.addListener('playbackStatusUpdate', observe);
      timer = setTimeout(() => finish(new Error('Il caricamento audio ha impiegato troppo tempo.')), timeoutMs);
      player.replace(source);
      replaced = true;
      installed();
      // Covers assets that became ready synchronously during replace(). Events
      // from the previous item emitted by replace() itself were ignored above.
      observe(player.currentStatus);
    } catch (error) { finish(error); }
  });
}

export async function startPlaybackWithRecovery(options: {
  player: Player; source: Source; signal: AbortSignal;
  installed: () => void; retrying: () => void;
  discard: (source: Source) => Promise<void>;
  freshSource: () => Promise<Source>;
  resolved: (source: Source, retried: boolean) => void;
}) {
  const { player, signal, installed } = options;
  check(signal);
  options.resolved(options.source, false);
  try {
    await replaceAndPlay(player, options.source, signal, installed);
  } catch (error) {
    check(signal); // A newer selection or logout must never restart this track.
    options.retrying();
    await options.discard(options.source);
    check(signal);
    const source = await options.freshSource();
    check(signal);
    options.resolved(source, true);
    // Exactly one ordinary retry; a real media/network failure remains visible.
    await replaceAndPlay(player, source, signal, installed);
  }
}
