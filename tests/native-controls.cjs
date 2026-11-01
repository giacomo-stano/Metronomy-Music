const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: name => { if (!(name in imports)) throw Error(name); return imports[name]; } });
  return exports;
}
const { NativeMenuModel } = load('src/nativeMenuModel.ts');
const model = new NativeMenuModel();
let revision = 0, selected = [];
const unsubscribe = model.subscribe(() => revision++);
model.register({ id: 'remove', kind: 'row', label: 'Rimuovi', destructive: true }, [2, 1], () => selected.push('remove'));
model.register({ id: 'download', kind: 'quick', label: 'Scarica' }, [0, 0], () => selected.push('download'));
model.register({ id: 'separator', kind: 'separator' }, [1]);
model.register({ id: 'favorite', kind: 'quick', label: 'Preferiti', selected: true }, [0, 1], () => selected.push('favorite'));
assert.deepEqual(Array.from(model.getSnapshot(), x => x.id), ['download', 'favorite', 'separator', 'remove']);
const snapshot = model.getSnapshot(), before = revision;
model.register({ id: 'download', kind: 'quick', label: 'Scarica' }, [0, 0], () => selected.push('latest download'));
assert.equal(model.getSnapshot(), snapshot, 'fresh callbacks must not cause render loops');
assert.equal(revision, before);
assert(!JSON.stringify(snapshot).includes('action'), 'never send callbacks to native');
model.select('download', true); model.select('separator', false); model.select('missing', false);
assert.deepEqual(selected, []);
model.select('download', false); assert.deepEqual(selected, ['latest download']);
model.register({ id: 'download', kind: 'quick', label: 'In download', disabled: true }, [0, 0], () => assert.fail('disabled action'));
model.select('download', false);
model.remove('favorite'); model.select('favorite', false);
assert.deepEqual(selected, ['latest download'], 'stale submenu events are ignored');
model.register({ id: 'async', kind: 'row', label: 'Playlist' }, [2, 0], () => selected.push('playlist'));
assert.deepEqual(Array.from(model.getSnapshot(), x => x.id), ['download', 'separator', 'async', 'remove']);
unsubscribe(); const stopped = revision; model.remove('async'); assert.equal(revision, stopped);

const { dispatchSliderAction } = load('src/nativeSliderCommands.ts');
let changes = [], previews = [];
const slider = { onChange: v => changes.push(v), onPreview: v => previews.push(v) };
dispatchSliderAction({ phase: 'begin', value: .2, tracking: true }, slider);
dispatchSliderAction({ phase: 'change', value: .4, tracking: true }, slider);
assert.deepEqual(changes, [], 'do not repeatedly seek while scrubbing');
dispatchSliderAction({ phase: 'commit', value: .4, tracking: false }, slider);
assert.deepEqual(changes, [.4]); assert.equal(previews.at(-1), null);
dispatchSliderAction({ phase: 'begin', value: .8, tracking: true }, slider);
dispatchSliderAction({ phase: 'cancel', value: .8 }, slider);
assert.deepEqual(changes, [.4], 'cancel must not seek'); assert.equal(previews.at(-1), null);
dispatchSliderAction({ phase: 'change', value: .6, tracking: false }, slider);
assert.deepEqual(changes, [.4, .6], 'VoiceOver does not emit touchUp');
assert.equal(previews.at(-1), null);
dispatchSliderAction({ phase: 'change', value: .7, tracking: true }, { ...slider, live: true });
dispatchSliderAction({ phase: 'commit', value: 1.5 }, slider);
dispatchSliderAction({ phase: 'commit', value: NaN }, slider);
dispatchSliderAction({ phase: 'commit', value: .1 }, { ...slider, enabled: false });
assert.deepEqual(changes, [.4, .6, .7, 1]);

