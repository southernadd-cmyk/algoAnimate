export const UNPROCESSED_AUDIO = Object.freeze({
  echoCancellation: false, noiseSuppression: false, autoGainControl: false
});
const PROCESSING_KEYS = Object.keys(UNPROCESSED_AUDIO);

async function unprocessedTrack(track) {
  // Capture preferences can be ignored. Reapply supported constraints to the
  // granted track and retain actual settings for diagnosing browser behaviour.
  const capabilities = track.getCapabilities?.() || {};
  const constraints = Object.fromEntries(PROCESSING_KEYS.filter(key =>
    Array.isArray(capabilities[key]) && capabilities[key].includes(false)).map(key => [key, false]));
  let constraintsRejected = false;
  if (track.applyConstraints && Object.keys(constraints).length) {
    try { await track.applyConstraints(constraints); }
    catch { constraintsRejected = true; }
  }
  return { constraintsRejected, settings: track.getSettings?.() || {} };
}

export class AudioInput {
  constructor({ onEnded = () => {} } = {}) {
    this.onEnded = onEnded;
    this.context = null;
    this.kind = null;
    this.stream = null;
    this.capturedAudio = null;
    this.captureStatus = null;
    this.source = null;
    this.monitor = null;
    this.cleanup = null;
    this.mediaSources = new WeakMap();
  }

  async ready() {
    if (!this.context) {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Context) throw new Error('This browser does not support Web Audio. Try desktop Chrome.');
      this.context = new Context({ latencyHint: 'interactive' });
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.15;
      this.analyser.minDecibels = -100;
      this.analyser.maxDecibels = -10;
      this.destination = this.context.createMediaStreamDestination();
      this.wave = new Float32Array(this.analyser.fftSize);
      this.frequencies = new Float32Array(this.analyser.frequencyBinCount);
    }
    await this.context.resume();
    if (this.context.state !== 'running') throw new Error('Audio is suspended. Click your audio source again to resume it.');
  }

  attach(source, kind, audible = false) {
    this.source = source;
    this.kind = kind;
    source.connect(this.analyser);
    source.connect(this.destination);
    if (audible) source.connect(this.context.destination);
  }

  async tab() {
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Tab audio capture is unavailable here. Use desktop Chrome, an audio file or the microphone.');
    // Call directly from the click gesture, before awaiting any other operation.
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser', frameRate: 1 },
      audio: { ...UNPROCESSED_AUDIO, suppressLocalAudioPlayback: false },
      selfBrowserSurface: 'exclude', systemAudio: 'include', surfaceSwitching: 'exclude'
    });
    await this.useStream(stream, 'tab');
  }

  async microphone() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture is unavailable in this browser.');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { ...UNPROCESSED_AUDIO }, video: false
    });
    await this.useStream(stream, 'microphone');
  }

  async useStream(stream, kind) {
    const track = stream.getAudioTracks().find(track => track.readyState === 'live');
    if (!track) {
      stream.getTracks().forEach(track => track.stop());
      throw new Error('No audio was shared. Choose a browser tab and turn on “Share tab audio”, then try again.');
    }
    try {
      await this.ready();
      const captureStatus = await unprocessedTrack(track);
      if (track.readyState !== 'live') throw new Error('The shared audio ended before it could be connected. Try sharing again.');
      this.stop();
      this.stream = stream;
      this.capturedAudio = new MediaStream([track]);
      this.captureStatus = captureStatus;
      this.attach(this.context.createMediaStreamSource(this.capturedAudio), kind);
      // Keep the captured video track alive: some browsers tie audio to it.
      // Its pixels are never displayed or recorded by AlgoAnimate.
      for (const track of stream.getTracks()) track.onended = () => {
        if (this.stream === stream) this.onEnded();
      };
    } catch (error) {
      stream.getTracks().forEach(track => track.stop());
      if (this.stream === stream) this.stop();
      throw error;
    }
  }

  get recordingStream() {
    // Native capture already has the original channels and level. Keep its
    // recording out of the analysis graph and its channel mixing/resampling.
    return this.capturedAudio || this.destination?.stream;
  }
  diagnostics() {
    const track = this.capturedAudio?.getAudioTracks()[0];
    const settings = track?.getSettings?.() || this.captureStatus?.settings || {};
    const keys = ['channelCount', 'sampleRate', ...PROCESSING_KEYS];
    return { recordingPath: this.capturedAudio ? 'direct-capture' : 'web-audio',
      constraintsRejected: this.captureStatus?.constraintsRejected || false,
      settings: Object.fromEntries(keys.filter(key => settings[key] !== undefined).map(key => [key, settings[key]])) };
  }

  async file(element) { await this.useMedia(element, 'file'); }
  async demo(element) { await this.useMedia(element, 'demo'); }

  async useMedia(element, kind) {
    await this.ready();
    if (this.kind === kind && this.mediaElement === element) return;
    this.stop();
    let source = this.mediaSources.get(element);
    if (!source) {
      source = this.context.createMediaElementSource(element);
      this.mediaSources.set(element, source);
    }
    this.mediaElement = element;
    this.attach(source, kind, true);
  }

  read() {
    if (!this.kind || !this.analyser || this.context.state !== 'running'
      || (this.mediaElement?.paused)
      || (this.stream && !this.stream.getAudioTracks().some(track =>
        track.readyState === 'live' && track.enabled !== false && !track.muted))) return null;
    this.analyser.getFloatTimeDomainData(this.wave);
    this.analyser.getFloatFrequencyData(this.frequencies);
    return { wave: this.wave, frequencies: this.frequencies, sampleRate: this.context.sampleRate };
  }

  stop() {
    this.cleanup?.(); this.cleanup = null;
    if (this.stream) for (const track of this.stream.getTracks()) { track.onended = null; track.stop(); }
    this.stream = null;
    this.capturedAudio = null; this.captureStatus = null;
    if (this.mediaElement) this.mediaElement.pause();
    this.mediaElement = null;
    if (this.source) this.source.disconnect();
    this.source = null;
    this.kind = null;
  }
}

export function describeCaptureError(error) {
  if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') return 'Audio sharing was cancelled or permission was denied. Click a source to try again.';
  if (error.name === 'NotFoundError') return 'No microphone or audio capture source was found. Try an audio file or the demo.';
  if (error.name === 'NotReadableError') return 'The browser could not access this audio source. Close other capture sessions and try again.';
  return error.message || 'The audio source could not be connected.';
}
