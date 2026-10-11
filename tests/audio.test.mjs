import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioInput } from '../js/audio.js';
import { VideoRecorder, supportedRecordingType } from '../js/recording.js';

function track(kind) { return { kind, readyState: 'live', stopped: false, onended: null, stop() { this.stopped = true; this.readyState = 'ended'; }, clone() { return track(this.kind); } }; }
class Stream {
  constructor(tracks = []) { this.tracks = tracks; }
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter(t => t.kind === 'video'); }
}
globalThis.MediaStream = Stream;

function input() {
  const audio = new AudioInput();
  audio.context = { state: 'running', resume: async () => {}, destination: { label: 'speakers' },
    createMediaStreamSource: () => ({ connections: [], connect(node) { this.connections.push(node); }, disconnect() {} }) };
  audio.analyser = { label: 'analyser' }; audio.destination = { label: 'recording' };
  return audio;
}

test('missing tab audio closes every captured track without disturbing an existing source', async () => {
  const audio = input(), video = track('video'); audio.kind = 'demo';
  await assert.rejects(audio.useStream(new Stream([video]), 'tab'), /No audio was shared/);
  assert.equal(video.stopped, true); assert.equal(audio.kind, 'demo');
});

test('tab capture uses audio only, keeps its video track alive and avoids duplicate playback', async () => {
  const audio = input(), a = track('audio'), v = track('video'), stream = new Stream([a, v]);
  await audio.useStream(stream, 'tab');
  assert.equal(audio.kind, 'tab'); assert.equal(v.stopped, false);
  assert.deepEqual(audio.source.connections, [audio.analyser, audio.destination]);
  audio.stop(); assert.equal(a.stopped, true); assert.equal(v.stopped, true); assert.equal(audio.kind, null);
});

test('failed audio setup releases a newly granted capture stream', async () => {
  const audio = input(), a = track('audio'), v = track('video');
  audio.ready = async () => { throw new Error('suspended'); };
  await assert.rejects(audio.useStream(new Stream([a, v]), 'tab'), /suspended/);
  assert.equal(a.stopped, true); assert.equal(v.stopped, true);
});

test('reconnecting one media element reuses its Web Audio source node', async () => {
  const audio = input(); let created = 0;
  audio.context.createMediaElementSource = () => { created++; return { connect() {}, disconnect() {} }; };
  const element = { pause() {} };
  await audio.file(element); audio.stop(); await audio.file(element);
  assert.equal(created, 1); audio.stop();
});

test('paused, suspended and muted sources cannot feed stale analyser samples', () => {
  const audio = input(); let reads = 0;
  audio.wave = new Float32Array(2048); audio.frequencies = new Float32Array(1024);
  audio.analyser.getFloatTimeDomainData = () => reads++;
  audio.analyser.getFloatFrequencyData = () => reads++;
  audio.kind = 'file'; audio.mediaElement = { paused: true };
  assert.equal(audio.read(), null);
  audio.mediaElement.paused = false; assert.ok(audio.read()); assert.equal(reads, 2);
  audio.context.state = 'suspended'; assert.equal(audio.read(), null); assert.equal(reads, 2);
  audio.context.state = 'running'; audio.kind = 'tab';
  const a = track('audio'); audio.stream = new Stream([a]);
  a.muted = true; assert.equal(audio.read(), null);
  a.muted = false; a.enabled = false; assert.equal(audio.read(), null);
  a.enabled = true; assert.ok(audio.read()); assert.equal(reads, 4);
});

test('recording format is detected rather than assuming MP4 or WebM', () => {
  assert.equal(supportedRecordingType({ isTypeSupported: t => t === 'video/mp4' }), 'video/mp4');
  assert.equal(supportedRecordingType({ isTypeSupported: () => false }), null);
});

test('finishing a take preserves the source audio track and creates a playable-format blob', async () => {
  const originalRecorder = globalThis.MediaRecorder;
  class Recorder {
    static isTypeSupported(t) { return t === 'video/webm'; }
    constructor(stream, options) { this.state = 'inactive'; this.stream = stream; this.mimeType = options.mimeType; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => { this.ondataavailable({ data: new Blob(['recorded bytes']) }); this.onstop(); });
    }
  }
  globalThis.MediaRecorder = Recorder;
  try {
    const audio = track('audio'), video = track('video');
    const recorder = new VideoRecorder();
    recorder.start({ captureStream: () => new Stream([video]) }, new Stream([audio]));
    const recordedAudio = recorder.stream.getAudioTracks()[0];
    assert.equal(recorder.active, true);
    const done = recorder.stop(); assert.equal(recorder.busy, true);
    const result = await done;
    assert.equal(result.extension, 'webm'); assert.ok(result.blob.size > 0);
    assert.equal(audio.stopped, false); assert.equal(recordedAudio.stopped, true); assert.equal(video.stopped, true);
    assert.equal(recorder.busy, false); URL.revokeObjectURL(result.url);
  } finally { globalThis.MediaRecorder = originalRecorder; }
});
