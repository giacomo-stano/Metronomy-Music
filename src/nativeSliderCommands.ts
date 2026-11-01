export type SliderAction = { phase?: unknown; value?: unknown; tracking?: unknown };
export function dispatchSliderAction(action: SliderAction, p: { enabled?: boolean; live?: boolean; onChange: (value: number) => void; onPreview?: (value: number | null) => void }) {
  if (p.enabled === false) return;
  if (action.phase === 'cancel') { p.onPreview?.(null); return; }
  if (typeof action.value !== 'number' || !Number.isFinite(action.value)) return;
  const value = Math.max(0, Math.min(1, action.value));
  if (action.phase === 'commit') { p.onChange(value); p.onPreview?.(null); }
  else if (action.phase === 'begin' || action.phase === 'change') {
    p.onPreview?.(value);
    // VoiceOver adjustments emit valueChanged without touch-up events.
    if (p.live || (action.phase === 'change' && action.tracking === false)) {
      p.onChange(value);
      if (action.tracking === false) p.onPreview?.(null);
    }
  }
}
