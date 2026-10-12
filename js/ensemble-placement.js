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

// φ derives the two entry stations on each paper edge. A scene's seeded
// golden-angle direction selects the edge; the other axis sits at .382 or .618.
// Keeping only a pen-safe inset avoids the empty band caused by fitting the
// full native Growth geometry around an interior focal intersection.
export function goldenEdgeEntrance(width, height, seed, rotation) {
  const inset = Math.max(2, Math.min(width, height) * .005);
  const fraction = hash(String(seed ?? '') + '|growth-edge-split') % 2
    ? 1 - GOLDEN_LOW : GOLDEN_LOW;
  const x = Math.cos(rotation), y = Math.sin(rotation);
  if (Math.abs(x) >= Math.abs(y)) return {
    x: x < 0 ? inset : width - inset, y: height * fraction,
    side: x < 0 ? 'left' : 'right', fraction
  };
  return { x: width * fraction, y: y < 0 ? inset : height - inset,
    side: y < 0 ? 'top' : 'bottom', fraction };
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
  const edgeGrowth = scene.ensembleRole === 'lead' && scene.mode === 'organic'
    && scene.width > scene.height;
  const entrance = edgeGrowth ? goldenEdgeEntrance(scene.width, scene.height, scene.seed, rotation) : null;
  const entrancePathIndex = edgeGrowth ? prepared.paths.findIndex(path =>
    path.role === 'gesture' && (motif === undefined || path.motif === motif)) : -1;
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
    let d = commands.join(' ');
    if (index === entrancePathIndex && commands[0] === 'M' && commands.length >= 6) {
      // Extend the native opening Growth stroke rather than overlaying a
      // decorative line. Its first pen now enters at a φ-position on the paper
      // edge, then joins the original native curve with tangent continuity.
      // This keeps the same path count, brush, motif and score identity.
      const start = { x: +commands[1], y: +commands[2] };
      const next = { x: +commands[4], y: +commands[5] };
      const dx = start.x - entrance.x, dy = start.y - entrance.y;
      const length = Math.hypot(dx, dy) || 1;
      const direction = hash(String(scene.seed ?? '') + '|growth-edge-bend') % 2 ? 1 : -1;
      const bend = direction * Math.min(length * GOLDEN_LOW * GOLDEN_LOW, Math.min(scene.width, scene.height) * .055);
      const safeInset = Math.max(2, Math.min(scene.width, scene.height) * .005);
      const within = (value, limit) => Math.max(safeInset, Math.min(limit - safeInset, value));
      const c1 = {
        x: within(entrance.x + dx * GOLDEN_LOW + (-dy / length) * bend, scene.width),
        y: within(entrance.y + dy * GOLDEN_LOW + (dx / length) * bend, scene.height)
      };
      const c2 = {
        x: within(start.x - (next.x - start.x) * GOLDEN_LOW, scene.width),
        y: within(start.y - (next.y - start.y) * GOLDEN_LOW, scene.height)
      };
      d = ['M', entrance.x, entrance.y, 'C', c1.x, c1.y, c2.x, c2.y,
        start.x, start.y, ...commands.slice(3)].join(' ');
    }
    // Native pen curves are preserved at sub-pixel precision. Eliminating
    // surplus floating-point digits matters for three-minute vector scores:
    // it reduces bytes without deleting strokes or increasing capture limits.
    d = d.split(' ').map(token => Number.isFinite(+token) && token !== ''
      ? String(+Number(token).toFixed(3)) : token).join(' ');
    return { ...path, d, transform: undefined, geometry: undefined };
  });
  return prepareSceneGeometry({ ...scene, paths,
    goldenFocal: scene.ensembleRole === 'lead' ? anchor : null,
    placement: { anchor, target: { x: target.x, y: target.y }, scale, rotation, entrance,
      bridge: scene.ensembleRole === 'support' ? bridge : 0 } });
}
