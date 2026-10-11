import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

const root = resolve('.'), results = resolve('test-results');
await mkdir(results, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + '/')) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const state = () => page.evaluate(() => window.AlgoAnimate.diagnostics());
async function settled() { await page.waitForFunction(() => window.AlgoAnimate?.diagnostics().paths > 0 && !window.AlgoAnimate.diagnostics().building, null, { timeout: 20000 }); }
async function select(id, value) {
  const before = (await state()).compositions;
  await page.selectOption('#' + id, value);
  await page.waitForFunction(count => window.AlgoAnimate.diagnostics().compositions > count && !window.AlgoAnimate.diagnostics().building, before, { timeout: 20000 });
}
async function setRange(id, value) {
  await page.evaluate(({ id, value }) => {
    const control = document.getElementById(id);
    control.value = String(value); control.dispatchEvent(new Event('input', { bubbles: true }));
  }, { id, value });
}
async function connectControlledTab() {
  // Stub only the browser's share dialog. The captured track, analyser,
  // silence and canvas below are real browser audio/video APIs.
  await page.evaluate(async () => {
    const context = new AudioContext(), gain = context.createGain();
    const destination = context.createMediaStreamDestination();
    gain.gain.value = 0.8; gain.connect(destination);
    const bands = {}, oscillators = [];
    for (const [name, hz] of Object.entries({ bass: 110, mid: 880, treble: 6000 })) {
      const oscillator = context.createOscillator(), band = context.createGain();
      oscillator.frequency.value = hz; band.gain.value = name === 'bass' ? 0.2 : 0;
      oscillator.connect(band); band.connect(gain); oscillator.start();
      bands[name] = band; oscillators.push(oscillator);
    }
    await context.resume();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 10;
    canvas.getContext('2d').fillRect(0, 0, 10, 10);
    const video = canvas.captureStream(1);
    const stream = new MediaStream([...destination.stream.getAudioTracks(), ...video.getVideoTracks()]);
    window.testSignal = { context, oscillators, bands, gain, stream };
    navigator.mediaDevices.getDisplayMedia = async options => { window.captureOptions = options; return stream; };
  });
  await page.click('#connectTab');
  await page.waitForFunction(() => window.AlgoAnimate.diagnostics().source === 'tab' && window.AlgoAnimate.diagnostics().drawing.flowing);
  const options = await page.evaluate(() => window.captureOptions);
  for (const key of ['autoGainControl', 'noiseSuppression', 'echoCancellation']) assert.equal(options.audio[key], false, key + ' is disabled for music capture');
  assert.equal((await state()).audio.recordingPath, 'direct-capture');
}
async function setCapturedBands(values, pulse = false) {
  await page.evaluate(({ values, pulse }) => {
    const { context, bands } = window.testSignal, now = context.currentTime;
    for (const [index, name] of Object.keys(bands).entries()) {
      const gain = bands[name].gain;
      gain.cancelScheduledValues(now); gain.setValueAtTime(values[name] || 0, now);
      if (pulse && values[name]) for (let beat = 0; beat < 400; beat++) {
        const time = now + 0.03 + index * 0.035 + beat * 0.22;
        gain.setValueAtTime(0.07, time);
        gain.linearRampToValueAtTime(values[name], time + 0.025);
        gain.exponentialRampToValueAtTime(0.07, time + 0.2);
      }
    }
  }, { values, pulse });
}
async function checkBandMeter(key, amplitude = 0.2) {
  await setCapturedBands({ [key]: amplitude }); await page.waitForTimeout(700);
  const sample = await page.evaluate(() => ({ state: window.AlgoAnimate.diagnostics(),
    ui: Object.fromEntries(['bass', 'mid', 'treble'].map(key => [key, {
      value: document.getElementById(key + 'Meter').value,
      label: document.getElementById(key + 'Db').textContent,
      height: document.getElementById(key + 'Meter').getBoundingClientRect().height }])) }));
  const band = sample.state.bandMeters[key], ui = sample.ui[key];
  const expectedDb = 20 * Math.log10(amplitude * 0.8 / Math.sqrt(2));
  assert.ok(Math.abs(band.db - expectedDb) < 0.6, key + ' real band RMS matches the known incoming tone');
  assert.ok(Math.abs(20 * Math.log10(band.rms / sample.state.features.rms)) < 0.6, key + ' band energy agrees with time-domain RMS');
  assert.ok(Math.abs(ui.value - (expectedDb + 60) / 60) < 0.025, key + ' meter shows the measured decibel level');
  assert.ok(Math.abs(parseFloat(ui.label) - band.db) <= 1, key + ' has a real numeric level reading');
  assert.ok(ui.height >= 8, 'The meter is visibly sized');
  for (const other of ['bass', 'mid', 'treble'].filter(band => band !== key)) {
    assert.ok(sample.ui[other].value < 0.1, key + ' tone does not light the ' + other + ' meter');
  }
  return { rms: band.rms, db: band.db, fill: ui.value };
}
async function silenceCapturedTab() {
  await page.evaluate(() => {
    window.silenceStarted = performance.now();
    window.testSignal.gain.gain.setValueAtTime(0, window.testSignal.context.currentTime);
  });
  await page.waitForFunction(() => !window.AlgoAnimate.diagnostics().drawing.flowing);
  const delay = await page.evaluate(() => performance.now() - window.silenceStarted);
  assert.ok(delay < 350, `Captured silence stops the pens promptly (${Math.round(delay)} ms)`);
  await page.evaluate(() => {
    window.frozenInk = document.getElementById('art').toDataURL();
    window.frozenProgress = window.AlgoAnimate.diagnostics().drawing.progress;
    window.frozenKits = JSON.stringify(window.AlgoAnimate.diagnostics().engines.map(engine => engine.style));
  });
  await page.waitForTimeout(500);
  assert.ok(await page.evaluate(() => document.getElementById('art').toDataURL() === window.frozenInk), 'Silent captured audio holds the exact painted pixels');
  assert.equal((await state()).drawing.progress, await page.evaluate(() => window.frozenProgress));
  assert.equal((await state()).source, 'tab', 'Silence does not disconnect capture');
  assert.ok(await page.evaluate(() => JSON.stringify(window.AlgoAnimate.diagnostics().engines.map(engine => engine.style)) === window.frozenKits), 'Silence holds the current pens and palettes');
  assert.equal((await state()).drawing.queuedSeed, null, 'Silence drops obsolete future targets');
  await page.waitForTimeout(150);
  assert.ok(await page.evaluate(() => ['bass', 'mid', 'treble'].every(key => document.getElementById(key + 'Meter').value === 0)), 'Silence empties every band meter');
  return delay;
}
async function resumeCapturedTab() {
  const before = (await state()).drawing.progress;
  await page.evaluate(() => window.testSignal.gain.gain.setValueAtTime(0.8, window.testSignal.context.currentTime));
  await page.waitForFunction(() => window.AlgoAnimate.diagnostics().drawing.flowing);
  await page.waitForFunction(progress => window.AlgoAnimate.diagnostics().drawing.progress !== progress, before);
}
async function motionSamples(count = 20, spacing = 80) {
  const samples = await page.evaluate(async ({ count, spacing }) => {
    const art = document.getElementById('art'), thumbnail = document.createElement('canvas');
    thumbnail.width = 200; thumbnail.height = Math.round(200 * art.height / art.width);
    const ctx = thumbnail.getContext('2d', { willReadFrequently: true }), samples = [];
    for (let frame = 0; frame < count; frame++) {
      await new Promise(resolve => setTimeout(resolve, spacing));
      ctx.drawImage(art, 0, 0, thumbnail.width, thumbnail.height);
      const pixels = ctx.getImageData(0, 0, thumbnail.width, thumbnail.height).data;
      let hash = 2166136261, ink = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        hash = Math.imul(hash ^ pixels[i], 16777619);
        hash = Math.imul(hash ^ pixels[i + 1], 16777619);
        hash = Math.imul(hash ^ pixels[i + 2], 16777619);
        if (pixels[i] < 205 || pixels[i + 1] < 205 || pixels[i + 2] < 185) ink++;
      }
      const state = window.AlgoAnimate.diagnostics();
      samples.push({ hash: hash >>> 0, ink, drawing: state.drawing, engines: state.engines, fps: state.fps });
    }
    return samples;
  }, { count, spacing });
  assert.ok(new Set(samples.map(s => s.hash)).size >= count * 0.9, 'Actual artwork pixels keep changing between seeds');
  assert.ok(samples.every(s => s.ink > 20), 'Pen cycles do not clear the entire paper');
  assert.ok(samples.filter(s => s.drawing.penTips > 0).length >= count * 0.85, 'Marker tips are drawing throughout the cycle');
  assert.ok(samples.every(s => s.drawing.layers <= 24 && s.engines.every(engine => engine.layers <= 3)), 'Eight independent ink histories remain bounded');
  for (const sample of samples) assertDistinctKits(sample.engines);
  return samples;
}
function assertDistinctKits(engines) {
  assert.ok(engines.every(engine => engine.style), 'Every engine carries its actual ink kit');
  assert.equal(new Set(engines.map(engine => engine.style.pen.id)).size, 8, 'All current pen profiles differ');
  assert.equal(new Set(engines.map(engine => engine.style.palette.id)).size, 8, 'All current colour families differ');
}
async function checkRenderedKits() {
  await page.waitForFunction(() => window.AlgoAnimate.diagnostics().engines.every(engine => {
    const card = document.querySelector(`[data-engine="${engine.engine}"]`);
    return card.dataset.pen === engine.style.pen.id && card.dataset.palette === engine.style.palette.id;
  }));
  const checked = await page.evaluate(() => {
    const context = document.createElement('canvas').getContext('2d');
    const normalise = color => { context.fillStyle = color; return context.fillStyle; };
    return window.AlgoAnimate.diagnostics().engines.map(engine => {
      const card = document.querySelector(`[data-engine="${engine.engine}"]`), style = engine.style;
      const colors = style.colors.map(normalise);
      return { engine: engine.engine, nativeColors: engine.ink.every(color => colors.includes(normalise(color))),
        nib: engine.strokeSample.every(stroke => stroke.lineCap === (['broad', 'highlighter'].includes(style.pen.renderer) ? 'butt' : 'round')),
        blend: engine.strokeSample.every(stroke => stroke.blend === (style.pen.renderer === 'highlighter' ? 'multiply' : 'source-over')),
        labels: card.querySelector('.pen-name').textContent === style.pen.name && card.querySelector('.ink-name').textContent === style.palette.name,
        swatches: [...card.querySelectorAll('.ink-swatches i')].every((swatch, index) => normalise(swatch.style.backgroundColor) === colors[index]) };
    });
  });
  assert.ok(checked.every(engine => engine.nativeColors && engine.nib && engine.blend && engine.labels && engine.swatches), 'Native ink, nibs and card labels agree: ' + JSON.stringify(checked));
}
async function download(path) {
  const request = page.waitForEvent('download');
  await page.click('#download');
  await (await request).saveAs(path);
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], { encoding: 'utf8' }));
}
function checkTake(info, width, height) {
  const video = info.streams.find(s => s.codec_type === 'video'), audio = info.streams.find(s => s.codec_type === 'audio');
  assert.ok(video, 'Export contains video'); assert.ok(audio, 'Export contains audio');
  assert.equal(video.width, width); assert.equal(video.height, height);
  assert.ok(Number(info.format.duration) > 1, 'Export has a useful duration');
}
function wav(seconds = 3, sampleRate = 22050) {
  const size = Math.round(seconds * sampleRate), buffer = Buffer.alloc(44 + size * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(size * 2, 40);
  for (let i = 0; i < size; i++) buffer.writeInt16LE(Math.round(Math.sin(i * 440 / sampleRate * Math.PI * 2) * 9000), 44 + i * 2);
  return buffer;
}

async function checkSparseComposition() {
  const comparison = await page.evaluate(async () => {
    const [{ SceneBuilder, DEFAULT_SETTINGS }, { LayeredArtwork, ENGINE_ROUTES, ensembleSettings },
      { styleSettings }, { SILENCE }] = await Promise.all([
      import('./js/scenes.js'), import('./js/ensemble.js'), import('./js/styles.js'), import('./js/features.js')]);
    const builder = new SceneBuilder(), styles = window.AlgoAnimate.diagnostics().engines.map(engine => engine.style);
    const keys = ['level', 'bass', 'mid', 'treble', 'centroid', 'flux'];
    const raw = Object.fromEntries(keys.map(key => [key, 0.4]));
    const sound = { ...SILENCE, ...raw, raw, active: true, rms: 0.1 };
    const result = {};
    try {
      for (const variant of ['previousMinimum', 'sparse', 'dense']) {
        const scenes = await Promise.all(ENGINE_ROUTES.map((route, index) => {
          const seed = 'SPACE-CHECK-' + route.id, style = styles[index];
          const settings = variant === 'previousMinimum'
            ? { ...DEFAULT_SETTINGS, seed, mode: route.id, orientation: 'landscape', palette: 'marker',
              elements: 12, density: 20, complexity: 46, recursion: 3, overdraw: 2, grain: 9, ...styleSettings(style) }
            : ensembleSettings(route, seed, 'landscape', 'marker', variant === 'sparse' ? 0 : 100, style);
          return builder.build(settings);
        }));
        assertScenes(scenes);
        const canvas = document.createElement('canvas'), art = new LayeredArtwork(canvas);
        art.setScenes(scenes, true);
        const thumb = document.createElement('canvas'); thumb.width = 350; thumb.height = 250;
        const ctx = thumb.getContext('2d', { willReadFrequently: true });
        let totalInk = 0, totalCoverage = 0, drawingFrames = 0;
        for (let frame = 0; frame < 18; frame++) {
          art.updateSignals(sound, 0.1, true); art.draw(0.1, 0.6, false, 1);
          ctx.drawImage(canvas, 0, 0, 350, 250);
          const data = ctx.getImageData(0, 0, 350, 250).data;
          let ink = 0;
          for (let i = 0; i < data.length; i += 4) if (data[i] < 205 || data[i + 1] < 205 || data[i + 2] < 185) ink++;
          totalInk += art.stats.inkLength; totalCoverage += ink / (350 * 250);
          if (art.diagnostics().every(engine => engine.penTips > 0)) drawingFrames++;
        }
        result[variant] = { meanInkLength: totalInk / 18, meanCoverage: totalCoverage / 18,
          drawingFrames, paths: scenes.reduce((sum, scene) => sum + scene.paths.length, 0), frame: canvas.toDataURL() };
      }
    } finally { builder.worker?.terminate(); }
    function assertScenes(scenes) {
      if (scenes.some(scene => !scene.paths.length)) throw new Error('Sparse composition removed an entire engine');
    }
    return result;
  });
  for (const [name, sample] of Object.entries(comparison)) {
    await writeFile(resolve(results, 'density-' + name + '.png'), Buffer.from(sample.frame.split(',')[1], 'base64'));
    delete sample.frame;
  }
  assert.ok(comparison.sparse.meanInkLength < comparison.previousMinimum.meanInkLength * 0.5, 'Minimum density has substantially less ink than the old minimum');
  assert.ok(comparison.sparse.meanCoverage < comparison.previousMinimum.meanCoverage * 0.65, 'Actual sparse pixels leave substantially more paper open');
  assert.ok(comparison.sparse.meanCoverage < comparison.dense.meanCoverage * 0.5, 'Density changes coverage, not just opacity');
  assert.ok(comparison.sparse.drawingFrames >= 15, 'All eight sparse engines keep drawing throughout the cycle');
  assert.equal(await page.locator('#density').getAttribute('min'), '0');
  const before = (await state()).compositions;
  await setRange('density', 0); await page.locator('#density').dispatchEvent('change');
  await page.waitForFunction(count => window.AlgoAnimate.diagnostics().compositions > count && !window.AlgoAnimate.diagnostics().building, before);
  assert.equal((await state()).engines.length, 8);
  const restore = (await state()).compositions;
  await setRange('density', 25); await page.locator('#density').dispatchEvent('change');
  await page.waitForFunction(count => window.AlgoAnimate.diagnostics().compositions > count && !window.AlgoAnimate.diagnostics().building, restore);
  return comparison;
}

async function checkAudioFidelity() {
  // A real stereo track with deliberate 20 dB steps and silence. Decode the
  // exported file, so recorder/channel/gain failures cannot pass on UI state.
  const originalControls = await page.evaluate(() => Object.fromEntries(['sensitivity', 'smoothing', 'motion'].map(id => [id, document.getElementById(id).value])));
  await page.evaluate(async () => {
    const context = new AudioContext({ sampleRate: 48000 });
    const destination = context.createMediaStreamDestination(), merger = context.createChannelMerger(2), level = context.createGain();
    level.channelCount = 2; level.channelCountMode = 'explicit'; level.channelInterpretation = 'discrete';
    merger.connect(level); level.connect(destination);
    const oscillators = [];
    for (const [channel, hz, amplitude] of [[0, 440, 0.3], [1, 6000, 0.12]]) {
      const oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.frequency.value = hz; gain.gain.value = amplitude;
      oscillator.connect(gain); gain.connect(merger, 0, channel); oscillator.start(); oscillators.push(oscillator);
    }
    await context.resume();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 10;
    canvas.getContext('2d').fillRect(0, 0, 10, 10);
    const stream = new MediaStream([...destination.stream.getAudioTracks(), ...canvas.captureStream(1).getVideoTracks()]);
    window.fidelitySignal = { context, level, oscillators, stream };
    navigator.mediaDevices.getDisplayMedia = async () => stream;
  });
  await page.click('#connectTab'); await page.waitForFunction(() => window.AlgoAnimate.diagnostics().source === 'tab');
  assert.equal((await state()).audio.recordingPath, 'direct-capture');
  await page.click('#record'); await page.waitForFunction(() => window.AlgoAnimate.diagnostics().recording);
  await page.evaluate(() => {
    const { context, level } = window.fidelitySignal, now = context.currentTime;
    level.gain.setValueAtTime(1, now); level.gain.setValueAtTime(0.1, now + 2.4);
    level.gain.setValueAtTime(0, now + 4.8); level.gain.setValueAtTime(1, now + 5.6);
  });
  await page.waitForTimeout(500);
  await setRange('sensitivity', 300); await setRange('smoothing', 100); await setRange('motion', 100);
  await page.waitForTimeout(8000);
  await page.click('#stopRecording'); await page.waitForFunction(() => !window.AlgoAnimate.diagnostics().recordingBusy);
  const path = resolve(results, 'audio-fidelity-stereo.webm'), info = await download(path);
  assert.equal(info.streams.find(stream => stream.codec_type === 'audio').channels, 2, 'Stereo channels survive export');
  assert.ok(await page.evaluate(() => window.fidelitySignal.stream.getAudioTracks()[0].readyState === 'live'), 'Finishing a take leaves capture audio live');
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-vn', '-ar', '48000', '-ac', '2', '-f', 'f32le', '-'], { maxBuffer: 16 * 1024 * 1024 });
  function rms(from, to) {
    const start = Math.round(from * 48000), end = Math.min(pcm.length / 8, Math.round(to * 48000)), sums = [0, 0];
    for (let frame = start; frame < end; frame++) for (let channel = 0; channel < 2; channel++) {
      const value = pcm.readFloatLE(frame * 8 + channel * 4); sums[channel] += value * value;
    }
    return sums.map(sum => Math.sqrt(sum / (end - start)));
  }
  const db = value => 20 * Math.log10(Math.max(1e-12, value));
  // Opus is lossy: an isolated high-frequency stereo tone can shift by a
  // fraction of a dB. Keep this separate from the stricter pumping check.
  const encodingToleranceDb = 0.8, steadyToleranceDb = 0.3;
  const phases = {};
  for (const [name, from, to, gain] of [['loud', 0.7, 2, 1], ['quiet', 3, 4.3, 0.1], ['restored', 6.2, 7.6, 1]]) {
    const levels = rms(from, to).map(db), windows = [];
    for (let time = from; time + 0.2 <= to; time += 0.2) windows.push(rms(time, time + 0.2).map(db));
    const spread = [0, 1].map(channel => Math.max(...windows.map(w => w[channel])) - Math.min(...windows.map(w => w[channel])));
    for (const channel of [0, 1]) {
      const expected = db([0.3, 0.12][channel] * gain / Math.sqrt(2));
      assert.ok(Math.abs(levels[channel] - expected) < encodingToleranceDb, name + ' preserves the known source level within encoding tolerance');
      assert.ok(spread[channel] < steadyToleranceDb, name + ' has no volume pumping during animation/control changes');
    }
    phases[name] = { db: levels, maximumVariationDb: spread };
  }
  const silenceDb = rms(5.2, 5.4).map(db);
  assert.ok(silenceDb.every(level => level < -70), 'Source silence is silent in the export');
  for (const channel of [0, 1]) assert.ok(Math.abs(phases.loud.db[channel] - phases.quiet.db[channel] - 20) < encodingToleranceDb, 'Intentional 20 dB dynamics remain intact');
  await page.click('#stopAudio');
  await page.evaluate(async () => { window.fidelitySignal.oscillators.forEach(node => node.stop()); await window.fidelitySignal.context.close(); });
  for (const [id, value] of Object.entries(originalControls)) await setRange(id, value);
  await writeFile(resolve(results, 'audio-fidelity.json'), JSON.stringify({ phases, silenceDb }, null, 2));
  return { phases, silenceDb, stereoChannels: 2 };
}

try {
  await page.goto(url); await settled();
  assert.equal((await state()).worker, true, 'Composition worker is active');
  assert.equal(await page.isDisabled('#record'), true, 'Cannot record without audio');
  await page.waitForTimeout(150);
  await page.screenshot({ path: resolve(results, 'desktop-ready.png'), fullPage: true });
  console.log('Initial worker-generated artwork ready.');

  assert.equal(await page.locator('#engine').count(), 0, 'The single-engine picker is removed');
  assert.equal((await state()).engine, 'ensemble');
  assert.equal((await state()).engines.length, 8);
  assert.ok((await state()).engines.every(engine => engine.paths > 0 && engine.pens === 3));
  assert.equal(await page.locator('.engine-row').count(), 8, 'Every engine has a visible audio-input meter');
  assertDistinctKits((await state()).engines); await checkRenderedKits();
  await page.focus('#connectTab');
  assert.ok(await page.locator('#connectTab').evaluate(element => element.matches(':focus-visible') && getComputedStyle(element).outlineStyle !== 'none'), 'Keyboard focus is visible');
  await page.focus('#tuningDetails summary'); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#tuningDetails').evaluate(element => element.open), true, 'Advanced controls open by keyboard');
  assert.equal(await page.isVisible('#sensitivity'), true);
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#record').evaluate(element => element.closest('.workspace') !== null), true, 'Recording stays beside the artwork');
  console.log('All eight genuine composition engines are prepared together with 24 pen lanes.');

  const beforeSound = (await state()).compositions;
  await page.evaluate(() => {
    window.startupTrace = [];
    const start = performance.now();
    const sample = now => {
      const s = window.AlgoAnimate.diagnostics();
      window.startupTrace.push({ time: now - start, ink: s.drawing.inkLength,
        voices: s.engines.filter(voice => voice.inkLength > 0).length,
        compositions: s.compositions, elapsed: s.introduction.elapsed });
      if (now - start < 1900) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.click('#playDemo');
  await page.waitForFunction(() => window.AlgoAnimate.diagnostics().features.level > 0.015, null, { timeout: 10000 });
  await page.waitForFunction(count => window.AlgoAnimate.diagnostics().compositions > count && window.AlgoAnimate.diagnostics().engines.some(engine => /^SOUND-[0-9A-F]{8}$/.test(engine.seed)), beforeSound, { timeout: 12000 });
  assert.equal((await state()).source, 'demo');
  await page.waitForFunction(() => window.startupTrace?.at(-1)?.time > 1800, null, { timeout: 10000 });
  const trace = await page.evaluate(() => window.startupTrace);
  await writeFile(resolve(results, 'startup-frame-trace.json'), JSON.stringify(trace, null, 2));
  assert.ok(trace.length > 6, 'Sound startup produces multiple rendered frames');
  const firstInk = trace.find(frame => frame.ink > 0);
  assert.ok(firstInk && firstInk.voices <= 2, 'First sound reveals a few strokes, not eight fully formed drawings');
  assert.ok(trace.some(frame => frame.voices >= 3), 'Other first strokes enter progressively');
  await page.waitForFunction(() => window.AlgoAnimate.diagnostics().fps > 5, null, { timeout: 10000 });
  await page.screenshot({ path: resolve(results, 'desktop-live.png'), fullPage: true });
  console.log('Demo produces measured audio, a waveform and sound-derived composition changes.');
  const demoBandPeaks = { bass: 0, mid: 0, treble: 0 };
  for (let frame = 0; frame < 20; frame++) {
    await page.waitForTimeout(80);
    const meters = (await state()).bandMeters;
    for (const key of Object.keys(demoBandPeaks)) demoBandPeaks[key] = Math.max(demoBandPeaks[key], meters[key].level);
  }
  assert.ok(Object.values(demoBandPeaks).every(value => value > 0.1), 'The demo visibly reaches all three real frequency meters');

  await connectControlledTab();
  await page.waitForTimeout(400);
  const bassStart = (await state()).engines;
  await page.waitForTimeout(400);
  const bassEnd = (await state()).engines;
  assert.ok(bassEnd.find(engine => engine.engine === 'field').progress !== bassStart.find(engine => engine.engine === 'field').progress, 'Bass drives the bass engine');
  for (const id of ['rects', 'burst', 'spiral']) {
    assert.equal(bassEnd.find(engine => engine.engine === id).progress, bassStart.find(engine => engine.engine === id).progress, 'A bass-only stream holds ' + id);
  }
  await setCapturedBands({ mid: 0.2 }); await page.waitForTimeout(350);
  const midStart = (await state()).engines;
  await page.waitForTimeout(400);
  const midEnd = (await state()).engines;
  assert.ok(midEnd.find(engine => engine.engine === 'rects').progress !== midStart.find(engine => engine.engine === 'rects').progress, 'Mids drive the midrange engine');
  assert.equal(midEnd.find(engine => engine.engine === 'field').progress, midStart.find(engine => engine.engine === 'field').progress, 'Mids do not move the bass engine');
  assert.equal(midEnd.find(engine => engine.engine === 'burst').progress, midStart.find(engine => engine.engine === 'burst').progress, 'Mids do not move the treble engine');
  console.log('Real bass-only and mid-only audio independently move their assigned engine layers.');
  const calibratedMeters = {};
  for (const key of ['bass', 'mid', 'treble']) calibratedMeters[key] = await checkBandMeter(key);
  for (const [band, engine] of Object.entries({ bass: 'field', mid: 'rects', treble: 'burst' })) {
    await setCapturedBands({ [band]: 0.2 }); await page.waitForTimeout(350);
    const value = await page.locator('.engine-row[data-engine="' + engine + '"] meter').evaluate(node => node.value);
    assert.ok(value > 0.45, engine + ' meter visibly responds to a real ' + band + ' tone (' + value + ')');
  }
  const fills = Object.values(calibratedMeters).map(meter => meter.fill);
  assert.ok(Math.max(...fills) - Math.min(...fills) < 0.025, 'Equal-level tones use equal meter scales regardless of band width');
  const trebleStart = (await state()).engines; await page.waitForTimeout(300);
  const trebleEnd = (await state()).engines;
  assert.notEqual(trebleEnd.find(engine => engine.engine === 'burst').progress, trebleStart.find(engine => engine.engine === 'burst').progress, 'Treble drives the treble engine');
  for (const id of ['field', 'rects']) assert.equal(trebleEnd.find(engine => engine.engine === id).progress,
    trebleStart.find(engine => engine.engine === id).progress, 'Treble holds ' + id);
  const quietTreble = await checkBandMeter('treble', 0.02);
  assert.ok(Math.abs(calibratedMeters.treble.db - quietTreble.db - 20) < 0.6, 'Ten times lower amplitude reads 20 dB lower');
  assert.ok(calibratedMeters.treble.fill - quietTreble.fill > 0.3, 'A quieter input visibly reduces the meter');
  await setRange('sensitivity', 300); await setRange('smoothing', 100);
  await page.waitForTimeout(300);
  assert.ok(Math.abs((await state()).bandMeters.treble.db - quietTreble.db) < 0.6, 'Artistic controls do not amplify the measurement');
  await setRange('sensitivity', 100); await setRange('smoothing', 55);
  await setCapturedBands({ mid: 0.2 }); await page.waitForTimeout(350);
  console.log('Real bass/mid/treble tones are calibrated equally; meters respond to actual amplitude and treble reaches its drawing engine.');
  await setRange('evolution', 100); await page.waitForTimeout(2400);
  const steadyKits = [];
  for (let frame = 0; frame < 16; frame++) {
    await page.waitForTimeout(100);
    const engines = (await state()).engines; assertDistinctKits(engines);
    steadyKits.push(engines.find(engine => engine.engine === 'rects'));
  }
  assert.equal(new Set(steadyKits.map(engine => engine.measuredSeed)).size, 1, 'A steady tone keeps its sound seed');
  assert.ok(new Set(steadyKits.map(engine => engine.style.token)).size > 1, 'A steady tone still starts drawings with fresh ink kits');
  await setRange('evolution', 50);
  await setCapturedBands({ bass: 0.24, mid: 0.21, treble: 0.18 }, true);
  await page.waitForFunction(() => window.AlgoAnimate.diagnostics().engines.every(engine => engine.inkLength > 0), null, { timeout: 15000 });
  const tabSilenceStopMs = await silenceCapturedTab();
  await page.waitForFunction(() => document.getElementById('liveLabel').textContent.includes('DRAWING PAUSED'));
  await page.click('#clearCanvas'); await page.waitForTimeout(150);
  const clearState = await state();
  assert.equal(clearState.source, 'tab', 'Clearing ink preserves connected audio');
  assert.equal(clearState.drawing.blank, true, 'Ink stays cleared during captured silence');
  assert.equal(clearState.drawing.layers, 0, 'All drawing layers are removed');
  assert.equal(clearState.drawing.inkLength, 0, 'No old strokes return after a frame');
  assert.equal(clearState.clearHold, true, 'Canvas stays clear long enough to be seen on a touch screen');
  await resumeCapturedTab();
  await page.waitForFunction(() => !window.AlgoAnimate.diagnostics().clearHold
    && window.AlgoAnimate.diagnostics().drawing.inkLength > 0, null, { timeout: 8000 });
  assert.equal((await state()).drawing.blank, false, 'Sound resumes new ink without reconnecting');
  // The new clean-sheet entrance deliberately starts with one pen, then
  // introduces the other voices. Continuous-ink assertions apply after that
  // introduction, not to the intentionally sparse opening frames.
  await page.waitForFunction(() => {
    const state = window.AlgoAnimate.diagnostics();
    return state.introduction.finished && state.engines.every(engine => engine.inkLength > 0);
  }, null, { timeout: 8000 });
  console.log(`Captured audio pauses/resumes the actual ink; silence stopped drawing in ${Math.round(tabSilenceStopMs)} ms.`);

  const defaultMotion = await motionSamples(60, 100);
  await writeFile(resolve(results, 'continuous-ink.json'), JSON.stringify(defaultMotion, null, 2));
  const enginesInMotion = {};
  await setRange('evolution', 100);
  const samples = await motionSamples(40, 100);
  for (const engine of (await state()).engines) {
    const drawingFrames = samples.filter(sample => sample.engines.find(voice => voice.engine === engine.engine).penTips > 0).length;
    assert.ok(drawingFrames > 20, engine.engine + ' draws simultaneously with the other engines');
    enginesInMotion[engine.engine] = { drawingFrames, frames: samples.length, inputs: engine.inputs };
  }
  const measuredFPS = Math.min(...samples.map(sample => sample.fps));
  assert.ok(measuredFPS >= 20, 'Eight engines maintain at least 20 measured FPS on the test runner');
  await setRange('evolution', 50);
  const styleChanges = {};
  for (const engine of (await state()).engines) {
    const changes = [...defaultMotion, ...samples].map(sample => sample.engines.find(voice => voice.engine === engine.engine))
      .filter((voice, index, all) => index === 0 || voice.style.token !== all[index - 1].style.token);
    assert.ok(changes.length >= 2, engine.engine + ' starts several drawings');
    for (let i = 1; i < changes.length; i++) {
      assert.notEqual(changes[i].style.pen.id, changes[i - 1].style.pen.id, engine.engine + ' changes pen');
      assert.notEqual(changes[i].style.palette.id, changes[i - 1].style.palette.id, engine.engine + ' changes palette');
    }
    styleChanges[engine.engine] = changes.map(voice => ({ pen: voice.style.pen.name, palette: voice.style.palette.name }));
  }
  await checkRenderedKits();
  await page.screenshot({ path: resolve(results, 'desktop-continuous.png'), fullPage: true });
  console.log(`All eight engines draw simultaneously on the actual canvas; measured minimum ${measuredFPS} FPS.`);

  await page.click('#record');
  await page.waitForFunction(() => window.AlgoAnimate.diagnostics().recording);
  assert.equal(await page.isDisabled('#orientation'), true);
  assert.equal(await page.isDisabled('#connectTab'), true);
  assert.equal(await page.isDisabled('#includeWaveform'), true);
  await page.waitForTimeout(10000); await page.click('#stopRecording');
  await page.waitForFunction(() => window.AlgoAnimate.diagnostics().recordedBytes > 10000 && !window.AlgoAnimate.diagnostics().recordingBusy);
  assert.equal((await state()).source, 'tab', 'Stopping a take retains the sound source');
  const firstPath = resolve(results, 'tab-landscape.webm');
  const first = await download(firstPath); checkTake(first, 1400, 1000);
  const decodedFrames = execFileSync('ffmpeg', ['-v', 'error', '-i', firstPath, '-an', '-vf', 'fps=10,scale=200:-1', '-f', 'framemd5', '-'], { encoding: 'utf8' })
    .split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(',').at(-1).trim());
  assert.ok(decodedFrames.length > 70, 'Export contains frames across several drawing cycles');
  assert.ok(new Set(decodedFrames).size > decodedFrames.length * 0.95, 'Recorded artwork keeps moving');
  // Sparse pen lines change a small fraction of a mostly blank paper frame.
  // Use a low noise threshold, plus a direct change measurement over 400 ms,
  // rather than treating the small global average as a held photograph.
  const freeze = spawnSync('ffmpeg', ['-hide_banner', '-i', firstPath, '-an', '-vf', 'freezedetect=n=-100dB:d=0.35', '-f', 'null', '-'], { encoding: 'utf8' });
  assert.equal(freeze.status, 0); assert.ok(!freeze.stderr.includes('freeze_start'), 'Video has no held still-image intervals');
  const rawFrames = execFileSync('ffmpeg', ['-v', 'error', '-i', firstPath, '-an', '-vf', 'fps=10,scale=350:250', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 64 * 1024 * 1024 });
  const frameBytes = 350 * 250 * 3, rawCount = Math.floor(rawFrames.length / frameBytes);
  assert.ok(rawCount > 70, 'Motion measurement covers the exported take');
  let minimumChangedPixels = Infinity;
  for (let frame = 0; frame < rawCount - 4; frame++) {
    let changed = 0;
    for (let pixel = 0; pixel < frameBytes; pixel += 3) {
      const a = frame * frameBytes + pixel, b = (frame + 4) * frameBytes + pixel;
      if (Math.abs(rawFrames[a] - rawFrames[b]) > 8 || Math.abs(rawFrames[a + 1] - rawFrames[b + 1]) > 8
        || Math.abs(rawFrames[a + 2] - rawFrames[b + 2]) > 8) changed++;
    }
    minimumChangedPixels = Math.min(minimumChangedPixels, changed);
  }
  assert.ok(minimumChangedPixels > 100, 'Every 400 ms of exported video contains substantial visible pen movement');
  const heldControl = spawnSync('ffmpeg', ['-hide_banner', '-i', firstPath, '-an', '-vf',
    'tpad=stop_mode=clone:stop_duration=0.6,freezedetect=n=-100dB:d=0.35', '-f', 'null', '-'], { encoding: 'utf8' });
  assert.equal(heldControl.status, 0);
  assert.ok(heldControl.stderr.includes('freeze_start'), 'The detector still catches an intentionally frozen frame');
  const volume = spawnSync('ffmpeg', ['-hide_banner', '-i', firstPath, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8' });
  assert.equal(volume.status, 0, 'Recorded audio decodes successfully');
  const meanVolume = volume.stderr.match(/mean_volume:\s*(-?[\d.]+) dB/);
  assert.ok(meanVolume && +meanVolume[1] > -70, 'Recording contains audible sound, not just a silent audio track');
  await page.click('#previewRecording'); assert.equal(await page.isVisible('#previewDialog'), true);
  await page.click('#closePreview');
  console.log('Landscape take exports valid video and audio; source remains connected.');

  await page.click('#record'); await page.waitForFunction(() => window.AlgoAnimate.diagnostics().recording);
  await page.waitForTimeout(700);
  const recordingSilenceStopMs = await silenceCapturedTab();
  assert.equal((await state()).recording, true, 'A silent interval retains the take');
  await resumeCapturedTab(); await page.waitForTimeout(700);
  await page.click('#stopRecording'); await page.waitForFunction(() => !window.AlgoAnimate.diagnostics().recordingBusy);
  const pausedPath = resolve(results, 'tab-pause-resume.webm');
  checkTake(await download(pausedPath), 1400, 1000);
  // VP9 can refine a complex still by a few colour levels across interframes.
  // Exact canvas equality is checked above. Allow tiny codec noise here, then
  // verify decoded pixels during the audio silence and visible motion on either side.
  const pausedVideo = spawnSync('ffmpeg', ['-hide_banner', '-i', pausedPath, '-an', '-vf', 'freezedetect=n=-70dB:d=0.3', '-f', 'null', '-'], { encoding: 'utf8' });
  assert.equal(pausedVideo.status, 0); assert.ok(pausedVideo.stderr.includes('freeze_start'), 'The recorded artwork holds during actual source silence');
  const pausedAudio = spawnSync('ffmpeg', ['-hide_banner', '-i', pausedPath, '-vn', '-af', 'silencedetect=noise=-60dB:d=0.3', '-f', 'null', '-'], { encoding: 'utf8' });
  assert.equal(pausedAudio.status, 0); assert.ok(pausedAudio.stderr.includes('silence_start'), 'The export preserves the corresponding silent audio');
  const silentStart = +pausedAudio.stderr.match(/silence_start:\s*([\d.]+)/)[1];
  const silentEnd = +pausedAudio.stderr.match(/silence_end:\s*([\d.]+)/)[1];
  const pauseFrames = execFileSync('ffmpeg', ['-v', 'error', '-i', pausedPath, '-an', '-vf', 'fps=30,scale=350:250',
    '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 64 * 1024 * 1024 });
  assert.ok(pauseFrames.length / frameBytes > Math.ceil((silentEnd + 0.4) * 30), 'Decoded video covers silence and resumption');
  const heldFrom = Math.ceil((silentStart + 0.2) * 30), heldTo = Math.floor((silentEnd - 0.12) * 30);
  assert.ok(heldTo - heldFrom >= 8, 'The take contains a usable decoded silent plateau');
  let maximumSilentChangedPixels = 0;
  for (let frame = heldFrom; frame < heldTo; frame++) {
    let changed = 0;
    for (let pixel = 0; pixel < frameBytes; pixel += 3) {
      const a = frame * frameBytes + pixel, b = (frame + 1) * frameBytes + pixel;
      if (Math.abs(pauseFrames[a] - pauseFrames[b]) > 8 || Math.abs(pauseFrames[a + 1] - pauseFrames[b + 1]) > 8
        || Math.abs(pauseFrames[a + 2] - pauseFrames[b + 2]) > 8) changed++;
    }
    maximumSilentChangedPixels = Math.max(maximumSilentChangedPixels, changed);
  }
  assert.ok(maximumSilentChangedPixels <= 15, 'Decoded ink holds throughout the audio silence, within codec noise');
  function changedBetween(from, to) {
    let changed = 0;
    for (let pixel = 0; pixel < frameBytes; pixel += 3) {
      const a = from * frameBytes + pixel, b = to * frameBytes + pixel;
      if (Math.abs(pauseFrames[a] - pauseFrames[b]) > 8 || Math.abs(pauseFrames[a + 1] - pauseFrames[b + 1]) > 8
        || Math.abs(pauseFrames[a + 2] - pauseFrames[b + 2]) > 8) changed++;
    }
    return changed;
  }
  assert.ok(changedBetween(3, 12) > 100, 'The exported pens move before the silent interval');
  assert.ok(changedBetween(Math.ceil((silentEnd + 0.1) * 30), Math.ceil((silentEnd + 0.4) * 30)) > 100, 'The exported pens resume after audio silence');
  console.log('Recording preserves silent audio with held ink, then resumes drawing with the sound.');

  await select('orientation', 'portrait');
  await page.check('#includeWaveform');
  await page.click('#record'); await page.waitForFunction(() => window.AlgoAnimate.diagnostics().recording);
  await page.waitForTimeout(1600); await page.click('#stopRecording');
  await page.waitForFunction(() => !window.AlgoAnimate.diagnostics().recordingBusy);
  const second = await download(resolve(results, 'demo-portrait-waveform.webm')); checkTake(second, 1000, 1556);
  await page.screenshot({ path: resolve(results, 'portrait-live.png'), fullPage: true });
  console.log('Portrait export preserves its shape and includes the optional waveform.');

  const snapshotPromise = page.waitForEvent('download'); await page.click('#snapshot');
  await (await snapshotPromise).saveAs(resolve(results, 'snapshot.png'));
  const png = await readFile(resolve(results, 'snapshot.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1000); assert.equal(png.readUInt32BE(20), 1400);

  // Exercise the application around a denied permission and a capture without audio.
  await page.evaluate(() => {
    navigator.mediaDevices.getDisplayMedia = async () => { throw new DOMException('cancelled', 'NotAllowedError'); };
  });
  await page.click('#connectTab');
  await page.waitForFunction(() => document.getElementById('message').textContent.includes('cancelled'));
  assert.equal((await state()).source, 'tab', 'Cancel preserves existing audio');
  await page.evaluate(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas'); canvas.getContext('2d').fillRect(0, 0, 10, 10);
      window.testEmptyCapture = canvas.captureStream(1);
      return window.testEmptyCapture;
    };
  });
  await page.click('#connectTab');
  await page.waitForFunction(() => document.getElementById('message').textContent.includes('No audio was shared'));
  assert.equal((await state()).source, 'tab');
  assert.equal(await page.evaluate(() => window.testEmptyCapture.getVideoTracks()[0].readyState), 'ended');
  console.log('Denied capture and missing shared audio recover without stopping a working source.');

  await page.click('#stopAudio');
  await page.evaluate(async () => { window.testSignal.oscillators.forEach(oscillator => oscillator.stop()); await window.testSignal.context.close(); });
  assert.equal((await state()).source, null);
  await page.setInputFiles('#fileInput', { name: 'test-tone.wav', mimeType: 'audio/wav', buffer: wav() });
  await page.waitForFunction(() => window.AlgoAnimate.diagnostics().source === 'file' && window.AlgoAnimate.diagnostics().features.level > 0.1);
  await page.evaluate(() => document.getElementById('filePlayer').pause());
  await page.waitForTimeout(100);
  const pausedProgress = (await state()).drawing.progress;
  await page.waitForTimeout(250);
  assert.equal((await state()).drawing.progress, pausedProgress, 'Pausing a file holds the drawing frame');
  await page.evaluate(() => document.getElementById('filePlayer').play());
  await page.waitForFunction(() => window.AlgoAnimate.diagnostics().source === null, null, { timeout: 8000 });
  await page.evaluate(() => document.getElementById('filePlayer').play());
  await page.waitForFunction(() => window.AlgoAnimate.diagnostics().source === 'file' && window.AlgoAnimate.diagnostics().features.level > 0.1);
  await page.click('#record'); await page.waitForFunction(() => window.AlgoAnimate.diagnostics().recording);
  await page.waitForFunction(() => window.AlgoAnimate.diagnostics().source === null && !window.AlgoAnimate.diagnostics().recordingBusy, null, { timeout: 8000 });
  assert.ok((await state()).recordedBytes > 0, 'Ending a file finalises a recording');
  console.log('Audio files play and replay; source end finalises an active take.');

  const compositionDensity = await checkSparseComposition();
  console.log('Sparse composition leaves more open paper while all eight engines keep drawing.');
  const audioFidelity = await checkAudioFidelity();
  console.log('Decoded stereo export preserves fixed levels, deliberate 20 dB changes and silence.');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  await page.evaluate(() => scrollTo(0, 0));
  assert.ok(await page.locator('#playDemo').evaluate(element => element.getBoundingClientRect().bottom < innerHeight), 'Mobile source controls are in the first viewport');
  assert.ok(await page.evaluate(() => Math.abs(document.getElementById('connectTab').getBoundingClientRect().top
    - document.getElementById('chooseFile').getBoundingClientRect().top) < 1), 'Mobile source buttons share one row');
  for (const selector of ['#connectTab', '#chooseFile', '#playDemo', '#snapshot', '#clearCanvas', '#orientation', '#closePreview']) {
    if (selector === '#closePreview') continue;
    assert.ok(await page.locator(selector).evaluate(element => element.getBoundingClientRect().height >= 44), selector + ' has a usable touch target');
  }
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile has no horizontal overflow');
  assert.ok(await page.evaluate(() => document.querySelector('.brand').getBoundingClientRect().right <= innerWidth - 12), 'Mobile branding fits');
  await page.screenshot({ path: resolve(results, 'mobile-portrait.png'), fullPage: true });
  await select('orientation', 'landscape');
  await page.waitForFunction(() => window.AlgoAnimate.diagnostics().drawing.inkLength > 0);
  assert.equal((await state()).drawing.flowing, false, 'Changing paper preserves the held drawing without restarting audio');
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(200); await page.evaluate(() => scrollTo(0, 0));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Narrow mobile has no horizontal overflow');
  assert.ok(await page.locator('.masthead-intro').evaluate(el => el.closest('header') === document.querySelector('.masthead')), 'Artwork headline and strapline live in the header');
  assert.equal(await page.locator('main .intro').count(), 0, 'No separate intro consumes space above the artwork');
  await page.screenshot({ path: resolve(results, 'mobile-landscape.png'), fullPage: true });
  // A real mobile/touch context exposes tap-target and continuous-audio clear bugs
  // that a desktop mouse click against a resized page cannot catch.
  const touchContext = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    deviceScaleFactor: 2, acceptDownloads: true
  });
  try {
    const mobilePage = await touchContext.newPage();
    mobilePage.on('pageerror', error => errors.push('Mobile: ' + error.message));
    await mobilePage.goto(url);
    await mobilePage.waitForFunction(() => window.AlgoAnimate?.diagnostics().paths > 0
      && !window.AlgoAnimate.diagnostics().building, null, { timeout: 20000 });
    for (const width of [390, 360]) {
      await mobilePage.setViewportSize({ width, height: 844 });
      assert.ok(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), width + 'px touch layout has no horizontal overflow');
      const header = await mobilePage.evaluate(() => {
        const masthead = document.querySelector('.masthead').getBoundingClientRect();
        const brand = document.querySelector('.brand').getBoundingClientRect();
        const title = document.querySelector('.masthead-intro').getBoundingClientRect();
        const canvas = document.getElementById('art').getBoundingClientRect();
        const source = document.getElementById('sources').getBoundingClientRect();
        return { height: masthead.height, noOverlap: brand.right + 1 <= title.left,
          titleInside: title.right <= masthead.right + 1, canvasTop: canvas.top, sourceTop: source.top };
      });
      assert.ok(header.noOverlap && header.titleInside, width + 'px header has no text overlap: ' + JSON.stringify(header));
      assert.ok(header.height < 145, width + 'px compact header saves vertical space: ' + header.height);
      if (!(await mobilePage.evaluate(() => window.AlgoAnimate.diagnostics().source))) {
        await mobilePage.locator('#playDemo').tap();
      }
      await mobilePage.waitForFunction(() => window.AlgoAnimate.diagnostics().source === 'demo'
        && window.AlgoAnimate.diagnostics().drawing.inkLength > 20, null, { timeout: 12000 });
      const button = mobilePage.locator('#clearCanvas');
      await button.scrollIntoViewIfNeeded();
      assert.ok(await button.evaluate(el => {
        const b = el.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2;
        return b.height >= 44 && b.width >= 90 && (document.elementFromPoint(x, y) === el
          || el.contains(document.elementFromPoint(x, y)));
      }), width + 'px clear target is a fully tappable button');
      await button.tap();
      await mobilePage.waitForFunction(() => window.AlgoAnimate.diagnostics().drawing.blank
        && window.AlgoAnimate.diagnostics().drawing.layers === 0, null, { timeout: 3000 });
      await mobilePage.waitForTimeout(250);
      const blankState = await mobilePage.evaluate(() => ({
        diagnostics: window.AlgoAnimate.diagnostics(), clearLabel: document.getElementById('clearCanvas').textContent,
        canvas: document.getElementById('art').toDataURL()
      }));
      assert.equal(blankState.diagnostics.source, 'demo', 'Tapping Clear retains mobile demo audio');
      assert.equal(blankState.diagnostics.drawing.inkLength, 0, 'Tapping Clear gives genuinely empty paper');
      assert.equal(blankState.diagnostics.clearHold, true, 'Clean paper is held visually on mobile');
      assert.ok(blankState.clearLabel.includes('cleared'), 'Touch gives visible acknowledgement');
      await mobilePage.waitForFunction(() => !window.AlgoAnimate.diagnostics().clearHold
        && window.AlgoAnimate.diagnostics().drawing.inkLength > 0, null, { timeout: 10000 });
      await mobilePage.screenshot({ path: resolve(results, 'mobile-touch-' + width + '.png'), fullPage: true });
    }
  } finally {
    await touchContext.close();
  }
  assert.deepEqual(errors, [], 'No uncaught application errors');
  const summary = { version: '0.10', desktop: 'passed', engines: 8, pens: 24, minimumMeasuredFPS: measuredFPS,
    compositionDensity, audioFidelity,
    calibratedMeters, quietTreble, demoBandPeaks, meterSilenceAndSensitivity: 'passed',
    responsiveEngineMeters: 'passed', clearCanvasKeepsAudio: 'passed',
    distinctNativePensAndPalettes: 'passed', styleChanges, steadyToneFreshKits: 'passed', keyboardControls: 'passed',
    realAudioBandIsolation: 'passed', demoAnalysis: 'passed',
    continuousMarkerDrawing: enginesInMotion, noVideoHolds: 'passed', minimumChangedPixelsPer400ms: minimumChangedPixels,
    tabSilenceStopMs, recordingSilenceStopMs, maximumSilentChangedPixels, exactSilentFrameHold: 'passed', capturedPauseResumeExport: 'passed',
    videoAudioExport: 'passed', portraitWaveform: 'passed', permissionRecovery: 'passed',
    fileReplayAndAutoFinish: 'passed', mobileWidths: [360, 390], errors, state: await state(),
    landscapeExport: first.streams.map(({ codec_name, codec_type, width, height }) => ({ codec_name, codec_type, width, height })) };
  await writeFile(resolve(results, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log('PASS: browser, audio, recording and mobile smoke tests.');
} catch (error) {
  await page.screenshot({ path: resolve(results, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(resolve(results, 'failure.txt'), String(error.stack) + '\n\nConsole errors:\n' + errors.join('\n'));
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
