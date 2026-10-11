import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioInput, UNPROCESSED_AUDIO } from '../js/audio.js';
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
  assert.deepEqual(audio.recordingStream.getTracks(), [a], 'Recording uses the original capture audio only');
  assert.equal(audio.diagnostics().recordingPath, 'direct-capture');
  audio.stop(); assert.equal(a.stopped, true); assert.equal(v.stopped, true); assert.equal(audio.kind, null);
  assert.equal(audio.capturedAudio, null);
});

test('tab capture requests music without gain, noise or echo processing before awaiting setup', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const audio = input(), stream = new Stream([track('audio'), track('video')]);
  const events = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: {
    getDisplayMedia: async options => {
      events.push('capture');
      assert.deepEqual(options.audio, { ...UNPROCESSED_AUDIO, suppressLocalAudioPlayback: false });
      return stream;
    }
  } } });
  audio.ready = async () => { events.push('ready'); };
  try { await audio.tab(); assert.deepEqual(events, ['capture', 'ready']); audio.stop(); }
  finally { if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor); else delete globalThis.navigator; }
});

test('supported capture processing is disabled on the granted track and diagnostics exclude identifiers', async () => {
  const audio = input(), a = track('audio');
  let settings = { channelCount: 2, sampleRate: 48000, deviceId: 'private', autoGainControl: true, noiseSuppression: true };
  a.getCapabilities = () => ({ autoGainControl: [true, false], noiseSuppression: [false, true], echoCancellation: [true] });
  a.applyConstraints = async constraints => {
    assert.deepEqual(constraints, { noiseSuppression: false, autoGainControl: false });
    settings = { ...settings, ...constraints };
  };
  a.getSettings = () => settings;
  await audio.useStream(new Stream([a]), 'tab');
  assert.deepEqual(audio.diagnostics(), { recordingPath: 'direct-capture', constraintsRejected: false,
    settings: { channelCount: 2, sampleRate: 48000, noiseSuppression: false, autoGainControl: false } });
  assert.equal(audio.recordingStream.getAudioTracks()[0], a);
  audio.stop();
});

test('a browser rejecting processing constraints keeps usable audio and reports its actual settings', async () => {
  const audio = input(), a = track('audio');
  a.getCapabilities = () => ({ autoGainControl: [true, false] });
  a.applyConstraints = async () => { throw new Error('unsupported capture constraint'); };
  a.getSettings = () => ({ autoGainControl: true });
  await audio.useStream(new Stream([a]), 'tab');
  assert.equal(audio.kind, 'tab'); assert.equal(a.stopped, false);
  assert.deepEqual(audio.diagnostics(), { recordingPath: 'direct-capture', constraintsRejected: true, settings: { autoGainControl: true } });
  audio.stop();
});

test('native recording preserves one selected input track; switching to a file restores generated audio', async () => {
  const audio = input(), first = track('audio'), second = track('audio');
  audio.destination.stream = new Stream([track('audio')]);
  let analysed;
  audio.context.createMediaStreamSource = stream => { analysed = stream; return { connect() {}, disconnect() {} }; };
  await audio.useStream(new Stream([first, second]), 'tab');
  assert.equal(analysed, audio.recordingStream);
  assert.deepEqual(analysed.getAudioTracks(), [first], 'Analysis and recording cannot pick different capture tracks');
  audio.context.createMediaElementSource = () => ({ connect() {}, disconnect() {} });
  await audio.file({ pause() {} });
  assert.equal(audio.recordingStream, audio.destination.stream);
  assert.equal(first.stopped, true); assert.equal(second.stopped, true);
  assert.equal(audio.diagnostics().recordingPath, 'web-audio');
  audio.stop();
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
