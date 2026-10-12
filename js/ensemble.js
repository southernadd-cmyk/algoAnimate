import { SoundGate, SoundSeed, SILENCE, clamp, hash } from './features.js';
import { AnimatedArtwork, DEFAULT_SETTINGS } from './scenes.js';
import { styleSettings } from './styles.js';
import { focalFromScene, stabilizeFocal, easeFocal, FOCAL_TRANSITION_SECONDS } from './focal-hierarchy.js';

export const LEAD_ROUTE_ID = 'organic';

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
  reset() { this.seeds.reset(); this.gate.reset(); this.features = SILENCE; this.seed = 'SOUND-READY'; this.profile = null; }
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
    // A continuous phrase envelope, independent of the quantised variety seed.
    // Hold it through silence; only this route's assigned inputs enter it.
    if (available && features.active) {
      const blend = this.profile ? 1 - Math.exp(-dt / 0.75) : 1;
      const prior = this.profile || this.features;
      this.profile = Object.fromEntries(['level', 'bass', 'mid', 'treble', 'centroid', 'flux']
        .map(key => [key, prior[key] + (this.features[key] - prior[key]) * blend]));
    }
    return flowing;
  }
}

// Resist short audio fluctuations without dulling the immediate pen animation.
// Every early composition must clear both the feature-change and time thresholds.
export const EARLY_REFRESH_PROFILE_DELTA = 0.25;
export const EARLY_REFRESH_COOLDOWN_SECONDS = 2.5;
export function profileShift(previous, current, inputs, threshold = EARLY_REFRESH_PROFILE_DELTA) {
  if (!previous || !current) return false;
  return inputs.some(key => Math.abs(clamp(previous[key] ?? 0) - clamp(current[key] ?? 0)) >= threshold);
}
export function ensembleSettings(route, seed, orientation, palette, density = 25, style = null, profile = null, phase = 0) {
  const amount = clamp(density / 100);
  // Eight independent voices, none privileged: their visible territories are
  // assigned by the shared recursive golden layout on the next phrase.
  const ensembleRole = 'equal';
  // Keep native vector counts bounded for long score captures. Interaction
  // comes from placement, retention and shared ink rather than extra paths.
  const roleBudget = 0.86;
  const owns = key => route.inputs.includes(key);
  // Derive route energy from assigned inputs rather than trusting a caller's
  // global level field. This also protects direct composition-builder calls.
  const energy = profile ? clamp(route.inputs.reduce((sum, key) => sum + clamp(profile[key] ?? 0), 0)
    / route.inputs.length) : 0.5;
  const bass = owns('bass') ? clamp(profile?.bass || 0) : 0;
  const onsets = owns('flux') ? clamp(profile?.flux || 0) : 0;
  const brightness = owns('centroid') ? clamp(profile?.centroid || 0)
    : owns('treble') ? clamp(profile?.treble || 0) : null;
  const audioControls = profile ? { energy, bass, onsets, brightness } : null;
  return { ...DEFAULT_SETTINGS, seed, mode: route.id, orientation, palette,
    // The budget is for eight overlapping engines. Sparse drawings need fewer
    // subjects and less internal detail, rather than eight sparse solo posters.
    elements: Math.max(3, Math.round((3 + 25 * amount ** 1.5 * (0.55 + 0.9 * energy)) * roleBudget)), density: 4 + 96 * amount,
    complexity: 12 + 34 * amount + 18 * onsets, recursion: Math.round(1 + 2 * amount),
    negativeSpace: Math.min(98, 92 - 48 * amount * (0.6 + 0.8 * energy)), nesting: 6 + 42 * amount + 34 * bass,
    overlap: 8 + 47 * amount,
    inkMemory: (.24 + .58 * amount) * (.74 + .75 * energy),
    curveBias: brightness === null || !profile ? 80 : 92 - 84 * brightness,
    shapeAmount: profile && owns('flux') ? 24 + 72 * onsets : DEFAULT_SETTINGS.shapeAmount,
    rotation: profile && owns('flux') ? 24 + 72 * onsets : DEFAULT_SETTINGS.rotation,
    elementScale: profile && owns('bass') ? 0.72 + 0.72 * bass : 1,
    // Eight disjoint lanes of one golden-angle sequence, on the whole paper.
    interlock: { lane: ENGINE_ROUTES.findIndex(item => item.id === route.id), lanes: ENGINE_ROUTES.length, phase },
    ensembleRole,
    sharedAnchor: true,
    audioControls,
    // All eight voices get the same bounded mark budget. Expressive voices unfold
    // in longer phrases; each still reads only its own assigned sound inputs.
    markHierarchy: true, rectangleBudget: Math.round(2 + 4 * amount),
    rectangles: route.id === 'rects' || route.id === 'geometric',
    phraseScale: ['field', 'organic', 'scribble', 'spiral'].includes(route.id) ? 1.4 : 1,
    overdraw: 2, grain: 9, ...styleSettings(style) };
}

