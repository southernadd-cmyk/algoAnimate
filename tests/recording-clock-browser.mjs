import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
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
const browser = await chromium.launch({ headless: process.env.HEADED !== '1',
  args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
const wait = predicate => page.waitForFunction(predicate, null, { polling: 100, timeout: 20000 });
const state = () => page.evaluate(() => window.AlgoAnimate.diagnostics());

async function saveTake(name) {
  const path = resolve(results, name + '.webm'), download = page.waitForEvent('download');
  await page.click('#download'); await (await download).saveAs(path);
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
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
