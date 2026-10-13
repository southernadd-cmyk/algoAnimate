import { SILENCE, clamp } from './features.js';
import { markerGeometry } from './ink.js';
import { layerStrokes } from './export.js';
import { ALGOART_RENDERER_VERSION } from './renderer-version.js';
import { packVectors, unpackVectors, MAX_SCORE_VECTOR_BYTES } from './score-vectors.js';
import { SUPPORT_OPACITY_REDUCTION } from './focal-hierarchy.js';

export const SCORE_FORMAT = 'algoanimate-score';
export const SCORE_FORMAT_VERSION = 3;
// Renderer is provenance, not a replay dependency: scores contain vector geometry.
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
// only reference those records, their exact pen ages and the painted focal
// ellipse. Moving support fades never create another geometry record. Worker timing, random
// ink kits and muted layers are preserved, without storing audio or canvas pixels.
export class ScoreCapture {
  constructor(started, source = '') {
    this.started = started; this.bytes = 0;
    this.sceneIds = new WeakMap(); this.layerIds = new WeakMap(); this.paperIds = new WeakMap();
    this.openLayers = new Map();
    this.data = { format: SCORE_FORMAT, version: SCORE_FORMAT_VERSION, renderer: ALGOART_RENDERER_VERSION, source,
      featureKeys: keys, hierarchyLead: null, supportOpacityReduction: SUPPORT_OPACITY_REDUCTION,
      material: 'tissue-graphite-v6', materialFrames: [],
      scenes: [], layers: [], papers: [], frames: [], duration: 0 };
  }
  sceneId(scene) {
    if (this.sceneIds.has(scene)) return this.sceneIds.get(scene);
    const id = this.data.scenes.length;
    const vectors = {
      schedule: scene.schedule, paths: scene.paths.map(({ d, stroke, width, opacity, lineCap,
        blend, transform, dash, dashOffset }) => ({ d, stroke, width, opacity, lineCap, blend, transform, dash, dashOffset })) };
    const record = { seed: scene.seed, mode: scene.mode, inkMemory: scene.inkMemory ?? 0.7,
      pathCount: scene.paths.length, vectors: packVectors(vectors) };
    this.bytes += JSON.stringify(record).length;
    this.data.scenes.push(record); this.sceneIds.set(scene, id); return id;
  }
  layerId(layer) {
    let id = this.layerIds.get(layer);
    if (id === undefined) {
      id = this.data.layers.length;
      const record = { scene: this.sceneId(layer.scene), preview: Boolean(layer.preview),
        pressure: layer.pressure.slice() };
      this.data.layers.push(record);
      this.bytes += JSON.stringify(record).length;
      this.layerIds.set(layer, id);
    } else {
      const record = this.data.layers[id];
      if (!Array.isArray(record.pressure)) {
        const saved = unpackVectors({ vectors: record.pressure });
        this.bytes += JSON.stringify(saved).length - JSON.stringify(record.pressure).length;
        record.pressure = saved;
      }
      const saved = record.pressure;
      layer.pressure.forEach((value, i) => {
        if (saved[i] === null && value !== null) {
          saved[i] = value;
          this.bytes += JSON.stringify(value).length - 4; // Replace the literal null.
        }
      });
    }
    this.openLayers.set(layer, id);
    return id;
  }
  packPressure(id) {
    const layer = this.data.layers[id];
    if (!Array.isArray(layer.pressure)) return;
    const packed = packVectors(layer.pressure);
    this.bytes += JSON.stringify(packed).length - JSON.stringify(layer.pressure).length;
    layer.pressure = packed;
  }
  retireLayers(artwork) {
    const current = new Set(artwork.voices.flatMap(voice => voice.art.layers));
    for (const [layer, id] of this.openLayers) if (!current.has(layer)) {
      this.packPressure(id); this.openLayers.delete(layer);
    }
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
    this.retireLayers(artwork);
    this.data.hierarchyLead = artwork.voices.indexOf(artwork.leadVoice);
    const focal = artwork.effectiveFocal;
    const frame = [time, packFeatures(features), paper, +gentle, voices,
      focal ? [focal.x, focal.y, focal.rx, focal.ry] : null];
    this.bytes += JSON.stringify(frame).length;
    this.data.frames.push(frame); this.data.duration = time;
    // Material must use the SAME source palette/seed on replay, even as
    // styles change between sounds and generations of geometry.
    const colours = [];
    for (const voice of artwork.voices) {
      if (!artwork.enabled(voice)) continue;
      const scene = voice.art.activeLayer?.scene || voice.art.current;
      for (const colour of scene?.style?.colors || []) {
        if (!colours.includes(colour)) colours.push(colour);
        if (colours.length >= 12) break;
      }
      if (colours.length >= 12) break;
    }
    const materialFrame = [artwork.drawnSeed || 'SOUND-READY', colours];
    this.data.materialFrames.push(materialFrame);
    this.bytes += JSON.stringify(materialFrame).length;
    return time < 180000 && this.data.frames.length < 5500 && this.bytes < MAX_SCORE_BYTES * 0.8;
  }
  finish() {
    if (!this.data.frames.length) return null;
    for (const id of this.openLayers.values()) this.packPressure(id);
    this.openLayers.clear();
    return this.data;
  }
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
  if (score?.format !== SCORE_FORMAT || ![1, 2, SCORE_FORMAT_VERSION].includes(score.version) || !Number.isInteger(score.renderer) || score.renderer < 1 || score.renderer > 1000) fail();
  if (score.material !== undefined && !['marker', 'tissue-graphite-v6'].includes(score.material)) fail();
  if (score.version >= 2 && (!Number.isInteger(score.hierarchyLead) || score.hierarchyLead < 0 || score.hierarchyLead >= 8)) fail();
  if (score.material === 'tissue-graphite-v6') {
    array(score.materialFrames, 5500);
    if (score.materialFrames.length !== score.frames.length) fail();
    for (const [seed, inks] of score.materialFrames) {
      if (typeof seed !== 'string' || seed.length > 200) fail();
      array(inks, 12); inks.forEach(colour);
    }
  }
  array(score.frames, 5500); array(score.scenes, 5000); array(score.layers, 10000); array(score.papers, 200);
  if (!score.frames.length || !score.papers.length) fail();
  number(score.duration, 0, 180000);
  if (score.version >= 3 || score.supportOpacityReduction !== undefined) number(score.supportOpacityReduction, 0, 1);
  let pathCount = 0, vectorBytes = 0;
  for (const scene of score.scenes) {
    number(scene.inkMemory, 0, 2);
    if (score.version >= 2) {
      if (!Number.isInteger(scene.pathCount) || scene.pathCount < 0 || scene.pathCount > 10000) fail();
      if (!Number.isInteger(scene.vectors?.bytes) || (vectorBytes += scene.vectors.bytes) > MAX_SCORE_VECTOR_BYTES) fail();
    }
    let vectors;
    try { vectors = score.version === 1 ? scene : unpackVectors(scene); } catch { fail(); }
    array(vectors.paths, 10000); array(vectors.schedule, 10000);
    if (vectors.paths.length !== vectors.schedule.length || (pathCount += vectors.paths.length) > 100000
      || (score.version >= 2 && scene.pathCount !== vectors.paths.length)) fail();
    vectors.paths.forEach((path, i) => {
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
      const timing = vectors.schedule[i]; number(timing.start, 0, 1); number(timing.duration, 1e-10, 1);
      if (timing.hold !== undefined) number(timing.hold, 0, 2);
    });
  }
  for (const paper of score.papers) {
    number(paper.width, 1, 2000); number(paper.height, 1, 2000); colour(paper.paper);
    array(paper.paperMarks, 50000);
    for (const mark of paper.paperMarks) { colour(mark.colour); for (const key of ['x', 'y', 'w', 'h']) number(mark[key]); }
  }
  for (const layer of score.layers) {
    ref(layer.scene, score.scenes);
    let pressure;
    try {
      if (score.version >= 2 && !Array.isArray(layer.pressure)) {
        if (!Number.isInteger(layer.pressure?.bytes) || (vectorBytes += layer.pressure.bytes) > MAX_SCORE_VECTOR_BYTES) fail();
        pressure = unpackVectors({ vectors: layer.pressure });
      } else pressure = layer.pressure;
    } catch { fail(); }
    array(pressure, 10000);
    const scene = score.scenes[layer.scene];
    if (pressure.length !== (score.version === 1 ? scene.paths.length : scene.pathCount)) fail();
    pressure.forEach(value => { if (value !== null) number(value, 0, 5); });
  }
  let previous = -1;
  for (const frame of score.frames) {
    const frameLength = score.version === 1 ? 5 : 6;
    array(frame, frameLength); if (frame.length !== frameLength) fail(); number(frame[0], 0, score.duration);
    if (frame[0] < previous) fail(); previous = frame[0];
    array(frame[1], 18); if (frame[1].length !== 18) fail(); frame[1].forEach(value => number(value, 0, 65535));
    ref(frame[2], score.papers); number(frame[3], 0, 1); array(frame[4], 8);
    if (frame[4].length !== 8) fail();
    for (const voice of frame[4]) {
      array(voice, 4);
      if (voice.length !== 4) fail(); number(voice[0], 0, 1); number(voice[1], 0, 1); number(voice[2], 0, 2); array(voice[3], 3);
      for (const layer of voice[3]) { array(layer, 2); if (layer.length !== 2) fail(); ref(layer[0], score.layers); number(layer[1], 0, 5); }
    }
    if (score.version >= 2 && frame[5] !== null) {
      array(frame[5], 4); if (frame[5].length !== 4) fail();
      const paper = score.papers[frame[2]], [x, y, rx, ry] = frame[5];
      number(x, 0, paper.width); number(y, 0, paper.height);
      number(rx, 1e-10, paper.width / 2); number(ry, 1e-10, paper.height / 2);
      if (x < rx || x > paper.width - rx || y < ry || y > paper.height - ry) fail();
    }
  }
  Object.defineProperty(score, 'validated', { value: true });
  return score;
}

