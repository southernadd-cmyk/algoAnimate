import test from 'node:test';
import assert from 'node:assert/strict';
import { renderComposition } from '../js/composition.js';
import { prepareSceneGeometry, inkWindow } from '../js/ink.js';
import { FrameClock } from '../js/frame-clock.js';

test('hierarchy bounds supporting rectangles, tags native motifs and restores renderer hooks', () => {
  const A = { W: 1400, H: 1000, svgRecorder: { paths: [] },
    stroke() { this.svgRecorder.paths.push({ d: 'M 0 0 L 100 100' }); },
    rect(ctx, centre, width, height, rotation, colour, pen) { this.stroke(); this.pens.push(pen); },
    pens: [], render(canvas, settings) {
      for (let i = 0; i < 8; i++) this.rect(null, {}, 200, 150, 0, '#000', { opacity: 80, thickness: 4 });
      this.stroke();
    } };
  const rect = A.rect, stroke = A.stroke;
  renderComposition(A, {}, { markHierarchy: true, rectangleBudget: 3, seed: 'fixture' });
  assert.equal(A.svgRecorder.paths.filter(path => path.role === 'structure').length, 3);
  assert.equal(A.svgRecorder.paths.filter(path => path.role === 'gesture').length, 1);
  assert.equal(new Set(A.svgRecorder.paths.map(path => path.motif)).size, 4);
  assert.ok(A.pens.every(pen => pen.opacity < 80 && pen.thickness < 4));
  assert.equal(A.rect, rect); assert.equal(A.stroke, stroke);
  A.render = () => { throw new Error('bad render'); };
  assert.throws(() => renderComposition(A, {}, { markHierarchy: true }), /bad render/);
  assert.equal(A.rect, rect); assert.equal(A.stroke, stroke);
});

test('Automatic Marks retries a completely empty void-masked composition without changing its seed', () => {
  const attempts = [];
  const A = { W: 1400, H: 1000, svgRecorder: { paths: [], paperMarks: [] },
    stroke() { this.svgRecorder.paths.push({ d: 'M 0 0 L 40 20' }); },
    rect() {},
    render(canvas, settings) {
      attempts.push({ seed: settings.seed, space: settings.negativeSpace,
        interlock: settings.interlock, recovery: Boolean(settings.emptyScribbleRecovery) });
      this.svgRecorder.paperMarks.push({ x: 1, y: 1, colour: '#000' });
      if (settings.negativeSpace === 0) this.stroke();
      return settings.seed;
    } };
  const stroke = A.stroke, rect = A.rect, interlock = { lane: 6, lanes: 8, phase: 0.42 };
  const settings = { markHierarchy: true, seed: 'SOUND-123', mode: 'scribble',
    negativeSpace: 85, interlock };
  assert.equal(renderComposition(A, {}, settings), settings.seed);
  assert.deepEqual(attempts.map(attempt => attempt.space), [85, 0]);
  assert.ok(attempts.every(attempt => attempt.seed === settings.seed));
  assert.ok(attempts.every(attempt => attempt.interlock === interlock));
  assert.deepEqual(attempts.map(attempt => attempt.recovery), [false, true]);
  assert.equal(A.svgRecorder.paths.length, 1);
  assert.equal(A.svgRecorder.paperMarks.length, 1, 'discard retry grain from the unsuccessful pass');
  assert.equal(A.stroke, stroke); assert.equal(A.rect, rect);
  assert.equal(settings.negativeSpace, 85, 'do not mutate caller settings');
});

test('Automatic Marks does not retry healthy compositions or conceal failures in other engines', () => {
  let renders = 0;
  const A = { W: 1400, H: 1000, svgRecorder: { paths: [], paperMarks: [] },
    stroke() { this.svgRecorder.paths.push({ d: 'M 0 0 L 10 10' }); },
    rect() {},
    render(canvas, settings) { renders++; if (settings.seed === 'healthy') this.stroke(); } };
  renderComposition(A, {}, { markHierarchy: true, mode: 'scribble', seed: 'healthy', negativeSpace: 90 });
  assert.equal(renders, 1);
  A.svgRecorder.paths.length = 0;
  renderComposition(A, {}, { markHierarchy: true, mode: 'field', seed: 'empty', negativeSpace: 90 });
  assert.equal(renders, 2, 'other engines still report their actual empty output');
});

