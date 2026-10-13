// Every new demo is CC0, with its source and licensing recorded in media/demo/README.md.
// Store each genre separately so Next track and Next genre remain distinct operations.
const entries = [
  { id: 'lofi', label: 'Lo-fi', tracks: [
    { title: 'Bubbles', file: 'bubbles.mp3', artist: 'HoliznaCC0', source: 'https://holiznacc0.bandcamp.com/track/bubbles' },
    { title: 'Calm Current', file: 'calm-current.mp3', artist: 'HoliznaCC0', source: 'https://holiznacc0.bandcamp.com/track/calm-current' },
    { title: 'Tokyo Sunset', file: 'tokyo-sunset.mp3', artist: 'HoliznaCC0', source: 'https://holiznacc0.bandcamp.com/track/tokyo-sunset' }
  ] },
  { id: 'dnb', label: 'Drum & bass', tracks: [
    { title: 'Final Hour', file: 'dnb-final-hour.mp3', artist: 'isaiah658', source: 'https://opengameart.org/content/final-hour',
      download: 'https://opengameart.org/sites/default/files/Final-Hour-isaiah658_0.mp3' },
    { title: 'Black Diamond', file: 'dnb-black-diamond.mp3', artist: 'Joth', source: 'https://opengameart.org/content/black-diamond',
      download: 'https://opengameart.org/sites/default/files/Black%20Diamond.mp3' }
  ] },
  { id: 'jazz', label: 'Jazz', tracks: [
    { title: 'Public Domain Jazz', file: 'jazz-public-domain.mp3', artist: 'Alex McCulloch', source: 'https://opengameart.org/content/public-domain-jazz',
      download: 'https://opengameart.org/sites/default/files/jazz_alex_mcculloch_0.mp3' },
    { title: '8-bit Bossa Nova', file: 'jazz-8bit-bossa.mp3', artist: 'Joth', source: 'https://opengameart.org/content/bossa-nova',
      download: 'https://opengameart.org/sites/default/files/8bit%20Bossa.mp3' }
  ] },
  { id: 'classical', label: 'Classical', tracks: [
    { title: 'Aftermath', file: 'classical-aftermath.mp3', artist: 'Indieteur', source: 'https://opengameart.org/content/aftermath',
      download: 'https://opengameart.org/sites/default/files/Aftermath_0.mp3' },
    { title: 'Classical Pop (Instrumental)', file: 'classical-pop.mp3', artist: 'Alex McCulloch', source: 'https://opengameart.org/content/classical-pop-instrumental',
      download: 'https://opengameart.org/sites/default/files/ClassicalPop%20%28Instrumental%29_0.mp3' }
  ] },
  { id: 'synthwave', label: 'Synthwave', tracks: [
    { title: 'Synthwave Type', file: 'synthwave-type.mp3', artist: 'G_P', source: 'https://opengameart.org/content/synthwavetype',
      download: 'https://opengameart.org/sites/default/files/synth_type_1.mp3' },
    { title: 'Electronic Synth', file: 'synthwave-electronic.mp3', artist: 'Alex McCulloch', source: 'https://opengameart.org/content/electronic-synth',
      download: 'https://opengameart.org/sites/default/files/synth_1.mp3' }
  ] }
];
export const DEMO_GENRES = Object.freeze(entries.map(genre => Object.freeze({
  ...genre, tracks: Object.freeze(genre.tracks.map(track => Object.freeze({
    ...track, url: new URL('../media/demo/' + track.file, import.meta.url).href
  })))
})));
export const DEMO_TRACKS = Object.freeze(DEMO_GENRES.flatMap(genre => genre.tracks));

// A single media element/Web Audio source keeps recording continuous across
// track and genre changes. Each request invalidates older in-flight play().
export class DemoPlaylist {
  constructor(element, { onTrack = () => {}, onLoading = () => {}, onError = () => {} } = {}) {
    this.element = element;
    this.onTrack = onTrack;
    this.onLoading = onLoading;
    this.onError = onError;
    this.genreIndex = 0;
    this.index = 0;
    this.active = false;
    this.loading = false;
    this.generation = 0;
    element.addEventListener('ended', () => {
      if (this.active) this.next().catch(onError);
    });
  }
  get genre() { return DEMO_GENRES[this.genreIndex]; }
  get track() { return this.genre.tracks[this.index]; }
  setLoading(loading) {
    this.loading = loading;
    this.onLoading(loading);
  }
  async start(index = this.index, genreIndex = this.genreIndex) {
    const request = ++this.generation;
    this.genreIndex = (genreIndex + DEMO_GENRES.length) % DEMO_GENRES.length;
    this.index = (index + this.genre.tracks.length) % this.genre.tracks.length;
    this.active = true;
    this.setLoading(true);
    try {
      this.element.src = this.track.url;
      this.element.load();
      await this.element.play();
      if (this.active && request === this.generation) this.onTrack(this.track, this.index, this.genre);
    } catch (error) {
      if (this.active && request === this.generation) throw error;
    } finally {
      if (this.active && request === this.generation) this.setLoading(false);
    }
  }
  async next() {
    if (!this.active) return;
    const last = this.index === this.genre.tracks.length - 1;
    await this.start(last ? 0 : this.index + 1, last ? this.genreIndex + 1 : this.genreIndex);
  }
  async nextGenre() {
    if (this.active) await this.start(0, this.genreIndex + 1);
  }
  stop() {
    this.active = false;
    this.generation++;
    this.setLoading(false);
    this.element.pause();
    this.element.removeAttribute('src');
    this.element.load();
  }
}
