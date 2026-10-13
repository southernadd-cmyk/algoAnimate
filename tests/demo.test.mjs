import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoPlaylist, DEMO_TRACKS, DEMO_GENRES } from '../js/demo.js';
import { AudioInput } from '../js/audio.js';

class Player extends EventTarget {
  constructor() { super(); this.paused = true; this.src = ''; }
  load() {}
  async play() { this.paused = false; }
  pause() { this.paused = true; }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
}

test('demo advances on real ended events, wraps the playlist, and disconnect releases playback', async () => {
  const element = new Player(), titles = [];
  const playlist = new DemoPlaylist(element, { onTrack: track => titles.push(track.title) });
  await playlist.start();
  for (let i = 0; i < DEMO_TRACKS.length; i++) {
    element.dispatchEvent(new Event('ended'));
    await Promise.resolve();
  }
  assert.deepEqual(titles, [...DEMO_TRACKS.map(track => track.title), DEMO_TRACKS[0].title]);
  playlist.stop();
  assert.equal(element.paused, true);
  assert.equal(element.src, '');
  element.dispatchEvent(new Event('ended'));
  await Promise.resolve();
  assert.equal(titles.length, DEMO_TRACKS.length + 1, 'A disconnected demo cannot restart itself');
});

test('Next genre switches genre, starts its first track, wraps and retains one audio element', async () => {
  const element = new Player();
  const playlist = new DemoPlaylist(element);
  await playlist.start();
  assert.equal(playlist.genre.label, 'Lo-fi');
  for (let i = 1; i < DEMO_GENRES.length; i++) {
    await playlist.nextGenre();
    assert.equal(playlist.genre.label, DEMO_GENRES[i].label);
    assert.equal(playlist.index, 0);
    assert.equal(playlist.track.title, DEMO_GENRES[i].tracks[0].title);
  }
  await playlist.nextGenre();
  assert.equal(playlist.genre.label, 'Lo-fi');
  assert.equal(playlist.track.title, DEMO_TRACKS[0].title);
  await playlist.start(DEMO_GENRES[0].tracks.length - 1, 0);
  await playlist.next();
  assert.equal(playlist.genre.label, 'Drum & bass', 'Next track crosses into next genre at the end');
  playlist.stop();
});

test('disconnect while playback is loading ignores the obsolete play rejection', async () => {
  const element = new Player();
  let rejectPlay;
  element.play = () => new Promise((resolve, reject) => { rejectPlay = reject; });
  const titles = [], loading = [], playlist = new DemoPlaylist(element, {
    onTrack: track => titles.push(track.title), onLoading: value => loading.push(value)
  });
  const pending = playlist.start();
  assert.equal(playlist.loading, true);
  playlist.stop();
  rejectPlay(new Error('Playback intentionally aborted'));
  await pending;
  assert.equal(titles.length, 0);
  assert.equal(playlist.loading, false);
  assert.deepEqual(loading, [true, false]);
});

test('failed playback clears the loading state for retry', async () => {
  const element = new Player();
  element.play = async () => { throw new Error('Network failure'); };
  const playlist = new DemoPlaylist(element);
  await assert.rejects(playlist.start(), /Network failure/);
  assert.equal(playlist.loading, false);
  element.play = Player.prototype.play;
  await playlist.start();
  assert.equal(playlist.loading, false);
  assert.equal(element.paused, false);
});

test('demo reconnects reuse one media source, route to recording and speakers, and pause analysis immediately', async () => {
  const element = new Player(), audio = new AudioInput();
  let sources = 0;
  audio.context = { state: 'running', resume: async () => {}, destination: {},
    createMediaElementSource: () => { sources++; return { connections: [],
      connect(node) { this.connections.push(node); }, disconnect() {} }; } };
  audio.analyser = {}; audio.destination = { stream: {} };
  await audio.demo(element);
  assert.deepEqual(audio.source.connections, [audio.analyser, audio.destination, audio.context.destination]);
  assert.equal(audio.recordingStream, audio.destination.stream);
  assert.equal(audio.read(), null, 'A paused media demo has no analyser tail');
  audio.stop(); await audio.demo(element);
  assert.equal(sources, 1, 'Repeated demos do not create duplicate sources for the element');
  audio.stop();
});
