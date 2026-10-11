import { SILENCE, clamp } from './features.js';
import { markerGeometry } from './ink.js';
import { layerStrokes } from './export.js';

export const SCORE_FORMAT = 'algoanimate-score';
export const MAX_SCORE_BYTES = 20 * 1024 * 1024;
const keys = ['level', 'bass', 'mid', 'treble', 'centroid', 'flux'];
const packed = (value, scale) => Math.round(clamp(value || 0) * scale);
export function packFeatures(features) {
  return [...keys.map(key => packed(features[key], 1023)),
    ...keys.map(key => packed(features.raw[key], 31)), packed(features.rms, 65535),
    +features.active, +features.beat, ...['bass', 'mid', 'treble'].map(key => packed(features.bandRms[key], 65535))];
}
export function unpackFeatures(packet) {
  return { ...SILENCE, ...Object.fromEntries(keys.map((key, i) => [key, packet[i] / 1023])),
    raw: Object.fromEntries(keys.map((key, i) => [key, packet[i + 6] / 31])),
    rms: packet[12] / 65535, active: Boolean(packet[13]), beat: Boolean(packet[14]),
    bandRms: Object.fromEntries(['bass', 'mid', 'treble'].map((key, i) => [key, packet[i + 15] / 65535])) };
}

// Geometry is stored once per composition; pressure once per ink layer. Frames
// only reference those records and their exact pen ages. Worker timing, random
// ink kits and muted layers are preserved, without storing audio or canvas pixels.
export class ScoreCapture {
  constructor(started, source = '') {
    this.started = started; this.bytes = 0;
    this.sceneIds = new WeakMap(); this.layerIds = new WeakMap(); this.paperIds = new WeakMap();
    this.data = { format: SCORE_FORMAT, version: 1, renderer: 7, source,
      featureKeys: keys, scenes: [], layers: [], papers: [], frames: [], duration: 0 };
  }
  sceneId(scene) {
    if (this.sceneIds.has(scene)) return this.sceneIds.get(scene);
    const id = this.data.scenes.length;
    const record = { seed: scene.seed, mode: scene.mode, inkMemory: scene.inkMemory ?? 0.7,
      schedule: scene.schedule, paths: scene.paths.map(({ d, stroke, width, opacity, lineCap,
        blend, transform, dash, dashOffset }) => ({ d, stroke, width, opacity, lineCap, blend, transform, dash, dashOffset })) };
    this.bytes += JSON.stringify(record).length;
    this.data.scenes.push(record); this.sceneIds.set(scene, id); return id;
  }
  layerId(layer) {
    let id = this.layerIds.get(layer);
    if (id === undefined) {
      id = this.data.layers.length;
      this.data.layers.push({ scene: this.sceneId(layer.scene), preview: Boolean(layer.preview),
        pressure: layer.pressure.slice() });
      this.bytes += layer.pressure.length * 20 + 40;
      this.layerIds.set(layer, id);
    } else {
      const saved = this.data.layers[id].pressure;
      layer.pressure.forEach((value, i) => { if (saved[i] === null && value !== null) saved[i] = value; });
    }
    return id;
  }
  capture(now, artwork, features, gentle) {
    if (!artwork.ready || !artwork.paperScene) return true;
    const time = Math.min(180000, Math.max(0, Math.round(now - this.started)));
    let paper = this.paperIds.get(artwork.paperScene);
    if (paper === undefined) {
      paper = this.data.papers.length;
      const { width, height, paper: colour, paperMarks } = artwork.paperScene;
      const record = { width, height, paper: colour, paperMarks };
      this.bytes += JSON.stringify(record).length;
      this.data.papers.push(record); this.paperIds.set(artwork.paperScene, paper);
    }
    const voices = artwork.voices.map(voice => [+artwork.enabled(voice), +voice.flowing, voice.art.current.inkMemory ?? 0.7,
      artwork.enabled(voice) ? voice.art.layers.map(layer => [this.layerId(layer), layer.age]) : []]);
    const frame = [time, packFeatures(features), paper, +gentle, voices];
    this.bytes += JSON.stringify(frame).length;
    this.data.frames.push(frame); this.data.duration = time;
    return time < 180000 && this.data.frames.length < 5500 && this.bytes < MAX_SCORE_BYTES * 0.8;
  }
  finish() { return this.data.frames.length ? this.data : null; }
}

