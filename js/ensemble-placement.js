import { prepareSceneGeometry, markerGeometry } from './ink.js';
import { focalFromScene } from './focal-hierarchy.js';
import { voiceRegion } from './golden-regions.js';

const GOLDEN_LOW = 1 / ((1 + Math.sqrt(5)) / 2) ** 2;

// Supporting voices still converse across golden intersections. V8 Growth
// chooses its own edge/interior roots and golden-angle directions upstream.
export function ensembleAnchor(width, height) {
  return { x: width * GOLDEN_LOW, y: height * GOLDEN_LOW, rx: width * .19, ry: height * .20 };
}


// These equal-voice territories are guides, never hard clipping rectangles.
// All marks (including native V8 Growth edge roots) retain their relative
// geometry, but each entire native composition is fitted to its own region.
// A little bleed makes neighbours converse across the invisible boundaries.
function prepareEqualVoice(scene) {
  const prepared = prepareSceneGeometry({ ...scene, markHierarchy: false });
  const lane = scene.interlock?.lane ?? 0;
  const phase = scene.interlock?.phase || 0;
  const region = voiceRegion(scene.width, scene.height, lane, phase);
  const audio = scene.composition?.audio;
  const energy = Math.max(0, Math.min(1, audio?.energy ?? .5));
  const bass = Math.max(0, Math.min(1, audio?.bass ?? 0));
  const onsets = Math.max(0, Math.min(1, audio?.onsets ?? 0));
  const matrices = prepared.paths.map(path => {
    const m = path.transform?.match(/^matrix\(([^)]+)\)$/)?.[1].trim().split(/[ ,]+/).map(Number);
    return m?.length === 6 && m.every(Number.isFinite) ? m : [1, 0, 0, 1, 0, 0];
  });
  const point = (p, m) => ({ x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5] });
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  prepared.paths.forEach((path, i) => {
    for (const segment of path.geometry.segments) for (const p of segment.points) {
      const q = point(p, matrices[i]);
      minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x);
      minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y);
    }
  });
  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);
  const centre = { x: Number.isFinite(minX + maxX) ? (minX + maxX) / 2 : scene.width / 2,
    y: Number.isFinite(minY + maxY) ? (minY + maxY) / 2 : scene.height / 2 };
  // Drawing breathes to its OWN audio channel, not another voice's loudness.
  // Golden cells tessellate, but lively marks should cross their invisible
  // boundaries: a typical passage reaches ~8% beyond its own territory.
  const reach = .94 + .28 * energy + .08 * bass;
  const scale = Math.min(1.3, region.w * reach / contentWidth, region.h * reach / contentHeight);
  const target = { x: region.x + region.w * (.50 + .055 * (energy - .5)),
    y: region.y + region.h * (.50 + .055 * (onsets - .5)) };
  const paths = prepared.paths.map((path, i) => {
    const tokens = path.d.match(/[MLCZ]|-?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) || [];
    const commands = [];
    for (let j = 0; j < tokens.length;) {
      const type = tokens[j++].toUpperCase(), count = { M: 1, L: 1, C: 3, Z: 0 }[type];
      if (count === undefined) throw new Error('Unsupported marker command in golden region');
      commands.push(type);
      for (let k = 0; k < count; k++) {
        const p = point({ x: +tokens[j++], y: +tokens[j++] }, matrices[i]);
        commands.push(String(+(target.x + (p.x - centre.x) * scale).toFixed(3)),
          String(+(target.y + (p.y - centre.y) * scale).toFixed(3)));
      }
    }
    return { ...path, d: commands.join(' '), transform: undefined, geometry: undefined,
      width: path.width * Math.sqrt(Math.max(0.1, scale)) };
  });
  for (let i = 0; i < paths.length; i++) {
    try { markerGeometry(paths[i].d); }
    catch (error) { throw new Error('Invalid transformed ' + scene.mode + ' path #' + i
      + ': ' + JSON.stringify({ d: paths[i].d.slice(0, 280), original: prepared.paths[i].d.slice(0, 180), scale, region })
      + ' (' + error.message + ')'); }
  }
  return prepareSceneGeometry({ ...scene, paths, markHierarchy: false,
    placement: { region, target, scale, equalVoice: true, reach } });
}

export function prepareEnsembleScene(scene) {
  if (scene.ensembleRole === 'equal' && scene.sharedAnchor !== false) return prepareEqualVoice(scene);
  if (!scene.ensembleRole || scene.sharedAnchor === false) return prepareSceneGeometry(scene);
  const prepared = prepareSceneGeometry({ ...scene, markHierarchy: false });

  if (scene.ensembleRole === 'lead' && scene.mode === 'organic') {
    // Native V8 can have two to four independent edge/interior roots. Do not
    // rotate, translate, fit or insert an entrance curve: even scaling about a
    // focal mass would lift edge roots off the paper. Keep the actual vectors.
    // Omitting goldenFocal lets LayeredArtwork track and smoothly ease the
    // dominant ink region rather than forcing all roots to a single anchor.
    return { ...prepared, placement: { nativeGrowth: true, scale: 1 } };
  }

  const anchor = ensembleAnchor(scene.width, scene.height);
  const lane = scene.interlock?.lane ?? 0;
  const high = 1 - GOLDEN_LOW;
  const targets = [[high, GOLDEN_LOW], [GOLDEN_LOW, high], [high, high]];
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
  const point = (p, m) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
  const relative = (p, m) => {
    const q = point(p, m);
    return { x: q.x - source.x, y: q.y - source.y };
  };
  // Only supporting voices are fitted within a 4% inset. Growth owns its
  // page-edge geometry and bypasses this entire placement operation.
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
  if (scene.ensembleRole === 'support') scale *= connector ? .82 : .74;
  const paths = prepared.paths.map((path, index) => {
    // Bake transforms for score replay and SVG without modifying other voices'
    // original sound-seeded composition and pen timing.
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
    const d = commands.join(' ').split(' ').map(token => Number.isFinite(+token) && token !== ''
      ? String(+Number(token).toFixed(3)) : token).join(' ');
    return { ...path, d, transform: undefined, geometry: undefined };
  });
  return prepareSceneGeometry({ ...scene, paths,
    goldenFocal: scene.ensembleRole === 'lead' ? anchor : null,
    placement: { anchor, target: { x: target.x, y: target.y }, scale,
      bridge: scene.ensembleRole === 'support' ? bridge : 0 } });
}
