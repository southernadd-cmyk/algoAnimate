// Focal composition analysis operates on generated vector paths, never on the
// vendored engine. It is deterministic and does not mutate incoming scenes.
import { markerGeometry } from './ink.js';

const sampleCache = new WeakMap();
const influenceCache = new WeakMap();
export const FOCAL_TRANSITION_SECONDS = 1;

function samples(path) {
  const cached = sampleCache.get(path);
  if (cached && cached.d === path.d && cached.transform === path.transform && cached.geometry === path.geometry) return cached.points;
  const geometry = path.geometry || markerGeometry(path.d);
  const points = [];
  for (const segment of geometry.segments) {
    const p = segment.points;
    points.push(p[0], p[p.length - 1]);
    if (p.length === 4) points.push({ x: (p[0].x + 3*p[1].x + 3*p[2].x + p[3].x)/8,
      y: (p[0].y + 3*p[1].y + 3*p[2].y + p[3].y)/8 });
  }
  const matrix = path.transform?.match(/^matrix\(([^)]+)\)$/)?.[1].trim().split(/[ ,]+/).map(Number);
  const transformed = matrix?.length === 6 && matrix.every(Number.isFinite)
    ? points.map(p => ({ x: matrix[0]*p.x + matrix[2]*p.y + matrix[4],
      y: matrix[1]*p.x + matrix[3]*p.y + matrix[5] })) : points;
  sampleCache.set(path, { d: path.d, transform: path.transform, geometry: path.geometry, points: transformed });
  return transformed;
}

export function focalFromScene(scene) {
  const width = scene.width, height = scene.height;
  if (!(width > 0 && height > 0)) throw new Error('Invalid focal scene dimensions');
  const bins = Array.from({ length: 7 * 7 }, () => ({ weight: 0, x: 0, y: 0 }));
  for (const path of scene.paths) {
    const pts = samples(path);
    if (!pts.length) continue;
    const weight = Math.max(0.05, Math.min(12, (path.width || 1) * (path.opacity ?? 1)));
    for (const p of pts) {
      const x = Math.max(0, Math.min(6, Math.floor(p.x / width * 7)));
      const y = Math.max(0, Math.min(6, Math.floor(p.y / height * 7)));
      const bin = bins[y * 7 + x], w = weight / pts.length;
      bin.weight += w; bin.x += p.x * w; bin.y += p.y * w;
    }
  }
  const index = bins.findIndex(bin => bin.weight === Math.max(...bins.map(b => b.weight)));
  const cellX = index % 7, cellY = Math.floor(index / 7);
  // Centre on the actual nearby ink rather than one grid-cell midpoint. Avoid
  // averaging distant islands: only the dominant cell and its neighbours vote.
  let sx = 0, sy = 0, total = 0;
  for (let y = Math.max(0, cellY - 1); y <= Math.min(6, cellY + 1); y++) {
    for (let x = Math.max(0, cellX - 1); x <= Math.min(6, cellX + 1); x++) {
      const bin = bins[y * 7 + x];
      sx += bin.x; sy += bin.y; total += bin.weight;
    }
  }
  const rx = width * .19, ry = height * .20;
  return { x: Math.max(rx, Math.min(width - rx, total ? sx / total : width / 2)),
    y: Math.max(ry, Math.min(height - ry, total ? sy / total : height / 2)), rx, ry };
}

// Hysteresis suppresses small shifts in successive lead compositions. Large
// changes take a bounded step; the centre never teleports to a different cell.
export function stabilizeFocal(next, previous = null) {
  if (!previous || previous.rx !== next.rx || previous.ry !== next.ry) return next;
  const dx = next.x - previous.x, dy = next.y - previous.y;
  const distance = Math.hypot(dx, dy), deadband = Math.min(next.rx, next.ry) * .18;
  if (distance <= deadband) return previous;
  const progress = .42 * (distance - deadband) / distance;
  return { ...next, x: previous.x + dx * progress, y: previous.y + dy * progress };
}

// Cache transformed samples once per native path and reuse one numeric buffer
// per scene. A moving focal point never reparses paths or replaces scene/layer
// objects; a stationary focal point needs no new influence calculation at all.
export function supportInfluences(scene, focal) {
  if (!focal) return null;
  const paths = scene.hierarchyBasePaths || scene.paths;
  let cached = influenceCache.get(scene);
  if (cached?.focal === focal && cached.paths === paths) return cached.values;
  if (!cached || cached.paths !== paths) cached = { paths, values: new Float64Array(paths.length) };
  for (let index = 0; index < paths.length; index++) {
    const points = samples(paths[index]);
    let total = 0;
    for (const p of points) {
      const dx = (p.x - focal.x) / focal.rx, dy = (p.y - focal.y) / focal.ry;
      const squared = dx * dx + dy * dy;
      if (squared <= .25) total += 1;
      else if (squared < 1.96) total += (1.4 - Math.sqrt(squared)) / .9;
    }
    cached.values[index] = points.length ? total / points.length : 0;
  }
  cached.focal = focal;
  influenceCache.set(scene, cached);
  return cached.values;
}

export function easeFocal(from, to, elapsed) {
  const t = Math.max(0, Math.min(1, elapsed / FOCAL_TRANSITION_SECONDS));
  if (t === 0) return from;
  if (t === 1) return to;
  const blend = t * t * (3 - 2 * t);
  return { ...to, x: from.x + (to.x - from.x) * blend, y: from.y + (to.y - from.y) * blend };
}

export function softenSupportScene(scene, focal) {
  const basePaths = scene.hierarchyBasePaths || scene.paths;
  if (!focal && !scene.hierarchyBasePaths) return scene;
  const influences = supportInfluences(scene, focal);
  const paths = basePaths.map((path, index) => {
    if (!focal) return { ...scene.paths[index], opacity: path.opacity, width: path.width };
    const influence = influences[index];
    // This biases whole recorded strokes; it never clips or erases them.
    return { ...scene.paths[index], opacity: (path.opacity ?? 1) * (1 - .55 * influence),
      width: path.width * (1 - .22 * influence) };
  });
  return { ...scene, hierarchyBasePaths: basePaths, paths };
}
