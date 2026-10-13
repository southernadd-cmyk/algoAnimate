# ALGO / ANIMATE

**Sound, in living ink.** An experimental, browser-based audio-reactive drawing instrument built from the eight golden-ratio composition systems of [ALGO/ART](https://southernadd-cmyk.github.io/algoart/).

[Open AlgoAnimate](https://southernadd-cmyk.github.io/algoAnimate/) · [View source](https://github.com/southernadd-cmyk/algoAnimate)

## What it does

AlgoAnimate listens to music or sound and progressively assembles translucent torn tissue, seeded pigments and graphite on one shared canvas. Each of eight voices responds to a different audio feature: bass, mids, treble, loudness, brightness, spectral change, bass + onsets, or mids + treble. It is a live interpretation rather than an instrument-recognition system. The composition uses shared recursive golden-ratio regions, but these are guides rather than clipping masks, so neighbouring marks can overlap.

**Eight equal voices / one sheet:** The lead-and-support hierarchy has been replaced for new compositions. All eight engines receive the same baseline mark and ink budgets, and none is faded to make room for Growth. A recursive three-level φ partition provides eight contiguous golden-proportion territories; each engine's native ALGO/ART V8 strokes are composed into its region, without visible panels or clipping. Territories exchange owners at phrase-scale golden-angle intervals, while each voice's smoothed sound input changes how fully it fills its space. Previous layers fade naturally as fresh compositions occupy their next territory. A little reach across region boundaries keeps this a single drawing rather than eight separate posters. Uncheck **Eight golden territories** under **Audio & motion** to draw all eight engines over the whole sheet without regional guidance. Earlier scores preserve their recorded lead/support fades for exact playback.

## Tissue & Graphite V6 (experimental preview)

Live frames now use the actual ALGO/ART Tissue & Graphite V6 material renderer instead of showing marker strokes. ALGO/ART V8 vectors, eight equal voices, golden territories, sound-driven stroke windows and pen-pressure timings remain the structural input. Three unmodified upstream material files live in `materials/tissue-v6/`; a separate worker paints the visible geometry at a bounded preview resolution, keeping browser audio and the interface responsive. Rendering may update more slowly than the 30 FPS animation clock on low-powered devices; a fresh canvas initially remains blank while its first tissue buffer is computed.

PNG and WebM record the tissue image. Print PNG re-renders the current sheet with a higher quality setting; SVG intentionally retains editable vector geometry, as in ALGO/ART. New scores record each frame's material seed and palette and replay as tissue. Older scores continue to replay in their original marker rendering mode. This is an experimental branch for visual and performance comparison; it does not change the deployed version until reviewed.

## Getting started

1. Choose **Try demo sound**, **Audio file**, **Microphone**, or **Browser tab** (where supported).
2. Watch the drawing develop. Adjust density, sensitivity, speed, smoothing, colour mood and page orientation. Gentle motion is ON by default and Eight golden territories is OFF by default; both remain configurable. Use **Solo** or **Mute** on individual voices to explore their contribution.
3. Select **Record** to capture the artwork with audio, then **Stop recording** and **Download video**. Recordings stop automatically after three minutes.
4. Use **Save frame** for PNG, 3× print PNG or SVG. Use **Save score** to keep a replayable vector timeline; **Load score** and **Replay** work without the original sound.
5. Choose **Performance** for distraction-free projection. Space pauses drawing, R toggles recording and C clears the sheet.

The demo offers Lo-fi, Drum & bass, Jazz, Classical and Synthwave, with Next track and Next genre controls. On reaching the end of a genre, playback continues into the next genre and wraps after the last. All tracks are CC0; see [demo credits and source licences](media/demo/README.md). Music plays from the site without third-party streaming at runtime, and recordings remain on your device.

## Browser support and limitations

Desktop Chrome is the initial target for browser-tab audio. Permissions, tab/system audio, recording formats and screen wake lock support depend on the browser and operating system. Uploaded files and microphones provide alternatives. Live results can vary with audio devices, browser analysers and frame rates; deterministic drawing seeds do not guarantee identical live-video files across systems. Performance targets 30 FPS, subject to device load.

## Preservation and reproducibility

Scores store a versioned file format and vector geometry, so playback does not need to regenerate scenes from the current ALGO/ART composition engine. Tissue scores also store the seed and source colours needed for their material treatment. Version-2 and version-3 scores save vector geometry once and use lossless compression for vectors and completed pressure records. Older hierarchy scores retain their recorded focal ellipse and reproduce moving fades exactly; new equal-voice scores use no focal fade. The score's renderer field is retained as provenance; support is governed by the score-format version. Version-3 scores also record the support fade strength. Earlier version-2 scores retain their original 55% fade; version-1 scores retain their baked-in ink. Imported scores are checked for valid geometry, references, sizes, bounded decompression and paint values.

The underlying ALGO/ART source is pinned and kept unmodified under `vendor/algoart/`. CI verifies its SHA-256 equality against the [recorded upstream commit](vendor/algoart/PROVENANCE.md). Changes to rendering behaviour should preserve saved scores and historical ALGO/ART artworks.

## Development

This is a static HTML/CSS/JavaScript project, with no backend or production build step. Serve it through a local HTTP server, for example `python3 -m http.server 8000`.

Use Node.js 22 or later to run:

```sh
npm run check
npm test
npm run test:browser
npm run test:demo
bash scripts/verify-vendor.sh
```

The browser tests require Playwright and the appropriate browser dependencies. GitHub Actions runs the checks before deployment to GitHub Pages.

For detailed engine routing, capture, timing and visual mechanics, see [ARCHITECTURE.md](ARCHITECTURE.md). For upstream source details, see [PROVENANCE.md](vendor/algoart/PROVENANCE.md).

## Project status

Experimental release v0.19. Visual composition, score compatibility and browser capture continue to evolve. The current artistic challenge is balancing eight independent golden-ratio systems into a coherent evolving ensemble, without losing individual musical responsiveness.
