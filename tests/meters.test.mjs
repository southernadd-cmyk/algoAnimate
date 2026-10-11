import test from 'node:test';
import assert from 'node:assert/strict';
import { measureAudio, FeatureTracker } from '../js/features.js';
import { BandMeters, BAND_KEYS, meterLevel } from '../js/meters.js';

// Exact, bin-centred sine spectra after the analyser's periodic Blackman
// window: central coefficient 0.21, sidebands 0.125 and 0.02 of peak amplitude.
function tone(band, amplitude = 0.2, sampleRate = 48000, size = 2048) {
  const hz = { bass: 120, mid: 1000, treble: 6000 }[band];
  const bin = Math.round(hz * size / sampleRate);
  const wave = Float32Array.from({ length: size }, (_, index) => amplitude * Math.sin(2 * Math.PI * bin * index / size));
  const frequencies = new Float32Array(size / 2).fill(-Infinity);
  for (const [offset, gain] of [[0, 0.21], [-1, 0.125], [1, 0.125], [-2, 0.02], [2, 0.02]]) {
    frequencies[bin + offset] = 20 * Math.log10(amplitude * gain);
  }
  return { wave, frequencies, sampleRate };
}

test('equal bass, mid and treble tones have equal calibrated RMS at both common sample rates and FFT sizes', () => {
  for (const sampleRate of [44100, 48000]) for (const size of [2048, 4096]) for (const key of BAND_KEYS) {
    const input = tone(key, 0.2, sampleRate, size);
    const measured = measureAudio(input.wave, input.frequencies, sampleRate, size);
    assert.ok(Math.abs(measured.bandRms[key] - 0.2 / Math.sqrt(2)) < 1e-6, key + ' matches sine RMS');
    assert.ok(Math.abs(measured.bandRms[key] - measured.rms) < 1e-6);
    for (const other of BAND_KEYS.filter(band => band !== key)) assert.equal(measured.bandRms[other], 0);
  }
});

test('decibel meters show ordinary sound levels and preserve changes in amplitude', () => {
  assert.ok(Math.abs(meterLevel(0.1) - 2 / 3) < 1e-9);
  assert.ok(Math.abs(meterLevel(0.01) - 1 / 3) < 1e-9);
  assert.ok(Math.abs(meterLevel(0.5) - meterLevel(0.05) - 1 / 3) < 1e-9, '20 dB occupies the same span everywhere');
  assert.equal(meterLevel(0.001), 0); assert.equal(meterLevel(1), 1); assert.equal(meterLevel(2), 1);
  for (const invalid of [0, -1, NaN, Infinity, undefined]) assert.equal(meterLevel(invalid), 0);
});

test('a meter tracks its own real band without normalising absent bands upward', () => {
  const meters = new BandMeters();
  for (let frame = 0; frame < 10; frame++) meters.update({ bass: 0.1, mid: 0, treble: 0 }, 1 / 30, true);
  assert.ok(meters.bands.bass.level > 0.65); assert.equal(meters.bands.bass.db, -20);
  assert.equal(meters.bands.mid.level, 0); assert.equal(meters.bands.treble.level, 0);
  for (let frame = 0; frame < 24; frame++) meters.update({ bass: 1, mid: 1, treble: 1 }, 1 / 30, false);
  assert.ok(BAND_KEYS.every(key => meters.bands[key].level === 0 && meters.bands[key].db === null), 'Real silence overrides residual FFT data');
  meters.update({ bass: 0.4, mid: 0.3, treble: 0.2 }, 0.1, true);
  meters.update({ bass: 0.4, mid: 0.3, treble: 0.2 }, 0.01, true, false);
  assert.ok(BAND_KEYS.every(key => meters.bands[key].level === 0 && meters.bands[key].rms === 0), 'Pause/disconnect resets immediately');
});

test('meter attack and release are time based across frame rates', () => {
  function simulate(dt) {
    const meters = new BandMeters();
    for (let time = 0; time < 0.1 - dt / 2; time += dt) meters.update({ bass: 0.1 }, dt, true);
    const attack = meters.bands.bass.level;
    for (let time = 0; time < 0.2 - dt / 2; time += dt) meters.update({ bass: 0 }, dt, false);
    return [attack, meters.bands.bass.level];
  }
  const slow = simulate(1 / 30), fast = simulate(1 / 60);
  assert.ok(slow.every((value, index) => Math.abs(value - fast[index]) < 1e-9));
});

test('meter measurements ignore artistic sensitivity and smoothing settings', () => {
  const data = tone('mid');
  const quiet = new FeatureTracker().update(data.wave, data.frequencies, data.sampleRate, 1 / 30, 0.25, 0);
  const bold = new FeatureTracker().update(data.wave, data.frequencies, data.sampleRate, 1 / 30, 3, 1);
  assert.notEqual(quiet.mid, bold.mid);
  assert.deepEqual(quiet.bandRms, bold.bandRms);
});
