import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, mkdtemp, rm, readdir, rename } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { chromium } from 'playwright';

const root = resolve('.'), results = resolve('test-results');
await mkdir(results, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + '/')) { res.writeHead(403).end(); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' }).end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
// Attach to an ordinary browser with no focus or throttling overrides. A
// separate CDP session cannot release the visible-capturer handle owned by
// Playwright's own focus emulation, so opt out before creating any pages.
const profile = await mkdtemp(resolve(tmpdir(), 'algoanimate-clock-'));
const chrome = spawn(chromium.executablePath(), ['--no-sandbox', '--disable-dev-shm-usage',
  '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
  '--user-data-dir=' + profile, '--autoplay-policy=no-user-gesture-required',
  ...(process.env.HEADED === '1' ? [] : ['--headless=new']), 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const endpoint = await new Promise((resolve, reject) => {
  let output = '';
  const timeout = setTimeout(() => reject(new Error('Chromium did not start: ' + output)), 30000);
  chrome.stderr.on('data', chunk => {
    output += chunk;
    const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
    if (match) { clearTimeout(timeout); resolve(match[1]); }
  });
  chrome.once('exit', code => { clearTimeout(timeout); reject(new Error('Chromium exited: ' + code + '\n' + output)); });
});
const browser = await chromium.connectOverCDP(endpoint, { noDefaults: true, isLocal: true, artifactsDir: results });
const context = browser.contexts()[0];
const browserSession = await browser.newBrowserCDPSession();
await browserSession.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: results, eventsEnabled: true });
const page = context.pages()[0], errors = [];
page.on('pageerror', error => errors.push(error.message));
const wait = predicate => page.waitForFunction(predicate, null, { polling: 100, timeout: 20000 });
const state = () => page.evaluate(() => window.AlgoAnimate.diagnostics());

async function saveTake(name) {
  const path = resolve(results, name + '.webm'), before = new Set(await readdir(results));
  // With noDefaults the browser owns its downloads, so wait for its finished
  // GUID-named file rather than Playwright's managed-download event.
  await page.click('#download');
  let downloaded;
  const deadline = Date.now() + 20000;
  while (!downloaded && Date.now() < deadline) {
    downloaded = (await readdir(results)).find(file => !before.has(file) && /^[0-9a-f-]{36}$/.test(file));
    if (!downloaded) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(downloaded, 'The Download video button saves a completed recording');
  await rename(resolve(results, downloaded), path);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'frame=best_effort_timestamp_time:stream=width,height', '-of', 'json', path], { maxBuffer: 8 * 1024 * 1024 }));
  const times = probe.frames.map(frame => +frame.best_effort_timestamp_time);
  const gaps = times.slice(1).map((time, index) => time - times[index]);
  const report = { name, width: probe.streams[0].width, height: probe.streams[0].height,
    frames: times.length, seconds: times.at(-1), fps: times.length / times.at(-1), maxGap: Math.max(...gaps) };
  assert.ok(report.fps > 22, 'Recording keeps a useful cadence without animation frames: ' + JSON.stringify(report));
  assert.ok(report.maxGap < 0.4, 'Export contains no multi-second frame gaps: ' + JSON.stringify(report));
  const hashes = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-an', '-vf', 'fps=2,scale=200:-1',
    '-f', 'framemd5', '-'], { encoding: 'utf8' }).split('\n').filter(line => line && !line.startsWith('#'))
    .map(line => line.split(',').at(-1).trim());
  assert.ok(new Set(hashes).size > hashes.length * 0.85, 'Background frames contain advancing ink, not repeated stills');
  console.log(JSON.stringify(report)); return report;
}

