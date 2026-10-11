import test from 'node:test';
import assert from 'node:assert/strict';
import { ENGINE_ROUTES, RoutedSound, ensembleSettings } from '../js/ensemble.js';
import { StyleDeck } from '../js/styles.js';
import { SILENCE } from '../js/features.js';
import { goldenLanePoint, interlockRenderer, GOLDEN_ANGLE } from '../js/phi-layout.js';
import { centroidReading } from '../js/listening.js';
import { pngWithDpi } from '../js/png.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { renderComposition } from '../js/composition.js';

const profile = value => ({ level: value, bass: value, mid: value, treble: value, centroid: value, flux: value });
const settings = (id, value) => ensembleSettings(ENGINE_ROUTES.find(route => route.id === id), 'FIXED-SEED', 'landscape', 'marker', 50, null, profile(value));
test('continuous sound changes geometry controls with the variety seed held fixed', () => {
  assert.ok(settings('geometric', 0.1).curveBias > settings('geometric', 0.9).curveBias);
  assert.ok(settings('field', 0.9).elementScale > settings('field', 0.1).elementScale);
  assert.ok(settings('field', 0.9).nesting > settings('field', 0.1).nesting);
  assert.ok(settings('network', 0.9).shapeAmount > settings('network', 0.1).shapeAmount);
  assert.ok(settings('network', 0.9).rotation > settings('network', 0.1).rotation);
  assert.ok(settings('organic', 0.9).elements > settings('organic', 0.1).elements);
  assert.ok(settings('organic', 0.9).inkMemory > settings('organic', 0.1).inkMemory);
  const low = settings('geometric', 0.5), nearby = settings('geometric', 0.501);
  assert.ok(Math.abs(low.curveBias - nearby.curveBias) < 0.1);
  assert.equal(low.seed, nearby.seed);
});
test('phrase profiles and composition controls ignore unrelated sound and hold during silence', () => {
  for (const route of ENGINE_ROUTES) {
    const a = new RoutedSound(route), b = new RoutedSound(route);
    for (let i = 0; i < 60; i++) {
      const reference = profile(i < 30 ? 0.2 : 0.7);
      const other = Object.fromEntries(Object.entries(reference).map(([key, value]) => [key, route.inputs.includes(key) ? value : 1 - value]));
      for (const [voice, raw] of [[a, reference], [b, other]]) voice.update({ ...SILENCE, ...raw, raw, active: true }, 1 / 30, true);
      assert.deepEqual(a.profile, b.profile);
    }
    const held = a.profile; a.update(SILENCE, 1, false); assert.deepEqual(a.profile, held);
  }
});
test('sound-seeded kits repeat across sessions while eight reservations remain distinct', () => {
  function kits(sessionSeed, soundSeed) {
    const deck = new StyleDeck(sessionSeed), voices = ENGINE_ROUTES.map(route => ({ route, art: {} }));
    for (const voice of voices) voice.pendingStyle = deck.next(voices, 'mix', soundSeed, voice.route.id, profile(0.4));
    return voices.map(voice => voice.pendingStyle);
  }
  const a = kits(1, 'SOUND-AAAA'), b = kits(999, 'SOUND-AAAA'), c = kits(1, 'SOUND-BBBB');
  assert.deepEqual(a, b); assert.notDeepEqual(a, c);
  assert.equal(new Set(a.map(style => style.pen.id)).size, 8);
  assert.equal(new Set(a.map(style => style.palette.id)).size, 8);
});
test('golden lanes interleave on the whole sheet and renderer hooks restore after use', () => {
  for (const [width, height] of [[1400, 1000], [1000, 1400]]) {
    const points = ENGINE_ROUTES.flatMap((route, lane) => Array.from({ length: 8 }, (_, i) => goldenLanePoint(width, height, i, 8, lane)));
    assert.equal(new Set(points.map(p => `${p.x},${p.y}`)).size, 64);
    assert.ok(points.every(p => p.x > 0 && p.x < width && p.y > 0 && p.y < height));
    assert.ok(Math.abs(points[8].a - points[0].a - GOLDEN_ANGLE) < 1e-9);
  }
  const A = { W: 1400, H: 1000, goldenCanvasPoint() { return { x: 1, y: 1 }; } }, original = A.goldenCanvasPoint;
  const restore = interlockRenderer(A, settings('field', 0.5));
  assert.notEqual(A.goldenCanvasPoint, original); restore(); assert.equal(A.goldenCanvasPoint, original);
});
test('centroid cap is labelled as a lower bound', () => {
  assert.equal(centroidReading(1), '≥ 10,000 Hz centroid');
  assert.equal(centroidReading(0.42), '4,200 Hz centroid');
});
test('300 DPI PNG metadata preserves image data and replaces an existing pHYs', async () => {
  const source = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBZkAAAAASUVORK5CYII=', 'base64')]);
  const first = Buffer.from(await (await pngWithDpi(source)).arrayBuffer());
  const again = Buffer.from(await (await pngWithDpi(new Blob([first]))).arrayBuffer());
  assert.deepEqual(first, again);
  const index = first.indexOf('pHYs');
  assert.equal(first.readUInt32BE(index + 4), 11811); assert.equal(first.readUInt32BE(index + 8), 11811);
  assert.equal(first[index + 12], 1);
  const old = Buffer.from(await source.arrayBuffer());
  const payload = buffer => { const i = buffer.indexOf('IDAT'); return buffer.subarray(i, i + 4 + buffer.readUInt32BE(i - 4)); };
  assert.deepEqual(payload(first), payload(old));
});

