// Pure blade-arc geometry shared by the player and the soldiers.
// Local frame of the attacker: x = attacker's right, y = up, z = forward; origin at the feet.
// Hits are found by sweeping the blade through space, so distance and timing matter.

export const SHOULDER = { x: .2, y: 1.45, z: 0 };
export const ARM = .55;
export const BLADE = .7;
const ease = p => p * p * (3 - 2 * p);
const norm = v => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const add = (a, v, s) => ({ x: a.x + v.x * s, y: a.y + v.y * s, z: a.z + v.z * s });

/** Unit direction of the blade (from the shoulder) at swing progress p ∈ [0,1]. */
export function bladeDir(dir, p) {
  const q = ease(Math.min(1, Math.max(0, p)));
  if (dir === 'up') { const a = 1.9 + (-.55 - 1.9) * q; return norm({ x: -.15, y: Math.sin(a), z: Math.cos(a) }); }
  if (dir === 'left') { const b = -1.75 + (1.2 + 1.75) * q; return norm({ x: Math.sin(b), y: -.15, z: Math.cos(b) }); }
  if (dir === 'right') { const b = 1.75 + (-1.2 - 1.75) * q; return norm({ x: Math.sin(b), y: -.15, z: Math.cos(b) }); }
  return norm({ x: -.12, y: -.08, z: 1 }); // thrust
}

/** Hand and blade tip (local) at progress p. */
export function bladeSegment(dir, p) {
  const v = bladeDir(dir, p);
  if (dir === 'thrust') {
    const reach = .15 + .4 * ease(Math.min(1, Math.max(0, p)));
    const hand = add(SHOULDER, v, reach);
    return { hand, tip: add(hand, v, BLADE) };
  }
  const hand = add(SHOULDER, v, ARM);
  return { hand, tip: add(hand, v, BLADE) };
}

/** Damage factor by where on the arc the blade connects: glancing at the ends, full mid-swing. */
export const glance = p => .4 + .6 * Math.sin(Math.PI * Math.min(1, Math.max(0, p)));

/** Local → world for someone at `pos` facing (sin yaw, 0, cos yaw). */
export function toWorld(l, pos, yaw) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -fz, rz = fx;
  return { x: pos.x + rx * l.x + fx * l.z, y: pos.y + l.y, z: pos.z + rz * l.x + fz * l.z };
}

/** Standing body as a vertical capsule. */
export const capsuleOf = (feet, r = .3, h = 1.75) => ({ a: { x: feet.x, y: feet.y + .2, z: feet.z }, b: { x: feet.x, y: feet.y + h, z: feet.z }, r });

function distPointSeg(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / (abx * abx + aby * aby + abz * abz || 1)));
  return Math.hypot(a.x + abx * t - p.x, a.y + aby * t - p.y, a.z + abz * t - p.z);
}

/**
 * Sweep the blade from progress p0 to p1 and test it against a capsule.
 * @returns {hit:boolean, p?:number, at?:{x,y,z}} — p is where on the arc contact happened
 */
export function sweepHit(pos, yaw, dir, p0, p1, cap, steps = 8) {
  const n = Math.max(1, Math.ceil(steps * Math.abs(p1 - p0) + 1));
  for (let i = 0; i <= n; i++) {
    const p = p0 + (p1 - p0) * i / n, seg = bladeSegment(dir, p);
    for (const f of [.35, .6, .8, 1]) {
      const l = { x: seg.hand.x + (seg.tip.x - seg.hand.x) * f, y: seg.hand.y + (seg.tip.y - seg.hand.y) * f, z: seg.hand.z + (seg.tip.z - seg.hand.z) * f };
      const w = toWorld(l, pos, yaw);
      if (distPointSeg(w, cap.a, cap.b) < cap.r + .05) return { hit: true, p, at: w };
    }
  }
  return { hit: false };
}
