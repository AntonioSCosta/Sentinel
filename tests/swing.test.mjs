import test from 'node:test';
import assert from 'node:assert/strict';
import { bladeSegment, glance, toWorld, sweepHit, capsuleOf } from '../src/swing.js';

test('cuts sweep from the side they are named after; overhead comes down in front; thrust extends', () => {
  assert.ok(bladeSegment('left', 0).tip.x < 0 && bladeSegment('left', 1).tip.x > 0);
  assert.ok(bladeSegment('right', 0).tip.x > 0 && bladeSegment('right', 1).tip.x < 0);
  const u0 = bladeSegment('up', 0).tip, u1 = bladeSegment('up', 1).tip;
  assert.ok(u0.y > 2, 'starts above the head'); assert.ok(u1.z > .5 && u1.y < 1.6, 'ends low in front');
  assert.ok(bladeSegment('thrust', 1).tip.z > bladeSegment('thrust', 0).tip.z + .3);
});

test('glancing blows: weak at the ends of the arc, full in the middle', () => {
  assert.equal(glance(0), .4); assert.equal(glance(1).toFixed(3), '0.400'); assert.equal(glance(.5), 1);
});

test('local right of someone facing +z is world -x', () => {
  const w = toWorld({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0);
  assert.ok(Math.abs(w.x + 1) < 1e-9 && Math.abs(w.z) < 1e-9);
  const f = toWorld({ x: 0, y: 0, z: 1 }, { x: 5, y: 0, z: 5 }, Math.PI / 2);
  assert.ok(Math.abs(f.x - 6) < 1e-9, 'facing yaw=90° looks along +x');
});

test('a full cut hits a body in reach, misses one out of reach or behind', () => {
  const at = { x: 0, y: 0, z: 0 };
  for (const dir of ['left', 'right', 'up', 'thrust']) {
    assert.ok(sweepHit(at, 0, dir, 0, 1, capsuleOf({ x: 0, y: 0, z: 1.3 })).hit, dir + ' in reach');
    assert.ok(!sweepHit(at, 0, dir, 0, 1, capsuleOf({ x: 0, y: 0, z: 3.2 })).hit, dir + ' out of reach');
    assert.ok(!sweepHit(at, 0, dir, 0, 1, capsuleOf({ x: 0, y: 0, z: -1.3 })).hit, dir + ' behind');
  }
});

test('the contact point reports where on the arc the blade met the body', () => {
  const r = sweepHit({ x: 0, y: 0, z: 0 }, 0, 'left', 0, 1, capsuleOf({ x: 0, y: 0, z: 1.3 }));
  assert.ok(r.p > .3 && r.p < .7, `left cut meets a body straight ahead mid-arc (p=${r.p.toFixed(2)})`);
});
