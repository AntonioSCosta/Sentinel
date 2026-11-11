// Javelins: who carries how many, how a held throw gains strength, and when the AI throws.

export const JAVELINS = { lusitano: 3, velite: 10 };
export const THROW_FULL = 1;   // s of holding the button for the strongest throw

/** Throw strength for a button held `t` s: speed (m/s) and damage multiplier, capped at THROW_FULL. */
export function throwPower(t) {
  const k = Math.min(1, Math.max(0, t) / THROW_FULL);
  return { k, speed: 22 + 18 * k, dmg: .7 + .6 * k };
}

/** Does a companion throw a javelin now? Only at javelin range — closer than 6 m he draws the falcata. */
export function allyThrows({ dist, jav, phase, cd, sees }) {
  return jav > 0 && phase === 'idle' && cd <= 0 && sees && dist >= 6 && dist <= 26;
}

/** A velite harasses from range while he has javelins, then closes in with the sword. */
export const veliteState = jav => jav > 0 ? 'skirmish' : 'chase';
