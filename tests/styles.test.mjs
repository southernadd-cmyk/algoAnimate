import test from 'node:test';
import assert from 'node:assert/strict';
import { StyleDeck, PEN_PROFILES, INK_FAMILIES, styleSettings } from '../js/styles.js';
import { ENGINE_ROUTES, ensembleSettings } from '../js/ensemble.js';
import { AnimatedArtwork } from '../js/scenes.js';

function voices() { return Array.from({ length: 8 }, () => ({ art: {}, pendingStyle: null })); }
function prepare(deck, group) {
  for (const voice of group) voice.pendingStyle = deck.next(group);
  for (const voice of group) {
    voice.art.activeLayer = { scene: { style: voice.pendingStyle } }; voice.pendingStyle = null;
  }
}
function unique(group) {
  const kits = group.flatMap(voice => [voice.art.activeLayer?.scene.style, voice.art.queued?.style, voice.pendingStyle]).filter(Boolean);
  assert.equal(new Set(kits.map(style => style.pen.id)).size, kits.length);
  assert.equal(new Set(kits.map(style => style.palette.id)).size, kits.length);
}

test('all pen profiles have different real renderer settings and colour families are separated', () => {
  assert.equal(PEN_PROFILES.length, 16); assert.equal(INK_FAMILIES.length, 16);
  assert.equal(new Set(PEN_PROFILES.map(({ id, name, ...settings }) => JSON.stringify(settings))).size, 16);
  assert.equal(new Set(INK_FAMILIES.map(family => family.hue)).size, 16);
  assert.deepEqual([...new Set(PEN_PROFILES.map(pen => pen.renderer))].sort(),
    ['broad', 'dry', 'felt', 'fine', 'highlighter', 'paint', 'scribble']);
});

test('eight simultaneous next drawings reserve distinct kits, then release them at their own handoff', () => {
  const deck = new StyleDeck(41), group = voices(); prepare(deck, group); unique(group);
  for (let cycle = 0; cycle < 100; cycle++) {
    const old = group.map(voice => voice.art.activeLayer.scene.style);
    for (const voice of group) { voice.pendingStyle = deck.next(group); assert.ok(voice.pendingStyle); unique(group); }
    assert.equal(deck.next(group), null, 'Fully reserved deck waits rather than sharing a kit');
    for (const index of [4, 1, 7, 0, 6, 2, 5, 3]) {
      const voice = group[index]; voice.art.queued = { style: voice.pendingStyle }; voice.pendingStyle = null;
      unique(group);
    }
    for (const index of [3, 5, 2, 6, 0, 7, 1, 4]) {
      const voice = group[index], style = voice.art.queued.style;
      assert.notEqual(style.pen.id, old[index].pen.id); assert.notEqual(style.palette.id, old[index].palette.id);
      voice.art.activeLayer = { scene: { style } }; voice.art.queued = null; unique(group);
    }
  }
});

test('cancelling a silent route releases its future kit while preserving its current ink', () => {
  const deck = new StyleDeck(2), group = voices(); prepare(deck, group);
  for (const voice of group) voice.pendingStyle = deck.next(group);
  const held = group[0].art.activeLayer.scene.style;
  group[0].pendingStyle = null;
  assert.ok(deck.next(group)); assert.equal(group[0].art.activeLayer.scene.style, held);
});

test('different sessions randomise the kits without changing any sound seed or route', () => {
  function session(seed) {
    const deck = new StyleDeck(seed), group = voices(); prepare(deck, group);
    return group.map((voice, index) => ensembleSettings(ENGINE_ROUTES[index], 'SOUND-1234ABCD', 'landscape', 'marker', 45, voice.art.activeLayer.scene.style));
  }
  const first = session(77), same = session(77), other = session(78);
  assert.deepEqual(first, same); assert.notDeepEqual(first.map(s => s.style), other.map(s => s.style));
  assert.deepEqual(first.map(({ seed, mode }) => ({ seed, mode })), other.map(({ seed, mode }) => ({ seed, mode })));
});

test('colour mood keeps every layer identity, pen and sound settings and changes only its colour tones', () => {
  const deck = new StyleDeck(8), group = voices(); prepare(deck, group);
  const style = group[0].art.activeLayer.scene.style, muted = deck.withMood(style, 'soft'), bold = deck.withMood(style, 'bold');
  assert.deepEqual(muted.pen, style.pen); assert.equal(muted.palette.id, style.palette.id);
  assert.notDeepEqual(muted.colors, style.colors); assert.notDeepEqual(bold.colors, muted.colors);
  assert.equal(deck.withMood(style, style.mood), style);
  const settings = styleSettings(bold);
  assert.equal(settings.pen, bold.pen.renderer); assert.equal(settings.thickness, bold.pen.thickness);
  assert.deepEqual(settings.inkColors, bold.colors); assert.equal(settings.colourCount, 3);
});

test('the displayed kit follows painted ink until a queued scene actually starts', () => {
  globalThis.Path2D = class {};
  const deck = new StyleDeck(9), group = voices(); prepare(deck, group);
  const held = group[0].art.activeLayer.scene.style, next = deck.next(group);
  const art = new AnimatedArtwork({ width: 10, height: 10, getContext: () => ({}) });
  const scene = style => ({ width: 10, height: 10, seed: 'SOUND-SAME', style, paths: [], paperMarks: [] });
  art.setScene(scene(held), true); art.layers = [art.layer(art.current)];
  art.setScene(scene(next)); assert.equal(art.drawnStyle, held);
  art.beginCycle(art.queued); assert.equal(art.drawnStyle, next);
});
