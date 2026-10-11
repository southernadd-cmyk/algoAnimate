// Geometry from AlgoArt's marker recorder. Partial strokes retain the original
// lines and cubic curves; only their visible arc-length interval changes.
import { clamp } from './features.js';

const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const mix = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function splitCurve(points, t) {
  const [a, b, c, d] = points;
  const ab = mix(a, b, t), bc = mix(b, c, t), cd = mix(c, d, t);
  const abc = mix(ab, bc, t), bcd = mix(bc, cd, t), middle = mix(abc, bcd, t);
  return [[a, ab, abc, middle], [middle, bcd, cd, d]];
}

function curvePart(points, from, to) {
  if (from === 0 && to === 1) return points;
  const left = to === 1 ? points : splitCurve(points, to)[0];
  return from === 0 ? left : splitCurve(left, from / to)[1];
}

function arcTable(points) {
  const samples = [{ t: 0, point: points[0], length: 0 }];
  function sample(curve, from, to, depth) {
    const chord = distance(curve[0], curve[3]);
    const polygon = distance(curve[0], curve[1]) + distance(curve[1], curve[2]) + distance(curve[2], curve[3]);
    // Also subdivide straight cubics: their parameter is not necessarily
    // proportional to distance, even when all four points are collinear.
    if (depth < 11 && (polygon - chord > 0.15 || to - from > 1 / 24)) {
      const [left, right] = splitCurve(curve, 0.5), mid = (from + to) / 2;
      sample(left, from, mid, depth + 1); sample(right, mid, to, depth + 1);
    } else {
      const previous = samples.at(-1);
      samples.push({ t: to, point: curve[3], length: previous.length + distance(previous.point, curve[3]) });
    }
  }
  sample(points, 0, 1, 0);
  return samples;
}

export function markerGeometry(d) {
  const tokens = d.match(/[MLCZ]|-?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) || [];
  const segments = [];
  let cursor = { x: 0, y: 0 }, origin = cursor, offset = 0, index = 0;
  const point = () => ({ x: Number(tokens[index++]), y: Number(tokens[index++]) });
  while (index < tokens.length) {
    const command = tokens[index++].toUpperCase();
    if (command === 'M') { cursor = point(); origin = cursor; continue; }
    let points;
    if (command === 'L') points = [cursor, point()];
    else if (command === 'C') points = [cursor, point(), point(), point()];
    else if (command === 'Z') points = [cursor, origin];
    else throw new Error('Unsupported marker path command: ' + command);
    if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('Invalid marker path');
    const arc = command === 'C' ? arcTable(points) : null;
    const length = arc ? arc.at(-1).length : distance(points[0], points[1]);
    if (length > 1e-8) segments.push({ type: command === 'C' ? 'C' : 'L', points, length, offset, arc });
    offset += length; cursor = points.at(-1);
  }
  return { segments, length: offset };
}

function parameterAt(segment, length) {
  if (!segment.arc) return clamp(length / segment.length);
  const samples = segment.arc;
  let low = 0, high = samples.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (samples[middle].length <= length) low = middle;
    else high = middle;
  }
  const a = samples[low], b = samples[high];
  return a.t + (b.t - a.t) * clamp((length - a.length) / Math.max(1e-8, b.length - a.length));
}

export function strokeWindow(geometry, from = 0, to = 1) {
  const start = clamp(from) * geometry.length, end = clamp(to) * geometry.length, commands = [];
  if (end - start < 1e-8) return commands;
  let last = null;
  for (const segment of geometry.segments) {
    const low = Math.max(start, segment.offset), high = Math.min(end, segment.offset + segment.length);
    if (high - low < 1e-8) continue;
    const a = parameterAt(segment, low - segment.offset), b = parameterAt(segment, high - segment.offset);
    const points = segment.type === 'C' ? curvePart(segment.points, a, b)
      : [mix(segment.points[0], segment.points[1], a), mix(segment.points[0], segment.points[1], b)];
    if (!last || distance(last, points[0]) > 1e-6) commands.push(['M', points[0].x, points[0].y]);
    commands.push(segment.type === 'C'
      ? ['C', points[1].x, points[1].y, points[2].x, points[2].y, points[3].x, points[3].y]
      : ['L', points[1].x, points[1].y]);
    last = points.at(-1);
  }
  return commands;
}

// Three pens share the work. Starts follow the marker recorder's order, with
// no pause between strokes on a pen, and every pen finishes within one cycle.
export function strokeSchedule(paths, penCount = 3) {
  const pens = new Array(Math.min(penCount, paths.length)).fill(0), schedule = [];
  for (const entry of paths) {
    const pen = pens.indexOf(Math.min(...pens)), work = Math.max(36, entry.geometry.length);
    schedule.push({ pen, start: pens[pen], duration: work });
    pens[pen] += work;
  }
  const total = Math.max(1, ...pens);
  return schedule.map(entry => ({ ...entry, start: entry.start / total, duration: entry.duration / total }));
}

export function pathBounds(d) {
  const numbers = d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) || [0, 0];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    minX = Math.min(minX, numbers[i]); maxX = Math.max(maxX, numbers[i]);
    minY = Math.min(minY, numbers[i + 1]); maxY = Math.max(maxY, numbers[i + 1]);
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, extent: Math.hypot(maxX - minX, maxY - minY) };
}

// Curve subdivision and pen scheduling are performed inside the composition
// worker. Geometry tables can cross the worker boundary; Path2D objects cannot.
export function prepareSceneGeometry(scene) {
  const paths = scene.paths.map(entry => ({
    ...entry, geometry: markerGeometry(entry.d), ...pathBounds(entry.d)
  }));
  return { ...scene, paths, schedule: strokeSchedule(paths), geometryPrepared: true };
}

export function inkWindow(age, timing, memory = 0.7) {
  return {
    from: clamp((age - timing.start - memory) / timing.duration),
    to: clamp((age - timing.start) / timing.duration)
  };
}
