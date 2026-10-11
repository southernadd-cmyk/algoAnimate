export class FrameClock {
  constructor(draw, environment = globalThis) {
    this.draw = draw; this.environment = environment; this.recording = false;
    this.started = false; this.timer = null; this.worker = null;
    try {
      if (environment.Worker) {
        this.worker = new environment.Worker(new URL('./frame-worker.js', import.meta.url));
        this.worker.onmessage = () => { if (this.recording) this.tick(); };
        this.worker.onerror = () => {
          this.worker?.terminate(); this.worker = null;
          if (this.recording) this.startTimer();
        };
      }
    } catch { this.worker = null; }
  }
  tick() { this.draw(this.environment.performance.now()); }
  startTimer() {
    if (this.timer === null) this.timer = this.environment.setInterval(() => this.tick(), 1000 / 30);
  }
  start() {
    if (this.started) return;
    this.started = true;
    const animate = now => {
      if (!this.started) return;
      this.animation = this.environment.requestAnimationFrame(animate);
      if (!this.recording) this.draw(now);
    };
    this.animation = this.environment.requestAnimationFrame(animate);
  }
  setRecording(active) {
    if (this.recording === active) return;
    this.recording = active;
    if (this.worker) this.worker.postMessage(active ? 'start' : 'stop');
    else if (active) this.startTimer();
    if (!active) { this.environment.clearInterval(this.timer); this.timer = null; }
  }
  stop() {
    this.setRecording(false); this.started = false;
    this.environment.cancelAnimationFrame(this.animation);
    this.worker?.terminate(); this.worker = null;
  }
  get mode() { return !this.recording ? 'animation' : this.worker ? 'worker' : 'timer'; }
}
