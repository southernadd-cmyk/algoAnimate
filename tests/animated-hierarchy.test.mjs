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

test('native animated ensemble keeps a golden lead through partial strokes and scene handoffs', () => {
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
    const dominant=ratios.filter(x=>x>.6).length/ratios.length;
    console.log(orientation,{mean,dominant});
    assert.ok(mean>.6,orientation+' visible lead share: '+mean.toFixed(3));
    assert.ok(dominant>.75,orientation+' lead holds >60% ink in at least 75% of animated samples: '+dominant.toFixed(3));
  }
});