const react = require('react');
const components = { Text: 'Text', ActivityIndicator: 'ActivityIndicator', StyleSheet: { flatten: value => Array.isArray(value) ? Object.assign({}, ...value) : value } };
const { nativeButtonContent } = load('src/nativeButtonContent.tsx', { react, 'react-native': components, 'expo-symbols': { SymbolView: 'SymbolView' }, '@expo/vector-icons': { Ionicons: 'Ionicons' }, './GlassBackground': { __esModule: true, default: 'GlassBackground' } });
const h = react.createElement;
const button = nativeButtonContent([h('GlassBackground', { key: 'g' }), h('SymbolView', { key: 's', name: 'play.fill', size: 32 }), h('Text', { key: 't', style: { color: '#fff', fontSize: 17, fontWeight: '600' } }, 'Riproduci')]);
assert.equal(button.content.title, 'Riproduci'); assert.equal(button.content.symbol, 'play.fill');
assert.equal(button.content.glass, true); assert.equal(button.sizing.length, 2, 'glass is rendered natively, never hidden under opacity zero');
assert.equal(nativeButtonContent(h('Text', { onPress() {} }, 'nested')), null);
assert.equal(nativeButtonContent([h('Text', { key: 'a' }, 'Title'), h('Text', { key: 'b' }, 'Subtitle')]), null);
assert.equal(nativeButtonContent(h('View', null, h('Text', null, 'rich row'))), null);
assert.equal(nativeButtonContent(h('Ionicons', { name: 'unknown' })), null);
assert.equal(nativeButtonContent(h('Ionicons', { name: 'chevron-back' })).content.symbol, 'chevron.left');

// Exercise the actual collector with fragments, layout wrappers and an action
// component that owns hooks (like the offline download action).
let nextID = 0;
const cleanups = [];
const hookReact = { ...react,
  createContext: value => {
    const context = { value };
    context.Provider = function Provider() {};
    context.Provider.context = context;
    return context;
  },
  useContext: context => context.value,
  useId: () => 'entry-' + ++nextID,
  useLayoutEffect: effect => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); },
};
const imports = { react: hookReact, 'react/jsx-runtime': require('react/jsx-runtime'), 'react-native': { ...components, View: 'View', StyleSheet: { hairlineWidth: .5, create: v => v } },
  './nativeMenuModel': { NativeMenuModel }, './theme': { useTheme: () => ({ colors: {} }) }, './musicChrome': { musicChrome: { menu: {} } },
  './SpringPressable': { __esModule: true, default: 'Pressable' }, 'expo-symbols': { SymbolView: 'SymbolView' } };
const collector = load('src/NativeMenuContext.tsx', imports);
const menuControls = load('src/MenuControls.tsx', { ...imports, './NativeMenuContext': collector });
function render(element) {
  if (element == null || typeof element === 'boolean') return;
  if (Array.isArray(element)) return element.forEach(render);
  if (!react.isValidElement(element)) return;
  if (element.type.context) {
    const context = element.type.context, previous = context.value;
    context.value = element.props.value; render(element.props.children); context.value = previous;
  } else if (typeof element.type === 'function') render(element.type(element.props));
  else render(element.props.children);
}
const collected = new NativeMenuModel();
function OfflineAction() { return h(menuControls.MenuQuickAction, { icon: 'arrow.down.circle', label: 'Scarica locale', onPress: () => selected.push('offline') }); }
function BulkActions() { return h(collector.MenuGroup, null, h(menuControls.MenuRow, { icon: 'arrow.down', label: 'Scarica tutti', onPress() {} }), h(menuControls.MenuSeparator)); }
render(h(collector.NativeMenuContext.Provider, { value: collected }, h(collector.NativeMenuContent, null,
  h('View', null, h(menuControls.MenuQuickActions, null, h(OfflineAction), h(menuControls.MenuQuickAction, { icon: 'star', label: 'Stella', onPress() {} }))),
  h(react.Fragment, null, h(menuControls.MenuSeparator), h(BulkActions), h('Text', null, 'Playlist vuota'), h(menuControls.MenuRow, { icon: 'trash', label: 'Elimina', onPress() {} }))
)));
assert.deepEqual(Array.from(collected.getSnapshot(), x => x.label ?? '|'), ['Scarica locale', 'Stella', '|', 'Scarica tutti', '|', 'Playlist vuota', 'Elimina']);
const offlineEntry = collected.getSnapshot()[0]; collected.select(offlineEntry.id, false);
assert.equal(selected.at(-1), 'offline');
assert.equal(collected.getSnapshot()[5].disabled, true);
cleanups.forEach(cleanup => cleanup());
assert.equal(collected.getSnapshot().length, 0, 'unmount removes all native registrations');

