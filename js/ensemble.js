import { SoundGate, SoundSeed, SILENCE, clamp, hash } from './features.js';
import { AnimatedArtwork, DEFAULT_SETTINGS } from './scenes.js';
import { styleSettings } from './styles.js';

// Six measured features, plus two combinations. A route never reads another
// feature's history, clock or pressure. All eight share one audio analyser.
export const ENGINE_ROUTES = Object.freeze([
  { id: 'field', name: 'Orbital Studies', label: 'Bass', inputs: ['bass'] },
  { id: 'rects', name: 'Recursive Divisions', label: 'Mids', inputs: ['mid'] },
  { id: 'burst', name: 'Radiant Systems', label: 'Treble', inputs: ['treble'] },
  { id: 'organic', name: 'Growth Systems', label: 'Loudness', inputs: ['level'] },
  { id: 'geometric', name: 'Constructed Forms', label: 'Brightness', inputs: ['centroid'] },
  { id: 'network', name: 'Connected Fields', label: 'Onsets / change', inputs: ['flux'] },
  { id: 'scribble', name: 'Automatic Marks', label: 'Bass + onsets', inputs: ['bass', 'flux'] },
  { id: 'spiral', name: 'Golden Trajectories', label: 'Mids + treble', inputs: ['mid', 'treble'] }
].map(route => Object.freeze({ ...route, inputs: Object.freeze(route.inputs) })));

export class RoutedSound {
  constructor(route) {
    this.route = route;
    this.seeds = new SoundSeed(route.inputs);
    // An onset has a short drawing tail so individual beat accents are legible.
    // The global current-sound gate still stops every layer during silence.
    this.gate = new SoundGate(route.inputs.includes('flux') ? 0.24 : 0.09);
    this.reset();
  }
  reset() { this.seeds.reset(); this.gate.reset(); this.features = SILENCE; this.seed = 'SOUND-READY'; }
  update(features, dt, available) {
    const inputs = this.route.inputs;
    const raw = Object.fromEntries(inputs.map(key => [key, features.raw[key]]));
    const level = inputs.reduce((sum, key) => sum + features[key], 0) / inputs.length;
    const rawLevel = inputs.reduce((sum, key) => sum + raw[key], 0) / inputs.length;
    const threshold = inputs.length === 1 && inputs[0] === 'flux' ? 0.035 : 0.012;
    const active = available && features.active && rawLevel > threshold;
    const flowing = this.gate.update(active, dt, available);
    // Zero intervals are part of this route's history while the source sounds;
    // other measured channels are deliberately absent from the signature.
    this.seed = this.seeds.update({ active: available && features.active, raw }, dt);
    this.features = { ...SILENCE, level: clamp(level), active, raw,
      bass: inputs.includes('bass') ? features.bass : 0,
      mid: inputs.includes('mid') ? features.mid : 0,
      treble: inputs.includes('treble') ? features.treble : 0,
      centroid: inputs.includes('centroid') ? features.centroid : 0,
      flux: inputs.includes('flux') ? features.flux : 0 };
    return flowing;
  }
}

export function ensembleSettings(route, seed, orientation, palette, density = 25, style = null) {
  const amount = clamp(density / 100);
  return { ...DEFAULT_SETTINGS, seed, mode: route.id, orientation, palette,
    // The budget is for eight overlapping engines. Sparse drawings need fewer
    // subjects and less internal detail, rather than eight sparse solo posters.
    elements: Math.round(3 + 25 * amount ** 1.5), density: 4 + 96 * amount,
    complexity: 12 + 34 * amount, recursion: Math.round(1 + 2 * amount),
    negativeSpace: 92 - 48 * amount, nesting: 6 + 42 * amount,
    overlap: 8 + 47 * amount, inkMemory: 0.12 + 0.58 * amount,
    // Supporting frames get a bounded mark budget. Expressive voices unfold
    // in longer phrases; each still reads only its own assigned sound inputs.
    markHierarchy: true, rectangleBudget: Math.round(2 + 4 * amount),
    rectangles: route.id === 'rects' || route.id === 'geometric',
    phraseScale: ['field', 'organic', 'scribble', 'spiral'].includes(route.id) ? 1.4 : 1,
    overdraw: 2, grain: 9, ...styleSettings(style) };
}

// Introduce first ink a few strokes at a time, without changing each voice's
// audio-derived seed, pressure or scheduling once the paper is underway.
export const ENTRY_STAGGER_SECONDS = 0.09;
export const ENTRY_RAMP_SECONDS = 0.45;
export const ENTRY_DURATION_SECONDS = 1.25;

