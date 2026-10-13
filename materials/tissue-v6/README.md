# ALGO/ART Tissue & Graphite V6 material source

These three files are copied unchanged from `southernadd-cmyk/algoart` at the start of the 13 October 2026 material-port work. They are the actual material implementation (V5 torn outlines plus V6 pale tissue, seeded pigments, relief, graphite details), **not a CSS effect or a redraw of the source marker canvas**.

`js/tissue-worker.js` supplies Canvas via OffscreenCanvas and adapts the already-composed, time-windowed vector paths to `A.renderOil`'s recorder. The path-stub swatches have no geometry; they keep the palette stable when only a handful of partial strokes are visible. ALGO Animate's original ALGO/ART V8 engine source under `vendor/algoart/` remains pinned and unmodified.

Material is computed asynchronously at preview resolution so the audio, timeline and main UI can continue at their normal cadence. Print export requests a higher-resolution re-render. The material PNG/video is raster; SVG exports deliberately retain the editable source vectors.
