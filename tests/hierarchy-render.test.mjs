import test from 'node:test';
import assert from 'node:assert/strict';
import { focalFromScene, softenSupportScene } from '../js/focal-hierarchy.js';

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
