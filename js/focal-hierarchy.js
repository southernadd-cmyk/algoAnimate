// Focal composition analysis operates on generated vector paths, never on the
// vendored engine. It is deterministic and does not mutate incoming scenes.
import { markerGeometry } from './ink.js';

function samples(path) {
  const geometry = path.geometry || markerGeometry(path.d);
  const points = [];
  for (const segment of geometry.segments) {
    const p = segment.points;
    points.push(p[0], p[p.length - 1]);
    if (p.length === 4) points.push({ x: (p[0].x + 3*p[1].x + 3*p[2].x + p[3].x)/8,
      y: (p[0].y + 3*p[1].y + 3*p[2].y + p[3].y)/8 });
  }
  const matrix = path.transform?.match(/^matrix\(([^)]+)\)$/)?.[1].trim().split(/[ ,]+/).map(Number);
  return matrix?.length === 6 && matrix.every(Number.isFinite)
    ? points.map(p => ({ x: matrix[0]*p.x + matrix[2]*p.y + matrix[4],
      y: matrix[1]*p.x + matrix[3]*p.y + matrix[5] })) : points;
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

export function softenSupportScene(scene, focal) {
  const basePaths = scene.hierarchyBasePaths || scene.paths;
  if (!focal && !scene.hierarchyBasePaths) return scene;
  const paths = basePaths.map((path, index) => {
    if (!focal) return { ...scene.paths[index], opacity: path.opacity, width: path.width };
    const pts = samples(path);
    if (!pts.length) return path;
    const influence = pts.reduce((total, p) => {
      const r = Math.hypot((p.x - focal.x) / focal.rx, (p.y - focal.y) / focal.ry);
      return total + Math.max(0, Math.min(1, (1.4 - r) / .9));
    }, 0) / pts.length;
    // This biases whole recorded strokes; it never clips or erases them.
    return { ...scene.paths[index], opacity: (path.opacity ?? 1) * (1 - .55 * influence),
      width: path.width * (1 - .22 * influence) };
  });
  return { ...scene, hierarchyBasePaths: basePaths, paths };
}
