export class AudioInput {
  constructor({ onEnded = () => {} } = {}) {
    this.onEnded = onEnded;
    this.context = null;
    this.kind = null;
    this.stream = null;
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
      audio: { suppressLocalAudioPlayback: false },
      selfBrowserSurface: 'exclude', systemAudio: 'include', surfaceSwitching: 'exclude'
    });
    await this.useStream(stream, 'tab');
  }

  async microphone() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture is unavailable in this browser.');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false
    });
    await this.useStream(stream, 'microphone');
  }

  async useStream(stream, kind) {
    if (!stream.getAudioTracks().some(track => track.readyState === 'live')) {
      stream.getTracks().forEach(track => track.stop());
      throw new Error('No audio was shared. Choose a browser tab and turn on “Share tab audio”, then try again.');
    }
    try {
      await this.ready();
      this.stop();
      this.stream = stream;
      const audioOnly = new MediaStream(stream.getAudioTracks());
      this.attach(this.context.createMediaStreamSource(audioOnly), kind);
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

  async file(element) {
    await this.ready();
    if (this.kind === 'file' && this.mediaElement === element) return;
    this.stop();
    let source = this.mediaSources.get(element);
    if (!source) {
      source = this.context.createMediaElementSource(element);
      this.mediaSources.set(element, source);
    }
    this.mediaElement = element;
    this.attach(source, 'file', true);
  }

  async demo() {
    await this.ready();
    this.stop();
    const context = this.context;
    const bus = context.createGain();
    bus.gain.value = 0.5;
    this.attach(bus, 'demo', true);
    const nodes = new Set();
    const chords = [[146.83, 174.61, 220], [130.81, 164.81, 196], [110, 130.81, 164.81], [130.81, 174.61, 220]];
    const noise = context.createBuffer(1, Math.round(context.sampleRate * 0.09), context.sampleRate);
    const data = noise.getChannelData(0);
    let random = 1618;
    for (let i = 0; i < data.length; i++) {
      random = Math.imul(random, 1664525) + 1013904223;
      data[i] = ((random >>> 0) / 4294967296 * 2 - 1) * Math.exp(-i / data.length * 5);
    }
    function tone(frequency, time, duration, volume, type = 'sine', kick = false) {
      const oscillator = context.createOscillator(), envelope = context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, time);
      if (kick) oscillator.frequency.exponentialRampToValueAtTime(45, time + 0.14);
      envelope.gain.setValueAtTime(0, time);
      envelope.gain.linearRampToValueAtTime(volume, time + 0.006);
      envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
      oscillator.connect(envelope); envelope.connect(bus);
      oscillator.start(time); oscillator.stop(time + duration + 0.015);
      nodes.add(oscillator);
      oscillator.onended = () => { nodes.delete(oscillator); oscillator.disconnect(); envelope.disconnect(); };
    }
    function hat(time, volume) {
      const sample = context.createBufferSource(), gain = context.createGain(), filter = context.createBiquadFilter();
      sample.buffer = noise; filter.type = 'highpass'; filter.frequency.value = 5000;
      gain.gain.value = volume;
      sample.connect(filter); filter.connect(gain); gain.connect(bus);
      sample.start(time); nodes.add(sample);
      sample.onended = () => { nodes.delete(sample); sample.disconnect(); filter.disconnect(); gain.disconnect(); };
    }
    let step = 0, next = context.currentTime + 0.07;
    const schedule = () => {
      // Resume cleanly after browser background throttling; don't play a backlog.
      if (next < context.currentTime - 0.4) {
        step += Math.floor((context.currentTime - next) / (60 / 108 / 2));
        next = context.currentTime + 0.04;
      }
      while (next < context.currentTime + 0.2) {
        const chord = chords[Math.floor(step / 16) % chords.length];
        if (step % 4 === 0) tone(145, next, 0.24, 0.52, 'sine', true);
        if (step % 2 === 0) tone(chord[Math.floor(step / 2) % 3] * 2, next, 0.37, 0.12, 'triangle');
        if (step % 8 === 0) tone(chord[0] / 2, next, 0.85, 0.18);
        hat(next, step % 2 ? 0.075 : 0.035);
        step++; next += 60 / 108 / 2;
      }
    };
    schedule();
    const interval = setInterval(schedule, 80);
    this.cleanup = () => {
      clearInterval(interval);
      for (const node of nodes) { try { node.stop(); } catch {} }
      nodes.clear();
    };
  }

  read() {
    if (!this.kind || !this.analyser) return null;
    this.analyser.getFloatTimeDomainData(this.wave);
    this.analyser.getFloatFrequencyData(this.frequencies);
    return { wave: this.wave, frequencies: this.frequencies, sampleRate: this.context.sampleRate };
  }

  stop() {
    this.cleanup?.(); this.cleanup = null;
    if (this.stream) for (const track of this.stream.getTracks()) { track.onended = null; track.stop(); }
    this.stream = null;
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
