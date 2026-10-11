# ALGO / ANIMATE — v0.03

**Make sound visible.** A browser-only audio experiment using the golden ratio
and ALGO / ART's expressive marker renderer.

[Open AlgoAnimate](https://southernadd-cmyk.github.io/algoAnimate/) ·
[Original AlgoArt](https://southernadd-cmyk.github.io/algoart/)

## Try it

1. Click **Try demo sound**, choose an **Audio file**, connect a **Microphone**, or
   use **Browser tab** to select a playing tab and enable **Share tab audio**.
2. Watch the incoming waveform and the live artwork. Choose any of eight AlgoArt
   engines, a palette and landscape or portrait paper.
3. Adjust sensitivity, pen response, drawing-cycle duration and smoothing.
   **Gentle motion** starts enabled if your system requests reduced motion.
4. Click **Record**, then **Stop recording** and **Download video**. Recordings
   contain the artwork and sound; optionally include the waveform. A take stops
   automatically after three minutes. **Save this frame** exports a PNG.

Keep the animation tab visible while recording. Files and recordings remain on
your device; the application does not upload sound or require an account.

## Browser support

Desktop Chrome is the initial target for tab-audio capture. A browser's sharing
dialog controls which tabs/windows and audio sources are available; no website
can silently listen to every tab. System audio, mobile capture and protected
media vary by browser, operating system and source. Microphone and file inputs
provide alternatives. Cancelling permission leaves an existing source running.

Export format is detected with `MediaRecorder.isTypeSupported`: WebM with audio
is preferred; MP4 is used where supported. A recording's file extension follows
its actual container. The canvas shape is preserved (1400 × 1000 landscape or
1000 × 1400 portrait); enabling the waveform adds 156 pixels below it.

## How sound becomes artwork

- Web Audio measures loudness, bass/mid/treble, spectral centroid and spectral
  changes. A short, quantised history of those measurements generates changing
  seeds, with no timestamp or random salt.
- AlgoArt V7 generates genuine φ compositions and marker paths. New compositions
  are built in a worker where supported. Three pen timelines draw the original
  marker paths progressively by arc length, including exact partial cubic
  curves, wobble, overdraw, ink colours, opacity and dryness.
- Ink stays in place after it is drawn. Older strokes recede from their start
  while fresh ink grows from the pen tips, so the paper keeps changing without
  whole-image holds or crossfades while sound is present. A fresh sound-derived
  composition is prepared just before the next pen cycle. A late target joins
  within 200 ms of drawing time, while existing ink finishes on its own layer.
- Loudness and spectral changes control pen pace; bass adds pressure to larger
  strokes and treble to finer marks. Pressure is captured when each stroke
  begins, so completed marks do not float or pulse around the paper.
- Drawing stops when the incoming audio goes silent, including when a video
  in a captured tab is paused. The gate uses current RMS above 0.0015 with a
  90 ms release for tiny gaps; visual smoothing cannot keep the pens running.
  Source capture/analysis adds a small detection delay. Pausing an uploaded file,
  a muted track or a suspended audio context closes the gate immediately.
  Silence freezes the actual pixels and discards obsolete pending targets.
  Sound resumes drawing from the held frame; a steady audible sound can keep
  tracing its current seed. Gentle motion slows the pens and pressure response.
- Canvas video and a clone of the Web Audio recording track are combined into a
  `MediaStream`. Stopping a take preserves the connected sound source. Chrome's
  streaming WebM export receives duration metadata so players report its length;
  the large media payload is preserved in Blob slices without re-encoding it.

The mapping is deterministic for the **same ordered feature measurements and
settings**. Live capture timing, noise, sample rates and browser FFT behaviour
can differ, so v0.03 does not promise bit-identical videos across devices or
mathematical uniqueness for every possible sound. Frame rate targets 30 FPS and
depends on the device, engine and number of marks. This is a prototype.

The pinned engine and font are documented in
[vendor/algoart/PROVENANCE.md](vendor/algoart/PROVENANCE.md); the original source
files remain unchanged. Audio and animation live separately in `js/`.

## Hosting on GitHub Pages

The application is static HTML/CSS/JavaScript. It needs no backend, API key,
production dependencies or build step. `.github/workflows/pages.yml` tests the
application and deploys the static assets.

In **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**.
Then run the **Test and deploy Pages** workflow, or push a commit to `main`.
Pages supplies the HTTPS required by capture APIs. The workflow stages only
public application files; tests and package tooling are excluded from the site.

## Development

Serve the repo with any local HTTP server; for example, `python3 -m http.server
8000`. Then open `http://localhost:8000/`.

Node.js 22 or later:

```sh
npm run check
npm test
```

GitHub Actions also runs a Chromium smoke test covering every composition
engine, continuous marker drawing between seed changes, captured-audio silence
and resume, exact frozen artwork pixels, silent intervals in exported video,
live demo analysis,
recording with audio, waveform export, source
cleanup, permission errors, audio-file replay, portrait rendering and mobile
layout. It inspects the exported video with `ffprobe`, saves screenshots and a
sample take as workflow artifacts, then deploys only after those checks pass.
Physical microphone and real tab-share permission dialogs need manual testing.
