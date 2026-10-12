import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { LayeredArtwork, ENGINE_ROUTES } from '../js/ensemble.js';
import { SILENCE } from '../js/features.js';
import { ScoreCapture, ScoreReplay, parseScore, MAX_SCORE_BYTES } from '../js/scores.js';
import { captureSheet, sheetSVG } from '../js/export.js';
import { StyleDeck } from '../js/styles.js';
import { nativeRenderer } from './helpers/native-renderer.mjs';

test('three minutes at full density retains the whole score, bounded geometry and exact moving-focal replay', () => {
  globalThis.Path2D = class { constructor(d) { this.d = d; } };
  const context = Object.fromEntries(['fillRect','setLineDash','beginPath','moveTo','lineTo','bezierCurveTo','stroke','save','restore','transform']
    .map(key => [key, () => {}]));
  const artwork = new LayeredArtwork({ width: 1400, height: 1000, getContext: () => context });
  const render = nativeRenderer(), styles = new StyleDeck(52);
  const values = value => Object.fromEntries(['level','bass','mid','treble','centroid','flux'].map(key => [key, value]));
  const build = (voice, epoch) => {
    const seed = 'DENSE-' + epoch + '-' + voice.route.id, profile = values(epoch % 2 ? .9 : .35);
    voice.pendingStyle = styles.next(artwork.voices, 'mix', seed, voice.route.id, profile);
    return render(voice.route, seed, { density: 100, profile, style: voice.pendingStyle, phase: epoch * .09 });
  };
  artwork.setScenes(artwork.voices.map(voice => build(voice, 0)), true);
  artwork.voices.forEach(voice => { voice.pendingStyle = null; });
  const capture = new ScoreCapture(0, '100% density · 180 seconds'), expected = new Map();
  const started = performance.now();
  let geometryChanges = ENGINE_ROUTES.length, lastEpoch = 0, drawMilliseconds = 0;
  for (let frame = 0; frame <= 5400; frame++) {
    const time = frame / 30, epoch = Math.floor(time / 2.5);
    const raw = values(epoch % 2 ? .9 : .35), features = { ...SILENCE, ...raw, raw, active: true, rms: .2 };
    artwork.updateSignals(features, 1 / 30, true);
    if (epoch !== lastEpoch && frame < 5400) {
      lastEpoch = epoch;
      artwork.voices.forEach(voice => { artwork.setVoiceScene(voice, build(voice, epoch)); voice.pendingStyle = null; geometryChanges++; });
    }
    const before = performance.now();
    artwork.draw(1 / 30, .8, false, 3);
    drawMilliseconds += performance.now() - before;
    const running = capture.capture(time * 1000, artwork, features, false);
    if (frame < 5400) assert.equal(running, true, 'Score ended early at ' + time.toFixed(2) + ' seconds; bytes=' + capture.bytes + '; scenes=' + capture.data.scenes.length);
    else assert.equal(running, false, 'The normal three-minute limit still applies');
    if (frame % 75 === 1 || frame === 5400) expected.set(frame, sheetSVG(captureSheet(artwork)));
  }
  const score = capture.finish(), text = JSON.stringify(score);
  assert.equal(score.duration, 180000);
  assert.equal(score.frames.length, 5401);
  assert.ok(score.scenes.length <= geometryChanges, 'Focal motion must not create scene records');
  assert.ok(Buffer.byteLength(text) < MAX_SCORE_BYTES * .8, 'Full-density capture must remain below its early cutoff');
  const replay = new ScoreReplay(parseScore(text));
  for (const [frame, svg] of expected) {
    replay.seek(score.frames[frame][0]);
    assert.equal(sheetSVG(replay.sheet()), svg, 'Exact geometry, fading and pressure at frame ' + frame);
  }
  console.log(JSON.stringify({ density: 100, seconds: 180, frames: score.frames.length,
    scenes: score.scenes.length, nativeCompositions: geometryChanges, layers: score.layers.length,
    bytes: Buffer.byteLength(text), bytesBeforeCutoff: MAX_SCORE_BYTES * .8,
    meanVectorDrawMilliseconds: drawMilliseconds / 5401, testMilliseconds: performance.now() - started }));
});
