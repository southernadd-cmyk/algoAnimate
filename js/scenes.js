import { hash, clamp } from './features.js';

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
      return { ...A.svgRecorder, seed: settings.seed, width: A.W, height: A.H, paper: settings.paper };
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
    this.previous = null;
    this.fade = 1;
    this.phase = 0;
    this.sceneCount = 0;
  }
  setScene(scene, immediate = false) {
    const changedSize = this.canvas.width !== scene.width || this.canvas.height !== scene.height;
    if (changedSize) { this.canvas.width = scene.width; this.canvas.height = scene.height; }
    const paths = scene.paths.map((entry, index) => ({
      ...entry, path: new Path2D(entry.d), ...pathBounds(entry.d),
      phase: hash(scene.seed + '|' + index) / 4294967296 * Math.PI * 2
    }));
    this.previous = immediate || changedSize ? null : this.current;
    this.current = { ...scene, paths };
    this.fade = this.previous ? 0 : 1;
    this.sceneCount++;
  }
  draw(features, dt, motion = 0.6, gentle = false) {
    if (!this.current) return;
    const ctx = this.context, scene = this.current;
    if (features.active) this.phase += dt * (0.4 + features.level * 1.7);
    this.fade = Math.min(1, this.fade + dt / (gentle ? 1.8 : 0.85));
    const blend = this.fade * this.fade * (3 - 2 * this.fade);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.fillStyle = scene.paper; ctx.fillRect(0, 0, scene.width, scene.height);
    ctx.globalAlpha = 0.035;
    for (const mark of scene.paperMarks) {
      ctx.fillStyle = mark.colour; ctx.fillRect(mark.x, mark.y, mark.w, mark.h);
    }
    ctx.globalAlpha = 1;
    if (this.previous && blend < 1) this.drawScene(this.previous, features, 1 - blend, motion, gentle);
    this.drawScene(scene, features, blend, motion, gentle);
    if (this.fade >= 1) this.previous = null;
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  drawScene(scene, features, alpha, motion, gentle) {
    const ctx = this.context, strength = motion * (gentle ? 0.22 : 1);
    for (let i = 0; i < scene.paths.length; i++) {
      const entry = scene.paths[i];
      const large = clamp(entry.extent / 450);
      const energy = features.bass * large + features.treble * (1 - large) + features.mid * 0.35;
      const angle = this.phase * (0.55 + (i % 5) * 0.13) + entry.phase;
      const x = Math.sin(angle) * (4 + 13 * large) * energy * strength;
      const y = Math.cos(angle * 0.618) * (3 + 11 * large) * energy * strength;
      const rotation = Math.sin(angle * 0.618) * (features.mid + features.treble * 0.5) * strength * 0.04;
      const scale = 1 + features.bass * strength * large * 0.055;
      ctx.save();
      ctx.translate(entry.x + x, entry.y + y); ctx.rotate(rotation); ctx.scale(scale, scale);
      ctx.translate(-entry.x, -entry.y);
      ctx.strokeStyle = entry.stroke;
      ctx.lineWidth = entry.width * (1 + features.level * strength * 0.12);
      ctx.globalAlpha = clamp(entry.opacity * alpha);
      ctx.lineCap = entry.lineCap || 'round'; ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = entry.blend || 'source-over';
      ctx.setLineDash(entry.dash || []); ctx.lineDashOffset = entry.dashOffset || 0;
      ctx.stroke(entry.path); ctx.restore();
    }
  }
}