try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await wait(() => window.AlgoAnimate?.diagnostics().paths > 0 && !window.AlgoAnimate.diagnostics().building);
  await page.selectOption('#orientation', 'portrait');
  await wait(() => window.AlgoAnimate.diagnostics().dimensions[0] === 1000 && !window.AlgoAnimate.diagnostics().building);
  await page.click('#playDemo'); await wait(() => window.AlgoAnimate.diagnostics().features.active);
  await page.click('#clearCanvas');
  // Explicitly stop animation callbacks, including during first-ink entry.
  // Keep their pending callbacks so the ordinary preview can resume afterwards.
  await page.evaluate(() => {
    const original = window.requestAnimationFrame.bind(window), held = [];
    window.requestAnimationFrame = callback => { held.push(callback); return 0; };
    window.restoreAnimationFrames = () => {
      window.requestAnimationFrame = original;
      for (const callback of held) original(callback);
    };
  });
  await page.click('#record', { force: true }); await wait(() => window.AlgoAnimate.diagnostics().recording);
  assert.equal((await state()).recordingClock, 'worker');
  await page.waitForTimeout(7000);
  assert.ok((await state()).drawing.inkLength > 0);
  await page.click('#stopRecording', { force: true }); await wait(() => !window.AlgoAnimate.diagnostics().recordingBusy);
  await page.evaluate(() => window.restoreAnimationFrames());
  const withoutRAF = await saveTake('clock-portrait-no-animation');
  assert.equal(withoutRAF.width, 1000); assert.equal(withoutRAF.height, 1400);

  await page.selectOption('#orientation', 'landscape');
  await wait(() => window.AlgoAnimate.diagnostics().dimensions[0] === 1400 && !window.AlgoAnimate.diagnostics().building);
  // Model tab capture without audible playback from the animation page. A
  // locally playing demo could exempt its timers from background throttling.
  await page.evaluate(async () => {
    const audio = new AudioContext(), destination = audio.createMediaStreamDestination();
    const gain = audio.createGain(); gain.connect(destination);
    for (const hz of [110, 880, 6000]) {
      const oscillator = audio.createOscillator(); oscillator.frequency.value = hz;
      oscillator.connect(gain); oscillator.start();
    }
    const now = audio.currentTime;
    gain.gain.setValueAtTime(0.07, now);
    for (let beat = 0; beat < 400; beat++) {
      const time = now + 0.03 + beat * 0.22;
      gain.gain.setValueAtTime(0.07, time);
      gain.gain.linearRampToValueAtTime(0.2, time + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.07, time + 0.2);
    }
    await audio.resume();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 10;
    canvas.getContext('2d').fillRect(0, 0, 10, 10);
    const stream = new MediaStream([...destination.stream.getAudioTracks(), ...canvas.captureStream(1).getVideoTracks()]);
    navigator.mediaDevices.getDisplayMedia = async () => stream;
    window.backgroundCapture = { audio, stream };
  });
  await page.click('#connectTab'); await wait(() => window.AlgoAnimate.diagnostics().source === 'tab');
  assert.equal((await state()).audio.recordingPath, 'direct-capture');
  await page.click('#record'); await wait(() => window.AlgoAnimate.diagnostics().recording);
  const controls = await context.newPage(); await controls.goto('about:blank'); await controls.bringToFront();
  if (process.env.HEADED === '1') await wait(() => document.hidden);
  // Continue past Chrome's one-minute background timer threshold. Splitting
  // the wait also makes worker liveness observable during the recording.
  await page.waitForTimeout(35000);
  const middle = await state();
  await page.waitForTimeout(35000);
  const end = await state();
  assert.ok(end.drawing.cycles > middle.drawing.cycles, 'Hidden artwork keeps developing after a minute');
  await page.bringToFront(); await controls.close();
  await page.click('#stopRecording'); await wait(() => !window.AlgoAnimate.diagnostics().recordingBusy);
  const background = await saveTake('clock-landscape-background');
  assert.equal(background.width, 1400); assert.equal(background.height, 1000);
  await page.screenshot({ path: resolve(results, 'hierarchy-landscape.png'), fullPage: true });
  await page.selectOption('#orientation', 'portrait');
  await wait(() => window.AlgoAnimate.diagnostics().dimensions[0] === 1000 && !window.AlgoAnimate.diagnostics().building);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(results, 'hierarchy-portrait.png'), fullPage: true });
  await writeFile(resolve(results, 'recording-clock.json'), JSON.stringify({ withoutRAF, background, errors }, null, 2));
  assert.deepEqual(errors, []); console.log('PASS: recording clock, first ink without animation frames and a real background tab.');
} finally {
  await browserSession.send('Browser.close').catch(() => {});
  await browser.close(); chrome.kill();
  await new Promise(resolve => server.close(resolve));
  // Chromium can finish writing its profile after the CDP connection closes.
  // Scratch cleanup must not turn successful recording checks into a failure.
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(error => {
    console.warn('Temporary browser profile cleanup:', error.code);
  });
}
