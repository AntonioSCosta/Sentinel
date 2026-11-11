// Pure movement rules for soldiers: acceleration-limited steering and duel footwork.
import { REACH } from './ai.js';

/** Move velocity `v` toward `target` by at most accel·dt (both {x,z}). */
export function steer(v, target, accel, dt) {
  const dx = target.x - v.x, dz = target.z - v.z, d = Math.hypot(dx, dz), m = accel * dt;
  if (d <= m) return { x: target.x, z: target.z };
  return { x: v.x + dx / d * m, z: v.z + dz / d * m };
}

const DODGE_CHANCE = [0, .35, .5]; // backing off a visible player windup, by difficulty

/**
 * Desired local motion in m/s: forward (toward the player, negative = back off) and strafe (sideways).
 * ctx: {dist, sp, act, strafe ±1, difficulty, rng, self: fighter, player: fighter}
 */
export function footwork({ dist, sp, act, strafe, difficulty, rng, self, player }) {
  if (self.phase === 'windup') return { forward: dist > 1.1 ? 1.4 : 0, strafe: 0 };          // step into the blow
  if (self.phase === 'strike') return { forward: dist > 1.0 ? .8 : 0, strafe: 0 };
  if (self.phase === 'recovery') return { forward: dist < 1.8 ? -1.1 : 0, strafe: strafe * .4 }; // reset distance
  if (self.phase === 'staggered') return { forward: -.6, strafe: 0 };
  if (dist < 1.0) return { forward: -1.5, strafe: strafe * .5 };                                  // crowded
  if (player.phase === 'windup' && dist < 1.8 && rng() < DODGE_CHANCE[difficulty]) return { forward: -2.2, strafe: strafe * .8 };
  if (act === 'circle') return { forward: (dist - 3) * 1.5, strafe: strafe * 1.5 }; // wait your turn in a ring, not in a heap
  if (dist > REACH) {
    const arrive = Math.min(1, (dist - REACH) / 1.5);                                             // ease in near reach
    return { forward: Math.max(.6, sp * arrive), strafe: dist < 6 ? strafe * .5 : 0 };
  }
  return { forward: 0, strafe: strafe * .6 };
}

/**
 * Player top speed (m/s) for the move direction (fwd/side in −1..1, local) and fighter state,
 * Mount & Blade style: a fighting stride, slower backwards and sideways, sprint only forward and only when not fighting.
 */
export function playerSpeed({ fwd, side, sprint = false, crouch = false, f }) {
  const n = Math.hypot(fwd, side) || 1, back = Math.max(0, -fwd / n), lat = Math.abs(side / n);
  let s = 4.4 * (1 - .4 * back - .15 * lat);
  const fighting = f.phase === 'windup' || f.phase === 'strike' || f.phase === 'recovery' || f.phase === 'staggered' || f.blocking;
  if (crouch) s = 2.3;
  else if (sprint && !fighting && fwd > .3) s = 7.6;
  if (f.phase === 'windup') s *= .75;
  if (f.phase === 'strike') s *= .55;
  if (f.phase === 'recovery') s *= .7;
  if (f.phase === 'staggered') s *= .35;
  if (f.blocking) s *= .55;
  return s;
}
