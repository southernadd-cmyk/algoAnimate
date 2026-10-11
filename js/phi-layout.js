const PHI = (1 + Math.sqrt(5)) / 2;
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// Every engine samples its own slots from one fixed interleaved sunflower.
// Unlike an engine-local spiral, element count changes don't rescale anchors.
export const GOLDEN_SCAFFOLD_SLOTS = 128;
export const GOLDEN_ROTATION_SECONDS = 60;
export function goldenRotationPhase(activeSeconds) {
  return GOLDEN_ANGLE * Math.max(0, activeSeconds) / GOLDEN_ROTATION_SECONDS;
}
export function goldenLanePoint(width, height, index, count, lane, lanes = 8, phase = 0) {
  const fraction = Math.max(0, Math.min(1, (index + 0.5) / Math.max(1, count)));
  const sample = Math.min(GOLDEN_SCAFFOLD_SLOTS - 1, Math.floor(fraction * GOLDEN_SCAFFOLD_SLOTS));
  const slot = sample * lanes + lane;
  const progress = (slot + 0.65) / (GOLDEN_SCAFFOLD_SLOTS * lanes);
  const radial = progress ** (1 / PHI), angle = slot * GOLDEN_ANGLE + phase;
  return { x: width * (0.5 + Math.cos(angle) * 0.465 * radial),
    y: height * (0.5 + Math.sin(angle) * 0.455 * radial), a: angle, rad: radial, slot };
}

export function interlockRenderer(A, settings) {
  if (!settings.interlock) return () => {};
  const { lane, lanes, phase = 0 } = settings.interlock;
  const originals = new Map();
  const replace = (name, method) => { if (A[name]) { originals.set(name, A[name]); A[name] = method; } };
  const makeR = A.makeR;
  replace('makeR', function (seed) {
    // Native AlgoArt includes the entire settings JSON in two RNG keys. Keep
    // the sound seed, route and purpose suffix, but don't hash smooth controls
    // or ink kits again: nearby control values should steer the same dice.
    if (typeof seed === 'string' && seed.startsWith(settings.seed + '|{')) {
      const end = seed.lastIndexOf('}');
      seed = settings.seed + '|' + settings.mode + '|composition' + seed.slice(end + 1);
    }
    return makeR.call(this, seed);
  });
  const point = (i, count) => goldenLanePoint(A.W, A.H, i, count, lane, lanes, phase);
  let focal = 0;
  const phiPoint = A.phiPoint;
  replace('phiPoint', function (s, random) {
    const native = phiPoint.call(this, s, random), anchor = point(focal++ % Math.max(1, s.elements), s.elements);
    const pull = s.phiStrength / 100;
    return { x: native.x + (anchor.x - native.x) * pull, y: native.y + (anchor.y - native.y) * pull };
  });
  replace('goldenCanvasPoint', function (i, count) { return point(i, count); });
  const distributed = A.distributedPhiPoints;
  replace('distributedPhiPoints', function (count, s, random) {
    return distributed.call(this, count, s, random).map((native, i) => {
      const anchor = point(i, count), cell = native.cell;
      return { ...native, x: anchor.x, y: anchor.y,
        cell: cell ? { ...cell, x: anchor.x - cell.w / 2, y: anchor.y - cell.h / 2 } : cell };
    });
  });
  return () => { for (const [name, method] of originals) A[name] = method; };
}
