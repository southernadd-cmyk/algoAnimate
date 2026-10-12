import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { renderComposition } from '../../js/composition.js';
import { prepareEnsembleScene } from '../../js/ensemble-placement.js';
import { ensembleSettings } from '../../js/ensemble.js';

// Run the real pinned engines and vector preparation, using a no-op raster
// context. This measures the actual native path payload, not synthetic lines.
export function nativeRenderer() {
  const environment = { window: {} }; environment.globalThis = environment.window;
  vm.createContext(environment);
  for (const file of ['phi.js', 'random.js', 'palettes.js', 'marker.js', 'generator.js']) {
    vm.runInContext(readFileSync(new URL('../../vendor/algoart/' + file, import.meta.url), 'utf8'), environment);
  }
  vm.runInContext(readFileSync(new URL('../../js/ink-palette.js', import.meta.url), 'utf8'), environment);
  const A = environment.window.AlgoArt, stack = [];
  const context = { globalCompositeOperation: 'source-over',
    save() { stack.push({ strokeStyle: this.strokeStyle, globalCompositeOperation: this.globalCompositeOperation }); },
    restore() { Object.assign(this, stack.pop()); },
    scale() {}, transform() {}, translate() {}, rotate() {}, fillRect() {}, beginPath() {},
    moveTo() {}, lineTo() {}, bezierCurveTo() {}, stroke() {}, setLineDash() {} };
  return (route, seed, { orientation = 'landscape', density = 100, profile, style = null, phase = 0, sharedAnchor = true } = {}) => {
    const settings = ensembleSettings(route, seed, orientation, 'marker', density, style, profile, phase);
    A.rendererVersion = 7; A.svgRecorder = { precise: true, paths: [], paperMarks: [] };
    renderComposition(A, { getContext: () => context }, settings);
    return prepareEnsembleScene({ ...A.svgRecorder, mode: route.id, seed, style: settings.style,
      ensembleRole: settings.ensembleRole, interlock: settings.interlock, sharedAnchor,
      width: A.W, height: A.H, paper: settings.paper, inkMemory: settings.inkMemory,
      markHierarchy: settings.markHierarchy, phraseScale: settings.phraseScale });
  };
}
