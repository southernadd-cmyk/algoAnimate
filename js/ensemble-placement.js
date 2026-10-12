import { prepareSceneGeometry } from './ink.js';
import { focalFromScene } from './focal-hierarchy.js';
import { hash } from './features.js';
import { GOLDEN_ANGLE } from './phi-layout.js';

const GOLDEN_LOW = 1 / ((1 + Math.sqrt(5)) / 2) ** 2;

// One anchor survives sound-seed changes and silent intervals. Supports occupy
// the other three golden intersections; their own musical clocks stay intact.
export function ensembleAnchor(width, height) {
  return { x: width * GOLDEN_LOW, y: height * GOLDEN_LOW, rx: width * .19, ry: height * .20 };
}

export function prepareEnsembleScene(scene) {
  if (!scene.ensembleRole || scene.sharedAnchor === false) return prepareSceneGeometry(scene);
  const prepared = prepareSceneGeometry({ ...scene, markHierarchy: false });
  const anchor = ensembleAnchor(scene.width, scene.height);
  const lane = scene.interlock?.lane ?? 0;
  const high = 1 - GOLDEN_LOW;
  const targets = [[high, GOLDEN_LOW], [GOLDEN_LOW, high], [high, high]];
  // Let the line-oriented and connective voices reach toward Growth's golden
  // intersection. Other voices retain their own territories, but lean into
  // the same conversation. Each voice keeps independent sound and ink timing.
  const connector = ['network', 'scribble', 'spiral'].includes(scene.mode);
  const bridge = connector ? .56 : .30;
  const corner = targets[lane % 3];
  const target = scene.ensembleRole === 'lead' ? anchor : {
    x: scene.width * corner[0] * (1 - bridge) + anchor.x * bridge,
    y: scene.height * corner[1] * (1 - bridge) + anchor.y * bridge
  };
  let motif, score = 0;
  if (scene.ensembleRole === 'lead') for (const path of prepared.paths) {
    const weight = path.extent * (path.geometry.segments.some(segment => segment.type === 'C') ? 1.3 : 1);
    if (path.role === 'gesture' && path.motif !== undefined && weight > score) { motif = path.motif; score = weight; }
  }
  const source = focalFromScene(motif === undefined ? prepared
    : { ...prepared, paths: prepared.paths.filter(path => path.motif === motif) });
  const matrices = prepared.paths.map(path => {
    const m = path.transform?.match(/^matrix\(([^)]+)\)$/)?.[1].trim().split(/[ ,]+/).map(Number);
    return m?.length === 6 && m.every(Number.isFinite) ? m : [1, 0, 0, 1, 0, 0];
  });
  const point = (p, m) => ({ x: m[0]*p.x + m[2]*p.y + m[4], y: m[1]*p.x + m[3]*p.y + m[5] });
  // Each sound-derived Growth composition takes a golden-angle orientation.
  // This rotates the actual vector directions around the focal mass, not the
  // entire canvas or the already-drawn ink. It stays fixed for the full phrase.
  const rotation = scene.ensembleRole === 'lead' && scene.mode === 'organic'
    ? GOLDEN_ANGLE * (hash(String(scene.seed ?? '') + '|growth-orientation') % 13) : 0;
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  const relative = (p, m) => {
    const q = point(p, m), dx = q.x - source.x, dy = q.y - source.y;
    return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
  };
  // Fit the rotated control hull, not the old horizontal one. Cubic control
  // points stay within paper and don't need post-hoc clamping. Existing layers
  // never move and saved scores hold the exact rotated path coordinates.
  let scale = 1;
  prepared.paths.forEach((path, index) => {
    for (const segment of path.geometry.segments) for (const p of segment.points) {
      const { x: dx, y: dy } = relative(p, matrices[index]);
      if (dx < 0) scale = Math.min(scale, (target.x - scene.width * .04) / -dx);
      if (dx > 0) scale = Math.min(scale, (scene.width * .96 - target.x) / dx);
      if (dy < 0) scale = Math.min(scale, (target.y - scene.height * .04) / -dy);
      if (dy > 0) scale = Math.min(scale, (scene.height * .96 - target.y) / dy);
    }
  });
  // Partners are large enough to exchange marks across the focal area, but
  // are still fitted to the page before they are drawn.
  if (scene.ensembleRole === 'support') scale *= connector ? .82 : .74;
  const paths = prepared.paths.map((path, index) => {
    // Bake the affine map into vector coordinates. This preserves curve shape
    // and nib width and gives live drawing, SVG and old score replay one geometry.
    const tokens = path.d.match(/[MLCZ]|-?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi);
    const commands = [];
    for (let i = 0; i < tokens.length;) {
      const type = tokens[i++].toUpperCase(), count = { M: 1, L: 1, C: 3, Z: 0 }[type];
      commands.push(type);
      for (let j = 0; j < count; j++) {
        const p = relative({ x: +tokens[i++], y: +tokens[i++] }, matrices[index]);
        commands.push(target.x + p.x * scale, target.y + p.y * scale);
      }
    }
    return { ...path, d: commands.join(' '), transform: undefined, geometry: undefined };
  });
  return prepareSceneGeometry({ ...scene, paths,
    goldenFocal: scene.ensembleRole === 'lead' ? anchor : null,
    placement: { anchor, target: { x: target.x, y: target.y }, scale, rotation,
      bridge: scene.ensembleRole === 'support' ? bridge : 0 } });
}
