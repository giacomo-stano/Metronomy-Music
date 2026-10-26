export function menuLayout(width: number, height: number, topInset: number, bottomInset: number, anchor: { x: number; y: number } | null, contentHeight: number, fontScale = 1) {
  const margin = 12;
  const scale = Math.max(1, Math.min(1.5, fontScale));
  const menuWidth = Math.min(340 * scale, Math.max(250, width * 0.64 * scale), width - margin * 2);
  const safeTop = Math.max(margin, topInset + 4);
  const bottom = height - Math.max(margin, bottomInset + 4);
  const available = Math.max(1, bottom - safeTop);
  const maxHeight = Math.min(available, 720);
  const desired = Math.min(contentHeight || maxHeight, maxHeight);
  // Align with the actual control, then lift the whole panel if it would clip.
  // A bottom-row trigger must not reduce a long menu to a 300pt scroll window.
  const top = Math.max(safeTop, Math.min(anchor?.y ?? safeTop, bottom - desired));
  const left = Math.max(margin, Math.min((anchor?.x ?? width - margin) - menuWidth, width - menuWidth - margin));
  return { top, left, width: menuWidth, maxHeight: Math.min(maxHeight, bottom - top) };
}
