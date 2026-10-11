import test from 'node:test';
import assert from 'node:assert/strict';
import { ENGINE_ROUTES, RoutedSound, LayeredArtwork,
  ENTRY_STAGGER_SECONDS, ENTRY_DURATION_SECONDS, ENTRY_FIRST_STROKE_AGE } from '../js/ensemble.js';
import { SILENCE } from '../js/features.js';

const keys = ['level', 'bass', 'mid', 'treble', 'centroid', 'flux'];
const sound = values => {
  const raw = Object.fromEntries(keys.map(key => [key, values[key] || 0]));
  return { ...SILENCE, ...raw, raw, active: true, rms: 0.1 };
};

test('the ensemble assigns all eight real engines to six inputs and two combinations', () => {
  assert.equal(new Set(ENGINE_ROUTES.map(route => route.id)).size, 8);
  assert.deepEqual(ENGINE_ROUTES.filter(route => route.inputs.length === 1).map(route => route.inputs[0]).sort(), [...keys].sort());
  assert.deepEqual(ENGINE_ROUTES.filter(route => route.inputs.length === 2).map(route => route.inputs), [['bass', 'flux'], ['mid', 'treble']]);
});

test('each route seed and pen features ignore every unassigned measurement', () => {
  for (const route of ENGINE_ROUTES) {
    const baseline = new RoutedSound(route), unrelated = new RoutedSound(route), changed = new RoutedSound(route);
    for (let i = 0; i < 30; i++) {
      const reference = Object.fromEntries(keys.map(key => [key, 0.2]));
      const other = Object.fromEntries(keys.map(key => [key, route.inputs.includes(key) ? 0.2 : (i % 3 + 1) / 4]));
      const own = { ...reference, [route.inputs[0]]: (i % 3 + 1) / 4 };
      baseline.update(sound(reference), 0.12, true);
      unrelated.update(sound(other), 0.12, true);
      changed.update(sound(own), 0.12, true);
      assert.equal(baseline.seed, unrelated.seed, route.id + ' seed is isolated');
      assert.deepEqual(baseline.features, unrelated.features, route.id + ' speed/pressure are isolated');
    }
    assert.notEqual(baseline.seed, changed.seed, route.id + ' listens to its own signal');
  }
});

test('both inputs of a combination independently affect its seed', () => {
  for (const route of ENGINE_ROUTES.filter(route => route.inputs.length === 2)) {
    function sequence(changed) {
      const input = new RoutedSound(route);
      for (let i = 0; i < 25; i++) input.update(sound({ [route.inputs[0]]: changed === 0 ? 0.7 : 0.2,
        [route.inputs[1]]: changed === 1 ? 0.7 : 0.2 }), 0.12, true);
      return input.seed;
    }
    assert.notEqual(sequence(-1), sequence(0)); assert.notEqual(sequence(-1), sequence(1));
  }
});

test('quiet bands hold independently while current source silence stops even onset tails', () => {
  const inputs = ENGINE_ROUTES.map(route => new RoutedSound(route));
  const mid = sound({ level: 0.5, mid: 0.3, centroid: 0.3 });
  for (const input of inputs) input.update(mid, 0.03, true);
  assert.deepEqual(inputs.filter(input => input.gate.open).map(input => input.route.id), ['rects', 'organic', 'geometric', 'spiral']);
  for (const input of inputs) input.update(sound(Object.fromEntries(keys.map(key => [key, 0.4]))), 0.03, true);
  assert.ok(inputs.every(input => input.gate.open));
  const before = inputs.map(input => input.seed);
  for (const input of inputs) assert.equal(input.update(SILENCE, 0.03, false), false);
  assert.deepEqual(inputs.map(input => input.seed), before, 'Silence never manufactures a new seed');
});

