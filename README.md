# ALGO / ANIMATE — v0.06

**Sound, in living ink.** A browser-only audio experiment using the golden ratio
and ALGO / ART's expressive marker renderer.

[Open AlgoAnimate](https://southernadd-cmyk.github.io/algoAnimate/) ·
[Original AlgoArt](https://southernadd-cmyk.github.io/algoart/)

## Try it

1. Click **Try demo sound**, choose an **Audio file**, connect a **Microphone**, or
   use **Browser tab** to select a playing tab and enable **Share tab audio**.
2. Watch eight AlgoArt engines layer their marker strokes on one canvas.
   Each voice has its own pen profile and colour family, both randomised at
   its next drawing. The cards show actual ink samples and live input meters.
   Choose a colour mood and landscape or portrait paper.
3. Adjust sensitivity, pen response, layer density, drawing-cycle duration and smoothing.
   **Gentle motion** starts enabled if your system requests reduced motion.
4. Click **Record**, then **Stop recording** and **Download video**. Recordings
   contain the artwork and sound; optionally include the waveform. A take stops
   automatically after three minutes. **Save frame** exports a PNG.

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

- One Web Audio analyser measures six features of the same sound source.
  They are three frequency bands and three other measurements, rather than six
  separate audio tracks. All eight engines are present together:

| Engine | Its audio input |
| --- | --- |
| Orbital Studies | Bass (35–250 Hz) |
| Recursive Divisions | Mids (250–2200 Hz) |
| Radiant Systems | Treble (2200–14000 Hz) |
| Growth Systems | Loudness |
| Constructed Forms | Brightness / spectral centroid |
| Connected Fields | Onsets / spectral change |
| Automatic Marks | Bass + onsets |
| Golden Trajectories | Mids + treble |

- The bass, mid and treble meters sum squared FFT magnitudes across their
  frequency ranges and compensate for Web Audio's Blackman window to estimate
  band RMS. All three use the same fixed −60 to 0 dBFS display scale, with a fast
  attack and short release. Wider bands are not divided by their bin count.
  Numeric readings show real incoming levels, independent of the artist's
  sensitivity and smoothing controls. Pausing or disconnecting resets the meters;
  an empty band stays empty. The six tuned animation features keep their existing
  mapping, preserving the pen pace and seed behaviour.
- Each engine hashes a short, ordered, quantised history of only its assigned
  measurements into its own seed. Unassigned measurements cannot influence
  that engine's seed, pen pace or stroke pressure. There is no timestamp or
  random salt. The two combined routes use both inputs for their seed and their
  average strength for the drawing response.
- AlgoArt V7 generates genuine φ compositions and marker paths. New compositions
  are built in a worker where supported. Three pen timelines per engine draw the original
  marker paths progressively by arc length, including exact partial cubic
  curves, wobble, overdraw, ink colours, opacity, dryness and portrait transforms.
  This provides 24 pen lanes across eight independent clocks. Layers draw into
  the same canvas; paper is painted once so one engine cannot erase another.
  Each engine retains at most three ink generations. Layer density controls the
  marks per engine, with reduced defaults and translucent ink for readable overlap.
- Ink stays in place after it is drawn. Older strokes recede from their start
  while fresh ink grows from the pen tips, so the paper keeps changing without
  whole-image holds or crossfades while sound is present. A fresh composition with the current sound-derived seed and a new ink kit
  is prepared just before the next pen cycle. A late target joins
  within 200 ms of drawing time, while existing ink finishes on its own layer.
- Each route's signal controls its pen pace and pressure. Quiet routes stop their
  own clock while other routes keep drawing. Band/level/brightness activity uses
  a 0.012 feature floor and 90 ms release; the onset route uses a 0.035 floor and
  a 240 ms drawing tail. The global silence gate overrides every route, including
  onset tails. Pressure is captured when each stroke begins, so completed marks
  do not float or pulse around the paper. The idle canvas waits for audio before
  laying down ink; the initial eight prepared compositions are not shown as posters.
- Drawing stops when the incoming audio goes silent, including when a video
  in a captured tab is paused. The gate uses current RMS above 0.0015 with a
  90 ms release for tiny gaps; visual smoothing cannot keep the pens running.
  Source capture/analysis adds a small detection delay. Pausing an uploaded file,
  a muted track or a suspended audio context closes the gate immediately.
  Silence freezes the actual pixels and discards obsolete pending targets.
  Sound resumes drawing from the held frame; a steady input can keep tracing
  its current seed with fresh pens and palettes each cycle. Gentle motion slows the pens and pressure response.
- Canvas video and a clone of the Web Audio recording track are combined into a
  `MediaStream`. Stopping a take preserves the connected sound source. Chrome's
  streaming WebM export receives duration metadata so players report its length;
  the large media payload is preserved in Blob slices without re-encoding it.

The sound seeds are deterministic for the **same ordered feature measurements**.
Pen and palette choices deliberately vary between drawings and sessions. A
separate session random generator assigns eight different kits from 16 pen/nib
profiles and 16 colour families. The profiles use the engine’s seven original
pen behaviours with different nib width, wobble, pressure, dryness and overdraw
settings. Current, queued and building kits reserve their pen and palette so
independent handoffs cannot share a current kit. Existing strokes keep their
original ink; style changes begin with the next drawing. Colour mood adjusts
tones while preserving the separate families. Silence freezes kits as well as
pixels. The public palette hook is adapted in `js/ink-palette.js`, in both the
worker and fallback renderer; no vendor source is modified.

Live capture timing, noise, sample rates and browser FFT behaviour can differ,
so v0.06 does not promise bit-identical videos across devices or mathematical
uniqueness for every possible sound. Frame rate targets 30 FPS and
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

GitHub Actions also runs a Chromium smoke test covering all eight composition
engines drawing simultaneously, 24 pen lanes, distinct native pen profiles and
colour families, random style handoffs under changing and steady audio, held
styles in silence, card-to-renderer agreement, keyboard controls, touch targets,
calibrated bass/mid/treble levels, amplitude response and silent meters,
real bass-only/mid-only/treble-only route
isolation, measured frame rate, continuous marker drawing between seed changes, captured-audio silence
and resume, exact frozen artwork pixels, silent intervals in exported video,
live demo analysis,
recording with audio, waveform export, source
cleanup, permission errors, audio-file replay, portrait rendering and mobile
layout. It inspects the exported video with `ffprobe`, saves screenshots and a
sample take as workflow artifacts, then deploys only after those checks pass.
Physical microphone and real tab-share permission dialogs need manual testing.
