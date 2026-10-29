export type StartupReport = {
  source: 'Qobuz' | 'Server' | 'iPhone';
  prepared: boolean;
  resolveMs?: number; readyMs?: number; advanceMs?: number;
  bridgeMs?: number; catalogMs?: number; resolverMs?: number;
  outcome: 'avviato' | 'errore' | 'tempo esaurito';
};
type Status = { isLoaded: boolean; playing: boolean; isBuffering: boolean; currentTime: number };

export class PlaybackStartup {
  private owner: unknown;
  private reports: StartupReport[] = [];
  private cancelPending?: () => void;
  constructor(private now: () => number = () => performance.now()) {}
  reset() {
    this.cancelPending?.(); this.cancelPending = undefined;
    this.reports = []; this.owner = undefined;
  }
  snapshot(owner: unknown) { return owner === this.owner ? this.reports.map(r => ({ ...r })) : []; }
  begin(owner: unknown, source: StartupReport['source']) {
    if (owner !== this.owner) { this.reset(); this.owner = owner; }
    this.cancelPending?.();
    const started = this.now();
    const report: StartupReport = { source, prepared: false, outcome: 'tempo esaurito' };
    let live = true, installed: number | undefined;
    const elapsed = () => Math.max(0, Math.round(this.now() - started));
    const finish = (outcome: StartupReport['outcome']) => {
      if (!live) return;
      live = false; clearTimeout(timer);
      report.outcome = outcome;
      this.reports = [{ ...report }, ...this.reports].slice(0, 8);
    };
    const timer = setTimeout(() => finish('tempo esaurito'), 60000);
    const cancel = () => { live = false; clearTimeout(timer); };
    this.cancelPending = cancel;
    return {
      cancel,
      fail: () => finish('errore'),
      resolved: (uri: string, prepared: boolean) => {
        if (!live) return;
        report.resolveMs = elapsed(); report.prepared = prepared;
        if (!/^https?:\/\//i.test(uri)) report.source = 'iPhone';
      },
      installed: () => { installed = this.now(); },
      serverTiming: (value: string | null) => {
        if (!live) return;
        // Accept only known numeric metrics, never arbitrary response content.
        for (const [name, key] of [['bridge','bridgeMs'], ['catalog','catalogMs'], ['resolver','resolverMs']] as const) {
          const match = value?.match(new RegExp('(?:^|,)\\s*' + name + ';dur=([0-9.]+)(?:,|$)'));
          const ms = match ? Number(match[1]) : NaN;
          if (Number.isFinite(ms) && ms >= 0 && ms <= 60000) report[key] = Math.round(ms);
        }
      },
      observe: (status: Status) => {
        if (!live || installed === undefined) return;
        if (status.isLoaded && report.readyMs === undefined) report.readyMs = elapsed();
        if (status.isLoaded && status.playing && !status.isBuffering && status.currentTime > 0) {
          report.advanceMs = elapsed(); finish('avviato');
        }
      },
    };
  }
}
export const playbackStartup = new PlaybackStartup();
export type StartupAttempt = ReturnType<PlaybackStartup['begin']>;
