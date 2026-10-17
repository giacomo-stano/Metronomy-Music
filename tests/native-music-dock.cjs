const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const api = {};
const motion = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/dockMotion.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: motion });
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/nativeDockCommands.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: api, require: () => motion });
const events = [];
const handlers = Object.fromEntries(['onTab', 'onExpand', 'onOpen', 'onToggle', 'onNext', 'onOptions'].map(name => [name, (...args) => events.push([name, ...args])]));
const dispatch = (command, id = 'song-a', canNext = true) => api.dispatchDockCommand(command, id, canNext, handlers);
for (let index = 0; index < 4; index++) {
  dispatch({ action: 'tab', index, reset: false });
  assert.deepEqual(events.pop(), ['onTab', api.dockTabs[index], false]);
  dispatch({ action: 'tab', index, reset: true });
  assert.deepEqual(events.pop(), ['onTab', api.dockTabs[index], true]);
}
for (const index of [-1, 4, undefined, NaN, 1.5, '1']) dispatch({ action: 'tab', index });
assert.equal(events.length, 0, 'invalid tab events do not navigate');
for (const [action, handler] of [['open', 'onOpen'], ['toggle', 'onToggle'], ['next', 'onNext'], ['options', 'onOptions']]) {
  dispatch({ action, trackID: 'song-a' });
  assert.deepEqual(events.pop(), [handler]);
  dispatch({ action, trackID: 'song-a' }, 'song-b');
  dispatch({ action, trackID: '' }, '');
  dispatch({ action });
  assert.equal(events.length, 0, 'stale native menu cannot act on a new song');
}
dispatch({ action: 'next', trackID: 'song-a' }, 'song-a', false);
dispatch({ action: 'unknown', trackID: 'song-a' });
assert.equal(events.length, 0);
dispatch({ action: 'expand' });
assert.deepEqual(events.pop(), ['onExpand'], 'compact section button expands without resetting navigation');
dispatch({ action: 'open', trackID: 'song-a', x: 70, y: 770, width: 220, height: 48 });
assert.equal(JSON.stringify(events.pop()), JSON.stringify(['onOpen', { x: 70, y: 770, width: 220, height: 48 }]));
const native = fs.readFileSync('modules/metronomy-audio-controls/ios/MetronomyDockView.swift', 'utf8');
assert(native.includes('private var compactNavigationIndex: Int { selected == 3 ? 2 : selected }'),
  'Search keeps the library symbol on the left, never two magnifying glasses');
