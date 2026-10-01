const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const load = (file, require = () => ({})) => {
  const exports = {};
  vm.runInNewContext(compile(file), { exports, require, Promise, Map, Set, Date, console });
  return exports;
};
const { ScreenCache } = load('src/ScreenCache.ts');
const math = load('src/sliderMath.ts');
const jsx = { jsx: (type, props, key) => ({ type, props, key }) };

function component(file, extra = {}) {
  let cursor = 0, hooks = [], pending = [];
  const slot = initial => { const index = cursor++; if (!(index in hooks)) hooks[index] = initial(); return hooks[index]; };
  const react = {
    memo: value => value,
    useRef: initial => slot(() => ({ current: initial })),
    useCallback: callback => slot(() => callback),
    useMemo: (callback, deps) => { const entry = slot(() => ({ deps: null, value: null })); if (!entry.deps || deps.some((d, i) => d !== entry.deps[i])) { entry.deps = deps; entry.value = callback(); } return entry.value; },
    useEffect: (callback, deps) => { const entry = slot(() => ({ deps: null, cleanup: null })); if (!entry.deps || deps.some((d, i) => d !== entry.deps[i])) { entry.cleanup?.(); entry.deps = deps; pending.push(() => { entry.cleanup = callback(); }); } },
  };
  const reanimated = {
    __esModule: true, default: { View: 'AnimatedView' },
    useSharedValue: initial => slot(() => ({ value: initial })),
    useAnimatedStyle: callback => callback(),
    withTiming: value => value, withSpring: value => value,
    runOnJS: callback => callback, runOnUI: callback => callback,
  };
  const module = load(file, name => name === 'react' ? react : name === 'react/jsx-runtime' ? jsx :
    name === 'react-native-reanimated' ? reanimated : name === './motionPreferences' ? { useMotionPreferences: () => ({ reduceMotion: false }) } :
    name === './sliderMath' ? math : name === 'react-native' ? { View: 'View' } : extra[name]);
  return props => { cursor = 0; const result = module.default(props); const effects = pending; pending = []; effects.forEach(run => run()); return result; };
}

(async () => {
  const cache = new ScreenCache(2);
  cache.useScope('online:1');
  let calls = 0, resolve;
  const loadHome = () => { calls++; return new Promise(done => { resolve = done; }); };
  const first = cache.get('home', loadHome), concurrent = cache.get('home', loadHome);
  assert.equal(first, concurrent, 'fast navigation shares an unfinished request');
  await Promise.resolve(); resolve({ albums: ['first'] }); await first;
  for (let i = 0; i < 20; i++) await cache.get('home', loadHome);
  assert.equal(calls, 1, 'repeated tab visits reuse the existing catalogue');
  cache.set('home', { albums: ['first', 'second page'] });
  assert.equal((await cache.get('home', loadHome)).albums.length, 2, 'pagination survives revisits');
  const stale = cache.get('pending', loadHome); await Promise.resolve(); const finishStale = resolve;
  cache.useScope('offline:2'); finishStale({ albums: ['remote'] }); await stale;
  assert.equal(cache.peek('pending'), undefined, 'old online responses cannot populate the offline catalogue');
  await assert.rejects(cache.get('retry', () => Promise.reject(new Error('network'))));
  assert.equal(await cache.get('retry', async () => 'recovered'), 'recovered', 'failed loads remain retryable');
  cache.set('one', 1); cache.set('two', 2); cache.set('three', 3);
  assert.equal(cache.peek('one'), undefined, 'cache has a memory bound');

  const screen = component('src/PersistentScreen.tsx');
  const child = { type: 'StatefulList', props: { scrollOffset: 480 } };
  assert.equal(screen({ active: false, children: child }), null, 'unvisited tabs mount lazily');
  assert.equal(screen({ active: true, children: child }).props.children, child);
  const hidden = screen({ active: false, children: child });
  assert.equal(hidden.props.children, child, 'visited screens stay mounted');
  assert.equal(hidden.props.accessibilityElementsHidden, true);
  assert.equal(hidden.props.pointerEvents, 'none');
  assert.equal(screen({ active: true, children: child }).props.children, child, 'returning preserves the list instance');

  const hooks = {};
  const pan = { enabled() { return this; }, minDistance() { return this; }, hitSlop() { return this; } };
  for (const name of ['onBegin', 'onUpdate', 'onEnd', 'onFinalize']) pan[name] = callback => { hooks[name] = callback; return pan; };
  const slider = component('src/MusicSlider.tsx', { 'react-native-gesture-handler': { Gesture: { Pan: () => pan }, GestureDetector: 'Detector' } });
  const commits = [], previews = [];
  const props = { value: 0.2, onChange: value => commits.push(value), onPreview: value => previews.push(value), color: 'white', track: 'gray', label: 'Seek' };
  const view = slider(props).props.children;
  view.props.onLayout({ nativeEvent: { layout: { width: 200 } } });
  hooks.onBegin({ x: 50 }); hooks.onUpdate({ x: 170 });
  assert.equal(commits.length, 0, 'dragging never issues repeated native seeks');
  hooks.onEnd({ x: 170 }); hooks.onFinalize({}, true);
  assert.equal(commits.length, 1); assert.equal(commits[0], 0.85);
  hooks.onBegin({ x: 20 }); hooks.onUpdate({ x: 150 }); hooks.onFinalize({}, false);
  assert.equal(commits.length, 1, 'cancelled drags do not seek');
  view.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } });
  assert.equal(commits[1], 0.25, 'VoiceOver can adjust the slider');
  assert.equal(math.sliderFraction(-10, 200), 0);
  assert.equal(math.sliderFraction(300, 200), 1);
  assert.equal(math.sliderFraction(10, 0), 0);
  assert.equal(math.clampFraction(NaN), 0);
  const volumeChanges = [];
  slider({ ...props, live: true, onChange: value => volumeChanges.push(value) });
  hooks.onBegin({ x: 100 });
  assert.equal(volumeChanges[0], 0.5, 'volume responds during contact, not only after release');
  hooks.onEnd({ x: 180 }); hooks.onFinalize({}, true);
  assert.equal(volumeChanges.at(-1), 0.9);

  let subscriptions = [], changed = [], events = {}, nativeListeners = 0;
  const preferences = load('src/motionPreferences.ts', name => name === 'react' ? {
    useSyncExternalStore: (subscribe, snapshot) => { subscriptions.push(subscribe(() => changed.push(snapshot()))); return snapshot(); },
  } : { AccessibilityInfo: {
    isReduceMotionEnabled: async () => false, isReduceTransparencyEnabled: async () => false,
    addEventListener: (name, callback) => { nativeListeners++; events[name] = callback; return { remove: () => { delete events[name]; } }; },
  } });
  for (let i = 0; i < 100; i++) preferences.useMotionPreferences();
  assert.equal(Object.keys(events).length, 2, '100 controls share two native preference listeners');
  assert.equal(nativeListeners, 2);
  await Promise.resolve(); changed = []; events.reduceMotionChanged(true);
  assert.equal(changed.length, 100, 'accessibility changes reach every mounted control');
  subscriptions.forEach(remove => remove());
  assert.equal(Object.keys(events).length, 0, 'listeners are cleaned up after the last control unmounts');
  console.log('UI performance: cached tab revisits, request deduplication, mode invalidation, bounded memory, persistent screens, seek/cancel/accessibility gestures and shared motion preferences passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
