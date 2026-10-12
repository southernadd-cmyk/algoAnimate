import { inkWindow } from '../../js/ink.js';
import { supportInfluences, SUPPORT_OPACITY_REDUCTION, SUPPORT_WIDTH_REDUCTION } from '../../js/focal-hierarchy.js';

const cache = new WeakMap();
// Arc-length quadrature follows the renderer's visible interval, including
// partial cubics, transforms, pen pressure, old layers and support fades.
export function visibleFocalInk(layer, focal, memory, soften = false) {
  const influences = soften ? supportInfluences(layer.scene, focal) : null;
  return layer.scene.paths.reduce((total, path, index) => {
    let points = cache.get(path);
    if (!points) {
      points = [];
      const matrix = path.transform?.match(/^matrix\(([^)]+)\)$/)?.[1].trim().split(/[ ,]+/).map(Number);
      for (const segment of path.geometry.segments) {
        const arc = segment.arc || [{ point: segment.points[0], length: 0 }, { point: segment.points[1], length: segment.length }];
        for (let i = 1; i < arc.length; i++) {
          const a = arc[i-1], b = arc[i], length = b.length-a.length;
          const steps = Math.max(1, Math.ceil(length / 6));
          for (let j = 0; j < steps; j++) {
            const t = (j+.5)/steps;
            let x = a.point.x+(b.point.x-a.point.x)*t, y = a.point.y+(b.point.y-a.point.y)*t;
            if (matrix?.length === 6) [x,y] = [matrix[0]*x+matrix[2]*y+matrix[4], matrix[1]*x+matrix[3]*y+matrix[5]];
            points.push({ x,y, u: (segment.offset+a.length+length*t)/path.geometry.length, length: length/steps });
          }
        }
      }
      cache.set(path, points);
    }
    const timing = layer.scene.schedule[index];
    const window = layer.preview ? { from: Math.max(0, Math.min(1, (layer.age*1.6-timing.start)/timing.duration)), to: 1 }
      : inkWindow(layer.age, timing, memory);
    const influence = influences?.[index] || 0;
    const weight = path.width*(path.opacity ?? 1)*(layer.pressure[index] ?? 1)*(1-SUPPORT_WIDTH_REDUCTION*influence)*(1-SUPPORT_OPACITY_REDUCTION*influence);
    for (const p of points) if (p.u >= window.from && p.u <= window.to
      && Math.hypot((p.x-focal.x)/focal.rx, (p.y-focal.y)/focal.ry) <= 1) total += p.length*weight;
    return total;
  },0);
}