test('full-page frames are occasional and bypassed renders stay unchanged', () => {
  let drawn = 0;
  const A = { W: 1400, H: 1000, rect() { drawn++; }, stroke() {},
    render() { this.rect(null, {}, 1300, 900, 0, '#000', { opacity: 80, thickness: 4 }); } };
  for (let i = 0; i < 100; i++) renderComposition(A, {}, { markHierarchy: true, seed: 'frame-' + i });
  assert.ok(drawn > 5 && drawn < 40, 'Borders remain possible without dominating every composition');
  drawn = 0; renderComposition(A, {}, {}); assert.equal(drawn, 1);
});

test('a leading gesture completes and holds before receding; supporting ink keeps its sparse window', () => {
  const scene = prepareSceneGeometry({ markHierarchy: true, paths: [
    { d: 'M 0 0 L 1200 0 L 1200 900', width: 3, opacity: 0.6, role: 'frame', motif: 0 },
    { d: 'M 0 0 C 100 200 300 200 400 0', width: 3, opacity: 0.6, role: 'gesture', motif: 1 },
    { d: 'M 0 1 C 100 201 300 201 400 1', width: 2, opacity: 0.4, role: 'gesture', motif: 1 },
    { d: 'M 0 0 L 40 10', width: 3, opacity: 0.6, role: 'gesture', motif: 2 }
  ] });
  assert.deepEqual(scene.paths.map(path => Boolean(path.accent)), [false, true, true, false]);
  assert.equal(scene.paths[0].opacity, 0.6, 'A frame cannot become the leading accent');
  assert.ok(scene.paths[1].opacity > 0.6);
  const timing = scene.schedule[1], completed = timing.start + timing.duration;
  assert.deepEqual(inkWindow(completed + 0.06, timing, 0.12), { from: 0, to: 1 });
  assert.ok(inkWindow(completed + 0.2, timing, 0.12).from > 0);
  assert.ok(inkWindow(completed, scene.schedule[0], 0.12).from > 0);
});

test('recording frames continue when animation callbacks stop, then clean up on stop', () => {
  const workers = [], draws = [], messages = [];
  const environment = { performance: { now: () => 123 },
    Worker: class { constructor() { workers.push(this); } postMessage(message) { messages.push(message); } terminate() { this.terminated = true; } },
    requestAnimationFrame: () => 7, cancelAnimationFrame() {}, clearInterval() {},
    setInterval: () => { throw new Error('A healthy worker does not need a main-thread timer'); } };
  const clock = new FrameClock(now => draws.push(now), environment);
  clock.start(); clock.setRecording(true); workers[0].onmessage(); workers[0].onmessage();
  assert.deepEqual(draws, [123, 123]); assert.equal(clock.mode, 'worker');
  clock.setRecording(false); workers[0].onmessage(); assert.equal(draws.length, 2);
  assert.deepEqual(messages, ['start', 'stop']); clock.stop(); assert.ok(workers[0].terminated);
});

test('an unavailable recording worker uses a timer and releases it after the take', () => {
  const timers = [], cleared = [], draws = [];
  const environment = { performance: { now: () => 23 },
    setInterval: callback => { timers.push(callback); return 5; }, clearInterval: id => cleared.push(id) };
  const clock = new FrameClock(now => draws.push(now), environment);
  clock.setRecording(true); clock.setRecording(true); assert.equal(timers.length, 1);
  timers[0](); assert.deepEqual(draws, [23]); assert.equal(clock.mode, 'timer');
  clock.setRecording(false); assert.deepEqual(cleared, [5]);
});
