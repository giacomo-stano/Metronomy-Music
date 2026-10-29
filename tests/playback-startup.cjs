const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const flush = async () => { for (let i=0; i<20; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const timers = new Map(); let timerId=0;
function load(path, mocks={}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}
  }).outputText, {exports, require:n=>mocks[n], AbortController, Date, performance,
    setTimeout: f=>{timers.set(++timerId,f);return timerId;}, clearTimeout: id=>timers.delete(id)});
  return exports;
}
(async()=>{
  const {NextTrackPreparation,upcomingTrack} = load('src/nextTrackPreparation.ts');
  const owner = {}, other = {}, audio = {uri:'https://cdn.test/private'};
  let now=1000, warmed=[], cleared=[], signal;
  const manager = new NextTrackPreparation(async s=>{warmed.push(s.uri);}, async s=>{cleared.push(s.uri);}, ()=>now);
  const resolver = async s=>{signal=s;return audio;};
  manager.prepare(owner,'a',resolver); await flush();
  manager.prepare(owner,'a',resolver); await flush();
  assert.equal(warmed.length,1,'deduplicate repeated status updates');
  const lease=manager.take(owner,'a'); assert(lease);
  manager.prepare(owner,'b',resolver); await flush();
  assert.equal(warmed.length,1,'do not preload while a source is being transferred to the player');
  lease.release(); lease.release(); await flush();
  assert.equal(cleared.length,1,'release is idempotent');
  manager.prepare(owner,'a',resolver); await flush();
  assert.equal(manager.take(other,'a'),undefined,'never reuse another session');
  assert(signal.aborted); await flush();

  const pending=deferred(); let pendingSignal;
  manager.prepare(owner,'slow',s=>{pendingSignal=s;return pending.promise;});
  assert.equal(manager.take(owner,'slow'),undefined,'a tap must not wait on speculative work');
  assert(pendingSignal.aborted);
  pending.resolve(audio); await flush();
  assert.equal(warmed.length,2,'cancelled resolver must not preload');

  manager.prepare(owner,'expiry',resolver); await flush(); now+=45001;
  assert.equal(manager.take(owner,'expiry'),undefined); await flush();
  manager.prepare(owner,'local',async()=>({uri:'file:///private.flac'})); await flush();
  assert.equal(manager.take(owner,'local'),undefined,'local files are revalidated at selection');
  let failures=0;
  manager.prepare(owner,'fail',async()=>{failures++;throw Error('upstream');}); await flush();
  manager.prepare(owner,'fail',async()=>{failures++;return audio;}); await flush();
  assert.equal(failures,1,'do not hammer a failing upstream every 250ms');
  assert.equal(manager.take(owner,'fail'),undefined);

  // Old native completion must be cleaned before reusing the same URI.
  const nativeWait=deferred(); const events=[];
  const racing=new NextTrackPreparation(async()=>{events.push('warm');if(events.length===1)await nativeWait.promise;},
    async()=>{events.push('clear');},()=>now);
  racing.prepare(owner,'old',resolver); await flush();
  racing.clear(); racing.prepare(owner,'new',resolver); await flush();
  assert.equal(events.join(','),'warm');
  nativeWait.resolve(); await flush();
  assert.equal(events.join(','),'warm,clear,warm');
  const ready=racing.take(owner,'new'); assert(ready); ready.release(); await flush();
  const broken=new NextTrackPreparation(async()=>{throw Error('unsupported');},async()=>{});
  broken.prepare(owner,'x',resolver); await flush();
  assert.equal(broken.take(owner,'x'),undefined,'failed native preload falls back to normal playback');
  const timed=new NextTrackPreparation(async()=>{},async()=>{});
  timed.prepare(owner,'x',resolver); await flush();
  for(const fn of [...timers.values()])fn();
  assert.equal(timed.take(owner,'x'),undefined,'idle native source is evicted on expiry');

  assert.equal(upcomingTrack([1,2,3],0,false,'off'),2);
  assert.equal(upcomingTrack([1,2,3],2,false,'all'),1);
  assert.equal(upcomingTrack([1,2,3],2,false,'off'),undefined);
  assert.equal(upcomingTrack([1,2],0,true,'off'),undefined);
  assert.equal(upcomingTrack([1,2],0,false,'one'),undefined);
  assert.equal(upcomingTrack([1],0,false,'all'),undefined);

  const {PlaybackStartup}=load('src/playbackStartup.ts');
  const timing=new PlaybackStartup(()=>now);
  let attempt=timing.begin(owner,'Qobuz');
  now+=100; attempt.resolved(audio.uri,true);
  attempt.serverTiming('bridge;dur=12.1,catalog;dur=3,resolver;dur=8,private;desc="secret"');
  attempt.installed(); now+=200;
  attempt.observe({isLoaded:true,playing:false,isBuffering:true,currentTime:0});
  assert.equal(timing.snapshot(owner).length,0,'ready is not audible playback');
  now+=250; attempt.observe({isLoaded:true,playing:true,isBuffering:false,currentTime:.25});
  let report=timing.snapshot(owner)[0];
  assert.equal(report.advanceMs,550); assert.equal(report.readyMs,300);
  assert.equal(report.bridgeMs,12); assert.equal(report.catalogMs,3);
  assert(!JSON.stringify(report).includes('private') && !JSON.stringify(report).includes('https'));
  assert.equal(timing.snapshot(other).length,0);
  attempt=timing.begin(owner,'Server'); attempt.resolved('file:///music.flac',false); attempt.fail();
  assert.equal(timing.snapshot(owner)[0].source,'iPhone');
  const stale=timing.begin(owner,'Server'); timing.begin(other,'Server'); stale.fail();
  assert.equal(timing.snapshot(other).length,0,'old account result ignored');
  timing.reset(); assert.equal(timing.snapshot(other).length,0);

  // Cancellation reaches fetch and does not consume responses after cancel.
  let account={baseURL:'https://bridge.test',token:'private',username:'test'};
  let fetchSignal, complete;
  const apiExports={};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/api.ts','utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}
  }).outputText,{exports:apiExports,AbortController,URL,
    setTimeout:()=>0,clearTimeout:()=>{},
    fetch:async(_url,options)=>{fetchSignal=options.signal;return await new Promise(r=>complete=r);}});
  apiExports.configureAccount(account);
  const controller=new AbortController();
  const request=apiExports.request('network/playback/1',1000,undefined,{signal:controller.signal});
  controller.abort(); assert(fetchSignal.aborted);
  complete({status:200,ok:true,json:async()=>({url:'private'}),headers:{get:()=>null}});
  await assert.rejects(request,/annullata/);
  const already=new AbortController();already.abort();
  await assert.rejects(apiExports.request('x',1000,undefined,{signal:already.signal}),/annullata/);
  console.log('Playback startup: session isolation, expiry, cancellation, late native completion, queue policy and private timing reports passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
