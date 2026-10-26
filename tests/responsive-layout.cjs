const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(path) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports });
  return exports;
}
const { tabLensWidth, searchHeaderMetrics, browseTileMetrics, playerLayout } = load('src/responsiveLayout.ts');
const { searchTitleHeight } = load('src/searchMotion.ts');
const { menuLayout } = load('src/menuLayout.ts');
// Logical widths, including Display Zoom / small phones, not physical pixels.
const screens = [[320, 568, 20, 0], [360, 780, 47, 34], [375, 667, 20, 0],
  [390, 844, 47, 34], [393, 852, 59, 34], [402, 874, 62, 34],
  [430, 932, 59, 34], [440, 956, 62, 34], [768, 1024, 24, 20], [1024, 768, 24, 20]];
for (const [width, height, top, bottom] of screens) {
  for (const metadataHeight of [52, 80, 120]) {
    const controlsHeight = height < 700 ? 258 : 303;
    const player = playerLayout(width, height, top, bottom, controlsHeight, metadataHeight);
    assert(player.controlsTop + controlsHeight <= height - bottom - 8 + 0.001);
    assert(player.metadataTop + metadataHeight + 12 <= player.controlsTop + 0.001);
    assert(player.artworkTop >= top + 52);
    assert(player.artworkSize >= 0);
    assert(player.artworkTop + player.artworkSize + 18 <= player.metadataTop + 0.001);
    assert(player.artworkSize <= width);
  }
  const itemWidth = (width - 40) / 4;
  const lensWidth = tabLensWidth(itemWidth);
  for (let index = 0; index < 4; index++) {
    const center = (index + 0.5) * itemWidth;
    // Selection stays inside its item even when the press animation enlarges it.
    assert(center - lensWidth * 1.08 / 2 >= index * itemWidth - 0.001);
    assert(center + lensWidth * 1.08 / 2 <= (index + 1) * itemWidth + 0.001);
  }
  for (const fontScale of [1, 1.15, 1.3, 1.4, 2, 3]) {
    const header = searchHeaderMetrics(fontScale);
    const scale = Math.min(fontScale, 1.4);
    assert(header.fieldHeight >= 17 * 1.2 * scale + 20);
    assert(header.titleHeight >= 34 * 1.2 * scale + 12);
    assert(header.scopeHeight >= 15 * 1.2 * Math.min(scale, 1.3) + 12);
    assert.equal(header.pinnedHeight, 8 + header.fieldHeight + 10 + header.scopeHeight + 10);
    for (const offset of [-20, 0, 30, 1000]) {
      assert(searchTitleHeight(offset, 0, header.titleHeight) <= header.titleHeight);
      assert.equal(searchTitleHeight(offset, 1, header.titleHeight), 0);
    }
    const tile = browseTileMetrics(width, fontScale);
    assert(tile.minHeight >= 44 + 22 + 55 * Math.min(fontScale, 1.5) + 3);
    if (width < 360 || fontScale >= 1.4) assert(tile.singleColumn);
    for (const content of [96, 500, 1600]) {
      for (const y of [top, height / 2, height - 10, height + 100]) {
        const menu = menuLayout(width, height, top, bottom, { x: width - 20, y }, content, fontScale);
        assert(menu.left >= 12 && menu.left + menu.width <= width - 12 + 0.001);
        assert(menu.top >= top + 4);
        assert(menu.top + menu.maxHeight <= height - Math.max(12, bottom + 4) + 0.001);
        assert(menu.maxHeight > 0);
      }
    }
  }
}
assert.equal(searchHeaderMetrics(1).pinnedHeight, 108, 'standard search proportions stay unchanged');
assert(menuLayout(390, 844, 47, 34, null, 500, 2).width > menuLayout(390, 844, 47, 34, null, 500, 1).width);
const native = fs.readFileSync('modules/metronomy-audio-controls/ios/MetronomyDockView.swift', 'utf8');
assert(native.includes('Self.tabImage(symbols[index])') && native.includes('let side: CGFloat = 24'));
assert(native.includes('withRenderingMode(.alwaysTemplate)'));
assert(native.includes('appearance.stackedLayoutAppearance') && native.includes('appearance.compactInlineLayoutAppearance'));
assert(native.includes('maximumPointSize: 12'));
assert(native.includes('ceil(titleLabel.font.lineHeight)') && native.includes('ceil(artistLabel.font.lineHeight)'));
assert(native.includes('bounds.width >= 350'), 'narrow displays keep the expanded, readable player');
assert(native.includes('let small = shouldCompact\n    // Resizing'), 'resize must update hidden navigation without another JS prop event');
console.log('Responsive layouts: 10 viewports, 6 text sizes, animated selection bounds, search/header spacing, tile actions and safe-area menu placement passed. Native UIKit rendering still needs device QA.');
