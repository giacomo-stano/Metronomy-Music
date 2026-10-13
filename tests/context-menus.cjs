const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/menuLayout.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: exportsObject });
const { menuLayout } = exportsObject;
for (const [width, height, top, bottom] of [[393, 852, 62, 34], [375, 667, 20, 0], [320, 568, 20, 0], [852, 393, 0, 21], [430, 932, 62, 34]]) {
  for (const y of [0, top + 24, height / 2, height - 30, height + 200]) {
    for (const content of [0, 96, 500, 1600]) {
      const layout = menuLayout(width, height, top, bottom, { x: width - 30, y }, content);
      assert(layout.top >= Math.max(12, top + 4));
      assert(layout.left >= 12);
      assert(layout.left + layout.width <= width - 12 + 0.001);
      assert(layout.top + layout.maxHeight <= height - Math.max(12, bottom + 4) + 0.001);
      assert(layout.maxHeight > 0);
    }
  }
}
assert(menuLayout(393, 852, 62, 34, null, 600).top >= 66);
const files = ['SongActions', 'AlbumActions', 'NetworkActions', 'PlayerSheet', 'LibraryScreen'];
for (const name of files) assert(fs.readFileSync(`src/${name}.tsx`, 'utf8').includes('<FloatingMenu'), name);
const menu = fs.readFileSync('src/FloatingMenu.tsx', 'utf8');
assert(menu.includes('showsVerticalScrollIndicator') && menu.includes('flashScrollIndicators'));
assert(menu.includes('reduceMotion') && menu.includes('useNativeDriver: true'));
assert(menu.includes('useScreenInsets') && menu.includes('onAccessibilityEscape'));
const controls = fs.readFileSync('src/MenuControls.tsx', 'utf8');
assert(!controls.includes('numberOfLines'), 'long action labels must wrap, not truncate');
const catalog = fs.readFileSync('src/CatalogBrowser.tsx', 'utf8');
assert(catalog.includes('marginTop: -insets.top'), 'hero must extend beyond parent safe-area padding');
assert(catalog.includes('paddingTop: insets.top + 10'), 'navigation remains below the island');
assert(catalog.includes('contentInsetAdjustmentBehavior="never"'), 'do not reinsert the status-bar gap');
const downloads = fs.readFileSync('src/OfflineDownloads.tsx', 'utf8');
assert(downloads.includes('if (compact) return <MenuQuickAction'));
assert(downloads.indexOf('await beforeRemove?.()') < downloads.indexOf('await store.remove(song.id)'));
assert(downloads.indexOf('await store.remove(song.id)') < downloads.indexOf('await afterRemove?.()'));
assert(fs.readFileSync('src/AlbumActions.tsx', 'utf8').includes('token: check.token'));
assert(fs.readFileSync('src/SongActions.tsx', 'utf8').includes('token: check.token'));
console.log('Context menus: safe-area bounds, small/landscape screens, overflow, shared surfaces, wrapping and deletion guards passed.');
