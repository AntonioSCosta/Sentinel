// Hand-authored combat moves, Mount & Blade: Warband style, layered on top of the base animation.
// Pure data + interpolation (no Three.js) so it can be unit-tested and tuned.
//
// A move has two parts:
//  · BODY — rotations in degrees about the CHARACTER's own axes, applied from the hips outward:
//      pitch = lean forward (+) or back (−), yaw = turn to the character's left (+) or right (−), roll = tilt left (+).
//      `spine` is shared out over spine_01..03; `pelvis` turns the hips (the thighs are counter-turned so the feet stay put).
//  · ARM — where the sword HAND is and where the BLADE points, in the character's own frame (metres; x = his right,
//      y = up, z = forward; origin at the feet — the same frame as the damage sweep in swing.js). The rig solves the
//      shoulder and elbow for it (rig.js), so the arm cannot be wrenched into an impossible twist, and the same move
//      looks the same whatever the fighter was doing before. `pole` is the way the elbow points, `w` how much of the
//      arm is taken over (0 = the base animation, 1 = this move).
//
// Each attack has three phases, driven by the fighter's combat state (combat.js):
//   windup  : guard → READY (sword drawn back), eased; held there for as long as the button is held
//   strike  : READY → onto the damage arc: from then on the drawn hand and blade ARE the sweep that deals damage
//   recovery: end of the arc → guard
// Blocks bring the sword to a guard position in BLOCK_IN seconds and hold it.
import { bladeSegment, bladeDir } from './swing.js';

export const BONES = ['pelvis', 'spine', 'neck'];
export const GUARD = {};   // the base animation's own guard pose: no offsets

/** Body through each attack: drawn back → the middle of the blow → carried through. */
export const MOVES = {
  right: {   // right-to-left cut: weight back, chest turned away; the hips lead the turn, the chest follows across
    windup: { pelvis: [0, -16, 0], spine: [-6, -38, -4], neck: [0, 22, 0] },
    mid: { pelvis: [4, 6, 0], spine: [8, 4, 0], neck: [0, -4, 0] },
    follow: { pelvis: [6, 18, 0], spine: [12, 40, 4], neck: [0, -24, 0] },
  },
  left: {    // left-to-right backhand: chest wound to the left, unwinding to the right
    windup: { pelvis: [0, 14, 0], spine: [-4, 34, 4], neck: [0, -24, 0] },
    mid: { pelvis: [4, -6, 0], spine: [8, -4, 0], neck: [0, 2, 0] },
    follow: { pelvis: [6, -12, 0], spine: [10, -24, -4], neck: [0, 16, 0] },   // not turned so far that the sword arm cannot follow the blade round
  },
  up: {      // overhead: chest open and upright while drawn, then bent into the blow and a little to the left
    windup: { pelvis: [0, -10, 0], spine: [-7, -8, 0], neck: [5, 6, 0] },
    mid: { pelvis: [5, 0, 0], spine: [8, 8, 0], neck: [-4, -4, 0] },
    follow: { pelvis: [8, 8, 0], spine: [14, 20, 0], neck: [-10, -12, 0] },
  },
  thrust: {  // thrust: right shoulder drawn back, then driven forward behind the point
    windup: { pelvis: [0, -14, 0], spine: [0, -22, 0], neck: [0, 18, 0] },
    mid: { pelvis: [3, 0, 0], spine: [6, 2, 0], neck: [0, -2, 0] },
    follow: { pelvis: [7, 12, 0], spine: [11, 22, 0], neck: [-4, -18, 0] },
  },
};
/** Sword arm drawn back, ready to strike. */
export const READY = {
  up: { hand: [.34, 1.8, -.04], blade: [-.1, .6, -.8], pole: [1, -.1, .3] },          // hand over the head, blade tipped back, elbow out
  right: { hand: [.5, 1.5, -.1], blade: [.45, .45, -.77], pole: [.6, -.8, -.4] },      // sword back over the right shoulder
  left: { hand: [-.1, 1.48, .24], blade: [-.75, .35, -.55], pole: [.2, -1, .2] },      // carried across to the left shoulder
  thrust: { hand: [.3, 1.18, -.05], blade: [-.1, -.03, 1], pole: [.5, -.3, -1] },      // hilt back at the hip, point at the foe
};
const DOWN_OUT = [.6, -1, -.1];   // where the elbow points through a blow: down and a little out

