// Render the original ALGO/ART V6 Tissue & Graphite material off the UI thread.
// Every input is the *currently visible* portion of the eight vector voices.
// The source renderer is vendored without changes under materials/tissue-v6/.
self.window = self;
self.document = {
  createElement(tag) {
    if (tag !== 'canvas') throw new Error('Only canvas is supported by the material worker.');
    return new OffscreenCanvas(1, 1);
  }
};
importScripts('../vendor/algoart/random.js',
  '../materials/tissue-v6/oil-render.js',
  '../materials/tissue-v6/oil-surface.js',
  '../materials/tissue-v6/oil-material.js');

const A = self.AlgoArt;
let visible = [];
// The source material's renderOil entrypoint records vectors through A.render.
// The animation has ALREADY composed its vectors, so replace only this recorder
// adapter, never the original composition, positioning, or audio machinery.
A.render = () => {
  A.svgRecorder.paths.push(...visible);
  return { voids: [] };
};


/*
 * Standard live mode: composite each sound-driven composition separately.
 * An immutable layer never borrows another voice's seed or random stream.
 * All conversion and cached bitmaps stay in this worker; ALGO/ART V6 sources
 * remain byte-identical to their pinned upstream commit.
 *
 * V6 produces opaque paper, so an isolated layer is converted to a transparent
 * pigment approximation by un-matting pixels against cream paper. This is not
 * a pixel-identical rendering of a whole-sheet V6 scene.
 */
const layerCache = new Map();
let layerEpoch = null;
function clearLayerCache() { layerCache.clear(); layerEpoch = null; }
function isolatedLayer(sheet, seed, palette, quality) {
  if (!sheet.paths.length) return null;
  const target = new OffscreenCanvas(1, 1);
  visible = [...(palette || []).slice(0, 12).map(stroke => ({
    d: 'M 0 0', stroke, width: 0
  })), ...sheet.paths];
  try {
    A.renderOil(target, {
      seed, mode: 'ensemble', orientation: sheet.height > sheet.width ? 'portrait' : 'landscape',
      colourCount: Math.max(1, Math.min(12, palette?.length || 6)), paper: '#f5f0e6'
    }, quality, false, 6);
  } finally { visible = []; }

  const result = new OffscreenCanvas(target.width, target.height);
  const source = target.getContext('2d', { willReadFrequently: true });
  const pixels = source.getImageData(0, 0, target.width, target.height);
  const bytes = pixels.data, base = [245, 240, 230];
  for (let i = 0; i < bytes.length; i += 4) {
    const difference = Math.max(
      Math.abs(bytes[i] - base[0]), Math.abs(bytes[i + 1] - base[1]),
      Math.abs(bytes[i + 2] - base[2]));
    const alpha = Math.min(1, Math.max(0, (difference - 4) / 115));
    if (alpha <= 0) { bytes[i + 3] = 0; continue; }
    // Reverse the cream-paper premultiplication before alpha compositing.
    for (let c = 0; c < 3; c++)
      bytes[i + c] = Math.round(Math.max(0, Math.min(255,
        base[c] + (bytes[i + c] - base[c]) / alpha)));
    bytes[i + 3] = Math.round(alpha * 255);
  }
  result.getContext('2d').putImageData(pixels, 0, 0);
  return result;
}
function layeredFrame(data) {
  const { id, epoch, layers = [], update = null, quality = 0.39, sheet } = data;
  if (layerEpoch !== epoch) { clearLayerCache(); layerEpoch = epoch; }
  const inUse = new Set(layers.map(layer => String(layer.id)));
  for (const key of layerCache.keys()) if (!inUse.has(key)) layerCache.delete(key);
  if (update) {
    layerCache.set(String(update.id), isolatedLayer(
      { ...sheet, paths: update.paths }, update.seed, update.palette, quality));
  }
  const portrait = sheet.height > sheet.width;
  const width = portrait ? 1000 : 1400, height = portrait ? 1400 : 1000;
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(width * quality)),
    Math.max(1, Math.round(height * quality)));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f5f0e6';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const layer of layers) {
    const cached = layerCache.get(String(layer.id));
    if (!cached) continue;
    ctx.globalAlpha = Math.min(1, Math.max(0, layer.opacity ?? 0.85));
    ctx.drawImage(cached, 0, 0, canvas.width, canvas.height);
  }
  ctx.globalAlpha = 1;
  const bitmap = canvas.transferToImageBitmap();
  self.postMessage({ id, epoch, bitmap }, [bitmap]);
}

self.onmessage = ({ data }) => {
  if (data.kind === 'clear-layers') { clearLayerCache(); return; }
  if (data.kind === 'layered') {
    try { layeredFrame(data); }
    catch (error) { self.postMessage({ id: data.id, epoch: data.epoch, error: String(error?.message || error) }); }
    return;
  }
  const { id, epoch, sheet, seed, palette, quality = 0.39 } = data;
  try {
    // Palette swatches do not contain drawable geometry; they fix the material
    // colours across a partial-stroke animation and are skipped by skeleton().
    visible = [...(palette || []).slice(0, 12).map(stroke => ({
      d: 'M 0 0', stroke, width: 0
    })), ...sheet.paths];
    const portrait = sheet.height > sheet.width;
    const target = new OffscreenCanvas(1, 1);
    A.renderOil(target, {
      seed, mode: 'ensemble', orientation: portrait ? 'portrait' : 'landscape',
      colourCount: Math.max(1, Math.min(12, palette?.length || 6)),
      paper: '#f5f0e6'
    }, quality, false, 6);
    const bitmap = target.transferToImageBitmap();
    self.postMessage({ id, epoch, bitmap }, [bitmap]);
  } catch (error) {
    self.postMessage({ id, epoch, error: String(error?.message || error) });
  } finally {
    visible = [];
  }
};
