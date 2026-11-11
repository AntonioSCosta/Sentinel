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

/**
 * OVERHEAD (combat.js dir 'up'). Proportions from the Warband one-handed overswing, studied as reference only:
 * drawn = hips turned right over the back foot, chest square, sword lifted over the right shoulder and laid back
 * behind the head; the cut bends the trunk ~40° forward while the chest turns ~35° left of the hips, the hand
 * dropping from above the head to the front of the waist.
 */
export const OVERHEAD = {
  windup: {   // elbow high beside the head, blade hanging back behind the right shoulder, chest open
    pelvis: [0, -12, 0], spine: [-8, -6, 0], neck: [6, 6, 0],
    clavicle_r: [0, 0, 20], upperarm_r: [-150, -10, 20], lowerarm_r: [0, 0, 80], hand_r: [-35, 0, 0],
  },
  mid: {      // arm thrown forward at head height, nearly straight: the blade is coming over the top
    pelvis: [5, 0, 0], spine: [8, 8, 0], neck: [-4, -4, 0],
    clavicle_r: [0, 6, 8], upperarm_r: [-165, 32, 6], lowerarm_r: [16, 38, 3], hand_r: [45, 68, 26],
  },
  follow: {   // cut carried down to hip height in front, arm long, shoulders following it down and a little left
    pelvis: [8, 8, 0], spine: [14, 20, 0], neck: [-10, -12, 0],
    clavicle_r: [0, 10, 0], upperarm_r: [-74, 44, 4], lowerarm_r: [14, 2, -32], hand_r: [102, -17, 30],
  },
};

/**
 * LEFT-TO-RIGHT CUT (combat.js dir 'left'): a backhand. The sword is carried across the body to the left shoulder,
 * chest turned left; the hips lead the turn back to the right and the arm opens out flat across the front.
 */
export const LEFT_CUT = {
  windup: {
    pelvis: [0, 14, 0], spine: [-4, 34, 4], neck: [0, -24, 0],
    clavicle_r: [0, 20, 0], upperarm_r: [-107, 90, 0], lowerarm_r: [-122, 34, 15], hand_r: [81, -43, -60],
  },
  mid: {
    pelvis: [4, -6, 0], spine: [8, -4, 0], neck: [0, 2, 0],
    clavicle_r: [0, 4, 0], upperarm_r: [-130, 10, 0], lowerarm_r: [33, 35, -23], hand_r: [75, 68, 0],
  },
  follow: {
    pelvis: [6, -22, 0], spine: [10, -44, -4], neck: [0, 28, 0],
    clavicle_r: [0, -16, 6], upperarm_r: [-98, -46, 60], lowerarm_r: [35, 50, 7], hand_r: [8, 81, -38],
  },
};
/** BLOCK AGAINST A CUT FROM THE ATTACKER'S LEFT (it arrives on the defender's right): blade upright on the right side. */
export const BLOCK_VS_LEFT = {
  pelvis: [0, -6, 0], spine: [2, -14, -2], neck: [0, 10, 0],
  clavicle_r: [0, -6, 0], upperarm_r: [-91, -35, 0], lowerarm_r: [17, 23, 16], hand_r: [30, 28, 25],
};

/** BLOCK AGAINST AN OVERHEAD: sword held flat above the head, hilt over the right shoulder, point to the left. */
export const BLOCK_VS_UP = {
  pelvis: [0, 0, 0], spine: [-4, 8, 0], neck: [6, 0, 0],
  clavicle_r: [0, 6, 14], upperarm_r: [-120, 45, 0], lowerarm_r: [-40, 20, 0], hand_r: [0, -130, 0],
};

export const MOVES = { right: RIGHT_CUT, up: OVERHEAD, left: LEFT_CUT };
export const BLOCKS = { right: BLOCK_VS_RIGHT, up: BLOCK_VS_UP, left: BLOCK_VS_LEFT };   // keyed by the INCOMING attack direction
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