function fixture() {
  globalThis.Path2D = class { constructor(d) { this.d = d; } };
  const commands = [];
  const context = Object.fromEntries(['fillRect', 'setLineDash', 'beginPath', 'moveTo', 'lineTo', 'bezierCurveTo', 'stroke', 'save', 'restore', 'transform'].map(name =>
    [name, (...args) => commands.push([name, ...args.map(x => x?.d || x)])]));
  const canvas = { width: 1000, height: 700, getContext: () => context };
  const art = new LayeredArtwork(canvas);
  art.setScenes(ENGINE_ROUTES.map((route, engine) => ({ mode: route.id, seed: 'SOUND-' + engine, width: 1000, height: 700,
    paper: '#fff', paperMarks: [], paths: [0, 1, 2, 3, 4, 5].map(i => ({
      d: `M ${engine * 60} ${i * 60} C 100 ${i * 60 + 80} 300 ${i * 60 + 80} 600 ${i * 60}`,
      stroke: '#000', opacity: 0.8, width: 3, lineCap: 'round' })) })), true);
  return { art, commands };
}
const full = sound(Object.fromEntries(keys.map(key => [key, 0.4])));

test('first clean-sheet sound staggers ink and eases pen speeds without restarting existing strokes', () => {
  const { art } = fixture();
  art.updateSignals(full, 1 / 30, true); art.draw(1 / 30, 0.6, false, 4);
  assert.ok(art.diagnostics().filter(voice => voice.inkLength > 0).length <= 2,
    'First frame contains only the opening pens, not eight complete drawings');
  assert.ok(art.stats.inkLength > 0, 'A real stroke appears during the first audible frame');
  assert.ok(art.voices[0].art.activeLayer.age >= ENTRY_FIRST_STROKE_AGE,
    'First pen starts with a short visible arc instead of a long blank lead-in');
  const firstLength = art.stats.inkLength;
  for (let i = 0; i < 11; i++) {
    art.updateSignals(full, 1 / 30, true); art.draw(1 / 30, 0.6, false, 4);
  }
  assert.ok(art.diagnostics().filter(voice => voice.inkLength > 0).length >= 4,
    'More pens enter progressively over the opening four tenths of a second');
  assert.ok(art.stats.inkLength > firstLength);
  for (let i = 0; i < 36; i++) {
    art.updateSignals(full, 1 / 30, true); art.draw(1 / 30, 0.6, false, 4);
  }
  assert.equal(ENTRY_STAGGER_SECONDS, 0.027);
  assert.ok(art.entrySeconds >= ENTRY_DURATION_SECONDS && art.entryFinished);
  assert.ok(art.diagnostics().every(voice => voice.inkLength > 0),
    'All eight engines have started by the end of the introduction');
  const positions = art.voices.map(voice => voice.art.activeLayer.age);
  art.updateSignals(SILENCE, 0.1, false); art.draw(0.1, 0.6, false, 4);
  assert.deepEqual(art.voices.map(voice => voice.art.activeLayer.age), positions,
    'Silence freezes the ink rather than restarting it');
  art.updateSignals(full, 1 / 30, true); art.draw(1 / 30, 0.6, false, 4);
  assert.ok(art.voices.every((voice, index) => voice.art.activeLayer.age > positions[index]),
    'Sound resumption advances all existing pens immediately');
  art.clearInk();
  assert.equal(art.entrySeconds, 0);
  assert.equal(art.entryFinished, false);
  art.updateSignals(full, 1 / 30, true); art.draw(1 / 30, 0.6, false, 4);
  assert.ok(art.stats.inkLength > 0, 'Clear Canvas resumes visibly on its first audible frame');
  assert.ok(art.diagnostics().filter(voice => voice.inkLength > 0).length <= 2,
    'Clear Canvas never flashes all eight drawings at once');
});

test('switching sound sources invalidates old worker targets without clearing painted ink', () => {
  const { art } = fixture();
  art.updateSignals(full, 0.2, true); art.draw(0.2, 0.6, false, 4);
  const progress = art.voices.map(voice => voice.art.stats.progress);
  for (const voice of art.voices) {
    voice.building = true;
    voice.art.setScene({ ...voice.art.current, seed: 'obsolete-source' });
  }
  const generations = art.voices.map(voice => voice.generation);
  art.resetSound();
  assert.deepEqual(art.voices.map(voice => voice.generation), generations.map(value => value + 1));
  assert.ok(art.voices.every(voice => !voice.building && voice.firstSoundSeed && !voice.art.queued && voice.sound.seed === 'SOUND-READY'));
  assert.deepEqual(art.voices.map(voice => voice.art.stats.progress), progress);
});

