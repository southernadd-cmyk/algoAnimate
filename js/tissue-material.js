import { captureSheet } from './export.js';

// The costly three-buffer ALGO/ART material process never runs on the animation
// thread. Keep one request in flight and discard obsolete frames on completion.
// All bitmap frames are made from progressing, sound-driven vector geometry;
// they are not a filter applied to finished marker pictures.
export class TissueMaterial {
  constructor(canvas, onError = () => {}) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: false });
    this.onError = onError;
    this.epoch = 0;
    this.counter = 0;
    this.pending = false;
    this.frame = null;
    this.held = false;
    this.lastRequest = 0;
    this.exports = new Map();
    this.identity = null;
    this.sheetSize = null;
    this.worker = typeof Worker === 'undefined' ? null
      : new Worker(new URL('./tissue-worker.js', import.meta.url));
    if (!this.worker) onError(new Error('Tissue & Graphite needs browser worker support.'));
    else {
      this.worker.onmessage = ({ data }) => this.receive(data);
      this.worker.onerror = () => {
        this.pending = false;
        this.onError(new Error('The Tissue & Graphite renderer stopped.'));
      };
    }
  }
  reset() {
    this.epoch++;
    this.pending = false; this.held = false; this.lastRequest = 0;
    this.frame?.close(); this.frame = null;
    this.identity = null; this.sheetSize = null;
    // A worker already rendering may still send an old epoch; discard it.
  }
  receive({ id, epoch, bitmap, error }) {
    if (this.exports.has(id)) {
      const { resolve, reject } = this.exports.get(id);
      this.exports.delete(id);
      if (error) reject(new Error(error));
      else resolve(bitmap);
      return;
    }
    if (epoch !== this.epoch) { bitmap?.close(); return; }
    this.pending = false;
    if (this.held) { bitmap?.close(); return; }
    if (error) { this.onError(new Error(error)); return; }
    this.frame?.close();
    this.frame = bitmap;
  }
  // A single V6 render applies one seed and pigment kit to the WHOLE sheet.
  // Freeze that identity for a sheet's lifetime: another voice refreshing must
  // not repaint finished marks with a different seed or pigment palette.
  // We collect swatches round-robin so later voices are represented too.
  identityFor(artwork) {
    if (this.identity) return this.identity;
    const palettes = artwork.voices.map(voice => {
      const scene = voice.art.activeLayer?.scene || voice.art.current;
      return scene?.style?.colors || [];
    });
    const colours = [];
    for (let index = 0; colours.length < 12 && index < 12; index++) {
      let found = false;
      for (const palette of palettes) {
        if (palette[index] === undefined) continue;
        found = true;
        if (!colours.includes(palette[index])) colours.push(palette[index]);
        if (colours.length >= 12) break;
      }
      if (!found) break;
    }
    this.identity = {
      seed: artwork.drawnSeed || 'SOUND-READY',
      palette: colours.length ? colours : ['#748e83', '#bc803f', '#626f61']
    };
    return this.identity;
  }
  seed(artwork) { return this.identityFor(artwork).seed; }
  palette(artwork) { return this.identityFor(artwork).palette; }
  present(sheet) {
    this.context.save();
    this.context.globalCompositeOperation = 'source-over';
    this.context.globalAlpha = 1;
    this.context.fillStyle = '#f5f0e6';
    this.context.fillRect(0, 0, sheet.width, sheet.height);
    if (this.frame) this.context.drawImage(this.frame, 0, 0, sheet.width, sheet.height);
    this.context.restore();
  }
  paint(sheet, seed, palette, now = performance.now()) {
    // Present the last completed tissue frame while rendering the next one.
    this.present(sheet);
    if (!this.worker || this.pending || now - this.lastRequest < 110) return;
    // No visible source geometry means real blank paper, not a fully painted
    // composition shown ahead of its audio-controlled drawing schedule.
    if (!sheet.paths.length) { this.frame?.close(); this.frame = null; return; }
    this.pending = true; this.lastRequest = now;
    this.worker.postMessage({
      id: ++this.counter, epoch: this.epoch, sheet, seed, palette, quality: 0.39
    });
  }
  live(artwork, gentle, now = performance.now()) {
    const paper = artwork.paperScene;
    if (!paper) return;
    const size = paper.width + 'x' + paper.height;
    if (this.sheetSize && this.sheetSize !== size) this.reset();
    this.sheetSize = size;
    // Pausing sound freezes the last painted frame, not a future material
    // buffer which happened to finish after the pen clock stopped.
    this.held = !artwork.flowing;
    if (this.held) { this.present(paper); return; }
    // Path-window extraction can be expensive for eight simultaneous voices.
    // Do it only when the material worker can accept the next frame, rather
    // than needlessly reconstructing every vector at the 30 FPS UI cadence.
    if (!this.worker || this.pending || now - this.lastRequest < 110) {
      this.present(paper);
      return;
    }
    const sheet = captureSheet(artwork, gentle);
    this.paint(sheet, this.seed(artwork), this.palette(artwork), now);
  }
  renderOnce(sheet, seed, palette, quality = 2.5) {
    if (!this.worker) return Promise.reject(new Error('Material worker is unavailable.'));
    const id = ++this.counter, epoch = this.epoch;
    return new Promise((resolve, reject) => {
      this.exports.set(id, { resolve, reject });
      this.worker.postMessage({ id, epoch, sheet, seed, palette, quality });
    });
  }
  dispose() {
    this.reset(); this.worker?.terminate();
    for (const item of this.exports.values()) item.reject(new Error('Material renderer closed.'));
    this.exports.clear();
  }
}
