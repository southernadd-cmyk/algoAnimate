import test from 'node:test';
import assert from 'node:assert/strict';
import { markerGeometry, strokeWindow, strokeSchedule, inkWindow } from '../js/ink.js';
import { AnimatedArtwork } from '../js/scenes.js';
import { SILENCE } from '../js/features.js';

test('partial marker lines travel by distance and preserve corners and subpaths', () => {
  const geometry = markerGeometry('M 0 0 L 100 0 L 100 100');
  assert.equal(geometry.length, 200);
  assert.deepEqual(strokeWindow(geometry, 0.25, 0.75), [['M', 50, 0], ['L', 100, 0], ['L', 100, 50]]);
  assert.deepEqual(strokeWindow(geometry, 0.5, 0.5), []);
  const separate = markerGeometry('M 0 0 L 10 0 M 100 0 L 110 0');
  assert.deepEqual(strokeWindow(separate), [['M', 0, 0], ['L', 10, 0], ['M', 100, 0], ['L', 110, 0]]);
  assert.equal(markerGeometry('M 10 10 L 10 10').length, 0);
  assert.deepEqual(strokeWindow(markerGeometry('M 10 10 L 10 10')), []);
});

test('partial cubic strokes remain exact curves with their original control geometry', () => {
  const geometry = markerGeometry('M 0 0 C 0 100 100 100 100 0');
  assert.ok(Math.abs(geometry.length - 200) < 0.2);
  const first = strokeWindow(geometry, 0, 0.5);
  assert.equal(first[1][0], 'C');
  for (const [index, value] of [0, 50, 25, 75, 50, 75].entries()) assert.ok(Math.abs(first[1][index + 1] - value) < 1e-6);
  const second = strokeWindow(geometry, 0.5, 1);
  assert.ok(Math.abs(second[0][1] - 50) < 1e-6);
  assert.ok(Math.abs(second[0][2] - 75) < 1e-6);
  assert.deepEqual(second.at(-1).slice(-2), [100, 0]);
  assert.deepEqual(strokeWindow(geometry), [['M', 0, 0], ['C', 0, 100, 100, 100, 100, 0]]);
});

test('arc length handles non-uniform straight cubics and closed curves', () => {
  const geometry = markerGeometry('M 0 0 C 0 0 0 0 100 0');
  assert.ok(Math.abs(strokeWindow(geometry, 0, 0.5).at(-1).at(-2) - 50) < 0.1);
  const loop = markerGeometry('M 0 0 C 200 100 -200 -100 0 0');
  assert.ok(loop.length > 250);
  assert.ok(strokeWindow(loop, 0.2, 0.8).flat().filter(x => typeof x === 'number').every(Number.isFinite));
});

test('pen schedules have no between-stroke pauses and ink tails retreat by distance', () => {
  const paths = [50, 100, 900, 120, 400, 10, 800, 200].map(length => ({ geometry: { length } }));
  const schedule = strokeSchedule(paths), ends = [0, 0, 0];
  for (const timing of schedule) {
    assert.equal(timing.start, ends[timing.pen]);
    ends[timing.pen] = timing.start + timing.duration;
    assert.ok(timing.duration > 0 && ends[timing.pen] <= 1 + 1e-9);
  }
  assert.ok(Math.abs(Math.max(...ends) - 1) < 1e-9);
  const timing = { start: 0, duration: 0.4 };
  assert.deepEqual(inkWindow(0.2, timing), { from: 0, to: 0.5 });
  assert.ok(Math.abs(inkWindow(0.9, timing).from - 0.5) < 1e-9);
  assert.deepEqual(inkWindow(1.1, timing), { from: 1, to: 1 });
});