assert(native.includes('bar.items?[compactNavigationIndex].image'));
assert(native.includes('sectionButton.accessibilityValue = names[compactNavigationIndex]'));
assert(!/\b(?:let|var)\s+next\s*[:=]/.test(native), 'next is inherited from UIResponder and cannot be a stored button property');
assert(!/\bnext\./.test(native), 'button references must use nextButton, not UIResponder.next');
assert(native.includes('private let nextButton = UIButton') && native.includes('if nextButton.isEnabled { emit("next") }'), 'rename the control without changing the next command protocol');
assert(native.includes('UITabBarDelegate') && native.includes('let reselected = selected == item.tag'));
assert(native.includes('barHeight: CGFloat = 72') && native.includes('height: barHeight'));
assert(native.includes('override var safeAreaInsets: UIEdgeInsets { .zero }'), 'floating bar must not deduct the home inset twice');
assert(native.includes('pointSize: 23, weight: .regular, scale: .medium'), 'bound symbol sizes inside the native selection');
assert(native.includes('open.showsMenuAsPrimaryAction = false') && native.includes('open.menu = UIMenu(children:'));
assert(native.includes('sectionGlass') && native.includes('searchGlass') && !native.includes('private let more ='));
assert(native.includes('self.barContainer.clipsToBounds = self.shouldCompact'), 'native tracking lens must not be clipped when expanded');
assert(/updateFonts\(\)\s+animateLayout\(\)/.test(native), 'changing accessibility text size must restore the expanded bar immediately');
assert(native.includes('UIAccessibility.isReduceTransparencyEnabled') && native.includes('UIAccessibility.isReduceMotionEnabled'));
assert(native.includes('UIAccessibility.isVoiceOverRunning') && native.includes('keyboardWillHideNotification'));
assert(native.includes('artworkGeneration == generation') && native.includes('artworkTask?.cancel()'));
assert(native.includes('URLSessionConfiguration.ephemeral') && native.includes('config.urlCache = nil'));
assert(!native.includes('AVPlayer') && !native.includes('MPNowPlayingInfoCenter'), 'dock must never own audio or lock-screen state');
const wrapper = fs.readFileSync('src/NativeMusicDock.tsx', 'utf8');
assert(wrapper.includes("requireOptionalNativeModule('MetronomyDock')") && wrapper.includes("Platform.OS === 'ios'"));
assert(wrapper.includes('const DockSurface = memo') && wrapper.includes('latest.current = props'));
assert(wrapper.includes('rememberMenuTrigger') && wrapper.includes('bottom - 10'));
const config = JSON.parse(fs.readFileSync('modules/metronomy-audio-controls/expo-module.config.json', 'utf8'));
assert(config.apple.modules.includes('MetronomyDockModule'));
const app = fs.readFileSync('App.tsx', 'utf8');
assert(app.includes('nativeMusicDockAvailable ? <NativeMusicDock') && app.includes('<LiquidTabBar'));
assert(app.includes("+ ':' + isOffline, width + 80, nativeMusicDockAvailable"), 'same native dock in both modes, reset only scroll geometry when mode changes');
assert(app.includes('const lensHeight = 62;'), 'fallback selection is taller too');
const libraryScreen = fs.readFileSync('src/LibraryScreen.tsx', 'utf8');
assert(libraryScreen.includes('String(p.offline)') && libraryScreen.includes('cache.useScope(catalogScope)'));
assert(app.includes('onTab={selectTab}') && app.includes('onToggle={toggleFromMiniPlayer}'));
// Execute the real React wrapper with hook stubs: no new native configuration on
// parent rerenders, but events must always reach the most recent JS callbacks.
const compiled = ts.transpileModule(wrapper, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
for (const available of [true, false]) {
  const slots = []; let cursor = 0; let nativeLoads = 0;
  function memoize(factory, deps) {
    const i = cursor++;
    if (!slots[i] || deps.some((value, index) => !Object.is(value, slots[i].deps[index]))) slots[i] = { value: factory(), deps };
    return slots[i].value;
  }
  const react = { memo: fn => fn, useMemo: memoize, useCallback: (fn, deps) => memoize(() => fn, deps), useRef: value => { const i = cursor++; return slots[i] ?? (slots[i] = { current: value }); } };
  const result = {};
  const modules = {
    react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
    'react-native': { Platform: { OS: 'ios' } },
    'expo-modules-core': { requireOptionalNativeModule: () => available ? {} : null, requireNativeViewManager: () => { nativeLoads++; return 'NativeDock'; } },
    './ScreenInsets': { useScreenInsets: () => ({ bottom: 34 }) },
    './menuAnchor': { rememberMenuTrigger() {} }, './nativeDockCommands': api,
  };
  vm.runInNewContext(compiled, { exports: result, require: name => { assert(name in modules, name); return modules[name]; } });
  const props = { tab: 'Home', trackID: 'song-a', title: 'Song', artist: 'Artist', artwork: '', playing: true, buffering: false, canNext: true, compact: false, dark: true, ...handlers };
  cursor = 0; const first = result.default(props);
  let toggles = 0;
  cursor = 0; const second = result.default({ ...props, onToggle: () => toggles++ });
  assert.equal(first.props.configuration, second.props.configuration, 'no native prop churn for new callback identities');
  assert.equal(first.props.onCommand, second.props.onCommand);
  first.props.onCommand({ nativeEvent: { action: 'toggle', trackID: 'song-a' } });
  assert.equal(toggles, 1, 'native event reaches current callback, not the first render closure');
  const surface = second.type(second.props);
  assert.equal(result.nativeMusicDockAvailable, available);
  assert.equal(nativeLoads, available ? 1 : 0, 'old binaries never require a missing native view');
  if (available) { assert.equal(surface.props.style.bottom, 24); assert.equal(surface.props.style.height, 140); assert.equal(surface.type, 'NativeDock'); }
  else assert.equal(surface, null);
}
console.log('Native dock: navigation/reselection, stale menu guards, audio isolation, fallback and native registration passed (device rendering requires iOS build).');
