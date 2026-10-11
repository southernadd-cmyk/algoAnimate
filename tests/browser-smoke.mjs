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
      samples.push({ hash: hash >>> 0, ink, drawing: window.AlgoAnimate.diagnostics().drawing });
    }
    return samples;
  }, { count, spacing });
  assert.ok(new Set(samples.map(s => s.hash)).size >= count * 0.9, 'Actual artwork pixels keep changing between seeds');
  assert.ok(samples.every(s => s.ink > 20), 'Pen cycles do not clear the entire paper');
  assert.ok(samples.filter(s => s.drawing.penTips > 0).length >= count * 0.85, 'Marker tips are drawing throughout the cycle');
  assert.ok(samples.every(s => s.drawing.layers <= 3), 'Ink history remains bounded');
  return samples;
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

try {
  await page.goto(url); await settled();
  assert.equal((await state()).worker, true, 'Composition worker is active');
  assert.equal(await page.isDisabled('#record'), true, 'Cannot record without audio');
  await page.waitForTimeout(150);
  await page.screenshot({ path: resolve(results, 'desktop-ready.png'), fullPage: true });
  console.log('Initial worker-generated artwork ready.');

  for (const engine of ['field', 'rects', 'burst', 'network', 'organic', 'geometric', 'scribble', 'spiral']) {
    await select('engine', engine); assert.ok((await state()).paths > 0, engine + ' creates marker paths');
  }
  console.log('All eight composition engines render.');

  const beforeSound = (await state()).compositions;
  await page.click('#playDemo');
  await page.waitForFunction(() => window.AlgoAnimate.diagnostics().features.level > 0.015, null, { timeout: 10000 });
  await page.waitForFunction(count => window.AlgoAnimate.diagnostics().compositions > count && /^SOUND-[0-9A-F]{8}$/.test(window.AlgoAnimate.diagnostics().seed), beforeSound, { timeout: 12000 });
  assert.equal((await state()).source, 'demo');
  await page.waitForFunction(() => window.AlgoAnimate.diagnostics().fps > 5, null, { timeout: 10000 });
  await page.screenshot({ path: resolve(results, 'desktop-live.png'), fullPage: true });
  console.log('Demo produces measured audio, a waveform and sound-derived composition changes.');

  const defaultMotion = await motionSamples(60, 100);
  await writeFile(resolve(results, 'continuous-ink.json'), JSON.stringify(defaultMotion, null, 2));
  const enginesInMotion = {};
  await setRange('evolution', 100);
  for (const engine of ['field', 'rects', 'burst', 'network', 'organic', 'geometric', 'scribble', 'spiral']) {
    await select('engine', engine);
    await page.waitForFunction(mode => window.AlgoAnimate.diagnostics().engine === mode, engine, { timeout: 12000 });
    const samples = await motionSamples();
    enginesInMotion[engine] = { uniqueFrames: new Set(samples.map(s => s.hash)).size, frames: samples.length };
  }
  await setRange('evolution', 50);
  await page.screenshot({ path: resolve(results, 'desktop-continuous.png'), fullPage: true });
  console.log('All eight engines continuously draw actual marker strokes; no blank-paper resets or image holds.');

  await page.click('#record');
  await page.waitForFunction(() => window.AlgoAnimate.diagnostics().recording);
  assert.equal(await page.isDisabled('#orientation'), true);
  assert.equal(await page.isDisabled('#connectTab'), true);
  assert.equal(await page.isDisabled('#includeWaveform'), true);
  await page.waitForTimeout(10000); await page.click('#stopRecording');
  await page.waitForFunction(() => window.AlgoAnimate.diagnostics().recordedBytes > 10000 && !window.AlgoAnimate.diagnostics().recordingBusy);
  assert.equal((await state()).source, 'demo', 'Stopping a take retains the sound source');
  const firstPath = resolve(results, 'demo-landscape.webm');
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
  assert.equal((await state()).source, 'demo', 'Cancel preserves existing audio');
  await page.evaluate(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas'); canvas.getContext('2d').fillRect(0, 0, 10, 10);
      window.testEmptyCapture = canvas.captureStream(1);
      return window.testEmptyCapture;
    };
  });
  await page.click('#connectTab');
  await page.waitForFunction(() => document.getElementById('message').textContent.includes('No audio was shared'));
  assert.equal((await state()).source, 'demo');
  assert.equal(await page.evaluate(() => window.testEmptyCapture.getVideoTracks()[0].readyState), 'ended');
  console.log('Denied capture and missing shared audio recover without stopping a working source.');

  await page.click('#stopAudio');
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

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile has no horizontal overflow');
  assert.ok(await page.evaluate(() => document.querySelector('.brand').getBoundingClientRect().right <= innerWidth - 12), 'Mobile branding fits');
  await page.screenshot({ path: resolve(results, 'mobile-portrait.png'), fullPage: true });
  await select('orientation', 'landscape');
  await page.setViewportSize({ width: 360, height: 800 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Narrow mobile has no horizontal overflow');
  await page.screenshot({ path: resolve(results, 'mobile-landscape.png'), fullPage: true });
  assert.deepEqual(errors, [], 'No uncaught application errors');
  const summary = { version: '0.02', desktop: 'passed', engines: 8, demoAnalysis: 'passed',
    continuousMarkerDrawing: enginesInMotion, noVideoHolds: 'passed', minimumChangedPixelsPer400ms: minimumChangedPixels,
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
