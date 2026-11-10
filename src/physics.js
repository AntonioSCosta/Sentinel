// Physics wrapper: Rapier (WASM) when available, otherwise a simple analytic fallback with the same API.
// Projectiles report ground hits; corpses topple and settle. Hits on people stay in game logic.

const GRAV = { javelin: 11, stone: 9.8 };

/** Reject if `promise` has not settled within `ms` (used for the Rapier CDN import). */
export function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout after ' + ms + ' ms')), ms))]);
}

/**
 * @param RAPIER initialised @dimforge/rapier3d-compat module, or null for the fallback
 * @param heightAt (x, z) → terrain height
 * @param half half-size of the playable square (m)
 */
export async function createPhysics({ RAPIER, heightAt, half = 200, seg = 100 }) {
  return RAPIER ? rapierPhysics(RAPIER, heightAt, half, seg) : simplePhysics(heightAt);
}

function simplePhysics(heightAt) {
  let next = 1;
  const proj = new Map(), corpses = new Map();
  return {
    ok: false,
    counts: () => ({ projectiles: proj.size, corpses: corpses.size }),
    addProjectile(pos, vel, kind) { const id = next++; proj.set(id, { p: { ...pos }, v: { ...vel }, g: GRAV[kind] || 9.8 }); return id; },
    remove(id) { proj.delete(id); },
    getPos(id) { const o = proj.get(id); return o && o.p; },
    getVel(id) { const o = proj.get(id); return o && o.v; },
    addCorpse(pos, yaw, impulse) { const id = next++; corpses.set(id, { p: { x: pos.x, y: pos.y, z: pos.z }, base: pos.y, yaw, t: 0, dir: Math.atan2(impulse.x, impulse.z) }); return id; },
    getTransform(id) { const c = corpses.get(id); return { p: c.p, tilt: Math.PI / 2 * Math.min(1, c.t / .7), dir: c.dir }; },
    removeCorpse(id) { corpses.delete(id); },
    step(dt) {
      const hits = [];
      for (const [id, o] of proj) {
        o.v.y -= o.g * dt;
        o.p.x += o.v.x * dt; o.p.y += o.v.y * dt; o.p.z += o.v.z * dt;
        const gh = heightAt(o.p.x, o.p.z);
        if (o.p.y <= gh) { o.p.y = gh; hits.push({ id, type: 'ground', pos: { ...o.p }, vel: { ...o.v } }); proj.delete(id); }
      }
      for (const c of corpses.values()) { c.t += dt; c.p.y = c.base + .25 * Math.min(1, c.t / .7); }
      return hits;
    },
  };
}

function rapierPhysics(R, heightAt, half, seg) {
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  const queue = new R.EventQueue(true);
  // terrain as a triangle mesh (coarser than the render mesh)
  const n = seg + 1, step = half * 2 / seg, verts = new Float32Array(n * n * 3), idx = new Uint32Array(seg * seg * 6);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -half + i * step, z = -half + j * step, k = (j * n + i) * 3;
    verts[k] = x; verts[k + 1] = heightAt(x, z); verts[k + 2] = z;
  }
  let t = 0;
  for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx.set([a, c, b, b, c, d], t); t += 6;
  }
  const ground = world.createCollider(R.ColliderDesc.trimesh(verts, idx).setFriction(1));
  const groundHandle = ground.handle;

  let next = 1;
  const proj = new Map(), byCollider = new Map(), corpses = new Map();
  const v3 = o => ({ x: o.x, y: o.y, z: o.z });
  return {
    ok: true,
    counts: () => ({ projectiles: proj.size, corpses: corpses.size }),
    addProjectile(pos, vel, kind) {
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setLinvel(vel.x, vel.y, vel.z)
        .setCcdEnabled(true).setGravityScale((GRAV[kind] || 9.81) / 9.81));
      const col = world.createCollider(R.ColliderDesc.ball(.05).setActiveEvents(R.ActiveEvents.COLLISION_EVENTS).setSensor(false).setDensity(kind === 'javelin' ? 40 : 60), body);
      const id = next++; proj.set(id, { body, col }); byCollider.set(col.handle, id); return id;
    },
    remove(id) { const o = proj.get(id); if (!o) return; byCollider.delete(o.col.handle); world.removeRigidBody(o.body); proj.delete(id); },
    getPos(id) { const o = proj.get(id); return o && v3(o.body.translation()); },
    getVel(id) { const o = proj.get(id); return o && v3(o.body.linvel()); },
    addCorpse(pos, yaw, impulse) {
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y + .9, pos.z)
        .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }).setAngularDamping(1.5).setLinearDamping(.4));
      world.createCollider(R.ColliderDesc.capsule(.55, .28).setFriction(1.2).setDensity(1000), body);
      body.applyImpulseAtPoint({ x: impulse.x * 60, y: impulse.y * 20, z: impulse.z * 60 }, { x: pos.x, y: pos.y + 1.6, z: pos.z }, true);
      const id = next++; corpses.set(id, body); return id;
    },
    getTransform(id) {
      const b = corpses.get(id), q = b.rotation(), p = b.translation();
      const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
      return { p: v3(p), q: { x: q.x, y: q.y, z: q.z, w: q.w }, tilt: Math.acos(Math.max(-1, Math.min(1, upY))) };
    },
    removeCorpse(id) { const b = corpses.get(id); if (b) { world.removeRigidBody(b); corpses.delete(id); } },
    step(dt) {
      world.timestep = dt;
      world.step(queue);
      const hits = [];
      queue.drainCollisionEvents((h1, h2, started) => {
        if (!started) return;
        const other = h1 === groundHandle ? h2 : h2 === groundHandle ? h1 : null;
        if (other == null || !byCollider.has(other)) return;
        const id = byCollider.get(other), o = proj.get(id);
        hits.push({ id, type: 'ground', pos: v3(o.body.translation()), vel: v3(o.body.linvel()) });
      });
      for (const h of hits) this.remove(h.id);
      return hits;
    },
  };
}
