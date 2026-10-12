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

test('eight golden territories tile the entire paper in either orientation', async () => {
  const { goldenRegions, voiceRegion, GOLDEN_SHARE } = await import('../js/golden-regions.js');
  for (const [width, height] of [[1400,1000],[1000,1400]]) {
    const cells = goldenRegions(width,height);
    assert.equal(cells.length,8);
    const total = cells.reduce((sum, r) => sum + r.w*r.h,0);
    assert.ok(Math.abs(total-width*height) < 1e-5);
    for (let i=0;i<cells.length;i++) {
      const a=cells[i];
      assert.ok(a.w>0&&a.h>0&&a.x>=0&&a.y>=0);
      assert.ok(a.x+a.w<=width+1e-6&&a.y+a.h<=height+1e-6);
      assert.equal(voiceRegion(width,height,i).voice,i);
      for(let j=i+1;j<cells.length;j++) {
        const b=cells[j];
        const overlap=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))
          *Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
        assert.ok(overlap<1e-6,'regions must tessellate without hard overlaps');
      }
    }
    assert.ok(Math.abs(cells[0].w/width-GOLDEN_SHARE)<1e-9
      || Math.abs(cells[0].h/height-GOLDEN_SHARE**3)<1e-9,
      'regions emerge from phi cuts rather than equal rectangular grid cells');
    const shifted=goldenRegions(width,height,.51);
    assert.notDeepEqual(shifted.map(r=>r.voice),cells.map(r=>r.voice),
      'golden-angle phrase rotation must reassign voice territories');
    assert.deepEqual(goldenRegions(width,height,.51),shifted,'territory rotation is deterministic');
  }
});

test('all native engines occupy separate golden regions without frames or lead fading', () => {
  const render = nativeRenderer();
  for (const orientation of ['landscape','portrait']) {
    const scenes=ENGINE_ROUTES.map(route=>render(route,'EQUAL-VOICE-'+route.id,{orientation,density:30,profile}));
    const regions=scenes.map(scene=>scene.placement.region);
    assert.equal(new Set(regions.map(region=>region.index)).size,8);
    for(const scene of scenes) {
      assert.equal(scene.ensembleRole,'equal');
      assert.equal(scene.placement.equalVoice,true);
      assert.equal(scene.goldenFocal,undefined);
      const region=scene.placement.region, epsilon=.19;
      assert.ok(scene.paths.length>0,scene.mode+' must actually draw');
      for(const path of scene.paths)for(const seg of path.geometry.segments)for(const p of seg.points) {
        assert.ok(p.x>=region.x-region.w*epsilon-1&&p.x<=region.x+region.w*(1+epsilon)+1,
          scene.mode+' must remain near its golden territory');
        assert.ok(p.y>=region.y-region.h*epsilon-1&&p.y<=region.y+region.h*(1+epsilon)+1,
          scene.mode+' must remain near its golden territory');
      }
      const repeated=render(ENGINE_ROUTES.find(r=>r.id===scene.mode),'EQUAL-VOICE-'+scene.mode,
        {orientation,density:30,profile});
      assert.deepEqual(scene.paths.map(path=>path.d),repeated.paths.map(path=>path.d),
        'seed+sound+phrase placement must be deterministic');
    }
  }
});

test('Growth joins the other equal voices and responds to audio and phrase changes', () => {
  const render=nativeRenderer(), route=ENGINE_ROUTES.find(route=>route.id==='organic');
  for(const orientation of ['landscape','portrait']) {
    const args={orientation,density:40,profile};
    const free=render(route,'ROOTS',{...args,sharedAnchor:false});
    const still=render(route,'ROOTS',args);
    const louder=render(route,'ROOTS',{...args,profile:{...profile,level:1}});
    const next=render(route,'ROOTS',{...args,phase:.51});
    assert.notDeepEqual(still.paths.map(p=>p.d),free.paths.map(p=>p.d),'native roots are composed within their territory');
    assert.equal(still.placement.equalVoice,true);
    assert.equal(still.placement.region.voice,ENGINE_ROUTES.findIndex(r=>r.id==='organic'));
    assert.notEqual(still.placement.scale,louder.placement.scale,'audio changes the drawn extent');
    assert.notEqual(still.placement.region.index,next.placement.region.index,'phrases redistribute the regions');
  }
});

test('active eight-voice animation has no central lead and stays on a shared sheet', () => {
  const render=nativeRenderer();
  for(const orientation of ['landscape','portrait']) {
    const canvas={width:0,height:0,getContext:()=>context}, art=new LayeredArtwork(canvas);
    const scenes=ENGINE_ROUTES.map(route=>render(route,'ONE-SHEET-'+route.id,{orientation,density:25,profile}));
    art.setScenes(scenes,true);
    assert.equal(art.effectiveFocal,null);
    for(let frame=0;frame<40;frame++) {
      art.updateSignals({...SILENCE,...profile,raw:profile,active:true},.1,true);
      art.draw(.1,.6,false,4);
      assert.equal(art.effectiveFocal,null,'no voice dims neighbouring marks around a focal leader');
      assert.equal(art.voices.length,8);
      assert.equal(art.paperScene.width,scenes[0].width);
    }
    assert.ok(art.voices.some(v=>v.art.stats.visiblePaths>0),'the ensemble must draw');
    const still=art.layoutTime;
    art.updateSignals(SILENCE,.5,false);
    assert.equal(art.layoutTime,still,'silent time must not rotate the regions');
  }
});
