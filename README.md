# ALGO / ANIMATE

**Sound, in living ink.** An experimental, browser-based audio-reactive drawing instrument built from the eight golden-ratio composition systems of [ALGO/ART](https://southernadd-cmyk.github.io/algoart/).

[Open AlgoAnimate](https://southernadd-cmyk.github.io/algoAnimate/) · [View source](https://github.com/southernadd-cmyk/algoAnimate)

## What it does

AlgoAnimate listens to music or sound and draws marker strokes progressively onto one shared canvas. Each of eight voices responds to a different audio feature: bass, mids, treble, loudness, brightness, spectral change, bass + onsets, or mids + treble. It is a live interpretation rather than an instrument-recognition system. The composition uses golden-ratio structures, but overlapping voices do **not** guarantee a single collision-free or mathematically unified layout.

**Experimental ensemble collaboration:** Growth Systems (loudness) remains the recognisable focal voice at the upper-left golden intersection (38.2% across and down), but does not monopolise the page. Connected Fields, Automatic Marks and Golden Trajectories now bridge toward Growth's gestures, while the other systems retain their own golden territories and lean inward. Supporting voices receive more marks, longer-lasting ink and much gentler overlap fading, so their independently sound-driven strokes can cross and participate in the same composition. Scenes are fitted once when built; existing marks never slide. Muting or soloing Growth restores unsoftened support ink. Uncheck **Shared golden anchor** under **Audio & motion** to compare unconstrained placement. The focal voice does not change during musical peaks.

## Getting started

1. Choose **Try demo sound**, **Audio file**, **Microphone**, or **Browser tab** (where supported).
2. Watch the drawing develop. Adjust density, sensitivity, speed, smoothing, colour mood and page orientation. Use **Solo** or **Mute** on individual voices to explore their contribution.
3. Select **Record** to capture the artwork with audio, then **Stop recording** and **Download video**. Recordings stop automatically after three minutes.
4. Use **Save frame** for PNG, 3× print PNG or SVG. Use **Save score** to keep a replayable vector timeline; **Load score** and **Replay** work without the original sound.
5. Choose **Performance** for distraction-free projection. Space pauses drawing, R toggles recording and C clears the sheet.

The three CC0 demo tracks are by HoliznaCC0; see [demo credits](media/demo/README.md). Sound files and recordings remain on your device.

## Browser support and limitations

Desktop Chrome is the initial target for browser-tab audio. Permissions, tab/system audio, recording formats and screen wake lock support depend on the browser and operating system. Uploaded files and microphones provide alternatives. Live results can vary with audio devices, browser analysers and frame rates; deterministic drawing seeds do not guarantee identical live-video files across systems. Performance targets 30 FPS, subject to device load.

## Preservation and reproducibility

Scores store a versioned file format and vector geometry, so playback does not need to regenerate scenes from the current ALGO/ART renderer. Version-2 and version-3 scores save vector geometry once, use lossless compression for vectors and completed pressure records, and record the displayed focal ellipse in each frame. Moving fades replay exactly without duplicating scenes. The score's renderer field is retained as provenance; support is governed by the score-format version. Version-3 scores also record the support fade strength. Earlier version-2 scores retain their original 55% fade; version-1 scores retain their baked-in ink. Imported scores are checked for valid geometry, references, sizes, bounded decompression and paint values.

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
