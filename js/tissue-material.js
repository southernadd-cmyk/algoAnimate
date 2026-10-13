import { captureSheet } from './export.js';

// The source V6 material is never modified. A single worker owns the costly
// pigment/height buffers; newer requests never pile up behind an older frame.
// On mobile, render cheaper material frames and interpolate their presentation.
export class TissueMaterial {
  constructor(canvas, onError = () => {}, { mobile = false } = {}) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: false });
    this.onError = onError;
    this.mobile = mobile;
    this.epoch = 0;
    this.counter = 0;
    this.pending = false;
    this.frame = null;
    this.previousFrame = null;
    this.receivedAt = 0;
    this.held = false;
    this.lastRequest = 0;
    this.textureSeed = null;
    this.quality = mobile ? 0.27 : 0.39;
    this.minInterval = mobile ? 60 : 110;
    this.blendMs = mobile ? 85 : 0;
    this.workerMs = 0;
    this.roundTripMs = 0;
    this.fastFrames = 0;
    this.completedTimes = [];
    this.exports = new Map();
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
    this.textureSeed = null;
    this.frame?.close(); this.frame = null;
    this.previousFrame?.close(); this.previousFrame = null;
    this.completedTimes = []; this.fastFrames = 0; this.receivedAt = 0;
    // A worker already rendering may still send an old epoch; discard it.
  }
  currentSeed(seed) {
    // The eight voice seeds change independently. Changing the material RNG
    // every time one voice advances repaints every old tissue scrap and causes
    // a visible whole-sheet jump. Lock the paper texture to its first audible
    // composition until Clear, orientation change, or replay reset.
    if (!this.textureSeed && seed && seed !== 'SOUND-READY') this.textureSeed = seed;
    return this.textureSeed || seed || 'SOUND-READY';
  }
  receive({ id, epoch, bitmap, error, renderMs }) {
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
    const now = performance.now();
    this.roundTripMs = this.lastRequestAt ? now - this.lastRequestAt : 0;
    if (Number.isFinite(renderMs) && renderMs >= 0) {
      this.workerMs = this.workerMs ? this.workerMs * 0.75 + renderMs * 0.25 : renderMs;
      // Only increase work after sustained headroom; back off quickly when
      // the worker cannot keep up. Desktop keeps its existing render quality.
      if (this.mobile) {
        if (this.quality > 0.3 && this.workerMs > 95) {
          this.quality = 0.27;
          this.fastFrames = 0;
        } else if (this.quality < 0.3) {
          this.fastFrames = this.workerMs < 42 ? this.fastFrames + 1 : 0;
          if (this.fastFrames >= 24) {
            this.quality = 0.39;
            this.fastFrames = 0;
          }
        }
      }
    }
    this.completedTimes.push(now);
    while (this.completedTimes.length > 40 || now - this.completedTimes[0] > 2000) this.completedTimes.shift();
    this.previousFrame?.close();
    this.previousFrame = this.mobile ? this.frame : null;
    if (!this.mobile) this.frame?.close();
    this.frame = bitmap;
    this.receivedAt = now;
  }
  get stats() {
    const now = performance.now();
    const recent = this.completedTimes.filter(t => now - t <= 2000);
    const paintedFps = recent.length > 1
      ? Math.round(10 * (recent.length - 1) * 1000 / (recent.at(-1) - recent[0])) / 10 : 0;
    return {
      paintedFps: now - (recent.at(-1) || 0) > 2000 ? 0 : paintedFps,
      workerMs: Math.round(this.workerMs), roundTripMs: Math.round(this.roundTripMs),
      quality: this.quality, pending: this.pending, mobile: this.mobile,
      blending: this.blendMs > 0
    };
  }
  palette(artwork) {
    const colours = [];
    for (const voice of artwork.voices) {
      if (!artwork.enabled(voice)) continue;
      const scene = voice.art.activeLayer?.scene || voice.art.current;
      for (const color of scene?.style?.colors || []) {
        if (!colours.includes(color)) colours.push(color);
        if (colours.length >= 12) return colours;
      }
    }
    return colours.length ? colours : ['#748e83', '#bc803f', '#626f61'];
  }
  present(sheet, now = performance.now(), freeze = false) {
    this.context.save();
    this.context.globalCompositeOperation = 'source-over';
    this.context.globalAlpha = 1;
    this.context.fillStyle = '#f5f0e6';
    this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // Only the on-screen material is blended. The source geometry and score
    // stay exact, and a held/silent sheet is not animated independently.
    if (this.previousFrame && this.frame && this.blendMs && !freeze) {
      const fraction = Math.max(0, Math.min(1, (now - this.receivedAt) / this.blendMs));
      if (fraction < 1) {
        this.context.drawImage(this.previousFrame, 0, 0, this.canvas.width, this.canvas.height);
        this.context.globalAlpha = fraction;
      } else {
        this.previousFrame.close(); this.previousFrame = null;
      }
    }
    if (this.frame) this.context.drawImage(this.frame, 0, 0, this.canvas.width, this.canvas.height);
    this.context.restore();
  }
  paint(sheet, seed, palette, now = performance.now()) {
    this.present(sheet, now);
    if (!this.worker || this.pending || now - this.lastRequest < this.minInterval) return;
    if (!sheet.paths.length) {
      this.frame?.close(); this.frame = null;
      this.previousFrame?.close(); this.previousFrame = null;
      return;
    }
    this.pending = true; this.lastRequest = now; this.lastRequestAt = performance.now();
    this.worker.postMessage({
      id: ++this.counter, epoch: this.epoch,
      // Paper marks are not consumed by the material worker. Avoid copying
      // them, and the rest of the score, on every paint request.
      sheet: { width: sheet.width, height: sheet.height, paths: sheet.paths },
      seed, palette, quality: this.quality
    });
  }
  live(artwork, gentle, now = performance.now()) {
    const paper = artwork.paperScene;
    if (!paper) return;
    this.held = !artwork.flowing;
    if (this.held) { this.present(paper, now, true); return; }
    if (!this.worker || this.pending || now - this.lastRequest < this.minInterval) {
      this.present(paper, now);
      return;
    }
    const sheet = captureSheet(artwork, gentle);
    this.paint(sheet, this.currentSeed(artwork.drawnSeed), this.palette(artwork), now);
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
