// Animation-specific interpretation of the unchanged AlgoArt renderer. The
// generated positions and golden-ratio geometry remain native to each engine.
import { hash } from './features.js';

export function renderComposition(A, canvas, settings) {
  if (!settings.markHierarchy) return A.render(canvas, settings, 0.5);
  const originalRect = A.rect, originalStroke = A.stroke;
  let role = 'gesture', motif = 0, rectangles = 0;
  A.stroke = function (...args) {
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
      return originalRect.call(this, ctx, centre, width, height, rotation, colour,
        { ...pen, opacity: pen.opacity * (frame ? 0.34 : 0.62),
          thickness: pen.thickness * (frame ? 0.65 : 0.82) }, random);
    } finally { role = previousRole; }
  };
  try { return A.render(canvas, settings, 0.5); }
  finally { A.rect = originalRect; A.stroke = originalStroke; }
}
