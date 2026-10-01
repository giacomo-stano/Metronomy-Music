export function clampFraction(value: number) {
  'worklet';
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}
export function sliderFraction(x: number, width: number) {
  'worklet';
  return width > 0 && Number.isFinite(width) ? clampFraction(x / width) : 0;
}
