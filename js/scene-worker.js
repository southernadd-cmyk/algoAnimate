// The original engine is deliberately kept separate from animation behaviour.
self.window = self;
importScripts('../vendor/algoart/phi.js', '../vendor/algoart/random.js',
  '../vendor/algoart/palettes.js', './ink-palette.js', '../vendor/algoart/marker.js', '../vendor/algoart/generator.js');

self.onmessage = ({ data: { id, settings } }) => {
  try {
    const canvas = new OffscreenCanvas(1, 1);
    const A = self.AlgoArt;
    A.rendererVersion = 7;
    A.svgRecorder = { precise: true, paths: [], paperMarks: [] };
    A.render(canvas, settings, 0.5);
    const scene = { ...A.svgRecorder, seed: settings.seed, mode: settings.mode, style: settings.style, inkMemory: settings.inkMemory, width: A.W, height: A.H, paper: settings.paper };
    A.svgRecorder = null;
    self.postMessage({ id, scene });
  } catch (error) {
    self.AlgoArt.svgRecorder = null;
    self.postMessage({ id, error: error.message });
  }
};
