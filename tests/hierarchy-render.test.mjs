import test from 'node:test';
import assert from 'node:assert/strict';
import { focalFromScene, softenSupportScene, stabilizeFocal, supportInfluences,
  FOCAL_TRANSITION_SECONDS } from '../js/focal-hierarchy.js';
import { LayeredArtwork, LEAD_ROUTE_ID } from '../js/ensemble.js';

const path = (d, opacity=1, width=4) => ({ d, opacity, width });
test('focal region follows actual lead geometry and orientation', () => {
  const landscape = { width: 1400, height: 1000,
    paths: [path('M 930 720 L 980 750'), path('M 950 700 L 1000 740')] };
  const portrait = { width: 1000, height: 1400,
    paths: [path('M 120 230 L 155 245'), path('M 140 210 L 165 255')] };
  const a = focalFromScene(landscape), b = focalFromScene(portrait);
  assert.ok(a.x > landscape.width / 2 && a.y > landscape.height / 2);
  assert.ok(b.x < portrait.width / 2 && b.y < portrait.height / 2);
  assert.ok(a.rx > b.rx && a.ry < b.ry);
});

test('supports lose visible ink near the lead without changing geometry or originals', () => {
  const lead = { width: 1400, height: 1000, paths: [path('M 900 700 L 940 735')] };
  const focal = focalFromScene(lead);
  const near = path('M 910 710 L 930 720');
  const far = path('M 20 20 L 40 40');
  const support = { width: 1400, height: 1000, paths: [near, far] };
  const first = softenSupportScene(support, focal);
  const again = softenSupportScene(support, focal);
  assert.deepEqual(first, again, 'Deterministic geometry adaptation');
  assert.equal(first.paths[0].d, near.d);
  assert.ok(first.paths[0].opacity < near.opacity);
  assert.ok(first.paths[0].width < near.width);
  assert.equal(first.paths[1].opacity, far.opacity);
  assert.equal(first.paths[1].width, far.width);
  assert.deepEqual(support.paths[0], near, 'Original score/vector inputs unchanged');
});

test('path transforms contribute to real focal detection', () => {
  const scene = { width: 1400, height: 1000, paths: [
    { ...path('M 0 0 L 30 30'), transform: 'matrix(1 0 0 1 1000 700)' }] };
  const focal = focalFromScene(scene);
  assert.ok(focal.x > 700 && focal.y > 500);
});

test('edge centres stay on-page and small shifts have hysteresis', () => {
  const first = focalFromScene({ width: 1400, height: 1000, paths: [path('M 1380 990 L 1395 995')] });
  assert.ok(first.x <= 1400 - first.rx && first.y <= 1000 - first.ry);
  const tiny = stabilizeFocal({ ...first, x: first.x - 4, y: first.y - 3 }, first);
  assert.equal(tiny, first);
  const far = stabilizeFocal({ ...first, x: 400, y: 350 }, first);
  assert.ok(far.x < first.x && far.x > 400 && far.y < first.y && far.y > 350);
});

test('focal adjustment can be removed and reapplied without accumulating fades', () => {
  const original = { width: 1400, height: 1000, paths: [path('M 910 710 L 930 720')] };
  const focal = focalFromScene(original);
  const softened = softenSupportScene(original, focal);
  const restored = softenSupportScene(softened, null);
  assert.equal(restored.paths[0].opacity, original.paths[0].opacity);
  assert.equal(restored.paths[0].width, original.paths[0].width);
  const repeated = softenSupportScene(restored, focal);
  assert.equal(repeated.paths[0].opacity, softened.paths[0].opacity);
  assert.equal(repeated.paths[0].width, softened.paths[0].width);
  assert.deepEqual(restored.paths[0].d, original.paths[0].d);
});

