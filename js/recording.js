export const MAX_TAKE_SECONDS = 180;
export function supportedRecordingType(Recorder = globalThis.MediaRecorder) {
  if (!Recorder?.isTypeSupported) return null;
  for (const type of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4']) {
    if (Recorder.isTypeSupported(type)) return type;
  }
  return null;
}

export class VideoRecorder {
  constructor({ onChange = () => {}, onError = () => {} } = {}) {
    this.onChange = onChange; this.onError = onError;
    this.recorder = null; this.result = null; this.stream = null;
    this.mimeType = supportedRecordingType();
  }
  get active() { return Boolean(this.recorder && this.recorder.state !== 'inactive'); }
  get busy() { return this.active || Boolean(this.stopping); }
  start(canvas, audio) {
    if (!this.mimeType || !canvas.captureStream) throw new Error('Video recording is unavailable in this browser. Try desktop Chrome.');
    if (this.busy) return;
    const audioTrack = audio.getAudioTracks().find(track => track.readyState === 'live');
    if (!audioTrack) throw new Error('No live audio track is available to record. Reconnect an audio source.');
    const video = canvas.captureStream(30);
    this.stream = new MediaStream([...video.getVideoTracks(), audioTrack.clone()]);
    try {
      this.recorder = new MediaRecorder(this.stream, {
        mimeType: this.mimeType, videoBitsPerSecond: 5500000, audioBitsPerSecond: 160000
      });
      this.chunks = []; this.started = performance.now();
      this.recorder.ondataavailable = event => { if (event.data.size) this.chunks.push(event.data); };
      this.recorder.onerror = event => {
        this.recordingError = event.error || new Error('Recording failed.');
        this.onError(this.recordingError);
        if (this.active) this.stop();
      };
      this.recorder.onstop = () => this.finish();
      this.recordingError = null;
      this.recorder.start(1000);
      this.limit = setTimeout(() => this.stop(), MAX_TAKE_SECONDS * 1000);
      this.onChange();
    } catch (error) {
      this.releaseTracks(); this.recorder = null;
      throw error;
    }
  }
  stop() {
    if (this.stopping) return this.stopping;
    if (!this.active) return Promise.resolve(this.result);
    this.stopping = new Promise(resolve => { this.resolveStop = resolve; });
    this.recorder.stop(); this.onChange();
    return this.stopping;
  }
  finish() {
    clearTimeout(this.limit);
    const seconds = (performance.now() - this.started) / 1000;
    const type = this.recorder.mimeType || this.mimeType;
    const blob = new Blob(this.chunks, { type });
    if (blob.size && !this.recordingError) {
      if (this.result) URL.revokeObjectURL(this.result.url);
      this.result = { blob, url: URL.createObjectURL(blob), type, seconds,
        extension: type.includes('mp4') ? 'mp4' : 'webm' };
    } else if (!this.recordingError) this.onError(new Error('The recording was empty. Play some sound and try again.'));
    this.chunks = []; this.releaseTracks();
    this.recorder = null;
    const resolve = this.resolveStop;
    this.resolveStop = null; this.stopping = null;
    resolve?.(this.result); this.onChange();
  }
  releaseTracks() { this.stream?.getTracks().forEach(track => track.stop()); this.stream = null; }
}
