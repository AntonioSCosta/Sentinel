// Hand-authored combat moves, Mount & Blade: Warband style, as key poses layered on top of the base animation.
// Pure data + interpolation (no Three.js) so it can be unit-tested and tuned.
//
// A pose is a set of rotations, in degrees, about the CHARACTER's own axes, applied from the hips outward:
//   pitch = lean / swing forward (+) or back (−), yaw = turn to the character's left (+) or right (−),
//   roll  = tilt toward the character's left side (+) or right side (−).
// `spine` is shared out over spine_01..03; `pelvis` turns the hips (the thighs are counter-turned so the feet stay put).
//
// Each attack has three phases, driven by the fighter's combat state (combat.js), so the drawn blade and the damage
// window (swing.js, strike phase only) stay in step:
//   windup  : guard → `windup` pose, eased; held there (and slightly over-drawn) for as long as the button is held
//   strike  : `windup` → `mid` → `follow`, fast in the middle, the body unwinding into the cut
//   recovery: `follow` → guard
// Blocks blend guard → block pose in BLOCK_IN seconds and hold it.

export const BONES = ['pelvis', 'spine', 'neck', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r'];
export const GUARD = {};   // the base animation's own guard pose: no offsets

/** RIGHT-TO-LEFT CUT (combat.js dir 'right'): the blade comes from the attacker's right and crosses to his left. */
export const RIGHT_CUT = {
  windup: {   // weight back on the right foot, chest turned away, sword drawn back high behind the right shoulder
    pelvis: [0, -16, 0], spine: [-6, -38, -4], neck: [0, 22, 0],
    clavicle_r: [0, 0, 10], upperarm_r: [-30, -45, 55], lowerarm_r: [0, 0, 55], hand_r: [-20, 0, 25],
  },
  mid: {      // the hips have already turned, the chest is square, the arm sweeps level across the front at chest height
    pelvis: [4, 6, 0], spine: [8, 4, 0], neck: [0, -4, 0],
    clavicle_r: [0, 10, 0], upperarm_r: [-45, 15, 25], lowerarm_r: [-15, 0, 12], hand_r: [0, 0, 0],
  },
  follow: {   // carried through: chest turned to the left, weight on the front foot, arm across the body
    pelvis: [6, 18, 0], spine: [12, 40, 4], neck: [0, -24, 0],
    clavicle_r: [0, 18, -6], upperarm_r: [-35, 60, 5], lowerarm_r: [-10, 0, 18], hand_r: [10, 0, -15],
  },
};

/**
 * BLOCK AGAINST A CUT FROM THE ATTACKER'S RIGHT (it arrives on the defender's left): falcata raised on the left side,
 * blade up, hilt at chest height, chest turned slightly into the blow.
 */
export const BLOCK_VS_RIGHT = {
  // note on signs: a hanging arm swings FORWARD/UP with negative pitch and across to the LEFT with positive yaw
  pelvis: [0, 6, 0], spine: [2, 16, 2], neck: [0, -10, 0],
  clavicle_r: [0, 12, 0], upperarm_r: [-55, 38, 0], lowerarm_r: [-55, 10, 0], hand_r: [35, 0, 25],
};

export const MOVES = { right: RIGHT_CUT };
export const BLOCKS = { right: BLOCK_VS_RIGHT };   // keyed by the INCOMING attack direction
export const BLOCK_IN = .12;    // s to bring the guard up (kept inside the parry window, combat.js PARRY_WINDOW)
export const HOLD_OVERDRAW = .12; // extra draw (fraction of the windup pose) reached after holding a charged blow ~1 s

const ease = k => k * k * (3 - 2 * k);
const easeOut = k => 1 - (1 - k) * (1 - k);
const clamp01 = k => Math.max(0, Math.min(1, k));

/** Linear blend of two poses (missing bones count as zero). */
export function mixPose(a, b, k) {
  const out = {};
  for (const n of BONES) {
    const pa = a[n] || [0, 0, 0], pb = b[n] || [0, 0, 0];
    if (!a[n] && !b[n]) continue;
    out[n] = [0, 1, 2].map(i => pa[i] + (pb[i] - pa[i]) * k);
  }
  return out;
}
const scalePose = (a, s) => mixPose(GUARD, a, s);

/**
 * The pose offset for a fighter state.
 * @param dir     attack direction ('right' is authored; others return null and keep the clip animation)
 * @param phase   'windup' | 'strike' | 'recovery'
 * @param t       seconds into the phase
 * @param T       timings { windup, strike, recovery } in seconds for this fighter
 */
export function attackPose(dir, phase, t, T) {
  const m = MOVES[dir]; if (!m) return null;
  if (phase === 'windup') {
    const k = clamp01(t / T.windup);
    const over = 1 + HOLD_OVERDRAW * clamp01((t - T.windup) / 1);   // holding the blow draws it back a little further
    return scalePose(m.windup, ease(k) * over);
  }
  if (phase === 'strike') {
    const k = easeOut(clamp01(t / T.strike));                         // fastest at the start of the cut, like a released spring
    return k < .5 ? mixPose(m.windup, m.mid, ease(k / .5)) : mixPose(m.mid, m.follow, ease((k - .5) / .5));
  }
  if (phase === 'recovery') return mixPose(m.follow, GUARD, ease(clamp01(t / T.recovery)));
  return null;
}

/** Block pose for the incoming direction, raised over BLOCK_IN. */
export function blockPose(incoming, blockT) {
  const b = BLOCKS[incoming]; if (!b) return null;
  return scalePose(b, easeOut(clamp01(blockT / BLOCK_IN)));
}
