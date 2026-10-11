import test from 'node:test';
import assert from 'node:assert/strict';
import { measureAudio, FeatureTracker, SoundSeed, SILENCE, evolutionInterval } from '../js/features.js';
import { pathBounds } from '../js/scenes.js';

function signal(hz, amplitude = 0.2, sampleRate = 48000) {
  const wave = Float32Array.from({ length: 2048 }, (_, i) => Math.sin(i * hz / sampleRate * Math.PI * 2) * amplitude);
  const frequencies = new Float32Array(1024).fill(-Infinity);
  frequencies[Math.round(hz * 2048 / sampleRate)] = 20 * Math.log10(amplitude);
  return { wave, frequencies, sampleRate };
}

test('silence stays finite and does not invent a sound seed', () => {
  const tracker = new FeatureTracker(), seeds = new SoundSeed();
  for (let i = 0; i < 120; i++) {
    const f = tracker.update(new Float32Array(2048), new Float32Array(1024).fill(-Infinity), 48000, 1 / 30);
    assert.equal(f.active, false); assert.equal(f.beat, false);
    for (const key of ['level', 'bass', 'mid', 'treble', 'centroid', 'flux']) assert.equal(f[key], 0);
    seeds.update(f, 1 / 30);
  }
  assert.equal(seeds.seed, 'SOUND-READY');
  assert.equal(seeds.history.length, 0);
});

test('frequency bands follow Hertz at both common sample rates', () => {
  for (const sampleRate of [44100, 48000]) {
    for (const [hz, band] of [[100, 'bass'], [1000, 'mid'], [6000, 'treble']]) {
      const { wave, frequencies } = signal(hz, 0.2, sampleRate);
      const f = measureAudio(wave, frequencies, sampleRate, wave.length);
      assert.ok(f[band] > 0);
      for (const other of ['bass', 'mid', 'treble'].filter(key => key !== band)) assert.equal(f[other], 0);
    }
  }
});

test('ordered sound histories produce repeatable, sound-dependent seeds', () => {
  function sequence(reverse = false) {
    const tracker = new FeatureTracker(), seeds = new SoundSeed(), output = [];
    const inputs = [signal(100), signal(1000, 0.1), signal(6000, 0.05), signal(250, 0.3)];
    if (reverse) inputs.reverse();
    for (const data of inputs) for (let i = 0; i < 12; i++) {
      const f = tracker.update(data.wave, data.frequencies, data.sampleRate, 1 / 30);
      output.push(seeds.update(f, 1 / 30));
    }
    return output;
  }
  assert.deepEqual(sequence(), sequence());
  assert.notDeepEqual(sequence(), sequence(true));
  assert.match(sequence().at(-1), /^SOUND-[A-F0-9]{8}$/);
});

test('history is bounded, holds during silence, and settles for steady sound', () => {
  const seeds = new SoundSeed();
  const f = { ...SILENCE, active: true, raw: { level: 0.3, bass: 0.2, mid: 0.1, treble: 0, centroid: 0.1, flux: 0 } };
  for (let i = 0; i < 50; i++) seeds.update(f, 0.12);
  const stable = seeds.seed;
  for (let i = 0; i < 50; i++) seeds.update(f, 0.12);
  assert.equal(seeds.seed, stable); assert.equal(seeds.history.length, 16);
  seeds.update(SILENCE, 5); assert.equal(seeds.seed, stable);
});

test('smoothing is time-based across render cadences', () => {
  const data = signal(1000);
  function simulate(dt) {
    const tracker = new FeatureTracker(); let f;
    for (let time = 0; time < 1 - dt / 2; time += dt) f = tracker.update(data.wave, data.frequencies, data.sampleRate, dt, 1, 0.8);
    return f.level;
  }
  assert.ok(Math.abs(simulate(1 / 30) - simulate(1 / 60)) < 1e-6);
});

test('onset detection responds to a new sound after silence', () => {
  const tracker = new FeatureTracker(), data = signal(100);
  tracker.update(new Float32Array(2048), new Float32Array(1024).fill(-Infinity), 48000, 0.3);
  const first = tracker.update(data.wave, data.frequencies, 48000, 1 / 30);
  const next = tracker.update(data.wave, data.frequencies, 48000, 1 / 30);
  assert.equal(first.beat, true); assert.equal(next.beat, false);
});

test('controls and recorded path bounds handle their edge cases', () => {
  assert.equal(evolutionInterval(0), 7); assert.equal(evolutionInterval(100), 1);
  const b = pathBounds('M -10.5 20 C 30 40 50 60 70 80');
  assert.equal(b.x, 29.75); assert.equal(b.y, 50); assert.ok(Number.isFinite(b.extent));
});
