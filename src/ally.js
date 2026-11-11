// Pure rules for Viriato's companions and for whom the Romans choose to fight.
import { REACH } from './ai.js';

/** Where companion i walks when not fighting: a loose line behind the player. fwd = player's flat forward. */
export function followSlot(i, p, fwd) {
  const side = [0, -1, 1][i % 3] * 1.9, back = 2.4 + (i % 3 === 0 ? .9 : 0) + Math.floor(i / 3) * 1.8;
  return { x: p.x - fwd.x * back - fwd.z * side, z: p.z - fwd.z * back + fwd.x * side };
}
/** Nearest living Roman within `range` who is already fighting (so companions never spoil an ambush). */
export function pickFoe(me, foes, range) {
  let best = null, bd = range;
  for (const e of foes) {
    if (e.dead || (e.state !== 'chase' && e.state !== 'skirmish')) continue;
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