let cursor = 0, hookSlots = [];
const wrapperReact = { ...react,
  useRef: initial => { const i = cursor++; return hookSlots[i] ??= { current: initial }; },
  useState: initial => { const i = cursor++; if (!(i in hookSlots)) hookSlots[i] = initial; return [hookSlots[i], update => { hookSlots[i] = typeof update === 'function' ? update(hookSlots[i]) : update; }]; },
  useEffect: () => {}, useMemo: callback => callback(), useCallback: callback => callback,
};
const remembered = [];
const nativeWrappers = load('src/NativeControls.tsx', { react: wrapperReact, 'react/jsx-runtime': require('react/jsx-runtime'),
  'react-native': { Platform: { OS: 'ios' }, View: 'View', StyleSheet: { absoluteFill: {}, flatten: value => value }, processColor: () => 0xff123456 },
  'expo-modules-core': { requireOptionalNativeModule: () => ({}), requireNativeViewManager: (_module, name) => name },
  './menuAnchor': { rememberMenuTrigger: trigger => remembered.push(trigger) }, './theme': { useTheme: () => ({ isDark: true, colors: { text: '#fff' } }) },
  './nativeSliderCommands': { dispatchSliderAction },
});
const renderWrapper = (Component, props) => { cursor = 0; return Component(props); };
const segmentProps = { labels: ['Qobuz', 'Libreria'], selected: 1, label: 'Cerca', onSelect() {} };
const segmentBefore = renderWrapper(nativeWrappers.NativeSegments, segmentProps);
segmentBefore.props.onAction({ nativeEvent: { index: 0 } });
const segmentAfter = renderWrapper(nativeWrappers.NativeSegments, segmentProps);
assert.equal(segmentAfter.props.configuration.selected, 1, 'offline caller can reject Qobuz');
assert.equal(segmentAfter.props.configuration.revision, segmentBefore.props.configuration.revision + 1, 'reassert unchanged controlled selection to UIKit');
hookSlots = [];
let presses = 0;
const buttonProps = { content: { symbol: 'ellipsis' }, onPress: () => presses++ };
const findButton = element => react.Children.toArray(element.props.children).find(child => child.type === 'MetronomyButtonView');
const firstButton = findButton(renderWrapper(nativeWrappers.NativeButton, buttonProps));
firstButton.props.onAction({ nativeEvent: { action: 'press', x: 320, y: 100, width: 44, height: 44 } });
assert.equal(presses, 1);
remembered.at(-1).measureInWindow((x, y, width, height) => assert.deepEqual([x, y, width, height], [320, 100, 44, 44]));
renderWrapper(nativeWrappers.NativeButton, { ...buttonProps, disabled: true });
firstButton.props.onAction({ nativeEvent: { action: 'press' } });
assert.equal(presses, 1, 'queued button event respects current disabled state');
renderWrapper(nativeWrappers.NativeButton, { ...buttonProps, onPress: () => presses += 10 });
firstButton.props.onAction({ nativeEvent: { action: 'press' } });
assert.equal(presses, 11, 'native events use the latest handler');

// Binding guards complement JS behavior tests; they are not a Swift build.
const swift = fs.readFileSync('modules/metronomy-audio-controls/ios/MetronomyControlsView.swift', 'utf8');
const config = JSON.parse(fs.readFileSync('modules/metronomy-audio-controls/expo-module.config.json'));
assert(config.apple.modules.includes('MetronomyControlsModule'));
for (const api of ['UIButton(type: .system)', 'UISlider()', 'UISegmentedControl()', 'performPrimaryAction()', 'updateVisibleMenu', '.keepsMenuPresented', 'preferredElementSize']) assert(swift.includes(api), api);
assert(swift.includes('if !slider.isTracking'), 'status updates cannot snap the thumb during scrubbing');
assert(swift.includes('if #available(iOS 26.0, *)'), 'guard glass on older iOS');
assert(!/Selector\(|perform\(NSSelector|value\(forKey/.test(swift), 'public UIKit only');
const volume = fs.readFileSync('modules/metronomy-audio-controls/ios/MetronomySystemVolumeView.swift', 'utf8');
assert(!volume.includes('setThumbImage') && !volume.includes('subviews.compactMap'), 'preserve native system volume appearance');
console.log('Native controls: menu order, live updates, stale/disabled actions, seek/cancel/VoiceOver, simple button conversion and module bindings passed. UIKit rendering needs an iOS build.');
