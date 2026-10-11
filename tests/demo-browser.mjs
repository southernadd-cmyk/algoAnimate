import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

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
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (request.url().endsWith('.mp3')) musicRequests.push(request.url()); });
const state = () => page.evaluate(() => window.AlgoAnimate.diagnostics());
const musicReady = title => page.waitForFunction(title => {
  const d = window.AlgoAnimate.diagnostics();
  return d.demo?.title === title && !d.demo.paused && d.features.active && d.drawing.inkLength > 0;
}, title, { timeout: 15000 });
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.AlgoAnimate?.diagnostics().paths > 0);
  assert.equal(await page.title(), await page.locator('meta[property="og:title"]').getAttribute('content'));
  assert.equal(await page.locator('.source-main > button').first().getAttribute('id'), 'playDemo');
  assert.equal(await page.locator('.source-button.primary').getAttribute('id'), 'playDemo');
  assert.equal(musicRequests.length, 0, 'Cold page loads do not download music or autoplay');
  await page.click('#playDemo');
  await musicReady('Bubbles');
  assert.equal((await state()).source, 'demo');
  assert.equal(await page.locator('#demoDeck').isVisible(), true);
  assert.match(await page.locator('#sourceName').textContent(), /Bubbles/);
  await page.evaluate(() => document.getElementById('demoPlayer').pause());
  await page.waitForFunction(() => !window.AlgoAnimate.diagnostics().drawing.flowing);
  const held = await page.locator('#art').evaluate(canvas => canvas.toDataURL());
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#art').evaluate(canvas => canvas.toDataURL()), held);
  await page.click('#playDemo');
  await musicReady('Bubbles');
  await page.waitForFunction(() => !document.getElementById('record').disabled);
  await page.click('#record');
  await page.waitForFunction(() => window.AlgoAnimate.diagnostics().recording);
  await page.waitForTimeout(1200);
  await page.click('#nextDemo');
  await musicReady('Calm Current');
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
  await page.click('#stopRecording');
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
  await page.screenshot({ path: resolve(results, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok(await page.locator('#playDemo').evaluate(el => el.getBoundingClientRect().height >= 44));
  await page.screenshot({ path: resolve(results, 'mobile.png'), fullPage: true });
  await page.click('#stopAudio');
  assert.equal((await state()).source, null);
  assert.equal(await page.locator('#demoPlayer').getAttribute('src'), null);
  await page.click('#playDemo'); await musicReady('Bubbles');
  assert.deepEqual(errors, []);
  assert.ok(new Set(musicRequests).size === 3, 'All three bundled recordings are playable');
  console.log('PASS: click-to-play, pause/resume, three tracks, real automatic advance, wrap, export sound, mobile and reconnect. Export RMS:', rms.toFixed(4));
} catch (error) {
  await page.screenshot({ path: resolve(results, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(resolve(results, 'failure.txt'), error.stack + '\n' + errors.join('\n'));
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
