import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeRenderer } from './helpers/native-renderer.mjs';
import { visibleFocalInk } from './helpers/visible-ink.mjs';
import { LayeredArtwork, ENGINE_ROUTES } from '../js/ensemble.js';
import { ensembleAnchor, prepareEnsembleScene } from '../js/ensemble-placement.js';
import { SILENCE } from '../js/features.js';
import { StyleDeck } from '../js/styles.js';

const context = new Proxy({}, { get(target, key) { return target[key] ?? (() => {}); } });
globalThis.Path2D ||= class { constructor(d) { this.d=d; } };
const profile = { level:.5,bass:.4,mid:.3,treble:.2,centroid:.4,flux:.25 };

test('golden placement composes transforms, stays on paper, and accents a gesture only once', () => {
  const input={width:1000,height:1400,ensembleRole:'lead',markHierarchy:true,paths:[{
    d:'M -200 -300 C 100 200 1100 1500 1500 1800',transform:'matrix(1 0 0 1 50 60)',
    width:4,opacity:.5,role:'gesture',motif:1
  }]};
  const original=JSON.stringify(input),placed=prepareEnsembleScene(input);
  assert.equal(JSON.stringify(input),original,'input vector snapshots are immutable');
  assert.equal(placed.paths[0].transform,undefined);
  assert.equal(placed.paths[0].width,4*(1+Math.sqrt(5))/2,'single hierarchy accent');
  for(const segment of placed.paths[0].geometry.segments)for(const p of segment.points){
    assert.ok(p.x>=40-1e-6&&p.x<=960+1e-6);
    assert.ok(p.y>=56-1e-6&&p.y<=1344+1e-6);
  }
  assert.deepEqual(placed.goldenFocal,ensembleAnchor(1000,1400));
  const free=prepareEnsembleScene({...input,sharedAnchor:false});
  assert.equal(free.paths[0].d,input.paths[0].d);
  assert.equal(free.paths[0].transform,input.paths[0].transform);
  assert.equal(free.goldenFocal,undefined);
});

test('V8 Growth preserves native multi-root paths, placement and edge entries in both orientations', () => {
  const render = nativeRenderer();
  const growth = ENGINE_ROUTES.find(route => route.id === 'organic');
  for (const orientation of ['landscape', 'portrait']) {
    let edgeEntries = 0, interiors = 0;
    for (let i = 0; i < 24; i++) {
      const seed = 'V8-NATIVE-ROOT-' + i;
      const args = { orientation, density: 60, profile };
      const free = render(growth, seed, { ...args, sharedAnchor: false });
      const placed = render(growth, seed, { ...args, sharedAnchor: true });
      assert.equal(placed.placement.nativeGrowth, true);
      assert.equal(placed.placement.scale, 1, 'fitting must not pull edge roots off the paper');
      assert.equal(placed.goldenFocal, undefined,
        'the focal region must track actual lead ink rather than a fixed intersection');
      assert.deepEqual(placed.paths.map(path => path.d).sort(), free.paths.map(path => path.d).sort(),
        'native V8 pen coordinates must survive the ensemble adapter exactly');
      assert.deepEqual(placed.paths.map(path => path.transform).sort(), free.paths.map(path => path.transform).sort());
      const starts = placed.paths.map(path => path.geometry.segments[0]?.points[0]).filter(Boolean);
      const edge = starts.some(p => p.x < 20 || p.y < 20 ||
        p.x > placed.width - 20 || p.y > placed.height - 20);
      if (edge) edgeEntries++;
      else interiors++;
      const repeat = render(growth, seed, args);
      assert.deepEqual(placed.paths.map(path => path.d), repeat.paths.map(path => path.d),
        'V8 rendering and placement remain deterministic for each sound seed');
    }
    assert.ok(edgeEntries > 0, orientation + ' must retain genuine V8 edge entrances');
    assert.ok(interiors > 0, orientation + ' must also retain interior-root compositions');
  }
});

test('manual Growth vectors are never relocated or rotated by the shared-anchor adapter', () => {
  const root = { width: 1400, height: 1000, mode: 'organic', ensembleRole: 'lead',
    seed: 'V8-NATIVE', markHierarchy: true, paths: [
      { d: 'M 5 382 C 80 330 150 420 300 490', width: 3, opacity: .8, role: 'gesture', motif: 1 },
      { d: 'M 535 618 C 600 700 700 720 760 790', width: 3, opacity: .8, role: 'gesture', motif: 2 }
    ] };
  const input = JSON.stringify(root);
  const placed = prepareEnsembleScene(root);
  assert.equal(JSON.stringify(root), input, 'native input remains unchanged');
  assert.deepEqual(placed.paths.map(path => path.d).sort(), root.paths.map(path => path.d).sort());
  assert.equal(placed.placement.nativeGrowth, true);
  assert.equal(placed.goldenFocal, undefined);
});

