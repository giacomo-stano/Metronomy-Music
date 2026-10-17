const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/dockMotion.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: api });
let state = api.initialDockScroll();
for (let y = 1; y <= 120; y++) state = api.advanceDockScroll(state, y, 1000);
assert.equal(state.compact, true, 'slow drags accumulate; no minimum per-frame speed');
for (let n = 0; n < 100; n++) state = api.advanceDockScroll(state, 120, 1000);
assert.equal(state.compact, true, 'idle does not re-expand the dock');
for (const y of [119, 120, 118, 121, 120]) state = api.advanceDockScroll(state, y, 1000);
assert.equal(state.compact, true, 'tiny reversals do not flicker');
state = api.advanceDockScroll(state, 105, 1000);
assert.equal(state.compact, false, 'upward travel expands');
state = api.advanceDockScroll(state, 1050, 1000);
assert.equal(state.y, 1000); assert.equal(state.compact, true);
state = api.advanceDockScroll(state, 1100, 1000);
state = api.advanceDockScroll(state, 1000, 1000);
assert.equal(state.compact, true, 'bottom overscroll rebound is not an upward navigation gesture');
state = api.advanceDockScroll(state, -20, 1000);
assert.equal(state.y, 0); assert.equal(state.compact, false);
assert.equal(api.advanceDockScroll(state, NaN, 1000), state);
const near = (a, b) => assert(Math.abs(a - b) < 0.00001, `${a} != ${b}`);
for (const [w, h] of [[320,568], [393,852], [440,956], [852,393]]) {
  for (const origin of [{ x:18, y:h-148, width:w-36, height:52 }, { x:74, y:h-80, width:w-148, height:48 }]) {
    assert(api.validPlayerOrigin(origin));
    const start = api.playerMorph(w,h,origin,0,0);
    near(w*start.scaleX, origin.width); near(h*start.scaleY, origin.height);
    near(w/2+start.translateX-origin.width/2, origin.x);
    near(h/2+start.translateY-origin.height/2, origin.y);
    let prev = start;
    for(let p=.05;p<=1.001;p+=.05) {
      const next=api.playerMorph(w,h,origin,p,0);
      assert(next.scaleX>=prev.scaleX && next.scaleY>=prev.scaleY); prev=next;
    }
    near(prev.scaleX,1); near(prev.scaleY,1); near(prev.translateX,0); near(prev.translateY,0);
    const drag=api.playerMorph(w,h,origin,1,90);
    near(drag.translateY,90); assert(drag.scaleX<1);
  }
}
for (const value of [{}, { x:0,y:0,width:0,height:52 }, { x:NaN,y:0,width:300,height:52 }]) assert.equal(api.validPlayerOrigin(value), false);
const player=fs.readFileSync('src/PlayerSheet.tsx','utf8');
assert(player.includes('onShow={animatePlayerOpen}') && player.includes('playerMorph(width, height, morphOrigin'));
assert(!player.includes('[p.visible, height,'), 'rotation must not reset a visible modal while waiting for a new onShow');
assert(player.includes('.onFinalize((_event, success)'));
console.log('Dock motion: slow scroll, persistent compact state, hysteresis, bounce, real mini-player origin, rotation and cancelled gestures passed.');
