// One lock for both projection and recording. No polling or retry loop.
export class ScreenAwake {
  constructor(onChange = () => {}, navigator = globalThis.navigator, document = globalThis.document) {
    this.navigator = navigator; this.document = document; this.onChange = onChange;
    this.wanted = false; this.lock = null; this.pending = false;
    this.status = navigator?.wakeLock ? 'off' : 'unavailable';
    this.visibility = () => { if (document.visibilityState === 'visible') this.acquire(); };
    document?.addEventListener('visibilitychange', this.visibility);
  }
  setWanted(wanted) {
    this.wanted = wanted;
    if (wanted) this.acquire();
    else { this.lock?.release(); this.lock = null; this.status = this.navigator?.wakeLock ? 'off' : 'unavailable'; this.onChange(this.status); }
  }
  async acquire() {
    if (!this.wanted || this.lock || this.pending || !this.navigator?.wakeLock || this.document.visibilityState !== 'visible') return;
    this.pending = true;
    try {
      const lock = await this.navigator.wakeLock.request('screen');
      if (!this.wanted || this.document.visibilityState !== 'visible') { await lock.release(); return; }
      this.lock = lock; this.status = 'awake';
      lock.addEventListener('release', () => {
        if (this.lock !== lock) return;
        this.lock = null; this.status = this.wanted ? 'released' : 'off'; this.onChange(this.status);
      });
    } catch { this.status = 'unavailable'; }
    finally { this.pending = false; this.onChange(this.status); }
  }
  dispose() { this.setWanted(false); this.document?.removeEventListener('visibilitychange', this.visibility); }
}

export function shortcut(event) {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.target?.closest?.('input,select,textarea,button,a,[contenteditable="true"]')) return null;
  return ({ ' ': 'pauseDrawing', r: 'record', c: 'clearCanvas', f: 'fullscreen' })[event.key.toLowerCase()] || null;
}
