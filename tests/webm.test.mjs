import test from 'node:test';
import assert from 'node:assert/strict';
import { fixWebmDuration } from '../js/webm.js';
import { supportedRecordingType } from '../js/recording.js';

const segment = [0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
const scale = [0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40];
const tail = [0x1f, 0x43, 0xb6, 0x75, 0xff, 0x42, 0x21, 0x11, 0x10];
function stream(info = scale) {
  return new Blob([new Uint8Array([...segment, 0x15, 0x49, 0xa9, 0x66, 0x80 | info.length, ...info, ...tail])], { type: 'video/webm' });
}

test('streaming WebM gains a timestamp-scaled duration without changing media bytes', async () => {
  const original = stream();
  const fixed = await fixWebmDuration(original, 2.5);
  const bytes = new Uint8Array(await fixed.arrayBuffer());
  assert.equal(fixed.size, original.size + 11);
  assert.equal(bytes[16], 0x80 | (scale.length + 11));
  const durationStart = 17 + scale.length;
  assert.deepEqual([...bytes.slice(durationStart, durationStart + 3)], [0x44, 0x89, 0x88]);
  assert.equal(new DataView(bytes.buffer).getFloat64(durationStart + 3), 2500);
  assert.deepEqual([...bytes.slice(-tail.length)], tail);
});

test('existing positive duration and other containers remain unchanged', async () => {
  const duration = new Uint8Array(11); duration.set([0x44, 0x89, 0x88]); new DataView(duration.buffer).setFloat64(3, 900);
  const withDuration = stream([...scale, ...duration]);
  assert.equal(await fixWebmDuration(withDuration, 2.5), withDuration);
  const mp4 = new Blob(['MP4 data'], { type: 'video/mp4' });
  assert.equal(await fixWebmDuration(mp4, 2.5), mp4);
});

test('missing or malformed headers are preserved rather than corrupting an export', async () => {
  const original = new Blob(['not an EBML stream'], { type: 'video/webm' });
  assert.equal(await fixWebmDuration(original, 2.5), original);
});


test('Mobile recording prefers hardware-friendly H.264, then VP8; desktop keeps VP9', () => {
  const formats = new Set(['video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus']);
  const Recorder = { isTypeSupported: type => formats.has(type) };
  assert.equal(supportedRecordingType(Recorder), 'video/webm;codecs=vp9,opus');
  assert.equal(supportedRecordingType(Recorder, true), 'video/mp4;codecs=avc1.42E01E,mp4a.40.2');
  formats.delete('video/mp4;codecs=avc1.42E01E,mp4a.40.2');
  assert.equal(supportedRecordingType(Recorder, true), 'video/webm;codecs=vp8,opus');
});
