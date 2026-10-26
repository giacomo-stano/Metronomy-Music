// Layout is based on available points and font scale, never a device-model list.
export function tabLensWidth(itemWidth: number) {
  return Math.max(0, Math.min(itemWidth - 8, itemWidth / 1.08));
}

export function searchHeaderMetrics(fontScale: number) {
  const scale = Math.max(1, Math.min(1.4, fontScale || 1));
  const titleHeight = Math.max(62, Math.ceil(34 * 1.2 * scale) + 12);
  const fieldHeight = Math.max(46, Math.ceil(17 * 1.2 * scale) + 20);
  const scopeHeight = Math.max(34, Math.ceil(15 * 1.2 * Math.min(scale, 1.3)) + 12);
  return { titleHeight, fieldHeight, scopeHeight, pinnedHeight: 8 + fieldHeight + 10 + scopeHeight + 10 };
}

export function playerLayout(width: number, height: number, top: number, bottom: number, controlsHeight: number, metadataHeight: number) {
  const controlsTop = Math.min(height * 0.642, height - bottom - 8 - controlsHeight);
  const metadataTop = Math.min(height * 0.565, controlsTop - metadataHeight - 12);
  const artworkTop = Math.max(top + 52, Math.min(height * 0.164, metadataTop - 144));
  const artworkSize = Math.max(0, Math.min(width * 0.705, height * 0.325, metadataTop - artworkTop - 18));
  return { controlsTop, metadataTop, artworkTop, artworkSize };
}

export function browseTileMetrics(width: number, fontScale: number) {
  const scale = Math.max(1, Math.min(1.5, fontScale || 1));
  // A single column preserves readable titles and separate menu touch targets.
  const singleColumn = width < 360 || fontScale >= 1.4;
  const minHeight = Math.ceil(44 + 22 + 40 * scale + 15 * scale + 3);
  return { singleColumn, minHeight };
}
