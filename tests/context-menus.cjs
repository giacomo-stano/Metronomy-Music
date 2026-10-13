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
const topMenu = menuLayout(393, 852, 62, 34, { x: 378, y: 76 }, 500);
assert.equal(topMenu.top, 76, 'top control should align with the top of its menu');
assert.equal(topMenu.left + topMenu.width, 378, 'align the panel with the measured control edge');
const bottomMenu = menuLayout(393, 852, 62, 34, { x: 378, y: 740 }, 1200);
assert.equal(bottomMenu.maxHeight, 720, 'long bottom-row menus should use the taller viewport');
assert.equal(bottomMenu.top, 94, 'lift the entire menu above the home indicator');
const shortMenu = menuLayout(393, 852, 62, 34, { x: 378, y: 740 }, 96);
assert.equal(shortMenu.top, 718, 'short menus stay close to their source row');
assert(menuLayout(320, 568, 20, 0, null, 1200).width >= 250, 'quick actions stay readable on small screens');

// Exercise native measurement without needing a device: root-local touch points
// must never be used to position a full-screen Modal.
const anchors = {};
let now = 1000;
let timer;
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/menuAnchor.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
  exports: anchors, Date: { now: () => now },
  setTimeout: fn => { timer = fn; return 1; }, clearTimeout: () => { timer = null; },
});
let point;
anchors.rememberMenuTrigger({ measureInWindow: callback => callback(340, 76, 38, 44) });
anchors.measureMenuAnchor(value => { point = value; });
assert.equal(point.x, 378);
assert.equal(point.y, 76);
anchors.measureMenuAnchor(value => { point = value; });
assert.equal(point, null, 'a menu must not reuse a previous menu trigger');
anchors.rememberMenuTrigger({ measureInWindow: () => assert.fail('stale trigger measured') });
now += 2001;
anchors.measureMenuAnchor(value => { point = value; });
assert.equal(point, null);
for (const rect of [[0, 0, 0, 0], [NaN, 76, 38, 44]]) {
  anchors.rememberMenuTrigger({ measureInWindow: callback => callback(...rect) });
  anchors.measureMenuAnchor(value => { point = value; });
  assert.equal(point, null, 'invalid/unmounted native views fall back safely');
}
let delayed;
let calls = 0;
anchors.rememberMenuTrigger({ measureInWindow: callback => { delayed = callback; } });
anchors.measureMenuAnchor(value => { point = value; calls++; });
timer();
delayed(340, 76, 38, 44);
assert.equal(calls, 1, 'a late native callback cannot move an already visible menu');
assert.equal(point, null);
anchors.rememberMenuTrigger({ measureInWindow: callback => { delayed = callback; } });
const cancel = anchors.measureMenuAnchor(() => assert.fail('unmounted menu updated'));
cancel();
delayed(340, 76, 38, 44);

const files = ['SongActions', 'AlbumActions', 'NetworkActions', 'PlayerSheet', 'LibraryScreen'];
for (const name of files) assert(fs.readFileSync(`src/${name}.tsx`, 'utf8').includes('<FloatingMenu'), name);
const menu = fs.readFileSync('src/FloatingMenu.tsx', 'utf8');
assert(menu.includes('showsVerticalScrollIndicator') && menu.includes('flashScrollIndicators'));
assert(menu.includes('reduceMotion') && menu.includes('useNativeDriver: true'));
assert(menu.includes('useScreenInsets') && menu.includes('onAccessibilityEscape'));
assert(menu.includes('measureMenuAnchor') && !menu.includes('lastPressPoint'));
assert(menu.includes('left: ready ? layout.left : width + 24'), 'measure before showing the panel to prevent position jumps');
const panel = menu.slice(menu.indexOf('<Animated.View pointerEvents={ready'), menu.indexOf('<GlassBackground'));
assert(!panel.includes('opacity:'), 'never animate opacity on a native glass ancestor');
assert(menu.includes('rgba(41,41,44,0.94)') && menu.includes('rgba(250,250,250,0.96)'), 'menus need a readable independent surface in both themes');
assert(menu.includes('reduceTransparency'));
const pressable = fs.readFileSync('src/SpringPressable.tsx', 'utf8');
assert(pressable.includes('rememberMenuTrigger(control.current)') && !pressable.includes('pageY'));
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
console.log('Context menus: measured anchors, stale/unmounted triggers, tall overflow, safe-area bounds, readable glass, wrapping and deletion guards passed.');