// Introduce first ink a few strokes at a time, without changing each voice's
// audio-derived seed, pressure or scheduling once the paper is underway.
export const ENTRY_STAGGER_SECONDS = 0.027;
export const ENTRY_RAMP_SECONDS = 0.12;
export const ENTRY_DURATION_SECONDS = 0.26;
// Reveal a few pixels of the first stroke immediately, never a complete mark.
export const ENTRY_FIRST_STROKE_AGE = 0.008;

export class LayeredArtwork {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: false });
    this.entrySeconds = 0;
    this.entryFinished = false;
    this.entryNextSlot = 0;
    this.layoutTime = 0; // Seconds of audible performance; stops advancing in silence.
    this.solo = null;
    this.focalRegion = null;
    this.effectiveFocal = null;
    this.focalSource = null;
    this.focalTransition = null;
    this.voices = ENGINE_ROUTES.map(route => ({ route, art: new AnimatedArtwork(canvas),
      muted: false,
      sound: new RoutedSound(route), flowing: false, building: false, generation: 0,
      pendingStyle: null, requestedSeed: 'SOUND-READY', firstSoundSeed: true, lastCompositionProfile: null,
      entrySlot: null, lastSceneTime: -1 }));
  }
  enabled(voice) { return !voice.muted && (!this.solo || this.solo === voice.route.id); }
  get leadVoice() { return this.voices.find(voice => voice.route.id === LEAD_ROUTE_ID); }
  // Only the presentation focal point changes. Native scene geometry, ink
  // layers and pressure arrays retain their identities through the transition.
  syncFocal(dt = 0) {
    const lead = this.leadVoice;
    const source = lead.art.activeLayer?.scene || lead.art.current;
    const active = this.enabled(lead) && !lead.art.blank && Boolean(source)
      && source.ensembleRole !== 'equal';
    if (!active) {
      this.focalRegion = this.effectiveFocal = this.focalSource = this.focalTransition = null;
      return;
    }
    if (active && source !== this.focalSource) {
      const next = source.goldenFocal || stabilizeFocal(focalFromScene(source), this.focalRegion);
      this.focalSource = source;
      if (next !== this.focalRegion) {
        this.focalRegion = next;
        if (!this.effectiveFocal || this.effectiveFocal.rx !== next.rx || this.effectiveFocal.ry !== next.ry) {
          this.effectiveFocal = next; this.focalTransition = null;
        } else this.focalTransition = { from: this.effectiveFocal, to: next, elapsed: 0 };
      }
    }
    if (this.focalTransition && dt > 0) {
      const transition = this.focalTransition;
      transition.elapsed = Math.min(FOCAL_TRANSITION_SECONDS, transition.elapsed + dt);
      this.effectiveFocal = easeFocal(transition.from, transition.to, transition.elapsed);
      if (transition.elapsed === FOCAL_TRANSITION_SECONDS) this.focalTransition = null;
    }
  }
  setVoiceScene(voice, scene, immediate = false, startNow = false) {
    voice.art.setScene(scene, immediate, startNow);
  }
  toggleSolo(id) {
    this.solo = this.solo === id ? null : id;
    if (this.solo) this.voices.find(voice => voice.route.id === id).muted = false;
    this.syncFocal();
  }
  toggleMute(id) {
    const voice = this.voices.find(voice => voice.route.id === id);
    if (voice) voice.muted = !voice.muted;
    this.syncFocal();
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
    return this.voices.filter(voice => this.enabled(voice)).reduce((sum, voice) => {
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
      voice.lastCompositionProfile = null;
      voice.requestedSeed = voice.art.drawnSeed || 'SOUND-READY';
    }
  }
  clearInk() {
    this.focalRegion = null;
    this.focalSource = null;
    this.effectiveFocal = null;
    this.focalTransition = null;
    this.entrySeconds = 0;
    this.entryFinished = false;
    this.entryNextSlot = 0;
    for (const voice of this.voices) {
      voice.entrySlot = null;
      voice.generation++; voice.building = false; voice.pendingStyle = null;
      voice.art.clearInk(); voice.sound.reset(); voice.flowing = false;
      voice.firstSoundSeed = true; voice.lastSceneTime = -1;
      voice.lastCompositionProfile = null;
      voice.requestedSeed = voice.art.drawnSeed || 'SOUND-READY';
    }
  }
  setScenes(scenes, immediate = false) {
    this.paperScene = scenes[0];
    for (let index = 0; index < this.voices.length; index++) {
      const art = this.voices[index].art;
      const progress = art.activeLayer?.age || 0;
      this.setVoiceScene(this.voices[index], scenes[index], immediate);
      // A layer that has never heard its assigned signal waits with empty ink.
      // Do not render eight unrelated ready-state posters over the audio art.
      // Explicit paper/ink controls rebuild at the held pen position, so an
      // orientation change during silence does not replace the art with blank paper.
      if (!art.layers.length && !art.blank) art.layers = [art.layer(art.current, progress)];
    }
    this.syncFocal();
  }
  updateSignals(features, dt, available) {
    if (available && features.active) this.layoutTime += dt;
    const stopped = [];
    for (const voice of this.voices) {
      voice.flowing = voice.sound.update(features, dt, available && this.enabled(voice));
      if (voice.art.flowing && !voice.flowing) stopped.push(voice);
    }
    return stopped;
  }
  draw(dt, response, gentle, cycle) {
    if (!this.ready) return;
    this.syncFocal(this.voices.some(voice => this.enabled(voice) && voice.flowing) ? dt : 0);
    const ctx = this.context, scene = this.paperScene;
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.fillStyle = scene.paper; ctx.fillRect(0, 0, scene.width, scene.height);
    ctx.globalAlpha = 0.035;
    for (const mark of scene.paperMarks) {
      ctx.fillStyle = mark.colour; ctx.fillRect(mark.x, mark.y, mark.w, mark.h);
    }
    // The first *active* voice makes a short real mark in the very first
    // audible frame. Other active voices enter over ~200ms rather than
    // withholding the composition for over a second. The normal pen clock,
    // geometry, palettes and sound gating are unchanged after this entrance.
    const entering = !this.entryFinished;
    if (entering && this.voices.some(voice => voice.flowing)) this.entrySeconds += dt;
    for (const voice of this.voices) {
      if (!this.enabled(voice)) { voice.art.flowing = false; continue; }
      if (entering && voice.flowing && voice.entrySlot === null) voice.entrySlot = this.entryNextSlot++;
      const elapsed = this.entrySeconds - (voice.entrySlot || 0) * ENTRY_STAGGER_SECONDS;
      const canDraw = voice.flowing && (!entering || elapsed > 0);
      const ease = entering ? 0.8 + 0.2 * clamp(elapsed / ENTRY_RAMP_SECONDS) : 1;
      voice.art.draw(voice.sound.features, canDraw ? dt * ease : 0, response,
        gentle, cycle, canDraw, { paper: false, opacity: 0.72,
          focal: voice.route.id === LEAD_ROUTE_ID ? null : this.effectiveFocal,
          initialInkAge: entering && canDraw ? ENTRY_FIRST_STROKE_AGE : 0 });
    }
    // New equal-voice sheets have no lead fading. Old score geometry remains replayable.
    if (this.entrySeconds >= ENTRY_DURATION_SECONDS) this.entryFinished = true;
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  diagnostics() {
    return this.voices.map(voice => { const { route, art, sound, flowing, building } = voice; return ({
      engine: route.id, inputs: route.inputs, seed: art.drawnSeed,
      enabled: this.enabled(voice), muted: voice.muted, solo: this.solo === route.id,
      measuredSeed: sound.seed, queuedSeed: art.queued?.seed || null,
      seedWindow: { samples: sound.seeds.history.length, steady: sound.seeds.history.length === 16
        && sound.seeds.history.every(value => value === sound.seeds.history[0]) },
      signal: sound.features.level, active: sound.features.active, flowing, building,
      paths: art.current?.paths.length || 0, compositions: art.sceneCount,
      progress: art.stats.progress, penTips: art.stats.penTips,
      visiblePaths: art.stats.visiblePaths, inkLength: art.stats.inkLength,
      layers: art.layers.length, cycles: art.turns, pens: 3,
      style: art.drawnStyle || null,
      composition: (art.activeLayer?.scene || art.current)?.composition || null,
      ink: [...new Set((art.activeLayer?.scene || art.current)?.paths.map(path => path.stroke) || [])],
      strokeSample: (art.activeLayer?.scene || art.current)?.paths.slice(0, 3).map(({ width, lineCap, blend, dash }) => ({ width, lineCap, blend, dash })) || []
    }); });
  }
}