test('muted or solo-excluded lead cannot leave a stale softened support layer', () => {
  const canvas = { getContext: () => ({}) };
  const ensemble = new LayeredArtwork(canvas);
  const lead = ensemble.leadVoice, support = ensemble.voices.find(v => v.route.id !== LEAD_ROUTE_ID);
  const pathData = path('M 910 710 L 930 720');
  const leadScene = { width: 1400, height: 1000, paths: [pathData] };
  lead.art.current = leadScene;
  const originalSupport = { width: 1400, height: 1000, paths: [pathData] };
  support.art.current = originalSupport;
  support.art.layers = [{ scene: originalSupport, age: .3, pressure: [1.2] }];
  ensemble.syncFocal();
  assert.ok(supportInfluences(originalSupport, ensemble.effectiveFocal)[0] > 0);
  const layer = support.art.layers[0], pressure = layer.pressure;
  assert.equal(layer.scene, originalSupport, 'Fading leaves native geometry intact');
  ensemble.toggleMute(LEAD_ROUTE_ID);
  assert.equal(ensemble.effectiveFocal, null);
  assert.equal(support.art.layers[0].scene.paths[0].opacity, 1);
  assert.equal(support.art.layers[0], layer);
  assert.equal(support.art.layers[0].pressure, pressure);
  assert.equal(support.art.layers[0].age, .3);
  assert.deepEqual(support.art.layers[0].pressure, [1.2]);
  ensemble.toggleMute(LEAD_ROUTE_ID);
  assert.ok(supportInfluences(originalSupport, ensemble.effectiveFocal)[0] > 0);
  ensemble.toggleSolo(support.route.id);
  assert.equal(support.art.layers[0].scene.paths[0].opacity, 1);
});

test('large focal changes ease over one second without replacing support geometry or pen state', () => {
  const ensemble = new LayeredArtwork({ getContext: () => ({}) });
  const lead = ensemble.leadVoice, support = ensemble.voices.find(v => v !== lead);
  const scene = x => ({ width: 1400, height: 1000, paths: [path(`M ${x} 400 L ${x + 20} 420`)] });
  lead.art.current = scene(350);
  support.art.current = scene(550);
  const layer = { scene: support.art.current, age: .37, pressure: [1.2] };
  support.art.layers = [layer];
  ensemble.syncFocal();
  const initial = ensemble.effectiveFocal;
  lead.art.current = scene(1000);
  ensemble.syncFocal();
  assert.equal(ensemble.effectiveFocal, initial, 'A new target does not switch the ink in the same frame');
  const target = ensemble.focalRegion;
  const positions = [];
  for (let frame = 0; frame < 30; frame++) {
    ensemble.syncFocal(FOCAL_TRANSITION_SECONDS / 30);
    positions.push(ensemble.effectiveFocal.x);
    assert.equal(support.art.current, layer.scene);
    assert.equal(support.art.layers[0], layer);
    assert.equal(layer.age, .37);
    assert.deepEqual(layer.pressure, [1.2]);
  }
  assert.ok(positions[0] < initial.x + (target.x - initial.x) * .01, 'First frame covers under 1% of the move');
  assert.ok(positions.every((x, i) => i === 0 || x >= positions[i - 1]));
  ensemble.syncFocal(.001);
  assert.equal(ensemble.effectiveFocal, target);
  assert.equal(ensemble.focalTransition, null);

  lead.art.current = scene(450); ensemble.syncFocal(.25);
  const interrupted = ensemble.effectiveFocal;
  lead.art.current = scene(1100); ensemble.syncFocal();
  assert.equal(ensemble.effectiveFocal, interrupted, 'Retargeting starts at the position actually shown');
  const held = ensemble.effectiveFocal;
  ensemble.syncFocal();
  assert.equal(ensemble.effectiveFocal, held, 'Zero drawing time freezes the transition');
  ensemble.toggleMute(LEAD_ROUTE_ID);
  assert.equal(ensemble.effectiveFocal, null);
  assert.equal(ensemble.focalTransition, null);
});
