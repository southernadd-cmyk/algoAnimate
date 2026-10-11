// Animation-specific interpretation of the unchanged AlgoArt renderer. The
// generated positions and golden-ratio geometry remain native to each engine.
import { hash } from './features.js';
import { interlockRenderer } from './phi-layout.js';

export function renderComposition(A, canvas, settings) {
  if (!settings.markHierarchy) return A.render(canvas, settings, 0.5);
  const originalRect = A.rect, originalStroke = A.stroke;
  const restorePlacement = interlockRenderer(A, settings);
  const shapeHooks = new Map();
  const scale = settings.elementScale || 1;
  for (const [name, dimensions] of [['ellipse', [2, 3]], ['poly', [2]], ['arc', [2]]]) {
    if (!A[name]) continue;
    const original = A[name]; shapeHooks.set(name, original);
    A[name] = function (...args) {
      for (const index of dimensions) args[index] *= scale;
      return original.apply(this, args);
    };
  }
  const drawLine = A.drawLine;
  if (drawLine && settings.audioControls?.brightness !== null && settings.audioControls) {
    shapeHooks.set('drawLine', drawLine);
    A.drawLine = function (ctx, a, b, colour, pen, random) {
      return drawLine.call(this, ctx, a, b, colour, { ...pen, curveBias: settings.curveBias }, random);
    };
  }
  let role = 'gesture', motif = 0, rectangles = 0;
  A.stroke = function (...args) {
    // Onset-rich gestures become broken strokes while quiet phrases retain curves.
    const onsets = settings.audioControls?.onsets || 0;
    if (args[5] && onsets && args[4].chance(onsets)) args[5] = false;
    const start = A.svgRecorder?.paths.length || 0, id = ++motif;
    const result = originalStroke.apply(this, args);
    for (const entry of A.svgRecorder?.paths.slice(start) || []) {
      entry.role = role; entry.motif = id;
    }
    return result;
  };
  A.rect = function (ctx, centre, width, height, rotation, colour, pen, random) {
    const frame = width > A.W * 0.75 && height > A.H * 0.75;
    // A full-paper border is an occasional supporting event, rather than the
    // inevitable opening stroke of every Recursive Divisions composition.
    if (frame && hash(settings.seed + '|frame') % 5 !== 0) return;
    if (!frame && rectangles++ >= settings.rectangleBudget) return;
    const previousRole = role;
    role = frame ? 'frame' : 'structure';
    try {
      return originalRect.call(this, ctx, centre, width * scale, height * scale, rotation, colour,
        { ...pen, opacity: pen.opacity * (frame ? 0.34 : 0.62),
          thickness: pen.thickness * (frame ? 0.65 : 0.82) }, random);
    } finally { role = previousRole; }
  };
  let result;
  try { result = A.render(canvas, settings, 0.5); }
  finally {
    A.rect = originalRect; A.stroke = originalStroke;
    for (const [name, method] of shapeHooks) A[name] = method;
    restorePlacement();
  }

  // Automatic Marks may reject every proposed gesture when its reserved
  // negative-space voids overlap all available anchors. In that rare case,
  // keep its sound-derived seed, pen, golden-angle lane and native algorithm;
  // retry once without the optional void mask rather than accepting a blank
  // composition (which would prevent all eight voices from starting).
  // Clear the first pass's grain so retries don't double the paper texture.
  const recorder = A.svgRecorder;
  if (settings.mode === 'scribble' && !settings.emptyScribbleRecovery
    && settings.negativeSpace > 0 && recorder?.paths.length === 0) {
    recorder.paths.length = 0;
    if (recorder.paperMarks) recorder.paperMarks.length = 0;
    return renderComposition(A, canvas, { ...settings, negativeSpace: 0, emptyScribbleRecovery: true });
  }
  return result;
}
