import test from 'node:test';
import assert from 'node:assert/strict';
import { DRAW_DIST, SHADOW_DIST, cullChunks } from '../src/chunks.js';

const chunk = (x, z, r = 25) => ({ visible: true, castShadow: true, __c: { x, z, r } });

test('chunks beyond the mist are not drawn and not shadow casters', () => {
  const near = chunk(0, 0), mid = chunk(0, 90), far = chunk(0, 400);
  cullChunks([near, mid, far], { x: 0, z: 0 });
  assert.deepEqual([near.visible, near.castShadow], [true, true]);
  assert.deepEqual([mid.visible, mid.castShadow], [true, false], 'desenhado ao longe, mas sem sombra');
  assert.equal(far.visible, false);
});

test('a chunk is kept while any part of it is inside the range', () => {
  const edge = chunk(0, DRAW_DIST + 20, 25);
  cullChunks([edge], { x: 0, z: 0 });
  assert.equal(edge.visible, true, 'o raio do bloco conta');
  const out = chunk(0, DRAW_DIST + 60, 25);
  cullChunks([out], { x: 0, z: 0 });
  assert.equal(out.visible, false);
});

test('SHADOW_DIST fits inside the sun shadow camera, and inside DRAW_DIST', () => {
  assert.ok(SHADOW_DIST <= 46 * Math.SQRT2 && SHADOW_DIST < DRAW_DIST);
});

import { bigEnoughForShadow, CHAR_SHADOW_DIST, cullCharacters } from '../src/chunks.js';

test('tiny character parts never cast a shadow: they cost a draw call and show nothing', () => {
  for (const n of ['Eyes', 'Eyebrows', 'face-mouth', 'feathers', 'cheek', 'crest']) assert.equal(bigEnoughForShadow(n), false, n);
  for (const n of ['SuperHero_Male', 'tunic', 'skirt', 'gladius', 'caetra', 'hair_long']) assert.equal(bigEnoughForShadow(n), true, n);
});

test('characters stop casting shadows once they are far from the camera', () => {
  const far = { pos: { x: 0, z: 120 }, m: { cast: [{ castShadow: true }] } };
  const near = { pos: { x: 0, z: 5 }, m: { cast: [{ castShadow: false }] } };
  cullCharacters([far, near], { x: 0, z: 0 });
  assert.equal(far.m.cast[0].castShadow, false);
  assert.equal(near.m.cast[0].castShadow, true);
  assert.ok(CHAR_SHADOW_DIST < SHADOW_DIST);
});
