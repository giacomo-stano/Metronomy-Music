export type DockScrollState = { y: number; travel: number; compact: boolean };
export const initialDockScroll = (): DockScrollState => ({ y: 0, travel: 0, compact: false });

// Accumulate slow drags too; tiny reversals/bounce must not make the dock flicker.
export function advanceDockScroll(previous: DockScrollState, offset: number, maximum: number): DockScrollState {
  if (!Number.isFinite(offset)) return previous;
  const y = Math.max(0, Math.min(offset, Number.isFinite(maximum) ? Math.max(0, maximum) : offset));
  const delta = y - previous.y;
  const travel = delta === 0 ? previous.travel : Math.sign(delta) === Math.sign(previous.travel) ? previous.travel + delta : delta;
  const compact = y < 20 ? false : travel >= 16 ? true : travel <= -8 ? false : previous.compact;
  return { y, travel: Math.max(-32, Math.min(32, travel)), compact };
}

export type PlayerOrigin = { x: number; y: number; width: number; height: number };
export function validPlayerOrigin(value: Partial<PlayerOrigin>): value is PlayerOrigin {
  return [value.x, value.y, value.width, value.height].every(n => typeof n === 'number' && Number.isFinite(n)) && value.width! > 0 && value.height! > 0;
}

export function playerMorph(width: number, height: number, origin: PlayerOrigin, progress: number, dragY: number) {
  'worklet';
  const p = Math.max(0, Math.min(1, progress));
  const w = Math.max(1, width), h = Math.max(1, height);
  const sourceWidth = Math.min(w, Math.max(1, origin.width));
  const sourceHeight = Math.min(h, Math.max(1, origin.height));
  const x = Math.max(0, Math.min(w - sourceWidth, origin.x));
  const y = Math.max(0, Math.min(h - sourceHeight, origin.y));
  const drag = Math.min(1, Math.max(0, dragY / (h * 0.65)));
  return {
    translateX: (x + sourceWidth / 2 - w / 2) * (1 - p),
    translateY: (y + sourceHeight / 2 - h / 2) * (1 - p) + dragY,
    scaleX: (sourceWidth / w + (1 - sourceWidth / w) * p) * (1 - drag * 0.04),
    scaleY: (sourceHeight / h + (1 - sourceHeight / h) * p) * (1 - drag * 0.04),
    radius: 28 * (1 - p) + 30 * drag,
  };
}