function artwork() {
  globalThis.Path2D = class { constructor(d) { this.d = d; } };
  const commands = [];
  const context = Object.fromEntries(['fillRect', 'setLineDash', 'beginPath', 'moveTo', 'lineTo', 'bezierCurveTo', 'stroke'].map(name =>
    [name, (...args) => commands.push([name, ...args.map(x => x?.d || x)])]));
  const canvas = { width: 1000, height: 700, getContext: () => context };
  const art = new AnimatedArtwork(canvas);
  return { art, context, commands };
}
function scene(seed = 'first', y = 0) {
  return { seed, width: 1000, height: 700, paper: '#fff', paperMarks: [], paths:
    [0, 1, 2, 3, 4, 5].map(i => ({ d: `M 0 ${y + i * 100} C 100 ${y + i * 100 + 80} 300 ${y + i * 100 + 80} 600 ${y + i * 100}`,
      stroke: '#000', opacity: 0.6, width: 3, lineCap: 'round' })) };
}

test('continuous ink advances every frame without needing a new seed', () => {
  const { art, commands } = artwork();
  art.setScene(scene(), true);
  const frames = new Set();
  for (let i = 0; i < 300; i++) {
    commands.length = 0;
    // Even a quiet connected source keeps the marker tracing its current seed.
    art.draw(SILENCE, 1 / 30, 0.6, false, 1, true);
    frames.add(JSON.stringify(commands));
    assert.ok(art.stats.penTips > 0, 'At least one pen is drawing in every frame');
    assert.ok(art.stats.inkLength > 0, 'The paper never goes blank between cycles');
    assert.ok(art.layers.length <= 3, 'Ink history is bounded');
  }
  assert.ok(frames.size > 290);
  assert.ok(art.turns >= 10);
  assert.equal(art.sceneCount, 1, 'Retracing does not invent new sound seeds');
});

test('new seeds wait for the pen boundary and do not restart a live stroke', () => {
  const { art } = artwork();
  art.setScene(scene(), true); art.draw(SILENCE, 0.2, 0, false, 1, true);
  const progress = art.activeLayer.age;
  art.setScene(scene('next', 20));
  assert.equal(art.drawnSeed, 'first'); assert.equal(art.activeLayer.age, progress);
  art.draw(SILENCE, 0.5, 0, false, 1, true); assert.equal(art.drawnSeed, 'first');
  art.draw(SILENCE, 0.35, 0, false, 1, true); assert.equal(art.drawnSeed, 'next');
  assert.ok(Math.abs(art.activeLayer.age - 0.05) < 1e-9);
  assert.ok(art.stats.penTips > 0);
});

test('pausing holds the exact drawing frame and gentle motion slows the pens', () => {
  const { art, commands } = artwork();
  art.setScene(scene(), true); art.draw(SILENCE, 0.4, 0, false, 1, true);
  const progress = art.activeLayer.age;
  commands.length = 0; art.draw(SILENCE, 0.1, 0, false, 1, false);
  const held = JSON.stringify(commands);
  commands.length = 0; art.draw(SILENCE, 1, 0, false, 1, false);
  assert.equal(JSON.stringify(commands), held); assert.equal(art.activeLayer.age, progress);
  art.draw(SILENCE, 0.16, 0, true, 1, true);
  assert.ok(Math.abs(art.activeLayer.age - progress - 0.1) < 1e-9);
});

test('ink cadence is time based and stroke pressure stays where it was drawn', () => {
  function simulate(dt) {
    const { art, context } = artwork(); art.setScene(scene(), true);
    for (let i = 0; i < Math.round(2.3 / dt); i++) art.draw(SILENCE, dt, 0, false, 1, true);
    return { progress: art.activeLayer.age, ink: art.stats.inkLength, context };
  }
  const a = simulate(1 / 30), b = simulate(1 / 60);
  assert.ok(Math.abs(a.progress - b.progress) < 1e-9);
  assert.ok(Math.abs(a.ink - b.ink) < 1e-6);
  const { art } = artwork(); art.setScene(scene(), true);
  art.draw(SILENCE, 0.3, 1, false, 1, true);
  const initial = art.activeLayer.pressure[0];
  art.draw({ ...SILENCE, level: 1, bass: 1 }, 0.1, 1, false, 1, true);
  assert.equal(art.activeLayer.pressure[0], initial);
});
