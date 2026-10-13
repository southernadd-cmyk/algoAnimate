import test from 'node:test';
import assert from 'node:assert/strict';
import { TissueMaterial } from '../js/tissue-material.js';

class MockWorker {
  constructor() { this.messages = []; this.closed = false; }
  postMessage(message) { this.messages.push(message); }
  terminate() { this.closed = true; }
}
const makeCanvas = () => {
  const ops = [];
  const context = {
    save() {}, restore() {}, fillRect(...args) { ops.push(['paper', ...args]); },
    drawImage(...args) { ops.push(['material', ...args]); }
  };
  return { width: 1400, height: 1000, getContext: () => context, ops };
};
const paper = { width: 1400, height: 1000, paths: [] };
const stroke = { ...paper, paths: [{ d: 'M 12 16 L 200 40', stroke: '#abc123', width: 4 }] };

test('Tissue port paints cream, never queues a completed composition before its first stroke', () => {
  const before = globalThis.Worker;
  globalThis.Worker = MockWorker;
  try {
    const canvas = makeCanvas(), painter = new TissueMaterial(canvas);
    painter.paint(paper, 'SEED', ['#abc123'], 500);
    assert.equal(painter.worker.messages.length, 0);
    assert.equal(canvas.ops[0][0], 'paper');
    painter.paint(stroke, 'SEED', ['#abc123'], 1000);
    const message = painter.worker.messages[0];
    assert.deepEqual(message.sheet.paths, stroke.paths);
    assert.equal(message.quality, .39);
    assert.deepEqual(message.palette, ['#abc123']);
    assert.equal(message.seed, 'SEED');
    assert.equal(painter.pending, true);
    const bitmap = { close() { this.closed = true; } };
    painter.receive({ id: message.id, epoch: message.epoch, bitmap });
    painter.paint(stroke, 'SEED', ['#abc123'], 1010);
    assert.ok(canvas.ops.some(([op]) => op === 'material'));
    painter.reset();
    assert.equal(bitmap.closed, true);
    assert.equal(painter.frame, null);
    painter.dispose();
    assert.equal(painter.worker.closed, true);
  } finally { globalThis.Worker = before; }
});

test('A cleared or replaced sheet discards late bitmap results', () => {
  const before = globalThis.Worker;
  globalThis.Worker = MockWorker;
  try {
    const painter = new TissueMaterial(makeCanvas());
    painter.paint(stroke, 'SEED', [], 1000);
    const first = painter.worker.messages[0];
    painter.reset();
    const bitmap = { closed: false, close() { this.closed = true; } };
    painter.receive({ id: first.id, epoch: first.epoch, bitmap });
    assert.equal(bitmap.closed, true);
    assert.equal(painter.frame, null);
    painter.dispose();
  } finally { globalThis.Worker = before; }
});


test('Mobile uses cheaper frames, retains a stable texture seed and reports worker throughput', () => {
  const before = globalThis.Worker;
  globalThis.Worker = MockWorker;
  try {
    const painter = new TissueMaterial(makeCanvas(), () => {}, { mobile: true });
    assert.equal(painter.quality, 0.27);
    assert.equal(painter.currentSeed('MIX-FIRST'), 'MIX-FIRST');
    assert.equal(painter.currentSeed('MIX-NEXT'), 'MIX-FIRST');
    painter.paint(stroke, 'MIX-FIRST', [], 1000);
    const request = painter.worker.messages[0];
    assert.equal(request.quality, 0.27);
    assert.equal(request.sheet.paperMarks, undefined);
    const first = { closed: false, close() { this.closed = true; } };
    painter.receive({ id: request.id, epoch: request.epoch, bitmap: first, renderMs: 120 });
    assert.equal(painter.stats.mobile, true);
    assert.ok(painter.stats.workerMs >= 100);
    assert.equal(painter.quality, 0.27);
    painter.reset();
    assert.equal(first.closed, true);
    assert.equal(painter.currentSeed('MIX-NEW'), 'MIX-NEW');
    painter.dispose();
  } finally { globalThis.Worker = before; }
});

test('Mobile interpolates between painted frames but avoids unchanged repaints', () => {
  const before = globalThis.Worker;
  globalThis.Worker = MockWorker;
  try {
    const canvas = makeCanvas();
    const painter = new TissueMaterial(canvas, () => {}, { mobile: true });
    painter.paint(stroke, 'S', [], 1000);
    const one = painter.worker.messages[0];
    const first = { closed: false, close() { this.closed = true; } };
    painter.receive({ id: one.id, epoch: one.epoch, bitmap: first, renderMs: 40 });
    painter.present(stroke);
    canvas.ops.length = 0;
    painter.present(stroke);
    assert.equal(canvas.ops.length, 0, 'The unchanged screen is not repainted');
    painter.paint(stroke, 'S', [], 1100);
    const two = painter.worker.messages[1];
    const second = { closed: false, close() { this.closed = true; } };
    painter.receive({ id: two.id, epoch: two.epoch, bitmap: second, renderMs: 40 });
    canvas.ops.length = 0;
    painter.present(stroke, performance.now() + 40);
    assert.equal(canvas.ops.filter(([type]) => type === 'material').length, 2,
      'Two bitmaps are crossfaded rather than jumping immediately');
    painter.present(stroke, performance.now() + 100);
    assert.equal(first.closed, true, 'The old material bitmap is promptly freed');
    painter.dispose();
    assert.equal(second.closed, true);
  } finally { globalThis.Worker = before; }
});
