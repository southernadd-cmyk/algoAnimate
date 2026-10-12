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
  const bins = Array.from({ length: 7 * 7 }, () => 0);
  for (const path of scene.paths) {
    const pts = samples(path);
    if (!pts.length) continue;
    const weight = Math.max(0.05, Math.min(12, (path.width || 1) * (path.opacity ?? 1)));
    for (const p of pts) {
      const x = Math.max(0, Math.min(6, Math.floor(p.x / width * 7)));
      const y = Math.max(0, Math.min(6, Math.floor(p.y / height * 7)));
      bins[y * 7 + x] += weight / pts.length;
    }
  }
  const index = bins.indexOf(Math.max(...bins));
  return { x: ((index % 7) + .5) / 7 * width,
    y: (Math.floor(index / 7) + .5) / 7 * height,
    rx: width * .19, ry: height * .20 };
}

export function softenSupportScene(scene, focal) {
  if (!focal) return scene;
  const paths = scene.paths.map(path => {
    const pts = samples(path);
    if (!pts.length) return path;
    const influence = pts.reduce((total, p) => {
      const r = Math.hypot((p.x - focal.x) / focal.rx, (p.y - focal.y) / focal.ry);
      return total + Math.max(0, Math.min(1, (1.4 - r) / .9));
    }, 0) / pts.length;
    // This biases whole recorded strokes; it never clips or erases them.
    return { ...path, opacity: (path.opacity ?? 1) * (1 - .55 * influence),
      width: path.width * (1 - .22 * influence) };
  });
  return { ...scene, paths };
}