test('all native engines render finite interlocked geometry in both orientations', () => {
  const environment = { window: {} }; environment.globalThis = environment.window;
  vm.createContext(environment);
  for (const file of ['phi.js', 'random.js', 'palettes.js', 'marker.js', 'generator.js']) {
    vm.runInContext(readFileSync(new URL('../vendor/algoart/' + file, import.meta.url), 'utf8'), environment);
  }
  const A = environment.window.AlgoArt;
  vm.runInContext(readFileSync(new URL('../js/ink-palette.js', import.meta.url), 'utf8'), environment);
  const stack = [], context = { globalCompositeOperation: 'source-over',
    save() { stack.push({ strokeStyle: this.strokeStyle, globalCompositeOperation: this.globalCompositeOperation }); },
    restore() { Object.assign(this, stack.pop()); },
    scale() {}, transform() {}, translate() {}, rotate() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, bezierCurveTo() {}, stroke() {}, setLineDash() {} };
  const canvas = { getContext: () => context };
  const styles = new StyleDeck(41), voices = ENGINE_ROUTES.map(route => ({ route, art: {} }));
  for (const voice of voices) voice.pendingStyle = styles.next(voices, 'mix', 'NATIVE-FIXTURE', voice.route.id, profile(0.5));
  function render(route, orientation, p, seed = 'NATIVE-FIXTURE') {
    const style = voices.find(voice => voice.route.id === route.id).pendingStyle;
    const s = ensembleSettings(route, seed, orientation, 'marker', 30, style, p);
    A.rendererVersion = 7; A.svgRecorder = { precise: true, paths: [], paperMarks: [] };
    renderComposition(A, canvas, s);
    return A.svgRecorder.paths;
  }
  for (const orientation of ['landscape', 'portrait']) for (const route of ENGINE_ROUTES) {
    for (const amount of [0.1, 0.9]) {
      const paths = render(route, orientation, profile(amount));
      assert.ok(paths.length > 0, route.id + ' has native marks');
      assert.ok(paths.every(path => !/NaN|Infinity|undefined/.test(path.d) && Number.isFinite(path.width)), route.id + ' remains finite');
    }
  }
  const geometric = ENGINE_ROUTES.find(route => route.id === 'geometric');
  const dark = render(geometric, 'landscape', { ...profile(0.5), centroid: 0 });
  const bright = render(geometric, 'landscape', { ...profile(0.5), centroid: 1 });
  assert.ok(dark.filter(path => path.d.includes(' C ')).length > bright.filter(path => path.d.includes(' C ')).length,
    'Brightness changes actual native curve marks with the sound seed held fixed');
});
