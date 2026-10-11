import test from 'node:test';
import assert from 'node:assert/strict';
import { ScreenAwake, shortcut } from '../js/performance.js';

class Sentinel extends EventTarget {
  async release() { this.released = true; this.dispatchEvent(new Event('release')); }
}
test('wake lock releases after use, reacquires on visibility and releases a late request', async () => {
  const document = new EventTarget(); document.visibilityState = 'visible';
  let requests = 0, resolve;
  const navigator = { wakeLock: { request: async () => { requests++; return new Sentinel(); } } };
  const awake = new ScreenAwake(() => {}, navigator, document);
  awake.setWanted(true); await Promise.resolve();
  assert.equal(awake.status, 'awake');
  const first = awake.lock; await first.release();
  document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve();
  assert.equal(requests, 2); assert.equal(awake.status, 'awake');
  const second = awake.lock; awake.setWanted(false); assert.equal(second.released, true);
  navigator.wakeLock.request = () => new Promise(done => { resolve = done; });
  awake.setWanted(true); awake.dispose();
  const late = new Sentinel(); resolve(late); await Promise.resolve(); await Promise.resolve();
  assert.equal(late.released, true); assert.equal(awake.lock, null);
});
test('wake lock denial is reported without disrupting the drawing', async () => {
  const document = new EventTarget(); document.visibilityState = 'visible';
  const awake = new ScreenAwake(() => {}, { wakeLock: { request: async () => { throw new Error('Denied'); } } }, document);
  awake.setWanted(true); await Promise.resolve(); assert.equal(awake.status, 'unavailable'); awake.dispose();
});
test('shortcuts respect typing, focused controls, modifier keys and repeated presses', () => {
  assert.equal(shortcut({ key: 'R' }), 'record');
  assert.equal(shortcut({ key: ' ' }), 'pauseDrawing');
  assert.equal(shortcut({ key: 'c', target: { closest: () => ({}) } }), null);
  assert.equal(shortcut({ key: 'r', ctrlKey: true }), null);
  assert.equal(shortcut({ key: 'f', repeat: true }), null);
});