const fail = () => { throw new Error('This is not a supported AlgoAnimate score.'); };
const number = (value, low = -1e6, high = 1e6) => { if (!Number.isFinite(value) || value < low || value > high) fail(); };
const colour = value => { if (typeof value !== 'string' || !/^(#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%+/-]+\))$/i.test(value)) fail(); };
const array = (value, max) => { if (!Array.isArray(value) || value.length > max) fail(); };
const ref = (value, records) => { if (!Number.isInteger(value) || value < 0 || value >= records.length) fail(); };
function validatePath(d) {
  if (typeof d !== 'string' || d.length > 100000) fail();
  const tokens = d.match(/[MLCZ]|-?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) || [];
  if (tokens[0] !== 'M' || tokens.join('') !== d.replace(/[\s,]+/g, '')) fail();
  for (let i = 0; i < tokens.length;) {
    const count = { M: 2, L: 2, C: 6, Z: 0 }[tokens[i++]];
    if (count === undefined || i + count > tokens.length) fail();
    for (let j = 0; j < count; j++) number(Number(tokens[i++]));
  }
}
export function parseScore(text) {
  if (typeof text !== 'string' || text.length > MAX_SCORE_BYTES) fail();
  const score = JSON.parse(text);
  if (score?.format !== SCORE_FORMAT || score.version !== 1 || score.renderer !== 7) fail();
  array(score.frames, 5500); array(score.scenes, 5000); array(score.layers, 10000); array(score.papers, 200);
  if (!score.frames.length || !score.papers.length) fail();
  number(score.duration, 0, 180000);
  let pathCount = 0;
  for (const scene of score.scenes) {
    number(scene.inkMemory, 0, 2); array(scene.paths, 10000); array(scene.schedule, 10000);
    if (scene.paths.length !== scene.schedule.length || (pathCount += scene.paths.length) > 100000) fail();
    scene.paths.forEach((path, i) => {
      validatePath(path.d);
      colour(path.stroke); number(path.width, 0, 100); number(path.opacity, 0, 1);
      if (path.lineCap && !['round', 'butt', 'square'].includes(path.lineCap)) fail();
      if (path.blend && !['source-over', 'multiply', 'screen', 'darken', 'lighten', 'overlay'].includes(path.blend)) fail();
      if (path.transform) {
        const matrix = path.transform.match(/^matrix\(([^)]+)\)$/)?.[1].trim().split(/[ ,]+/).map(Number);
        if (matrix?.length !== 6) fail(); matrix.forEach(value => number(value));
      }
      if (path.dash) { array(path.dash, 40); path.dash.forEach(value => number(value, 0, 10000)); }
      if (path.dashOffset !== undefined) number(path.dashOffset);
      const timing = scene.schedule[i]; number(timing.start, 0, 1); number(timing.duration, 1e-10, 1);
      if (timing.hold !== undefined) number(timing.hold, 0, 2);
    });
  }
  for (const paper of score.papers) {
    number(paper.width, 1, 2000); number(paper.height, 1, 2000); colour(paper.paper);
    array(paper.paperMarks, 50000);
    for (const mark of paper.paperMarks) { colour(mark.colour); for (const key of ['x', 'y', 'w', 'h']) number(mark[key]); }
  }
  for (const layer of score.layers) {
    ref(layer.scene, score.scenes); array(layer.pressure, 10000);
    if (layer.pressure.length !== score.scenes[layer.scene].paths.length) fail();
    layer.pressure.forEach(value => { if (value !== null) number(value, 0, 5); });
  }
  let previous = -1;
  for (const frame of score.frames) {
    array(frame, 5); if (frame.length !== 5) fail(); number(frame[0], 0, score.duration);
    if (frame[0] < previous) fail(); previous = frame[0];
    array(frame[1], 18); if (frame[1].length !== 18) fail(); frame[1].forEach(value => number(value, 0, 65535));
    ref(frame[2], score.papers); number(frame[3], 0, 1); array(frame[4], 8);
    if (frame[4].length !== 8) fail();
    for (const voice of frame[4]) {
      array(voice, 4);
      if (voice.length !== 4) fail(); number(voice[0], 0, 1); number(voice[1], 0, 1); number(voice[2], 0, 2); array(voice[3], 3);
      for (const layer of voice[3]) { array(layer, 2); if (layer.length !== 2) fail(); ref(layer[0], score.layers); number(layer[1], 0, 5); }
    }
  }
  Object.defineProperty(score, 'validated', { value: true });
  return score;
}

export class ScoreReplay {
  constructor(score) { this.score = score; this.time = 0; this.index = 0; this.paused = false; this.scenes = new Map(); }
  seek(time) {
    this.time = clamp(time, 0, this.score.duration);
    let low = 0, high = this.score.frames.length;
    while (low + 1 < high) { const middle = (low + high) >> 1;
      if (this.score.frames[middle][0] <= this.time) low = middle; else high = middle; }
    this.index = low;
  }
  advance(seconds) {
    if (this.paused) return;
    this.seek(this.time + seconds * 1000);
    if (this.time >= this.score.duration) this.paused = true;
  }
  get frame() { return this.score.frames[this.index]; }
  get features() { return unpackFeatures(this.frame[1]); }
  get engines() { return this.frame[4].map(voice => ({ enabled: Boolean(voice[0]), flowing: Boolean(voice[1]) })); }
  sheet() {
    const frame = this.frame, paper = this.score.papers[frame[2]];
    const active = new Set(frame[4].flatMap(voice => voice[3].map(([id]) => this.score.layers[id].scene)));
    // Keep arc tables only for the currently visible scenes, not the whole take.
    for (const id of this.scenes.keys()) if (!active.has(id)) this.scenes.delete(id);
    for (const id of active) if (!this.scenes.has(id)) {
      const scene = this.score.scenes[id];
      this.scenes.set(id, { ...scene, paths: scene.paths.map(path => ({ ...path, geometry: markerGeometry(path.d) })) });
    }
    return { ...paper, paths: frame[4].flatMap(voice => voice[3].flatMap(([id, age]) => {
      const layer = this.score.layers[id];
      return layerStrokes({ ...layer, age, scene: this.scenes.get(layer.scene) }, Boolean(frame[3]), 0.72, voice[2]);
    })) };
  }
}
