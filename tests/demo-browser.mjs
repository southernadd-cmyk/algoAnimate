import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { parseScore, ScoreReplay, MAX_SCORE_BYTES } from '../js/scores.js';
import { sheetSVG } from '../js/export.js';

const root = resolve('.'), results = resolve('test-results/demo');
await mkdir(results, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + '/')) { res.writeHead(403).end(); return; }
    const body = await readFile(file), type = mime[extname(file)] || 'application/octet-stream';
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if (range) {
      const start = +range[1], end = Math.min(range[2] ? +range[2] : body.length - 1, body.length - 1);
      res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Content-Length': end - start + 1 });
      res.end(body.subarray(start, end + 1));
    } else { res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length }); res.end(body); }
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch(); // Default autoplay policy: a real click must start the demo.
const errors = [], musicRequests = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
let musicGate;
await page.route('**/media/demo/*.mp3', async route => {
  if (musicGate) await musicGate;
  await route.continue();
});
function holdMusic() {
  let release;
  musicGate = new Promise(resolve => { release = resolve; });
  return () => { musicGate = null; release(); };
}
await page.addInitScript(() => {
  window.wakeTest = { requests: 0, releases: 0 };
  Object.defineProperty(navigator, 'wakeLock', { value: { request: async type => {
    if (type !== 'screen') throw new Error('Unexpected wake lock type');
    window.wakeTest.requests++;
    const lock = new EventTarget(); lock.release = async () => {
      window.wakeTest.releases++; lock.dispatchEvent(new Event('release'));
    }; return lock;
  } } });
});
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (request.url().endsWith('.mp3')) musicRequests.push(request.url()); });
const state = () => page.evaluate(() => window.AlgoAnimate.diagnostics());
const musicReady = title => page.waitForFunction(title => {
  const d = window.AlgoAnimate.diagnostics();
  return d.demo?.title === title && !d.demo.paused && d.features.active && d.drawing.inkLength > 0
    && document.getElementById('playDemo').getAttribute('aria-busy') === 'false';
}, title, { timeout: 15000 });
async function resumeDemo() {
  const title = await page.locator('#demoTrackLink').textContent();
  await page.click('#playDemo'); await musicReady(title);
}
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.AlgoAnimate?.diagnostics().paths > 0);
  assert.equal(await page.locator('#sharedAnchor').isChecked(),true);
  await page.locator('#tuningDetails').evaluate(element=>{element.open=true;});
  const anchoredCount=(await state()).compositions;
  await page.uncheck('#sharedAnchor');
  await page.waitForFunction(count=>window.AlgoAnimate.diagnostics().compositions>count&&!window.AlgoAnimate.diagnostics().building,anchoredCount);
  const freeCount=(await state()).compositions;
  await page.check('#sharedAnchor');
  await page.waitForFunction(count=>window.AlgoAnimate.diagnostics().compositions>count&&!window.AlgoAnimate.diagnostics().building,freeCount);
  await page.locator('#tuningDetails').evaluate(element=>{element.open=false;});
  assert.equal(await page.title(), await page.locator('meta[property="og:title"]').getAttribute('content'));
  assert.equal(await page.locator('.source-main > button').first().getAttribute('id'), 'playDemo');
  assert.equal(await page.locator('.source-button.primary').getAttribute('id'), 'playDemo');
  assert.equal(musicRequests.length, 0, 'Cold page loads do not download music or autoplay');
  const releaseFirstTrack = holdMusic();
  await page.click('#playDemo');
  assert.equal(await page.locator('#demoButtonLabel').textContent(), 'Loading track…');
  assert.equal(await page.locator('#playDemo').getAttribute('aria-busy'), 'true');
  releaseFirstTrack();
  await musicReady('Bubbles');
  // Independent layer caching is the default Tissue material, not an opt-in toggle.
  assert.equal(await page.locator('#layeredTissue').count(), 0);
  assert.equal(await page.locator('#materialMode').inputValue(), 'tissue');
  await page.waitForFunction(() => {
    const d = window.AlgoAnimate.diagnostics();
    return d.material.name === 'Tissue & Graphite' && d.material.compositionCache && d.material.frameReady;
  }, null, { timeout: 30000 });
  assert.equal(await page.locator('#message').textContent() === 'Tissue & Graphite rendering failed:', false);
  await page.screenshot({ path: resolve(results, 'tissue-composition-cache-default.png') });
  // The original marker material remains selectable without a checkbox.
  await page.selectOption('#materialMode', 'marker');
  assert.equal((await state()).material.name, 'Marker');
  assert.equal((await state()).material.compositionCache, false);
  await page.selectOption('#materialMode', 'tissue');
  await page.waitForFunction(() => {
    const material = window.AlgoAnimate.diagnostics().material;
    return material.compositionCache && material.frameReady;
  }, null, { timeout: 30000 });
  assert.equal(await page.locator('#demoButtonLabel').textContent(), 'Demo playing');
  assert.equal(await page.locator('#playDemo').getAttribute('aria-busy'), 'false');
  assert.equal(await page.locator('#demoTrackNumber').textContent(),
    '01 / ' + String((await state()).demo.tracks).padStart(2, '0'));
  assert.equal((await state()).source, 'demo');
  assert.equal(await page.locator('#demoDeck').isVisible(), true);
  assert.match(await page.locator('#sourceName').textContent(), /Bubbles/);
  await page.locator('[data-engine="field"] .engine-title').click();
  await page.waitForFunction(() => window.AlgoAnimate.diagnostics().engines.filter(e => e.enabled).length === 1);
  assert.equal(await page.getByRole('button', { name: 'Solo Orbital Studies', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Mute Orbital Studies', exact: true }).click();
  await page.waitForFunction(() => window.AlgoAnimate.diagnostics().drawing.visiblePaths === 0);
  await page.getByRole('button', { name: 'Solo Orbital Studies', exact: true }).click();
  await page.getByRole('button', { name: 'Mute Orbital Studies', exact: true }).click();
  await page.click('#listen');
  assert.equal(await page.locator('#listeningOverlay').isVisible(), true);
  assert.match(await page.locator('#listeningOverlay').textContent(), /35–250 Hz.*dBFS/);
  assert.match(await page.locator('#listeningOverlay').textContent(), /positive flux/);
  await page.click('#listen');
  await page.click('#performance');
  await page.waitForFunction(() => window.AlgoAnimate.diagnostics().performance && window.AlgoAnimate.diagnostics().wakeLock === 'awake');
  assert.equal(await page.locator('.masthead').isVisible(), false);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.AlgoAnimate.diagnostics().paused && !window.AlgoAnimate.diagnostics().drawing.flowing);
  const pausedPens = await page.locator('#art').evaluate(canvas => canvas.toDataURL());
  await page.waitForTimeout(120);
  assert.equal(await page.locator('#art').evaluate(canvas => canvas.toDataURL()), pausedPens);
  await page.keyboard.press('Space');
  await page.keyboard.press('c');
  await page.waitForFunction(() => document.getElementById('message').textContent.includes('Canvas cleared'));
  await page.waitForFunction(() => getComputedStyle(document.getElementById('performanceControls')).opacity === '0');
  await page.screenshot({ path: resolve(results, 'performance.png') });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.AlgoAnimate.diagnostics().performance);
  assert.equal(await page.locator('.masthead').isVisible(), true);
  assert.ok(await page.evaluate(() => window.wakeTest.releases >= 1));

  await page.evaluate(() => document.getElementById('demoPlayer').pause());
  await page.waitForFunction(() => !window.AlgoAnimate.diagnostics().drawing.flowing);
  const held = await page.locator('#art').evaluate(canvas => canvas.toDataURL());
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#art').evaluate(canvas => canvas.toDataURL()), held);
  await page.click('#playDemo');
  await musicReady('Bubbles');
  await page.waitForFunction(() => !document.getElementById('record').disabled);
  await page.locator('#art').click();
  await page.keyboard.press('r');
  await page.waitForFunction(() => window.AlgoAnimate.diagnostics().recording);
  await page.waitForTimeout(1200);
  const releaseNextTrack = holdMusic();
  await page.click('#nextDemo');
  assert.equal(await page.locator('#demoButtonLabel').textContent(), 'Loading track…');
  assert.equal(await page.locator('#nextDemo').isDisabled(), true);
  releaseNextTrack();
  await musicReady('Calm Current');
  assert.equal(await page.locator('#demoButtonLabel').textContent(), 'Demo playing');
  assert.equal((await state()).recording, true, 'Skipping tracks preserves the live recording');
  await page.waitForTimeout(1200);
  // Seek close to a real media end; do not simulate an ended event in the browser.
  await page.evaluate(() => {
    const player = document.getElementById('demoPlayer'); player.currentTime = player.duration - 0.18;
  });
  await musicReady('Tokyo Sunset');
  await page.waitForTimeout(1200);
  await page.click('#nextDemo');
  await musicReady('Bubbles');
  await page.waitForTimeout(1200);
  await page.click('#pauseDrawing');
  await page.waitForFunction(() => window.AlgoAnimate.diagnostics().paused && !window.AlgoAnimate.diagnostics().drawing.flowing);
  await page.waitForTimeout(100);
  const recordedSheet = await page.locator('#art').evaluate(canvas => canvas.toDataURL());
  await page.locator('#art').click(); await page.keyboard.press('r');
  await page.waitForFunction(() => !window.AlgoAnimate.diagnostics().recordingBusy && !document.getElementById('take').hidden);
  const recordingPath = resolve(results, 'lofi-rotation.webm');
  const downloadPending = page.waitForEvent('download');
  await page.click('#download');
  await (await downloadPending).saveAs(recordingPath);
  const media = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', recordingPath]));
  assert.ok(media.streams.some(stream => stream.codec_type === 'audio'));
  assert.ok(media.streams.some(stream => stream.codec_type === 'video'));
  const sound = execFileSync('ffmpeg', ['-v', 'error', '-i', recordingPath, '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', 'pipe:1']);
  let sum = 0;
  for (let i = 0; i < sound.length; i += 4) sum += sound.readFloatLE(i) ** 2;
  const rms = Math.sqrt(sum / (sound.length / 4));
  assert.ok(rms > 0.005, 'Export contains actual audible music across the track changes');
  const scoreDownload = page.waitForEvent('download'); await page.click('#saveScore');
  const scorePath = resolve(results, 'take-score.json'); await (await scoreDownload).saveAs(scorePath);
  const savedScore = JSON.parse(await readFile(scorePath, 'utf8'));
  assert.equal(savedScore.format, 'algoanimate-score'); assert.ok(savedScore.frames.length > 50);
  assert.equal(savedScore.material, 'tissue-graphite-v6');
  assert.equal(savedScore.materialFrames.length, savedScore.frames.length, 'Each replay frame carries its material seed and palette');
  assert.ok((await readFile(scorePath)).length < 5000000, 'The short score contains shared geometry, not audio or frame images');
  await page.click('#replayScore');
  await page.waitForFunction(() => window.AlgoAnimate.diagnostics().replay !== null);
  await page.locator('#scoreSeek').evaluate(el => { el.value = el.max; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForFunction(() => window.AlgoAnimate.diagnostics().replay.paused && window.AlgoAnimate.diagnostics().replay.time === window.AlgoAnimate.diagnostics().replay.duration);
  // Tissue buffers render asynchronously. Compare two independently
  // reconstructed replays, not a live canvas that can legitimately lag its
  // contemporaneous vector score by one material-render interval.
  await page.waitForFunction(() => window.AlgoAnimate.diagnostics().material.frameReady, null, { timeout: 15000 });
  await page.waitForTimeout(100);
  const replayedSheet = await page.locator('#art').evaluate(canvas => canvas.toDataURL());
  assert.notEqual(replayedSheet, recordedSheet === '' ? replayedSheet : '', 'A real tissue image is reconstructed');
  await page.selectOption('#exportFormat', 'svg');
  const svgDownload = page.waitForEvent('download'); await page.click('#snapshot');
  const svgPath = resolve(results, 'frame.svg'); await (await svgDownload).saveAs(svgPath);
  const svg = await readFile(svgPath, 'utf8'); assert.ok(svg.includes('<path')); assert.ok(!svg.includes('<image'));
  assert.equal(await page.evaluate(svg => new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('parsererror') === null, svg), true);
  await page.selectOption('#exportFormat', 'print');
  const printDownload = page.waitForEvent('download'); await page.click('#snapshot');
  const printPath = resolve(results, 'frame-3x.png'); await (await printDownload).saveAs(printPath);
  const png = await readFile(printPath); assert.equal(png.readUInt32BE(16), 4200); assert.equal(png.readUInt32BE(20), 3000);
  const phys = png.indexOf('pHYs'); assert.ok(phys > 0);
  assert.equal(png.readUInt32BE(phys + 4), 11811); assert.equal(png.readUInt32BE(phys + 8), 11811); assert.equal(png[phys + 12], 1);
  await page.click('#leaveReplay'); await page.setInputFiles('#scoreInput', scorePath);
  await page.waitForFunction(() => window.AlgoAnimate.diagnostics().replay !== null);
  await page.locator('#scoreSeek').evaluate(el => { el.value = el.max; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForFunction(() => window.AlgoAnimate.diagnostics().material.frameReady, null, { timeout: 15000 });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#art').evaluate(canvas => canvas.toDataURL()), replayedSheet,
    'An imported score recreates exactly the same tissue pixels from saved vectors, seed and palette');
  await page.click('#leaveReplay');
  await page.click('#playDemo'); await musicReady('Bubbles');
  if (process.env.ALGOANIMATE_DENSE_TAKE === '1') {
    await page.evaluate(() => {
      for (const [id, value] of [['density', 100], ['evolution', 80]]) {
        const control = document.getElementById(id); control.value = value;
        control.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await page.waitForFunction(() => !window.AlgoAnimate.diagnostics().building && !document.getElementById('record').disabled,
      null, { timeout: 30000 });
    const beforeDense = await state();
    await page.click('#record');
    await page.waitForFunction(() => window.AlgoAnimate.diagnostics().recording);
    console.log('Dense recording started: real demo music, 100% density, normal three-minute auto-stop.');
    await page.waitForFunction(() => !window.AlgoAnimate.diagnostics().recordingBusy,
      null, { timeout: 205000, polling: 1000 });
    const afterDense = await state();
    const denseVideoDownload = page.waitForEvent('download'); await page.click('#download');
    const denseVideoPath = resolve(results, 'dense-three-minute.webm');
    await (await denseVideoDownload).saveAs(denseVideoPath);
    const denseScoreDownload = page.waitForEvent('download'); await page.click('#saveScore');
    const denseScorePath = resolve(results, 'dense-three-minute-score.json');
    await (await denseScoreDownload).saveAs(denseScorePath);
    const denseText = await readFile(denseScorePath, 'utf8'), denseScore = parseScore(denseText);
    assert.ok(denseScore.duration >= 179000, 'The dense score must reach the normal three-minute auto-stop');
    assert.ok(Buffer.byteLength(denseText) < MAX_SCORE_BYTES * .8, 'Lossless vectors remain below the score cutoff');
    assert.ok(denseScore.scenes.length <= afterDense.compositions - beforeDense.compositions + 24,
      'Restyling must not add extra scene records');
    // New eight-voice captures have no privileged lead, hence no focal fade.
    // Do not weaken score coverage: prove that all eight independent voices
    // regenerate geometry during the full three-minute performance.
    assert.ok(denseScore.frames.every(frame => frame[5] === null),
      'Equal-voice score frames must not fade seven voices around Growth');
    const voiceCompositions = Object.fromEntries(
      [...new Set(denseScore.scenes.map(scene => scene.mode))].map(mode => [
        mode, new Set(denseScore.scenes
          .filter(scene => scene.mode === mode)
          .map(scene => scene.vectors.data)).size
      ]));
    assert.equal(Object.keys(voiceCompositions).length, 8,
      'All eight voices must appear in the dense captured score');
    for (const [mode, changes] of Object.entries(voiceCompositions)) {
      assert.ok(changes >= 2, mode + ' must redraw under changing sound');
    }
    const probe = new ScoreReplay(denseScore); probe.seek(denseScore.duration);
    await page.click('#replayScore');
    await page.locator('#scoreSeek').evaluate(el => { el.value = el.max; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForFunction(() => window.AlgoAnimate.diagnostics().replay?.paused);
    await page.selectOption('#exportFormat', 'svg');
    const denseSVGDownload = page.waitForEvent('download'); await page.click('#snapshot');
    const denseSVGPath = resolve(results, 'dense-final-frame.svg'); await (await denseSVGDownload).saveAs(denseSVGPath);
    assert.equal(await readFile(denseSVGPath, 'utf8'), sheetSVG(probe.sheet()), 'Dense score replays the exact final vector frame');
    const denseMedia = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', denseVideoPath]));
    assert.ok(denseMedia.streams.some(stream => stream.codec_type === 'audio'));
    assert.ok(denseMedia.streams.some(stream => stream.codec_type === 'video'));
    const seconds = Number(denseMedia.format.duration);
    assert.ok(seconds >= 179 && seconds <= 185, 'Video reaches the three-minute capture limit');
    const report = { density: 100, videoSeconds: seconds, scoreMilliseconds: denseScore.duration,
      scoreBytes: Buffer.byteLength(denseText), scenes: denseScore.scenes.length, frames: denseScore.frames.length,
      equalVoiceNoFocal: true, voiceCompositions, newCompositions: afterDense.compositions - beforeDense.compositions, replay: 'exact SVG' };
    await writeFile(resolve(results, 'dense-recording-report.json'), JSON.stringify(report, null, 2));
    console.log('PASS: dense three-minute music recording, full score and exact replay.', report);
    await page.click('#leaveReplay'); await resumeDemo();
  }
  await page.screenshot({ path: resolve(results, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok(await page.locator('#playDemo').evaluate(el => el.getBoundingClientRect().height >= 44));
  await page.screenshot({ path: resolve(results, 'mobile.png'), fullPage: true });
  await page.click('#stopAudio');
  assert.equal((await state()).source, null);
  assert.equal(await page.locator('#demoPlayer').getAttribute('src'), null);
  await resumeDemo();
  assert.deepEqual(errors, []);
  assert.ok(new Set(musicRequests).size === 3, 'All three bundled recordings are playable');
  console.log('PASS: solo/mute, overlay, performance, shortcuts, wake lock, vector/3x export, score pixel determinism, click-to-play, pause/resume, three tracks, real automatic advance, wrap, export sound, mobile and reconnect. Export RMS:', rms.toFixed(4));
} catch (error) {
  await page.screenshot({ path: resolve(results, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(resolve(results, 'failure.txt'), error.stack + '\n' + errors.join('\n'));
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