export class ScoreReplay {
  constructor(score) { this.score = score; this.time = 0; this.index = 0; this.paused = false; this.scenes = new Map(); this.layers = new Map(); }
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
  get materialFrame() { return this.score.materialFrames?.[this.index] || ['SOUND-READY', []]; }
  get engines() { return this.frame[4].map(voice => ({ enabled: Boolean(voice[0]), flowing: Boolean(voice[1]) })); }
  sheet() {
    const frame = this.frame, paper = this.score.papers[frame[2]];
    if (this.focalFrame !== frame) {
      this.focalFrame = frame;
      const f = this.score.version >= 2 ? frame[5] : null;
      this.focal = f ? { x: f[0], y: f[1], rx: f[2], ry: f[3] } : null;
    }
    const active = new Set(frame[4].flatMap(voice => voice[3].map(([id]) => this.score.layers[id].scene)));
    const activeLayers = new Set(frame[4].flatMap(voice => voice[3].map(([id]) => id)));
    for (const id of this.layers.keys()) if (!activeLayers.has(id)) this.layers.delete(id);
    for (const id of activeLayers) if (!this.layers.has(id)) {
      const layer = this.score.layers[id];
      this.layers.set(id, { ...layer, pressure: Array.isArray(layer.pressure) ? layer.pressure : unpackVectors({ vectors: layer.pressure }) });
    }
    // Keep arc tables only for the currently visible scenes, not the whole take.
    for (const id of this.scenes.keys()) if (!active.has(id)) this.scenes.delete(id);
    for (const id of active) if (!this.scenes.has(id)) {
      const scene = this.score.scenes[id];
      const vectors = this.score.version === 1 ? scene : unpackVectors(scene);
      this.scenes.set(id, { ...scene, schedule: vectors.schedule,
        paths: vectors.paths.map(path => ({ ...path, geometry: markerGeometry(path.d) })) });
    }
    return { ...paper, paths: frame[4].flatMap((voice, index) => voice[3].flatMap(([id, age]) => {
      const layer = this.layers.get(id);
      return layerStrokes({ ...layer, age, scene: this.scenes.get(layer.scene) }, Boolean(frame[3]), 0.72, voice[2],
        index === this.score.hierarchyLead ? null : this.focal, this.score.supportOpacityReduction ?? .55);
    })) };
  }
}
