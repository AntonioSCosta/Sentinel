// Pure hit-zone rules.
export const ZONE_MULT = { head: 2, torso: 1, legs: .7 };
export const LEG_SLOW = { factor: .6, time: 3 };
/** hRel = impact height ÷ body height (0 = feet, 1 = top of head). */
export function zoneFromHeight(hRel) { return hRel >= .85 ? 'head' : hRel >= .45 ? 'torso' : 'legs'; }
