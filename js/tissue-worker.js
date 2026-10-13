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

self.onmessage = ({ data }) => {
  const { id, epoch, sheet, seed, palette, quality = 0.39 } = data;
  try {
    const started = performance.now();
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
    self.postMessage({ id, epoch, bitmap, renderMs: performance.now() - started }, [bitmap]);
  } catch (error) {
    self.postMessage({ id, epoch, error: String(error?.message || error) });
  } finally {
    visible = [];
  }
};