/** Sword blocks, keyed by the INCOMING attack's direction (the attacker's 'right' arrives on the defender's left). */
export const BLOCKS = {
  right: { pelvis: [0, 6, 0], spine: [2, 16, 2], neck: [0, -10, 0], arm: { hand: [-.04, 1.34, .38], blade: [-.22, .94, .26], pole: [.5, -1, 0] } },
  left: { pelvis: [0, -6, 0], spine: [2, -14, -2], neck: [0, 10, 0], arm: { hand: [.38, 1.32, .32], blade: [-.14, .95, .28], pole: [.6, -1, -.2] } },
  up: { pelvis: [0, 0, 0], spine: [-4, 6, 0], neck: [6, 0, 0], arm: { hand: [.34, 1.8, .2], blade: [-.97, .16, .18], pole: [1, -.3, 0] } },   // blade flat above the head
  thrust: { pelvis: [0, -4, 0], spine: [2, -8, 0], neck: [0, 6, 0], arm: { hand: [.26, 1.2, .36], blade: [-.55, .62, .56], pole: [.6, -1, -.2] } },   // point beaten aside across the body
};
export const BLOCK_IN = .12;      // s to bring the guard up (kept inside the parry window, combat.js PARRY_WINDOW)
export const HOLD_OVERDRAW = .12; // extra wind (fraction of the windup body pose) reached after holding a charged blow ~1 s
export const JOIN = .4;           // fraction of the strike over which the arm leaves READY and joins the damage arc

const ease = k => k * k * (3 - 2 * k);
const easeOut = k => 1 - (1 - k) * (1 - k);
const clamp01 = k => Math.max(0, Math.min(1, k));
const xyz = o => [o.x, o.y, o.z];
const lerp3 = (a, b, k) => [0, 1, 2].map(i => a[i] + (b[i] - a[i]) * k);
const unit = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/** Linear blend of two body poses (missing bones count as zero). */
export function mixPose(a, b, k) {
  const out = {};
  for (const n of BONES) { const pa = a[n] || [0, 0, 0], pb = b[n] || [0, 0, 0]; out[n] = lerp3(pa, pb, k); }
  return out;
}
const scalePose = (a, s) => mixPose(GUARD, a, s);
/** The way the cutting edge is travelling at progress p of the sweep (thrust: edge down). */
function travel(dir, p) {
  if (dir === 'thrust') return [0, -1, 0];
  const a = bladeDir(dir, Math.max(0, p - .02)), b = bladeDir(dir, Math.min(1, p + .02));
  return unit([b.x - a.x, b.y - a.y, b.z - a.z]);
}
/** Hand and blade on the damage arc at progress p, blended in from READY over the first JOIN of the strike. */
function armAt(dir, p) {
  const r = READY[dir], seg = bladeSegment(dir, p), k = ease(clamp01(p / JOIN));
  if (k >= 1) return { hand: xyz(seg.hand), blade: xyz(bladeDir(dir, p)), edge: travel(dir, p), pole: DOWN_OUT, w: 1 };
  return { hand: lerp3(r.hand, xyz(seg.hand), k), blade: unit(lerp3(r.blade, xyz(bladeDir(dir, p)), k)), edge: travel(dir, p), pole: lerp3(r.pole, DOWN_OUT, k), w: 1 };
}

/**
 * The pose for a fighter in an attack.
 * @param dir     'up' | 'left' | 'right' | 'thrust'
 * @param phase   'windup' | 'strike' | 'recovery'
 * @param t       seconds into the phase
 * @param T       timings { windup, strike, recovery } in seconds for this fighter
 * @returns { pelvis, spine, neck, arm: { hand, blade, edge, pole, w } } or null for an unknown direction
 */
export function attackPose(dir, phase, t, T) {
  const m = MOVES[dir]; if (!m) return null;
  if (phase === 'windup') {
    const k = ease(clamp01(t / T.windup)), over = 1 + HOLD_OVERDRAW * clamp01((t - T.windup) / 1);   // holding the blow winds the body a little further
    return { ...scalePose(m.windup, k * over), arm: { ...READY[dir], blade: unit(READY[dir].blade), edge: travel(dir, 0), w: k } };
  }
  if (phase === 'strike') {
    const p = clamp01(t / T.strike), q = ease(p);   // the same easing as the blade (swing.js), so body and blade stay together
    return { ...(q < .5 ? mixPose(m.windup, m.mid, q / .5) : mixPose(m.mid, m.follow, (q - .5) / .5)), arm: armAt(dir, p) };
  }
  if (phase === 'recovery') { const k = ease(clamp01(t / T.recovery)); return { ...mixPose(m.follow, GUARD, k), arm: { ...armAt(dir, 1), w: 1 - k } }; }
  return null;
}

/** Sword block against the incoming direction, raised over BLOCK_IN. */
export function blockPose(incoming, blockT) {
  const b = BLOCKS[incoming]; if (!b) return null;
  const k = easeOut(clamp01(blockT / BLOCK_IN));
  return { ...scalePose(b, k), arm: { ...b.arm, blade: unit(b.arm.blade), edge: [0, 0, 1], w: k } };
}
