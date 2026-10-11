import { clamp } from './features.js';
import { inkWindow, strokeWindow } from './ink.js';

export function layerStrokes(layer, gentle = false, opacity = 0.72, inkMemory = layer.scene.inkMemory ?? 0.7) {
  const scene = layer.scene, memory = inkMemory * (gentle ? 8 / 7 : 1);
  const paths = [];
  scene.paths.forEach((entry, index) => {
    const timing = scene.schedule[index];
    const { from, to } = layer.preview
      ? { from: clamp((layer.age * 1.6 - timing.start) / timing.duration), to: 1 }
      : inkWindow(layer.age, timing, memory);
    if (to <= from || !entry.geometry.length) return;
    const d = from === 0 && to === 1 ? entry.d
      : strokeWindow(entry.geometry, from, to).map(command => command.join(' ')).join(' ');
    paths.push({ d, stroke: entry.stroke, width: entry.width * (layer.pressure[index] ?? 1),
      opacity: clamp(entry.opacity) * opacity, lineCap: entry.lineCap || 'round',
      blend: entry.blend || 'source-over', transform: entry.transform,
      dash: entry.dash || [], dashOffset: (entry.dashOffset || 0) + from * entry.geometry.length });
  });
  return paths;
}

export function captureSheet(artwork, gentle = false) {
  const scene = artwork.paperScene;
  if (!scene) throw new Error('Wait for the paper to be ready.');
  return { width: scene.width, height: scene.height, paper: scene.paper,
    paperMarks: scene.paperMarks, paths: artwork.voices.filter(voice => artwork.enabled(voice))
      .flatMap(voice => voice.art.layers.flatMap(layer => layerStrokes(layer, gentle, 0.72, voice.art.current.inkMemory ?? 0.7))) };
}

export function paintSheet(context, sheet, scale = 1) {
  context.save(); context.scale(scale, scale);
  context.globalCompositeOperation = 'source-over'; context.globalAlpha = 1;
  context.fillStyle = sheet.paper; context.fillRect(0, 0, sheet.width, sheet.height);
  context.globalAlpha = 0.035;
  for (const mark of sheet.paperMarks) {
    context.fillStyle = mark.colour; context.fillRect(mark.x, mark.y, mark.w, mark.h);
  }
  for (const path of sheet.paths) {
    context.save();
    const matrix = path.transform?.match(/^matrix\(([^)]+)\)$/)?.[1].trim().split(/[ ,]+/).map(Number);
    if (matrix?.length === 6 && matrix.every(Number.isFinite)) context.transform(...matrix);
    context.strokeStyle = path.stroke; context.lineWidth = path.width;
    context.globalAlpha = path.opacity; context.lineCap = path.lineCap; context.lineJoin = 'round';
    context.globalCompositeOperation = path.blend;
    context.setLineDash(path.dash); context.lineDashOffset = path.dashOffset;
    context.stroke(new Path2D(path.d)); context.restore();
  }
  context.restore();
}

const xml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
export function sheetSVG(sheet) {
  const marks = sheet.paperMarks.map(mark => `<rect x="${mark.x}" y="${mark.y}" width="${mark.w}" height="${mark.h}" fill="${xml(mark.colour)}" opacity="0.035"/>`).join('');
  const paths = sheet.paths.map(path => `<path d="${xml(path.d)}" fill="none" stroke="${xml(path.stroke)}" stroke-width="${path.width}" opacity="${path.opacity}" stroke-linecap="${xml(path.lineCap)}" stroke-linejoin="round"${path.transform ? ` transform="${xml(path.transform)}"` : ''}${path.dash.length ? ` stroke-dasharray="${path.dash.join(' ')}" stroke-dashoffset="${path.dashOffset}"` : ''}${path.blend !== 'source-over' ? ` style="mix-blend-mode:${xml(path.blend)}"` : ''}/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sheet.width}" height="${sheet.height}" viewBox="0 0 ${sheet.width} ${sheet.height}"><title>ALGO / ANIMATE — current sheet</title><rect width="100%" height="100%" fill="${xml(sheet.paper)}"/>${marks}${paths}</svg>`;
}
