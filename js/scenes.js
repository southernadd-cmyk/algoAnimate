import { clamp } from './features.js';
import { markerGeometry, strokeSchedule, strokeWindow, inkWindow } from './ink.js';

export const DEFAULT_SETTINGS = Object.freeze({
  seed: 'SOUND-READY', mode: 'spiral', orientation: 'landscape',
  elements: 32, density: 48, complexity: 60, negativeSpace: 44,
  phiStrength: 90, recursion: 4, spiralInfluence: 75, goldenAngle: 100, nesting: 48,
  pen: 'felt', thickness: 3.4, wobble: 29, overdraw: 2, opacity: 78,
  pressure: 34, dryness: 15, curveBias: 80, shapeAmount: 64, overlap: 55, rotation: 78,
  lines: true, circles: true, rectangles: true, polygons: true, arcs: true,
  palette: 'marker', colourCount: 5, saturation: 83, brightness: 53,
  paper: '#f4f0e6', grain: 14
});

export class SceneBuilder {
  constructor() {
    this.id = 0;
    this.pending = new Map();
    if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./scene-worker.js', import.meta.url));
        this.worker.onmessage = ({ data }) => {
          const request = this.pending.get(data.id);
          if (!request) return;
          this.pending.delete(data.id);
          clearTimeout(request.timer);
          if (data.error) request.reject(new Error(data.error));
          else request.resolve(data.scene);
        };
        this.worker.onerror = () => this.failWorker();
      } catch { this.worker = null; }
    }
  }
  failWorker() {
    this.worker?.terminate(); this.worker = null;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      try { request.resolve(this.buildLocally(request.settings)); } catch (error) { request.reject(error); }
    }
    this.pending.clear();
  }
  buildLocally(settings) {
    const A = window.AlgoArt, canvas = document.createElement('canvas');
    A.rendererVersion = 7;
    A.svgRecorder = { precise: true, paths: [], paperMarks: [] };
    try {
      A.render(canvas, settings, 0.5);
      return { ...A.svgRecorder, seed: settings.seed, mode: settings.mode, width: A.W, height: A.H, paper: settings.paper };
    } finally { A.svgRecorder = null; }
  }
  build(settings) {
    if (!this.worker) return Promise.resolve().then(() => this.buildLocally(settings));
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.failWorker(), 15000);
      this.pending.set(id, { resolve, reject, timer, settings });
      this.worker.postMessage({ id, settings });
    });
  }
}

export function pathBounds(d) {
  const numbers = d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) || [0, 0];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    minX = Math.min(minX, numbers[i]); maxX = Math.max(maxX, numbers[i]);
    minY = Math.min(minY, numbers[i + 1]); maxY = Math.max(maxY, numbers[i + 1]);
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, extent: Math.hypot(maxX - minX, maxY - minY) };
}

