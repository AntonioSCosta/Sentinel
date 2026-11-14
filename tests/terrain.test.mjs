import test from 'node:test';
import assert from 'node:assert/strict';
import { addCol, clearColliders, solidAt } from '../src/terrain.js';

test('solidAt finds static obstacles (trees, palisade) for blades bouncing off', () => {
  clearColliders(); addCol(10, 10, .4);
  assert.equal(solidAt(10.2, 10), true);
  assert.equal(solidAt(11, 10), false);
  addCol(20, 20, 1, .5); // a low rock
  assert.equal(solidAt(20, 20, .3), true, 'blade low enough hits the rock');
  assert.equal(solidAt(20, 20, 1.2), false, 'blade passes over a low rock');
  clearColliders();
});

test('a collider can be switched off and on (scenery that exists in one mission only)', async () => {
  const T = await import('../src/terrain.js');
  const c = T.addCol(151.5, 151.5, 1.2), p = { x: 151.9, z: 151.5 };
  assert.ok(c && T.solidAt(151.9, 151.5));
  c.off = true; T.resolve(p, .4);
  assert.equal(T.solidAt(151.9, 151.5), false); assert.ok(Math.abs(p.x - 151.9) < 1e-9, 'not pushed while off');
  c.off = false; T.resolve(p, .4); assert.ok(Math.hypot(p.x - 151.5, p.z - 151.5) >= 1.59);
});

test('mountain stream (Ribeira) path is smooth, continuous and carves stream bed', async () => {
  const { streamX, inStream, rawH } = await import('../src/terrain.js');
  assert.ok(typeof streamX(0) === 'number');
  assert.equal(inStream(streamX(50), 50), true);
  assert.equal(inStream(streamX(50) + 15, 50), false);
  const hStream = rawH(streamX(20), 20);
  const hBank = rawH(streamX(20) + 8, 20);
  assert.ok(hBank >= hStream, 'stream bed is carved lower or equal to immediate banks');
});
