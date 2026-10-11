import { clamp } from './features.js';

export const METER_FLOOR_DB = -60;
export const METER_CEILING_DB = 0;
export const BAND_KEYS = Object.freeze(['bass', 'mid', 'treble']);

export function meterLevel(rms) {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  return clamp((20 * Math.log10(rms) - METER_FLOOR_DB) / (METER_CEILING_DB - METER_FLOOR_DB));
}

// Meter ballistics are independent of the artist's sensitivity/smoothing knobs.
// A fixed dB scale never normalises an empty band up to a convincing-looking bar.
export class BandMeters {
  constructor() { this.reset(); }
  reset() {
    this.bands = Object.fromEntries(BAND_KEYS.map(key => [key, { level: 0, rms: 0, db: null }]));
  }
  update(bandRms, dt, active, available = true) {
    if (!available) { this.reset(); return this.bands; }
    for (const key of BAND_KEYS) {
      const band = this.bands[key], measured = bandRms?.[key];
      band.rms = active && Number.isFinite(measured) && measured > 0 ? measured : 0;
      band.db = band.rms > 0 ? 20 * Math.log10(band.rms) : null;
      const target = meterLevel(band.rms), tau = target > band.level ? 0.025 : 0.12;
      band.level += (target - band.level) * (1 - Math.exp(-Math.max(0, dt) / tau));
      if (!target && band.level < 0.005) band.level = 0;
    }
    return this.bands;
  }
}
