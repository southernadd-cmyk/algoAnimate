// Audio measurements and seeds contain no wall-clock time or random input.
export const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));

export function hash(text) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}

export function measureAudio(wave, decibels, sampleRate, fftSize, previous) {
  let squareSum = 0, peak = 0, total = 0, weighted = 0, rise = 0, priorTotal = 0;
  const linear = new Float32Array(decibels.length);
  const sums = [0, 0, 0], counts = [0, 0, 0];
  for (const value of wave) {
    if (!Number.isFinite(value)) continue;
    squareSum += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  for (let i = 1; i < decibels.length; i++) {
    const hz = i * sampleRate / fftSize;
    const amplitude = Number.isFinite(decibels[i]) ? Math.pow(10, decibels[i] / 20) : 0;
    linear[i] = amplitude;
    if (hz < 35 || hz > 14000) continue;
    const band = hz < 250 ? 0 : hz < 2200 ? 1 : 2;
    sums[band] += amplitude * amplitude;
    counts[band]++;
    total += amplitude;
    weighted += amplitude * hz;
    if (previous) {
      const old = previous[i] || 0;
      rise += Math.max(0, amplitude - old);
      priorTotal += old;
    }
  }
  const rms = Math.sqrt(squareSum / Math.max(1, wave.length));
  return {
    rms, peak, level: clamp(rms * 4),
    bass: clamp(Math.sqrt(sums[0] / Math.max(1, counts[0])) * 8),
    mid: clamp(Math.sqrt(sums[1] / Math.max(1, counts[1])) * 12),
    treble: clamp(Math.sqrt(sums[2] / Math.max(1, counts[2])) * 22),
    centroid: total > 1e-9 ? clamp(weighted / total / 10000) : 0,
    flux: previous && total > 1e-7 ? clamp(rise / Math.max(total, priorTotal, 1e-7)) : 0,
    linear
  };
}

export class FeatureTracker {
  constructor() { this.reset(); }
  reset() {
    this.previous = null;
    this.smoothed = { level: 0, bass: 0, mid: 0, treble: 0, centroid: 0, flux: 0 };
    this.fluxBaseline = 0.12;
    this.time = 0;
    this.lastBeat = -1;
  }
  update(wave, frequencies, sampleRate, dt, sensitivity = 1, smoothing = 0.55) {
    const measured = measureAudio(wave, frequencies, sampleRate, wave.length, this.previous);
    this.previous = measured.linear;
    this.time += dt;
    const active = measured.rms > 0.0015;
    const beat = active && measured.flux > Math.max(0.16, this.fluxBaseline * 1.65)
      && this.time - this.lastBeat > 0.22;
    if (beat) this.lastBeat = this.time;
    this.fluxBaseline += (measured.flux - this.fluxBaseline) * (1 - Math.exp(-dt / 1.5));
    const raw = {};
    for (const key of Object.keys(this.smoothed)) {
      raw[key] = key === 'centroid' || key === 'flux' ? measured[key] : clamp(measured[key] * sensitivity);
      const tau = raw[key] > this.smoothed[key] ? 0.025 + smoothing * 0.09 : 0.08 + smoothing * 0.7;
      this.smoothed[key] += (raw[key] - this.smoothed[key]) * (1 - Math.exp(-dt / tau));
    }
    return { ...this.smoothed, raw, active, beat, rms: measured.rms, peak: measured.peak };
  }
}

// Hash a short, ordered sound history, rather than raw samples (which jitter).
export class SoundSeed {
  constructor() { this.reset(); }
  reset() { this.history = []; this.accumulator = 0; this.seed = 'SOUND-READY'; }
  update(features, dt) {
    if (!features.active) return this.seed;
    this.accumulator += dt;
    if (this.accumulator < 0.12) return this.seed;
    this.accumulator %= 0.12;
    const keys = ['level', 'bass', 'mid', 'treble', 'centroid', 'flux'];
    const signature = keys.map(key => Math.round(clamp(features.raw[key]) * 31).toString(36)).join('.');
    this.history.push(signature);
    if (this.history.length > 16) this.history.shift();
    this.seed = 'SOUND-' + hash(this.history.join('|')).toString(16).padStart(8, '0').toUpperCase();
    return this.seed;
  }
}

export function evolutionInterval(value) { return 7 - clamp(value / 100) * 6; }

export const SILENCE = Object.freeze({
  level: 0, bass: 0, mid: 0, treble: 0, centroid: 0, flux: 0,
  active: false, beat: false, rms: 0, peak: 0,
  raw: { level: 0, bass: 0, mid: 0, treble: 0, centroid: 0, flux: 0 }
});
