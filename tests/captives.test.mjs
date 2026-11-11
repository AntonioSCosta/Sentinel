import test from 'node:test';
import assert from 'node:assert/strict';
import { haltLayout, isFighter, companionsFrom, canLeave, alertRadius, REINFORCE_AFTER, CUT_TIME } from '../src/captives.js';

test('the halt holds three groups of four captives, two guards each, and a sentinel by the tents', () => {
  const L = haltLayout({ x: 10, z: -20 });
  assert.equal(L.groups.length, 3);
  for (const g of L.groups) { assert.equal(g.captives.length, 4); assert.equal(g.guards.length, 2); }
  assert.equal(L.groups.flatMap(g => g.captives).filter(c => c.kind === 'man').length, 6);
  assert.equal(L.sentinel.length, 1); assert.equal(L.tents.length, 3);
});
test('groups stand far enough apart that a silent kill at one is not heard at the next', () => {
  const L = haltLayout({ x: 0, z: 0 });
  for (const a of L.groups) for (const b of L.groups) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > alertRadius(true) * 1.8);
  for (const g of L.groups) for (const c of g.captives) assert.ok(Math.hypot(c.x - g.x, c.z - g.z) < 2, 'captives sit round their stake');
});
test('only the grown men take up arms; the others run for the woods', () => {
  assert.equal(isFighter('man'), true);
  for (const k of ['woman', 'child', 'elder']) assert.equal(isFighter(k), false);
});
test('a man cut down unawares is heard only close by; a fight is heard across the halt', () => {
  assert.ok(alertRadius(true) <= 6);
  assert.equal(alertRadius(false), 22);
});
test('Viriato may leave once three captives are free, and takes two to six men into the ambush', () => {
  assert.equal(canLeave(2), false); assert.equal(canLeave(3), true);
  assert.equal(companionsFrom(0), 2); assert.equal(companionsFrom(4), 4); assert.equal(companionsFrom(9), 6);
});
test('reinforcements take over a minute; the ropes take a moment to cut', () => {
  assert.ok(REINFORCE_AFTER >= 60); assert.ok(CUT_TIME >= 1 && CUT_TIME <= 3);
});
