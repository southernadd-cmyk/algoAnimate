import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeRenderer } from './helpers/native-renderer.mjs';
import { visibleFocalInk } from './helpers/visible-ink.mjs';
import { LayeredArtwork, ENGINE_ROUTES } from '../js/ensemble.js';
import { ensembleAnchor, goldenEdgeEntrance, prepareEnsembleScene } from '../js/ensemble-placement.js';
import { SILENCE } from '../js/features.js';
import { StyleDeck } from '../js/styles.js';
import { GOLDEN_ANGLE } from '../js/phi-layout.js';

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

test('landscape Growth begins at golden-section stations on all four paper edges', () => {
  const width=1400,height=1000,seen=new Set();
  const lead={ width,height, mode:'organic',ensembleRole:'lead',markHierarchy:true,
    paths:[{d:'M 120 440 C 280 250 620 250 980 500',
      width:3,opacity:.65,role:'gesture',motif:7}]};
  const phiLow=1/((1+Math.sqrt(5))/2)**2;
  for(let i=0;i<64;i++) {
    const seed='EDGE-GROWTH-'+i,scene=prepareEnsembleScene({...lead,seed});
    const entrance=scene.placement.entrance,root=scene.paths[0].geometry.segments[0].points[0];
    const expected=goldenEdgeEntrance(width,height,seed,scene.placement.rotation);
    assert.deepEqual(entrance,expected);
    assert.ok(Math.hypot(root.x-entrance.x,root.y-entrance.y)<.001,
      'the opening pen starts at the golden edge station to subpixel precision');
    assert.ok(Math.abs(entrance.fraction-phiLow)<1e-12 ||
      Math.abs(entrance.fraction-(1-phiLow))<1e-12,
      'only true golden-section splits are valid edge stations');
    seen.add(entrance.side);
    assert.equal(scene.paths.length,lead.paths.length,'edge entry must extend a native mark, not add a new path');
    assert.deepEqual(scene.goldenFocal,ensembleAnchor(width,height));
    for(const path of scene.paths)for(const segment of path.geometry.segments)
      for(const p of segment.points){
        assert.ok(p.x>=-1e-6&&p.x<=width+1e-6);
        assert.ok(p.y>=-1e-6&&p.y<=height+1e-6);
      }
  }
  assert.deepEqual([...seen].sort(),['bottom','left','right','top']);
  const portrait=prepareEnsembleScene({...lead,width:1000,height:1400,seed:'EDGE-GROWTH-1'});
  assert.equal(portrait.placement.entrance,null,'portrait composition retains its current native entrance');
});

test('Growth turns by sound-seeded golden angles without moving its fixed focal point', () => {
  for (const [width,height] of [[1400,1000],[1000,1400]]) {
    const source = {width,height,mode:'organic',ensembleRole:'lead',markHierarchy:true,
      paths:[{ d:'M 60 300 C 180 200 600 220 1030 420',width:3,opacity:.65,
        role:'gesture',motif:1 }]};
    const anchor = ensembleAnchor(width,height);
    const orientations = new Set();
    for (let i=0;i<32;i++) {
      const input = {...source,seed:'GROWTH-ANGLE-'+i}, snapshot=JSON.stringify(input);
      const result=prepareEnsembleScene(input);
      assert.equal(JSON.stringify(input),snapshot,'seeded orientation must not mutate native paths');
      assert.deepEqual(result.goldenFocal,anchor,'all rotated gestures retain their golden anchor');
      const repeat=prepareEnsembleScene(input);
      assert.deepEqual(result.paths.map(p=>p.d),repeat.paths.map(p=>p.d),'same seed, same rotation');
      assert.ok(Math.abs(result.placement.rotation / GOLDEN_ANGLE
        - Math.round(result.placement.rotation / GOLDEN_ANGLE)) < 1e-12,
        'orientations use integer golden turns');
      orientations.add(result.placement.rotation);
      for (const path of result.paths) for (const segment of path.geometry.segments)
        for (const p of segment.points) {
          const inset = width > height ? Math.min(width,height)*.005 : Math.min(width,height)*.04;
          assert.ok(p.x>=inset-1e-5&&p.x<=width-inset+1e-5);
          assert.ok(p.y>=inset-1e-5&&p.y<=height-inset+1e-5);
        }
    }
    assert.ok(orientations.size>=8,'successive sound seeds must produce varied growth directions');
  }
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
      const anchor=ensembleAnchor(canvas.width,canvas.height);
      for(let frame=0;frame<120;frame++) {
        const time=frame*.1;
        if(frame===45||frame===87) for(const voice of art.voices) art.setVoiceScene(voice,build(voice.route,frame),false,true);
        const level=time<2?.12:.65,values={...profile,level,mid:.3+.15*Math.sin(time),flux:.15+.15*Math.max(0,Math.sin(time*4))};
        art.updateSignals({...SILENCE,...values,raw:values,active:true},.1,true);
        art.draw(.1,.6,false,4);
        if(frame<10) continue;
        assert.deepEqual(art.effectiveFocal,anchor,'seed changes must not move the anchor');
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
    assert.ok(collaborative>.50,orientation+' lead and partners must share visible ink: '+collaborative.toFixed(3));
  }
});
