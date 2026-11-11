// Pure duel decisions for Roman soldiers, evaluated each AI tick.
import { DIRS } from './combat.js';

export const REACH = 1.75;  // start a blow from here; the attacker steps in during the windup
const BLOCK_CHANCE = [.25, .6, .85];   // chance to read and block a visible player windup, by difficulty
const FEINT_CHANCE = .15;             // Hard only

/**
 * @param enemy {kind, fighter}
 * @param ctx {dist, playerFighter, difficulty 0|1|2, attackersNow, rng, engaged (one of the 2–3 nearest)}
 * @returns 'approach'|'circle'|'attack:<dir>'|'block'|'feint'|'backoff'|'idle'
 */
export function decide(enemy, { dist, playerFighter, difficulty, attackersNow, rng, engaged = true }) {
  const f = enemy.fighter;
  if (f.phase !== 'idle') return 'idle';
  if (!engaged && dist < 6) return 'circle'; // not your turn: hold the ring, don't heap onto the player
  if (dist >= REACH) return 'approach';
  const pick = () => 'attack:' + DIRS[Math.min(DIRS.length - 1, Math.floor(rng() * DIRS.length))];
  if (playerFighter.phase === 'windup' && rng() < BLOCK_CHANCE[difficulty]) return 'block';
  const limit = difficulty === 2 ? 2 : 1;   // one at a time, as in a Warband melee; two on hard
  if (attackersNow >= limit) return 'circle';
  if (playerFighter.phase === 'staggered') return pick();
  if (difficulty === 2 && rng() < FEINT_CHANCE) return 'feint';
  return pick();
}
