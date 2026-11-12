// "O Acampamento" (147 BC), the chapter after the ambush: the camp that supplied the patrol.
// Pure data and numbers, no Three.js.

export const TENTS_TO_BURN = 3;
export const RELIEF_GUARD = 4;    // men who come out of the praetorium beside the centurion

/** Where Viriato and his band wait: in the scrub south of the gate, looking up at the palisade. */
export function campStart(CAMP) {
  const z = CAMP.z + CAMP.half + 22;
  return { x: CAMP.x - 9, z, yaw: Math.PI };   // yaw PI faces -z, up the valley towards the camp
}

/**
 * The garrison: two at the gate and two velites outside it, one velite in the lanes, and six
 * posted among the tents and the praetorium. Positions are relative to the camp's middle.
 */
export function campGarrison(CAMP) {
  const at = (kind, ox, oz) => ({ kind, x: CAMP.x + ox, z: CAMP.z + oz });
  return [
    at('legio', -3, CAMP.half + 2), at('legio', 3, CAMP.half + 2),          // the gate
    at('velite', -9, CAMP.half + 6), at('velite', 9, CAMP.half + 5),        // outside it
    at('velite', 0, -6),                                                    // the lanes
    at('legio', -10, 0), at('legio', 10, -2), at('legio', -3, -10),         // among the tents
    at('legio', 12, 14), at('legio', -12, 16), at('legio', 3, 14),          // the stores
  ];
}

/** Where the chapter stands: the stores burn first, and only then does the centurion come out. */
export function campPhase(tentsBurnt, centurionDead) {
  if (tentsBurnt < TENTS_TO_BURN) return 'tents';
  return centurionDead ? 'won' : 'centurion';
}

export const CAMP_MISSIONS = [
  { m: 'III · OS MANTIMENTOS', t: burnt => `Incendeia os mantimentos do acampamento (${burnt}/${TENTS_TO_BURN})` },
  { m: 'III · O CENTURIÃO', t: () => 'Derruba o centurião que saiu do pretório' },
];
