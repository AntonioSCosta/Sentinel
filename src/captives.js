// "Os Cativos" (149 BC): rules and layout of the Roman halt where the survivors of Galba's massacre are held.
// Pure data and numbers, no Three.js.

export const CUT_TIME = 1.6;          // s to cut a group's ropes (E, staying beside the stake)
export const REINFORCE_AFTER = 70;    // s from the alarm until the rider comes back with more men
export const RELIEF = 6;              // how many legionaries he brings
export const FREE_TO_LEAVE = 3;       // captives that must be free before Viriato may slip away

/** Men pick up the arms of the dead and fight; women, children and the old run for the woods. */
export const isFighter = kind => kind === 'man';
/** How far a death is heard: a man cut down unawares drops almost without a sound. */
export const alertRadius = silent => silent ? 6 : 22;
export const canLeave = freed => freed >= FREE_TO_LEAVE;
/** Men Viriato takes into the next mission: those who took up arms, never fewer than two nor more than six. */
export const companionsFrom = fighters => Math.max(2, Math.min(6, fighters));

/**
 * The halt, laid out round `c` (a clearing ~15 m across): three stakes with four captives roped to each, two guards
 * per group (one close, one walking a wider beat), the tents and the fire in the middle with a sentinel.
 */
export function haltLayout(c) {
  const at = (dx, dz) => ({ x: c.x + dx, z: c.z + dz });
  const kinds = [['man', 'man', 'woman', 'child'], ['man', 'woman', 'man', 'elder'], ['man', 'woman', 'child', 'man']];
  const stakes = [[-11, -5], [10, -8], [1, 12]];
  const groups = stakes.map(([sx, sz], i) => {
    const out = Math.atan2(sx, sz);   // the way that points away from the middle of the halt
    return { i, ...at(sx, sz),
      captives: kinds[i].map((kind, k) => { const a = k / 4 * Math.PI * 2 + .6; return { kind, ...at(sx + Math.sin(a) * 1.1, sz + Math.cos(a) * 1.1), yaw: a }; }),
      guards: [{ ...at(sx - Math.sin(out) * 3.6, sz - Math.cos(out) * 3.6), yaw: out + Math.PI }, { ...at(sx + Math.sin(out + 1.3) * 6.5, sz + Math.cos(out + 1.3) * 6.5), yaw: out }] };
  });
  return { groups, tents: [{ ...at(-3.2, -1.5), ry: .5 }, { ...at(2.8, -2.2), ry: -.4 }, { ...at(.2, 3.2), ry: 2.6 }], fire: at(0, -.2), sentinel: [{ ...at(1.6, .6), yaw: 2 }] };
}
