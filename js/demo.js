export const DEMO_TRACKS = Object.freeze([
  { title: 'Bubbles', file: 'bubbles.mp3', source: 'https://holiznacc0.bandcamp.com/track/bubbles' },
  { title: 'Calm Current', file: 'calm-current.mp3', source: 'https://holiznacc0.bandcamp.com/track/calm-current' },
  { title: 'Tokyo Sunset', file: 'tokyo-sunset.mp3', source: 'https://holiznacc0.bandcamp.com/track/tokyo-sunset' }
].map(track => Object.freeze({ ...track, artist: 'HoliznaCC0',
  url: new URL('../media/demo/' + track.file, import.meta.url).href })));

// Stream one track at a time through a single media element. Changing tracks
// keeps the same Web Audio source and recording stream, without decoded caches.
export class DemoPlaylist {
  constructor(element, { onTrack = () => {}, onError = () => {} } = {}) {
    this.element = element;
    this.onTrack = onTrack;
    this.onError = onError;
    this.index = 0;
    this.active = false;
    this.generation = 0;
    element.addEventListener('ended', () => {
      if (this.active) this.next().catch(onError);
    });
  }
  get track() { return DEMO_TRACKS[this.index]; }
  async start(index = this.index) {
    const request = ++this.generation;
    this.index = (index + DEMO_TRACKS.length) % DEMO_TRACKS.length;
    this.active = true;
    this.element.src = this.track.url;
    this.element.load();
    try {
      await this.element.play();
      if (this.active && request === this.generation) this.onTrack(this.track, this.index);
    } catch (error) {
      // Disconnecting or changing a source intentionally aborts pending playback.
      if (this.active && request === this.generation) throw error;
    }
  }
  async next() {
    if (this.active) await this.start(this.index + 1);
  }
  stop() {
    this.active = false;
    this.generation++;
    this.element.pause();
    this.element.removeAttribute('src');
    this.element.load();
  }
}
