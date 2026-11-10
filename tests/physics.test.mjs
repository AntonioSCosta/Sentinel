import test from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { createPhysics } from '../src/physics.js';

const flat = () => 0;
const deg = d => d * Math.PI / 180;
const throwJavelin = async (R) => {
  const phys = await createPhysics({ RAPIER: R, heightAt: flat, half: 200 });
  const v = 36, a = deg(10);
  const id = phys.addProjectile({ x: 0, y: 1.6, z: 0 }, { x: 0, y: v * Math.sin(a), z: -v * Math.cos(a) }, 'javelin');
  for (let t = 0; t < 6; t += 1 / 60) {
    const hits = phys.step(1 / 60);
    const h = hits.find(x => x.id === id);
    if (h) return { phys, h };
  }
  return { phys, h: null };
};

test('with Rapier: a javelin at 36 m/s, 10 degrees up, lands 35-60 m away and reports a ground hit', async () => {
  await RAPIER.init();
  const { phys, h } = await throwJavelin(RAPIER);
  assert.equal(phys.ok, true);
  assert.ok(h, 'ground hit reported'); assert.equal(h.type, 'ground');
  const dist = Math.hypot(h.pos.x, h.pos.z);
  assert.ok(dist > 35 && dist < 60, `landed at ${dist.toFixed(1)} m`);
});

test('without Rapier: same API, ok=false, the javelin still falls and lands', async () => {
  const { phys, h } = await throwJavelin(null);
  assert.equal(phys.ok, false);
  assert.ok(h, 'ground hit reported');
  const dist = Math.hypot(h.pos.x, h.pos.z);
  assert.ok(dist > 35 && dist < 60, `landed at ${dist.toFixed(1)} m`);
});

test('corpses fall over and come to rest on the ground', async () => {
  for (const R of [RAPIER, null]) {
    const phys = await createPhysics({ RAPIER: R, heightAt: flat, half: 200 });
    const id = phys.addCorpse({ x: 5, y: 0, z: 5 }, 0, { x: 0, y: 1, z: -3 });
    for (let i = 0; i < 240; i++) phys.step(1 / 60);
    const t = phys.getTransform(id);
    assert.ok(t.p.y < .6, `corpse resting low (${t.p.y.toFixed(2)})`);
    assert.ok(Math.abs(t.tilt) > 1.0, `corpse lying down (tilt ${t.tilt.toFixed(2)})`);
  }
});

test('bodies can be removed and counted (restart leaves nothing behind)', async () => {
  await RAPIER.init();
  for (const R of [RAPIER, null]) {
    const phys = await createPhysics({ RAPIER: R, heightAt: flat, half: 200 });
    const c = phys.addCorpse({ x: 0, y: 0, z: 0 }, 0, { x: 0, y: 1, z: 1 });
    const p = phys.addProjectile({ x: 0, y: 5, z: 0 }, { x: 0, y: 0, z: 1 }, 'stone');
    assert.deepEqual(phys.counts(), { projectiles: 1, corpses: 1 });
    phys.removeCorpse(c); phys.remove(p);
    assert.deepEqual(phys.counts(), { projectiles: 0, corpses: 0 });
  }
});

test('withTimeout rejects a promise that never settles', async () => {
  const { withTimeout } = await import('../src/physics.js');
  await assert.rejects(withTimeout(new Promise(() => {}), 50), /timeout/);
  assert.equal(await withTimeout(Promise.resolve(7), 50), 7);
});
