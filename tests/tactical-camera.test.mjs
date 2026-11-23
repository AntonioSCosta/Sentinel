import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCameraRig } from '../src/tactical/proto/camera-rig.js';

const base = { x: 80, y: 90, z: 100, yaw: Math.PI, pitch: -0.95, fov: 38 };
const terrain = (x, z) => 2 * Math.max(0, 1 - Math.hypot(x - 77, z - 45) / 6);
const makeRig = reducedMotion => createCameraRig({ heightAt: terrain, width: 160, depth: 110, reducedMotion });
const group = { id: 'column', side: 'romanos', x: 78, y: 45, facing: 0, men: 5, left: null };

test('immersive transition and steering keep the eye above the ground and pitch bounded', () => {
  const rig = makeRig(false);
  const groups = [{ ...group, id: 'scouts' }];
  assert.equal(rig.update(1 / 60, base, groups), null);
  rig.select('immersive', 'scouts');
  const first = rig.update(1 / 60, base, groups);
  assert.ok(first.y > 85, 'the first transition frame is close to the starting view');
  for (let i = 0; i < 180; i++) {
    rig.move(i < 50 ? 0 : 1, 0.5);
    rig.look(0.02, 0.2);
    const view = rig.update(1 / 60, base, groups);
    assert.ok(view.y >= terrain(view.x, view.z) + 1.1);
    assert.ok(view.pitch <= 0.52);
  }
  rig.select('strategic');
  assert.ok(rig.busy, 'canvas commands wait for the strategic projection');
  for (let i = 0; i < 40; i++) rig.update(1 / 60, base, groups);
  assert.equal(rig.busy, false);
  assert.equal(rig.update(1 / 60, base, groups), null);
});

test('a followed formation keeps a stable heading through angle wrap and falls back after exit', () => {
  const rig = makeRig(true);
  rig.update(0.016, base, [group]);
  rig.select('follow', group.id);
  const east = rig.update(0.016, base, [Object.freeze({ ...group, facing: Math.PI - 0.001 })]);
  assert.ok(east.y < 6, 'reduced motion skips the entry transition');
  const west = rig.update(0.016, base, [Object.freeze({ ...group, facing: -Math.PI + 0.001, x: group.x + 0.1 })]);
  assert.ok(Math.hypot(west.x - east.x, west.z - east.z) < 0.1);
  const retreat = Object.freeze({ ...group, x: 105, order: { type: 'retirar' } });
  let moved;
  for (let i = 0; i < 60; i++) moved = rig.update(1 / 60, base, [retreat]);
  assert.ok(moved.x > east.x + 10);
  assert.equal(rig.targetId, group.id);
  assert.equal(rig.update(0.016, base, [{ ...retreat, left: 'retirou' }]), null);
  assert.equal(rig.mode, 'strategic');
});
