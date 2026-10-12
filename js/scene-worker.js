// The original engine is deliberately kept separate from animation behaviour.
self.window = self;
importScripts('../vendor/algoart/phi.js', '../vendor/algoart/random.js',
  '../vendor/algoart/palettes.js', './ink-palette.js', '../vendor/algoart/marker.js', '../vendor/algoart/generator.js');

const geometryModule = import('./ink.js');
const rendererVersionModule = import('./renderer-version.js');
const compositionModule = import('./composition.js');

self.onmessage = async ({ data: { id, settings } }) => {
  try {
    // Await module loading before touching the renderer's shared recorder:
    // several initial scene requests can arrive while imports are pending.
    const [{ prepareSceneGeometry }, { renderComposition }, { ALGOART_RENDERER_VERSION }] = await Promise.all([geometryModule, compositionModule, rendererVersionModule]);
    const canvas = new OffscreenCanvas(1, 1);
    const A = self.AlgoArt;
    A.rendererVersion = ALGOART_RENDERER_VERSION;
    A.svgRecorder = { precise: true, paths: [], paperMarks: [] };
    renderComposition(A, canvas, settings);
    const scene = { ...A.svgRecorder, seed: settings.seed, mode: settings.mode, style: settings.style,
      composition: { audio: settings.audioControls, interlock: settings.interlock, elements: settings.elements,
        curveBias: settings.curveBias, shapeAmount: settings.shapeAmount, rotation: settings.rotation,
        elementScale: settings.elementScale, nesting: settings.nesting, inkMemory: settings.inkMemory },
      inkMemory: settings.inkMemory, markHierarchy: settings.markHierarchy, phraseScale: settings.phraseScale, width: A.W, height: A.H, paper: settings.paper };
    A.svgRecorder = null;
    self.postMessage({ id, scene: prepareSceneGeometry(scene) });
  } catch (error) {
    self.AlgoArt.svgRecorder = null;
    self.postMessage({ id, error: error.message });
  }
};