export class LayeredArtwork {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: false });
    this.entrySeconds = 0;
    this.entryFinished = false;
    this.voices = ENGINE_ROUTES.map(route => ({ route, art: new AnimatedArtwork(canvas),
      sound: new RoutedSound(route), flowing: false, building: false, generation: 0,
      pendingStyle: null, requestedSeed: 'SOUND-READY', firstSoundSeed: true, lastSceneTime: -1 }));
  }
  get current() { return this.voices[0].art.current; }
  get ready() { return this.voices.every(voice => voice.art.current); }
  get sceneCount() { return this.voices.reduce((sum, voice) => sum + voice.art.sceneCount, 0); }
  get flowing() { return this.voices.some(voice => voice.art.flowing); }
  get pathCount() { return this.voices.reduce((sum, voice) => sum + (voice.art.current?.paths.length || 0), 0); }
  get drawnSeed() {
    const seeds = this.voices.map(voice => voice.art.drawnSeed || 'SOUND-READY');
    return seeds.every(seed => seed === 'SOUND-READY') ? 'SOUND-READY'
      : 'MIX-' + hash(seeds.join('|')).toString(16).padStart(8, '0').toUpperCase();
  }
  get stats() {
    return this.voices.reduce((sum, voice) => {
      const art = voice.art;
      for (const key of ['progress', 'penTips', 'visiblePaths', 'inkLength']) sum[key] += art.stats[key];
      sum.layers += art.layers.length; sum.cycles += art.turns;
      return sum;
    }, { progress: 0, penTips: 0, visiblePaths: 0, inkLength: 0, layers: 0, cycles: 0 });
  }
  resetSound() {
    for (const voice of this.voices) {
      voice.generation++; voice.building = false; voice.pendingStyle = null; voice.art.discardQueued();
      voice.sound.reset(); voice.firstSoundSeed = true; voice.lastSceneTime = -1;
      voice.requestedSeed = voice.art.drawnSeed || 'SOUND-READY';
    }
  }
  clearInk() {
    this.entrySeconds = 0;
    this.entryFinished = false;
    for (const voice of this.voices) {
      voice.generation++; voice.building = false; voice.pendingStyle = null;
      voice.art.clearInk(); voice.sound.reset(); voice.flowing = false;
      voice.firstSoundSeed = true; voice.lastSceneTime = -1;
      voice.requestedSeed = voice.art.drawnSeed || 'SOUND-READY';
    }
  }
  setScenes(scenes, immediate = false) {
    this.paperScene = scenes[0];
    for (let index = 0; index < this.voices.length; index++) {
      const art = this.voices[index].art;
      const progress = art.activeLayer?.age || 0;
      art.setScene(scenes[index], immediate);
      // A layer that has never heard its assigned signal waits with empty ink.
      // Do not render eight unrelated ready-state posters over the audio art.
      // Explicit paper/ink controls rebuild at the held pen position, so an
      // orientation change during silence does not replace the art with blank paper.
      if (!art.layers.length && !art.blank) art.layers = [art.layer(art.current, progress)];
    }
  }
  updateSignals(features, dt, available) {
    const stopped = [];
    for (const voice of this.voices) {
      voice.flowing = voice.sound.update(features, dt, available);
      if (voice.art.flowing && !voice.flowing) stopped.push(voice);
    }
    return stopped;
  }
  draw(dt, response, gentle, cycle) {
    if (!this.ready) return;
    const ctx = this.context, scene = this.paperScene;
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.fillStyle = scene.paper; ctx.fillRect(0, 0, scene.width, scene.height);
    ctx.globalAlpha = 0.035;
    for (const mark of scene.paperMarks) {
      ctx.fillStyle = mark.colour; ctx.fillRect(mark.x, mark.y, mark.w, mark.h);
    }
    // First ink grows in: voices enter one by one and the first pen movements
    // ease to their normal sound-controlled speed. A pause later never restarts
    // this introduction or moves any marks on the held paper.
    const entering = !this.entryFinished;
    if (entering && this.voices.some(voice => voice.flowing)) this.entrySeconds += dt;
    for (const [index, voice] of this.voices.entries()) {
      const elapsed = this.entrySeconds - index * ENTRY_STAGGER_SECONDS;
      const canDraw = voice.flowing && (!entering || elapsed > 0);
      const ease = entering ? 0.25 + 0.75 * clamp(elapsed / ENTRY_RAMP_SECONDS) : 1;
      voice.art.draw(voice.sound.features, canDraw ? dt * ease : 0, response,
        gentle, cycle, canDraw, { paper: false, opacity: 0.72 });
    }
    if (this.entrySeconds >= ENTRY_DURATION_SECONDS) this.entryFinished = true;
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  diagnostics() {
    return this.voices.map(({ route, art, sound, flowing, building }) => ({
      engine: route.id, inputs: route.inputs, seed: art.drawnSeed,
      measuredSeed: sound.seed, queuedSeed: art.queued?.seed || null,
      signal: sound.features.level, active: sound.features.active, flowing, building,
      paths: art.current?.paths.length || 0, compositions: art.sceneCount,
      progress: art.stats.progress, penTips: art.stats.penTips,
      visiblePaths: art.stats.visiblePaths, inkLength: art.stats.inkLength,
      layers: art.layers.length, cycles: art.turns, pens: 3,
      style: art.drawnStyle || null,
      ink: [...new Set((art.activeLayer?.scene || art.current)?.paths.map(path => path.stroke) || [])],
      strokeSample: (art.activeLayer?.scene || art.current)?.paths.slice(0, 3).map(({ width, lineCap, blend, dash }) => ({ width, lineCap, blend, dash })) || []
    }));
  }
}
