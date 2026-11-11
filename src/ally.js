// Pure rules for Viriato's companions and for whom the Romans choose to fight.
import { REACH } from './ai.js';

/** Where companion i walks when not fighting: a loose line behind the player. fwd = player's flat forward. */
export function followSlot(i, p, fwd) {
  const side = [0, -1, 1][i % 3] * 1.9, back = 2.4 + (i % 3 === 0 ? .9 : 0) + Math.floor(i / 3) * 1.8;
  return { x: p.x - fwd.x * back - fwd.z * side, z: p.z - fwd.z * back + fwd.x * side };
}
/** Nearest living Roman within `range` who is already fighting (so companions never spoil an ambush). */
export function pickFoe(me, foes, range, anyState = false) {
  let best = null, bd = range;
  for (const e of foes) {
    if (e.dead || (!anyState && e.state !== 'chase' && e.state !== 'skirmish')) continue;
    const d = Math.hypot(e.pos.x - me.x, e.pos.z - me.z);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
/** Whom a Roman at `pos` fights: a companion only if clearly nearer than the player. → { ally|null, pos, dist } */
export function pickTarget(pos, player, allies) {
  let ally = null, bd = Math.hypot(player.pos.x - pos.x, player.pos.z - pos.z), tp = player.pos; const pd = bd;
  for (const a of allies) {
    if (a.dead) continue;
    const d = Math.hypot(a.pos.x - pos.x, a.pos.z - pos.z);
    if (d < bd && d < pd * .8) { bd = d; ally = a; tp = a.pos; }
  }
  return { ally, pos: tp, dist: bd };
}
/** What a companion does this decision tick. */
export function allyAct({ dist, foePhase, rng }) {
  if (dist > REACH + .2) return 'approach';
  if (foePhase === 'windup' && rng() < .55) return 'block';
  return rng() < .7 ? 'attack' : 'wait';
}

/** Where companion i stands when ordered to a flag: a short line across the direction `yaw` they were sent in. */
export function holdSlot(i, flag, yaw) {
  const side = [0, -1, 1][i % 3] * 1.8 + Math.floor(i / 3) * .9, back = Math.floor(i / 3) * 1.8;
  return { x: flag.x + Math.cos(yaw) * side - Math.sin(yaw) * back, z: flag.z - Math.sin(yaw) * side - Math.cos(yaw) * back };
}
/** March a ray from `o` along unit `d` until it goes under the terrain. → {x, y, z} or null (sky / too far). */
export function aimGround(o, d, heightAt, max = 90) {
  let pt = 0;
  for (let t = .5; t <= max; t += .5) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t, h = heightAt(x, z);
    if (y <= h) { const m = (pt + t) / 2, mx = o.x + d.x * m, mz = o.z + d.z * m; return { x: mx, y: heightAt(mx, mz), z: mz }; }
    pt = t;
  }
  return null;
}
/** How companion i looks: height, tunic, hair, hair colour, whether he wears the crested cap. */
export function allyLook(i) {
  return [
    { scale: 1.05, outfit: 'lusitano_c', hair: ['hair_long', 'hair_beard'], hairColor: 0x1c1410, cap: false },
    { scale: .94, outfit: 'lusitano_b', hair: ['hair_buzzed', 'hair_beard'], hairColor: 0x5a3d24, cap: true },
    { scale: .99, outfit: 'lusitano_d', hair: ['hair_long'], hairColor: 0x6b4a2a, cap: false },
    { scale: 1.02, outfit: 'lusitano', hair: ['hair_buzzed'], hairColor: 0x2a1d14, cap: true },
  ][i % 4];
}
