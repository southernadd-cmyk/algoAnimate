# ALGO / ANIMATE — v0.14

**Sound, in living ink.** A browser-only audio experiment using the golden ratio
and ALGO / ART's expressive marker renderer.

[Open AlgoAnimate](https://southernadd-cmyk.github.io/algoAnimate/) ·
[Original AlgoArt](https://southernadd-cmyk.github.io/algoart/)

## Try it

1. Click **Try demo sound** for three rotating lo-fi tracks, choose an **Audio file**, connect a **Microphone**, or
   use **Browser tab** to select a playing tab and enable **Share tab audio**.
2. Watch eight AlgoArt engines layer their marker strokes on one canvas.
   Each voice has its own pen profile and colour family, both chosen from sound at
   its next drawing. The cards show actual ink samples and live input meters.
   Choose a colour mood and landscape or portrait paper. Click a card or **Solo** to isolate a drawing voice; **Mute** hides and holds it. The audio continues unchanged.
3. Adjust composition density, sensitivity, pen response, drawing-cycle duration and smoothing.
   **Gentle motion** starts enabled if your system requests reduced motion.
4. Click **Record**, then **Stop recording** and **Download video**. Recordings
   contain the artwork and sound; optionally include the waveform. A take stops
   automatically after three minutes. **Save frame** offers screen PNG, 3× print PNG (4200 × 3000 landscape, tagged at 300 dpi) or vector SVG.

5. **Save score** keeps the feature history and ink timeline captured with a take. **Load score** or **Replay** plays it without audio; pause, restart or seek, then export a frame.
6. **Performance** hides the studio for projection. Move the pointer or tap to reveal controls; Escape exits. Space pauses the pens, R starts/stops recording, and C clears. Shortcuts leave typing and focused controls alone.
7. **How it listens** overlays the eight input-to-pen mappings, measured band dBFS, RMS gate, spectral centroid and positive flux. The overlay is separate from frame and video exports.

Projection and recording request a screen wake lock where the browser permits it; the studio reports whether it is awake, released, temporarily failed or unavailable. A lock is released when both activities end, and requested again on return to a visible tab.

Recording uses a dedicated worker clock and explicitly captures each painted
frame, so switching to the sound tab does not depend on the preview's animation
callbacks. Files and recordings remain on your device; the application does not
upload sound or require an account.

The demo plays **Bubbles**, **Calm Current** and **Tokyo Sunset** by HoliznaCC0,
from [Public Domain Lo-fi](https://holiznacc0.bandcamp.com/album/public-domain-lo-fi).
The artist explicitly released the album under CC0. Tracks advance automatically
and wrap around; **Next** skips a track, and the audio controls pause or seek.
Music goes through the same analyser and recording path as an uploaded file.
The MP3s are served with the site, require no API key or third-party playback
service, and are fetched only when the demo is used. Only one track streams at
a time. Source and licence details are in [media/demo/README.md](media/demo/README.md).

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

- The **Onsets / change** meter uses the unamplified maximum of actual
  positive spectral-flux observations between UI refreshes (~100 ms). It is a
  relative upward spectrum-change ratio, not a volume level or an estimated
  probability of a beat. This meter, and the onsets part of **Bass + onsets**,
  are independent of the artistic smoothing/sensitivity controls; there is
  no 3× display boost or slow artificial release.
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
  and their marker arc-length geometry are prepared in the worker where supported,
  leaving the animation thread to construct only the browser's Path2D objects.
  The initial active pen now draws a tiny real marker arc in the first audible
  frame. Other engines enter over about 260 ms, avoiding both sudden fully drawn
  lines and the previous blank 1.1-second restart delay.
  On the first clean-sheet sound entrance, active engines enter 27 ms apart and
  their pen speed eases up over 120 ms, without altering the sound-derived seeds.
  First sound-seeded replacements wait for the clean-sheet introduction to finish
  rather than competing with the first frames. Pausing the audio subsequently
  holds the ink and resumes immediately without replaying the entrance.
  Three pen timelines per engine draw the original
  marker paths progressively by arc length, including exact partial cubic
  curves, wobble, overdraw, ink colours, opacity, dryness and portrait transforms.
  This provides 24 pen lanes across eight independent clocks. Layers draw into
  the same canvas; paper is painted once so one engine cannot erase another.
  Each engine retains at most three ink generations. Composition density spans
  0–100%, with a more open 25% default. The sparse end reduces subjects, internal
  detail, recursion, nesting and overlap, requests more negative space and shortens
  the visible ink history. All eight engines still draw; density does not simply
  make their ink more transparent. Native engine minimum geometry is retained.
- An animation adapter gives rectangles a supporting role: their count is
  bounded, their ink is thinner and quieter, and enclosing page frames appear
  occasionally rather than on every recursive drawing. Expressive engines use
  lines, curves, circles, arcs and polygons. A chosen native gesture receives a
  stronger accent, completes its stroke, holds briefly, then recedes by arc
  length. Supporting ink keeps the sparse rolling window. Orbital Studies,
  Growth Systems, Automatic Marks and Golden Trajectories unfold over longer
  phrases. The default base cycle is about five seconds; the pace control still
  allows quick drawing. Every engine retains its assigned sound input.
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
- Tab and microphone capture request echo cancellation, noise suppression and
  automatic gain control off. Supported constraints are reapplied to the granted
  track. Browsers can reject or ignore capture preferences; read-only diagnostics
  report actual processing settings where available, without device identifiers.
  Canvas video and a clone of the original captured audio track are combined into
  a `MediaStream`, preserving its channels and levels without passing through the
  analysis graph. Files and the lo-fi demo use the Web Audio destination.
  Stopping a take preserves the connected sound source. Chrome's
  streaming WebM export receives duration metadata so players report its length;
  the large media payload is preserved in Blob slices without re-encoding it.

The sound seeds are deterministic for the **same ordered feature measurements**.
Sound also steers continuous composition controls through a 0.75-second phrase
envelope: bass increases shape scale and nesting, brightness and treble move
line gestures from curves toward straight edges, onsets increase shape accents,
rotation and broken strokes, and each route's energy adjusts its element budget
and ink retention. **Energy means each route's own assigned inputs**, not always
volume: Constructed Forms uses brightness, Connected Fields uses onsets, and
combination routes average their assigned features. Unassigned channels never
steer that voice's composition. Density still limits the whole ensemble.
If a rare Automatic Marks seed makes every proposed stroke fall inside a protected
negative-space void, the adapter deterministically retries once without the
optional void mask. The original AlgoArt renderer and sound-derived seed remain
unchanged; successful first passes and all other engines are unaffected.
Substantial changes in the smoothed assigned signal (at least 0.15) request a
new composition early, with a 1.25-second cooldown; small variations wait for
the normal cycle. Existing strokes keep their geometry and pressure, and an
early refresh becomes visible only after the new scene builds and begins its
ink handoff. Similar sound steers similar controls, while hashed
seeds still provide variation; this is not semantic recognition of instruments.
The animation adapter keeps continuous controls and ink choices out of the
native renderer's additional settings hash, so they steer the same random
sequence instead of scrambling it again with every small parameter change.

The engines share a fixed 128-slot-per-lane golden-angle scaffold.
Each voice samples its own interleaved lane (0, 8, 16… versus 1, 9, 17…);
variable element counts choose different subsets without redefining the
spiral's radius for other voices. The shared layout turns one golden angle
per **minute of active sound**, freezing during pauses and silence. Each new
composition snapshots that phase, so marks already on the paper never rotate
or jump. Native divisions and long gestures still cross lanes: these are
disjoint candidate anchors, not collision-free ink territories.

Each drawing's sound seed and route also choose its ink kit from 16 pen/nib
profiles and 16 colour families, with no unseeded session randomness. Current,
queued and building kits reserve their pen and palette to keep voices distinct.
The same sound seed, route and reservation state choose the same kit. Steady
sound can alternate between available kits at drawing boundaries. Energy
adjusts nib width and onsets add dry texture. Colour mood preserves families;
silence holds kits and pixels. Placement and marker hooks are applied in the
animation adapter, in the worker and fallback renderer; vendor sources remain
unchanged.

Live capture timing, noise, sample rates and browser FFT behaviour can differ,
so live performances do not promise bit-identical videos across devices or mathematical
uniqueness for every possible sound. Frame rate targets 30 FPS and
depends on the device, engine and number of marks. This is a prototype.

Scores use versioned JSON with quantised feature samples, shared native vector geometry, exact layer ages and latched pen pressure. They record the actual composition/kit handoffs and solo/mute decisions rather than asking a fresh worker and ink reservations to reproduce them. Replaying the same score preserves the vector drawing even at a different screen size; canvas antialiasing can vary between browser engines. Scores contain no audio. Capture is bounded to three minutes / 5,500 frames and a 20 MB file budget; completed scores remain in memory only until replaced or the page is closed. Download a score to keep it. Imports validate sizes, references, paths and paint values; SVGs contain native strokes rather than embedded screenshots.

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
npm run test:browser
npm run test:demo
# A desktop display is needed to check actual background-tab behaviour:
HEADED=1 xvfb-run -a npm run test:clock
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
recording with audio, decoded stereo level stability, deliberate 20 dB changes,
source silence, composition coverage compared with the previous minimum density,
all eight engines drawing at minimum density, waveform export, source
cleanup, permission errors, audio-file replay, portrait rendering and mobile
layout. It inspects the exported video with `ffprobe`, saves screenshots and a
sample take as workflow artifacts. Every push and manual deployment runs both browser suites before publishing.
Commit-message prefixes cannot bypass checks. The demo suite covers solo/mute,
performance shortcuts and wake locks, score replay/import pixel equality,
vector exports and 300 dpi print PNG metadata.
An additional headed Chromium test checks first ink while animation callbacks
are stopped, then records with the artwork in a real background tab for over a
minute. It checks actual video frame timestamps and changing artwork pixels.
Physical microphone and real tab-share permission dialogs need manual testing.
