// Eight voices on one sheet. Each region is a leaf of three recursive
// golden-ratio cuts; the partition fills the paper in either orientation.
// Regions are spatial guidance, not clipping masks or visible panel borders.
export const PHI = (1 + Math.sqrt(5)) / 2;
export const GOLDEN_SHARE = 1 / PHI;
export const GOLDEN_SHORT = 1 - GOLDEN_SHARE;
export const GOLDEN_REGION_COUNT = 8;

// Reassign voices only after a full phrase-scale turn. Each engine continues
// drawing its earlier ink while its next audio-generated scene takes a new
// golden territory. There is no focal leader and no forced scene synchrony.
export function goldenRegions(width, height, phase = 0) {
  if (!(width > 0 && height > 0)) throw new Error('Invalid sheet dimensions');
  const regions = [];
  const branch = (r, depth) => {
    if (depth === 3) { regions.push(r); return; }
    // Split the longer side to avoid very thin cells. Both children remain
    // genuinely phi-proportioned shares of their parent.
    const splitX = r.w >= r.h;
    if (splitX) {
      const first = r.w * GOLDEN_SHARE;
      branch({ x: r.x, y: r.y, w: first, h: r.h }, depth + 1);
      branch({ x: r.x + first, y: r.y, w: r.w - first, h: r.h }, depth + 1);
    } else {
      const first = r.h * GOLDEN_SHARE;
      branch({ x: r.x, y: r.y, w: r.w, h: first }, depth + 1);
      branch({ x: r.x, y: r.y + first, w: r.w, h: r.h - first }, depth + 1);
    }
  };
  branch({ x: 0, y: 0, w: width, h: height }, 0);
  // A golden-angle step changes who occupies which space every ~12.5 seconds
  // of actual sound (phase comes from goldenRotationPhase). No wall-clock RNG.
  const turn = Math.floor(Math.max(0, phase) * 2 + 1e-8);
  const shift = (turn * 5) % GOLDEN_REGION_COUNT;
  return regions.map((r, i) => ({ ...r, index: i, turn, voice: (i + GOLDEN_REGION_COUNT - shift) % GOLDEN_REGION_COUNT }));
}
export function voiceRegion(width, height, lane, phase = 0) {
  if (!Number.isInteger(lane) || lane < 0 || lane >= GOLDEN_REGION_COUNT)
    throw new Error('Invalid ensemble voice lane');
  return goldenRegions(width, height, phase).find(region => region.voice === lane);
}
