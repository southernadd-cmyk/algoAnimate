// Sound chooses the kit; reservations keep simultaneous voices distinguishable.
import { hash, clamp } from './features.js';
export const PEN_PROFILES = Object.freeze([
  ['fineliner', 'Fineliner', 'fine', 3.3, 15, 22, 4, 86, 2],
  ['felt', 'Felt marker', 'felt', 3.4, 29, 34, 15, 78, 2],
  ['chisel', 'Chisel marker', 'broad', 3.4, 16, 28, 7, 76, 2],
  ['highlighter', 'Highlighter', 'highlighter', 4.2, 10, 18, 0, 92, 2],
  ['dry', 'Dry marker', 'dry', 3.8, 38, 42, 72, 83, 2],
  ['paint', 'Paint marker', 'paint', 3.5, 12, 46, 6, 80, 2],
  ['sketch', 'Sketch pen', 'scribble', 2.8, 48, 36, 21, 80, 2],
  ['technical', 'Technical nib', 'fine', 1.8, 4, 10, 0, 94, 1],
  ['fiber', 'Soft fibre nib', 'felt', 2.1, 37, 42, 27, 78, 2],
  ['flat', 'Wide flat nib', 'broad', 4.5, 8, 16, 0, 72, 1],
  ['wash', 'Wash marker', 'highlighter', 2.7, 24, 30, 6, 78, 1],
  ['bristle', 'Dry bristle nib', 'dry', 2.5, 24, 54, 94, 88, 2],
  ['brush', 'Brush marker', 'paint', 4.7, 22, 72, 12, 77, 2],
  ['scratch', 'Scratch nib', 'scribble', 1.9, 62, 48, 63, 88, 2],
  ['pigment', 'Pigment marker', 'felt', 4.9, 10, 19, 0, 94, 1],
  ['ribbon', 'Narrow chisel', 'broad', 1.8, 31, 48, 42, 89, 2]
].map(([id, name, renderer, thickness, wobble, pressure, dryness, opacity, overdraw]) =>
  Object.freeze({ id, name, renderer, thickness, wobble, pressure, dryness, opacity, overdraw })));

export const INK_FAMILIES = Object.freeze([
  'Vermilion', 'Rust', 'Amber', 'Honey', 'Citrus', 'Meadow', 'Fern', 'Forest',
  'Jade', 'Sea glass', 'Petrol', 'Blueprint', 'Iris', 'Violet', 'Berry', 'Rose'
].map((name, index) => Object.freeze({ id: name.toLowerCase().replace(' ', '-'), name, hue: index * 22.5 })));

function colorsFor(family, mood, variation) {
  const [saturation, lightness] = mood === 'soft' ? [49, 49] : mood === 'bold' ? [88, 39] : [74, 43];
  return [-7, 0, 7].map((offset, index) => {
    const hue = (family.hue + offset + variation + 360) % 360;
    return `hsl(${hue.toFixed(1)} ${saturation - index * 6}% ${lightness + [0, 10, -8][index]}%)`;
  });
}

export class StyleDeck {
  constructor(seed = hash('algoanimate-ink')) { this.state = seed >>> 0; this.serial = 0; }
  random() {
    let value = this.state += 0x6D2B79F5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  }
  next(voices, mood = 'mix', soundSeed = null, route = '', profile = null) {
    const usedPens = new Set(), usedPalettes = new Set();
    for (const voice of voices) {
      for (const style of [voice.art.activeLayer?.scene.style || voice.art.current?.style,
        voice.art.queued?.style, voice.pendingStyle]) {
        if (style) { usedPens.add(style.pen.id); usedPalettes.add(style.palette.id); }
      }
    }
    const pens = PEN_PROFILES.filter(pen => !usedPens.has(pen.id));
    const palettes = INK_FAMILIES.filter(palette => !usedPalettes.has(palette.id));
    if (!pens.length || !palettes.length) return null;
    const random = soundSeed === null ? () => this.random()
      : (() => { const source = new StyleDeck(hash(soundSeed + '|' + route + '|ink')); return () => source.random(); })();
    const pen = pens[Math.floor(random() * pens.length)];
    const palette = palettes[Math.floor(random() * palettes.length)];
    const variation = (random() - 0.5) * 4;
    const energy = profile ? clamp(profile.level) : 0.5, onsets = clamp(profile?.flux || 0);
    return { token: `INK-${++this.serial}`, pen: { ...pen,
      thickness: +(pen.thickness * (0.7 + energy * 0.6) * (0.94 + random() * 0.12)).toFixed(2),
      wobble: +(pen.wobble * (0.94 + random() * 0.12)).toFixed(2),
      dryness: clamp(pen.dryness + 30 * onsets, 0, 100) },
      palette, variation, mood, colors: colorsFor(palette, mood, variation) };
  }
  withMood(style, mood) {
    if (style.mood === mood) return style;
    return { ...style, token: `INK-${++this.serial}`, mood, colors: colorsFor(style.palette, mood, style.variation) };
  }
}

export function styleSettings(style) {
  if (!style) return {};
  const { renderer, thickness, wobble, pressure, dryness, opacity, overdraw } = style.pen;
  return { pen: renderer, thickness, wobble, pressure, dryness, opacity, overdraw,
    inkColors: style.colors, colourCount: style.colors.length, style };
}