export class AnimatedArtwork {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: false });
    this.current = null;
    this.layers = [];
    this.queued = null;
    this.queuedSeconds = 0;
    this.flowing = false;
    this.speed = 1;
    this.turns = 0;
    this.stats = { progress: 0, penTips: 0, visiblePaths: 0, inkLength: 0 };
    this.sceneCount = 0;
  }
  get activeLayer() { return this.layers.at(-1); }
  get drawnSeed() { return this.activeLayer?.scene.seed || this.current?.seed; }
  get drawnMode() { return this.activeLayer?.scene.mode || this.current?.mode; }
  needsScene(cycle, gentle = false) {
    if (this.queued || !this.activeLayer) return false;
    const remainingSeconds = (1 - this.activeLayer.age) * cycle * (gentle ? 1.6 : 1) / this.speed;
    return remainingSeconds <= 0.2;
  }
  discardQueued() {
    this.queued = null; this.queuedSeconds = 0;
    if (this.activeLayer) this.current = this.activeLayer.scene;
  }
  setScene(scene, immediate = false, startNow = false) {
    const changedSize = this.canvas.width !== scene.width || this.canvas.height !== scene.height;
    if (changedSize) { this.canvas.width = scene.width; this.canvas.height = scene.height; }
    const paths = scene.paths.map(entry => ({
      ...entry, path: new Path2D(entry.d), geometry: markerGeometry(entry.d), ...pathBounds(entry.d)
    }));
    this.current = { ...scene, paths, schedule: strokeSchedule(paths) };
    this.queuedSeconds = 0;
    if (immediate || changedSize || !this.layers.length) {
      this.layers = []; this.queued = null;
    } else if (startNow && this.flowing) {
      this.layers.push(this.layer(this.current));
      this.layers = this.layers.slice(-3); this.queued = null; this.turns++;
    } else this.queued = this.current;
    this.sceneCount++;
  }
  layer(scene, age = 0, preview = false) {
    return { scene, age, preview, pressure: new Array(scene.paths.length).fill(null) };
  }
  beginCycle(scene, age = 0) {
    this.queued = null; this.queuedSeconds = 0;
    this.layers.push(this.layer(scene, age));
    this.layers = this.layers.slice(-3); this.turns++;
  }
  draw(features, dt, response = 0.6, gentle = false, cycle = 4, flowing = features.active, { paper = true, opacity = 1 } = {}) {
    if (!this.current) return;
    this.flowing = flowing;
    const memory = gentle ? 0.8 : 0.7;
    if (flowing) {
      if (!this.layers.length) {
        // Clear the ready-state drawing along its strokes while the first
        // live drawing begins, rather than making it disappear in one frame.
        this.layers = [this.layer(this.current, 0, true), this.layer(this.current)];
        this.turns++;
      }
      const targetSpeed = 1 + response * (features.level * 0.55 + features.mid * 0.2 + features.flux * 0.35);
      this.speed += (targetSpeed - this.speed) * (1 - Math.exp(-dt / 0.2));
      const advance = dt * this.speed / Math.max(0.5, cycle * (gentle ? 1.6 : 1));
      for (const layer of this.layers) layer.age += advance;
      if (this.queued) this.queuedSeconds += dt;
      while (this.activeLayer.age >= 1) {
        const next = this.queued || this.current, overflow = this.activeLayer.age - 1;
        this.beginCycle(next, overflow);
      }
      // A slow worker or a settings change must not sit behind a full old
      // cycle. Existing strokes finish on their own ink layer during handoff.
      if (this.queued && this.queuedSeconds >= 0.2) this.beginCycle(this.queued);
      this.layers = this.layers.filter(layer => layer.age < (layer.preview ? 1 / 1.6 : 1 + memory));
    }
    const ctx = this.context, scene = this.activeLayer?.scene || this.current;
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    if (paper) {
      ctx.fillStyle = scene.paper; ctx.fillRect(0, 0, scene.width, scene.height);
      ctx.globalAlpha = 0.035;
      for (const mark of scene.paperMarks) {
        ctx.fillStyle = mark.colour; ctx.fillRect(mark.x, mark.y, mark.w, mark.h);
      }
    }
    ctx.globalAlpha = 1;
    this.stats = { progress: this.activeLayer?.age || 0, penTips: 0, visiblePaths: 0, inkLength: 0 };
    if (this.layers.length) for (const layer of this.layers) this.drawLayer(layer, features, response, gentle, memory, false, opacity);
    else this.drawLayer(this.layer(this.current, 0, true), features, 0, gentle, memory, true, opacity);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  drawLayer(layer, features, response, gentle, memory, still = false, opacity = 1) {
    const ctx = this.context, scene = layer.scene;
    for (let i = 0; i < scene.paths.length; i++) {
      const entry = scene.paths[i], timing = scene.schedule[i];
      const { from, to } = still ? { from: 0, to: 1 } : layer.preview
        ? { from: clamp((layer.age * 1.6 - timing.start) / timing.duration), to: 1 }
        : inkWindow(layer.age, timing, memory);
      if (to <= from || !entry.geometry.length) continue;
      if (layer.pressure[i] === null) {
        const large = clamp(entry.extent / 450), strength = response * (gentle ? 0.4 : 1);
        // Pressure is latched when this stroke starts: marks already on the
        // paper stay in place while the sound controls the next pen stroke.
        layer.pressure[i] = layer.preview ? 1 : 1 + strength * (features.level * 0.2
          + features.bass * large * 0.24 + features.treble * (1 - large) * 0.12);
      }
      ctx.strokeStyle = entry.stroke;
      ctx.lineWidth = entry.width * layer.pressure[i];
      ctx.globalAlpha = clamp(entry.opacity) * opacity;
      ctx.lineCap = entry.lineCap || 'round'; ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = entry.blend || 'source-over';
      ctx.setLineDash(entry.dash || []);
      ctx.lineDashOffset = (entry.dashOffset || 0) + from * entry.geometry.length;
      const transform = entry.transform?.match(/^matrix\(([^)]+)\)$/)?.[1].trim().split(/[ ,]+/).map(Number);
      if (transform?.length === 6 && transform.every(Number.isFinite)) { ctx.save(); ctx.transform(...transform); }
      if (from === 0 && to === 1) ctx.stroke(entry.path);
      else {
        ctx.beginPath();
        for (const [type, ...points] of strokeWindow(entry.geometry, from, to)) {
          if (type === 'M') ctx.moveTo(...points);
          else if (type === 'C') ctx.bezierCurveTo(...points);
          else ctx.lineTo(...points);
        }
        ctx.stroke();
      }
      if (transform?.length === 6 && transform.every(Number.isFinite)) ctx.restore();
      this.stats.visiblePaths++;
      this.stats.inkLength += (to - from) * entry.geometry.length;
      if (!layer.preview && to > 0 && to < 1) this.stats.penTips++;
    }
  }
}
