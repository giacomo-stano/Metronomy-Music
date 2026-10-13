export function menuLayout(width: number, height: number, topInset: number, bottomInset: number, anchor: { x: number; y: number } | null, contentHeight: number) {
  const margin = 12;
  const menuWidth = Math.min(320, width * 0.64, width - margin * 2);
  const safeTop = Math.max(margin, topInset + 4);
  const bottom = height - Math.max(margin, bottomInset + 4);
  const available = Math.max(1, bottom - safeTop);
  const desired = Math.min(contentHeight || 520, available, 650);
  // Prefer the triggering row; long menus retain enough room to scroll comfortably.
  const top = Math.max(safeTop, Math.min((anchor?.y ?? safeTop + 22) - 22, bottom - Math.min(desired, 300)));
  const left = Math.max(margin, Math.min((anchor?.x ?? width) - menuWidth + 20, width - menuWidth - margin));
  return { top, left, width: menuWidth, maxHeight: Math.min(650, bottom - top) };
}