test('supporting engine positions bridge into the focal area without collapsing onto Growth', () => {
  for (const [width, height] of [[1400, 1000], [1000, 1400]]) {
    const anchor = ensembleAnchor(width, height);
    const scene = { width, height, ensembleRole:'support', markHierarchy:true,
      paths:[{ d:'M 200 200 C 250 330 470 160 550 400',
        width:3, opacity:.7, role:'gesture', motif:1 }] };
    const outer = prepareEnsembleScene({...scene,mode:'field',interlock:{lane:0,lanes:8}});
    const connector = prepareEnsembleScene({...scene,mode:'network',interlock:{lane:0,lanes:8}});
    const distance = ({x,y}) => Math.hypot((x-anchor.x)/width,(y-anchor.y)/height);
    assert.ok(distance(connector.placement.target) < distance(outer.placement.target));
    assert.ok(distance(outer.placement.target) > 0);
    assert.ok(connector.placement.scale > outer.placement.scale);
    for (const prepared of [outer,connector]) for (const path of prepared.paths)
      for (const segment of path.geometry.segments) for (const point of segment.points) {
        assert.ok(point.x >= width*.04-1e-5 && point.x <= width*.96+1e-5);
        assert.ok(point.y >= height*.04-1e-5 && point.y <= height*.96+1e-5);
      }
  }
});

test('native animated ensemble shares ink with Growth through partial strokes and scene handoffs', () => {
  const render = nativeRenderer();
  for (const orientation of ['landscape','portrait']) {
    const ratios=[];
    for (let seed=0;seed<12;seed++) {
      const canvas={ width:0,height:0,getContext:()=>context },art=new LayeredArtwork(canvas);
      const styles = new StyleDeck(seed), kits = ENGINE_ROUTES.map(route=>({route,art:{}}));
      for(const kit of kits) kit.pendingStyle=styles.next(kits,'mix',`ANIMATED-${seed}`,kit.route.id,profile);
      const build=(route,generation)=>render(route,`ANIMATED-${seed}-${generation}`,{orientation,density:25,profile,
        style:kits.find(kit=>kit.route.id===route.id).pendingStyle});
      art.setScenes(ENGINE_ROUTES.map(route=>build(route,0)),true);
      for(let frame=0;frame<120;frame++) {
        const time=frame*.1;
        if(frame===45||frame===87) for(const voice of art.voices) art.setVoiceScene(voice,build(voice.route,frame),false,true);
        const level=time<2?.12:.65,values={...profile,level,mid:.3+.15*Math.sin(time),flux:.15+.15*Math.max(0,Math.sin(time*4))};
        art.updateSignals({...SILENCE,...values,raw:values,active:true},.1,true);
        art.draw(.1,.6,false,4);
        if(frame<10) continue;
        assert.ok(art.effectiveFocal, 'a live Growth lead should create a real focal region');
        const anchor = art.effectiveFocal;
        assert.ok(anchor.x >= anchor.rx && anchor.x <= canvas.width-anchor.rx);
        assert.ok(anchor.y >= anchor.ry && anchor.y <= canvas.height-anchor.ry);
        let lead=0,support=0;
        for(const voice of art.voices) for(const layer of voice.art.layers) {
          const ink=visibleFocalInk(layer,anchor,voice.art.current.inkMemory,voice!==art.leadVoice);
          if(voice===art.leadVoice) lead+=ink;else support+=ink;
        }
        if(lead+support>0) ratios.push(lead/(lead+support));
      }
    }
    const mean=ratios.reduce((a,b)=>a+b,0)/ratios.length;
    const collaborative=ratios.filter(x=>x>=.3&&x<=.8).length/ratios.length;
    console.log(orientation,{mean,collaborative});
    assert.ok(mean>.30&&mean<.8,orientation+' ensemble focal balance: '+mean.toFixed(3));
    // V8 distributes several roots across the paper rather than forcing one
    // stable top-left anchor. Require substantial overlap without reinstating
    // V7's fixed placement merely to meet its old 50% threshold.
    assert.ok(collaborative>.35,orientation+' lead and partners must share visible ink: '+collaborative.toFixed(3));
  }
});
