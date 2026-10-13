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


test('V6 sheet identity stays fixed when independent voices change seed or palette', () => {
  const previousWorker = globalThis.Worker;
  globalThis.Worker = MockWorker;
  try {
    const painter = new TissueMaterial(makeCanvas());
    const voices = Array.from({ length: 8 }, (_, i) => ({
      art: {
        current: {
          style: { colors: ['#' + String(i + 1).repeat(6), '#aabbcc'] }
        }
      }
    }));
    const artwork = { voices, drawnSeed: 'FIRST-MIX' };
    const first = painter.identityFor(artwork);
    assert.equal(first.seed, 'FIRST-MIX');
    // All eight voices get a representative first pigment before a voice
    // contributes its second/third swatches.
    assert.deepEqual(first.palette.slice(0, 8),
      voices.map(voice => voice.art.current.style.colors[0]));
    artwork.drawnSeed = 'SECOND-MIX';
    voices[0].art.current.style.colors = ['#ffffff', '#000000'];
    assert.strictEqual(painter.identityFor(artwork), first);
    assert.equal(painter.seed(artwork), 'FIRST-MIX');
    assert.deepEqual(painter.palette(artwork), first.palette);
    painter.reset();
    assert.equal(painter.seed(artwork), 'SECOND-MIX');
    assert.equal(painter.palette(artwork)[0], '#ffffff');
    painter.dispose();
  } finally { globalThis.Worker = previousWorker; }
});