test('paper and ink changes preserve each quiet engine pen position', () => {
  const { art } = fixture();
  for (let i = 0; i < 6; i++) {
    art.updateSignals(full, 0.35, true); art.draw(0.35, 0.6, false, 4);
  }
  art.updateSignals(SILENCE, 0.03, false); art.draw(0.03, 0.6, false, 4);
  const positions = art.voices.map(voice => voice.art.activeLayer.age);
  art.setScenes(art.voices.map(voice => ({ ...voice.art.current, width: 700, height: 1000 })), true);
  art.draw(0.03, 0.6, false, 4);
  assert.deepEqual(art.voices.map(voice => voice.art.activeLayer.age), positions);
  assert.ok(art.diagnostics().every(voice => voice.inkLength > 0 && !voice.flowing));
  assert.equal(art.canvas.width, 700); assert.equal(art.canvas.height, 1000);
});

test('all eight engines draw on one paper with 24 independent pen lanes and bounded history', () => {
  const { art, commands } = fixture();
  for (let i = 0; i < 150; i++) {
    commands.length = 0; art.updateSignals(full, 1 / 30, true); art.draw(1 / 30, 0.6, false, 1);
    assert.equal(commands.filter(command => command[0] === 'fillRect').length, 1, 'An engine cannot wipe another engine');
    if (i > 40) assert.ok(art.diagnostics().every(voice => voice.penTips > 0 && voice.inkLength > 0 && voice.layers <= 3));
    assert.equal(art.diagnostics().reduce((sum, voice) => sum + voice.pens, 0), 24);
  }
  const progress = art.voices.map(voice => voice.art.stats.progress);
  art.updateSignals(SILENCE, 0.03, false); art.draw(0.03, 0.6, false, 1);
  commands.length = 0; art.draw(0.5, 0.6, false, 1);
  const held = JSON.stringify(commands);
  commands.length = 0; art.draw(1, 0.6, false, 1);
  assert.equal(JSON.stringify(commands), held);
  assert.deepEqual(art.voices.map(voice => voice.art.stats.progress), progress);
});

test('sparse ink retention keeps less old ink while all 24 pen lanes continue and silence still holds it', () => {
  function drawWithMemory(memory) {
    const { art } = fixture();
    for (const voice of art.voices) voice.art.current.inkMemory = memory;
    for (let i = 0; i < 180; i++) {
      art.updateSignals(full, 1 / 30, true); art.draw(1 / 30, 0.6, false, 1);
    }
    return art;
  }
  const sparse = drawWithMemory(0.12), dense = drawWithMemory(0.7);
  assert.ok(sparse.stats.inkLength < dense.stats.inkLength * 0.55, 'Less ink is present, with the same native paths and opacity');
  assert.ok(sparse.diagnostics().every(engine => engine.penTips > 0 && engine.inkLength > 0));
  const held = sparse.stats.inkLength;
  sparse.updateSignals(SILENCE, 0.1, false); sparse.draw(0.1, 0.6, false, 1);
  sparse.draw(1, 0.6, false, 1); assert.equal(sparse.stats.inkLength, held);
});

test('changing treble leaves the bass clock unchanged and native portrait transforms survive compositing', () => {
  function advance(treble) {
    const { art } = fixture();
    for (let i = 0; i < 10; i++) {
      art.updateSignals(sound({ level: 0.5, bass: 0.3, mid: 0.2, treble, centroid: 0.4 }), 1 / 30, true);
      art.draw(1 / 30, 1, false, 4);
    }
    return art.voices[0].art.stats.progress;
  }
  assert.equal(advance(0), advance(1));
  const { art, commands } = fixture();
  art.voices[3].art.current.paths[0].transform = 'matrix(0 1 -1 0 1000 0)';
  // The transformed engine enters after its deliberate first-ink stagger.
  for (let frame = 0; frame < 8; frame++) {
    art.updateSignals(full, 0.1, true); art.draw(0.1, 0.6, false, 4);
  }
  assert.ok(commands.some(command => JSON.stringify(command) === JSON.stringify(['transform', 0, 1, -1, 0, 1000, 0])));
  assert.equal(commands.filter(command => command[0] === 'save').length, commands.filter(command => command[0] === 'restore').length);
});
