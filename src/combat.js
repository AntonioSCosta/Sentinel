// Pure melee combat rules shared by the player and the Roman soldiers.
// No Three.js here: everything is plain numbers so it can be unit-tested.

export const DIRS = ['up', 'left', 'right', 'thrust'];
export const WINDUP = { up: .5, left: .35, right: .35, thrust: .4 };   // minimum telegraph before a strike lands (s)
export const STRIKE_TIME = { up: .3, left: .26, right: .26, thrust: .22 }; // blade travelling its arc (s)
export const RECOVERY = { up: .45, left: .32, right: .32, thrust: .38 }; // lock-out after the arc (s)
export const FLINCH = .3;            // hit while attacking → blow lost, short stagger
export const DMG = { up: 1.3, left: 1, right: 1, thrust: .8 };         // damage multiplier per direction
export const FULL_CHARGE = 1.2;       // s of holding for full power (a tap = .6, full = 1.6)
export const PARRY_WINDOW = .15;      // sword block started this recently → perfect parry
export const PARRY_COOLDOWN = .45;    // a guard re-raised sooner than this after the last one gets no parry (anti-mashing)
export const SHIELD_ARC = 75;         // degrees each side covered by the caetra / scutum
export const PASSIVE_ARC = 45;        // degrees each side an idle shield-bearer covers without raising it
export const PASSIVE_COST = 1.3;      // passive guard is this much dearer in stamina than a raised shield
export const SWORD_ARC = 60;          // degrees each side covered by a sword block
export const ATTACK_COST = 5.5;      // stamina per swing
export const MIN_ATTACK_STAMINA = 8;
export const SHIELD_COST = 7;         // stamina per blocked blow at full power
export const SWORD_BLOCK_COST = 10;
export const JAVELIN_SHIELD_PENALTY = .15; // extra shield cost per stuck javelin
export const MAX_STUCK = 3;
export const STAMINA_REGEN = 40;      // per s while idle or blocking-free
export const SHIELD_WEAR = 8;          // shield points lost per blocked blow at power 1 (x direction multiplier)
export const OVERHOLD = 1.5;          // holding a charge longer than this drains stamina

export function dirFromMouse(dx, dy) {
  if (Math.hypot(dx, dy) < 4) return 'thrust';
  if (Math.abs(dy) > Math.abs(dx)) return dy < 0 ? 'up' : 'thrust';
  return dx < 0 ? 'left' : 'right';
}

export function createFighter(opts = {}) {
  return { stamina: 100, shieldHP: 100, stuckJavelins: 0, phase: 'idle', dir: null, t: 0, released: false, power: .5,
    blocking: null, blockT: 0, sinceBlock: 99, parryOk: true, ...opts };
}

/**
 * Does the shield a fighter carries stop a missile? Raised, it covers him head to knee over a wide arc.
 * Merely carried by a man on his guard, it still covers his body from the front — not his head, and not while he
 * is striking, reeling, or taken by surprise.
 */
export function missileBlocked(f, { fromAngle, head = false, aware = true }) {
  if (!(f.shieldHP > 0)) return false;
  const ang = Math.abs(fromAngle);
  if (f.blocking === 'shield') return ang <= SHIELD_ARC;
  if (!aware || f.phase === 'strike' || f.phase === 'staggered') return false;
  return !head && ang <= PASSIVE_ARC + 10;
}
/** What a fighter raises to guard: the shield while it holds, his own sword once it is broken or lost. */
export const guardFor = f => f.shieldHP > 0 ? 'shield' : 'sword';

export const chargePower = t => .6 + Math.min(1, t / FULL_CHARGE);

export function beginAttack(f, dir) {
  if (f.phase !== 'idle' || f.blocking || f.stamina < MIN_ATTACK_STAMINA) return false;
  f.phase = 'windup'; f.dir = dir; f.t = 0; f.released = false;
  f.stamina = Math.max(0, f.stamina - ATTACK_COST);
  return true;
}

export function releaseAttack(f) {
  if (f.phase !== 'windup' || f.released) return null;
  f.released = true; f.power = chargePower(f.t);
  return { dir: f.dir, power: f.power };
}

export function feint(f) {
  if (f.phase !== 'windup') return false;
  f.phase = 'idle'; f.dir = null; f.t = 0; f.released = false;
  return true;
}

/** The blade met a guard or a wall: the swing ends early. */
export function stopBlade(f) { if (f.phase === 'strike') { f.phase = 'recovery'; f.t = RECOVERY[f.dir] + .1; } }

export function stagger(f, time) {
  f.phase = 'staggered'; f.t = time; f.released = false; f.blocking = null;
}

export function beginBlock(f, kind) {
  if (f.phase === 'windup') feint(f);
  if (f.phase === 'recovery') { f.phase = 'idle'; f.t = 0; f.released = false; }   // the follow-through can be cut short to get the shield up
  if (f.phase !== 'idle') return false;
  if (kind === 'shield' && f.shieldHP <= 0) return false;
  f.blocking = kind; f.blockT = 0; f.parryOk = f.sinceBlock >= PARRY_COOLDOWN;
  return true;
}

export function endBlock(f) { if (f.blocking) f.sinceBlock = 0; f.blocking = null; f.blockT = 0; }

/** Advance timers; returns events: {type:'strike',dir,power} and {type:'recovered'}. */
export function tickFighter(f, dt) {
  const ev = [];
  if (f.blocking) f.blockT += dt; else f.sinceBlock += dt;
  if (f.phase === 'windup') {
    f.t += dt;
    if (!f.released && f.t > OVERHOLD) f.stamina = Math.max(0, f.stamina - 10 * dt);
    if (f.released && f.t >= WINDUP[f.dir] * (f.tele || 1)) {   // tele > 1: a slower, readable wind-up
      ev.push({ type: 'strike', dir: f.dir, power: f.power });
      f.phase = 'strike'; f.t = 0;
    }
  } else if (f.phase === 'strike') {
    const T = STRIKE_TIME[f.dir], p0 = Math.min(1, f.t / T);
    f.t += dt; const p1 = Math.min(1, f.t / T);
    ev.push({ type: 'swing', dir: f.dir, power: f.power, p0, p1 });
    if (p1 >= 1) { f.phase = 'recovery'; f.t = RECOVERY[f.dir]; }
  } else if (f.phase === 'recovery' || f.phase === 'staggered') {
    f.t -= dt;
    if (f.t <= 0) { f.phase = 'idle'; f.t = 0; f.dir = null; ev.push({ type: 'recovered' }); }
  } else if (f.phase === 'idle' && !f.blocking) {
    f.stamina = Math.min(100, f.stamina + STAMINA_REGEN * dt);
  }
  return ev;
}

/**
 * Resolve a blow (or javelin) landing on `def`.
 * fromAngle: degrees between the defender's facing and the direction the blow comes from (0 = straight ahead).
 */
export function resolveHit(def, { dir, power, fromAngle, baseDamage, kind = 'melee' }) {
  const raw = baseDamage * (DMG[dir] ?? 1) * power;
  const ang = Math.abs(fromAngle);
  const out = { result: 'hit', damage: raw, staminaCost: 0, attackerStagger: 0 };
  const interrupt = () => { if (def.phase === 'windup' || def.phase === 'strike') stagger(def, FLINCH); else if (def.phase === 'idle') stagger(def, FLINCH * .8); };   // every clean hit makes the man reel

  if (def.blocking === 'sword' && ang <= SWORD_ARC && kind === 'melee') {
    if (def.blockT <= PARRY_WINDOW && def.parryOk) return { result: 'parried', damage: 0, staminaCost: 0, attackerStagger: .8 };
    const cost = SWORD_BLOCK_COST * power;
    if (def.stamina < cost) { def.stamina = 0; endBlock(def); stagger(def, .6); return { result: 'guardBroken', damage: raw * .5, staminaCost: cost, attackerStagger: 0 }; }
    def.stamina -= cost;
    return { result: 'blocked', damage: 0, staminaCost: cost, attackerStagger: 0 };
  }
  if (def.blocking === 'shield' && ang <= SHIELD_ARC) {
    if (kind === 'javelin') {
      def.stuckJavelins = Math.min(MAX_STUCK, def.stuckJavelins + 1);
      def.shieldHP = Math.max(0, def.shieldHP - 8);
      return { result: 'blocked', damage: 0, staminaCost: 0, attackerStagger: 0, stuck: true };
    }
    const cost = SHIELD_COST * power * (1 + def.stuckJavelins * JAVELIN_SHIELD_PENALTY);
    if (def.stamina < cost) { def.stamina = 0; endBlock(def); stagger(def, .7); return { result: 'guardBroken', damage: raw * .5, staminaCost: cost, attackerStagger: 0 }; }
    def.stamina -= cost;
    def.shieldHP = Math.max(0, def.shieldHP - SHIELD_WEAR * (DMG[dir] ?? 1) * power);
    if (def.shieldHP <= 0) endBlock(def);
    return { result: 'blocked', damage: 0, staminaCost: cost, attackerStagger: 0 };
  }
  if (def.passiveShield && !def.blocking && def.phase === 'idle' && def.shieldHP > 0 && ang <= PASSIVE_ARC && kind === 'melee') {
    const cost = SHIELD_COST * PASSIVE_COST * power;
    if (def.stamina >= cost) {
      def.stamina -= cost; def.shieldHP = Math.max(0, def.shieldHP - SHIELD_WEAR * .8 * (DMG[dir] ?? 1) * power);
      return { result: 'blocked', damage: 0, staminaCost: cost, attackerStagger: 0 };
    }
  }
  interrupt();
  return out;
}

// Mouse intent: a short memory of recent mouse motion, so a sweep made just before the click
// (as in Mount & Blade) picks the blow's direction. Half-life ≈ .1 s.
export const INTENT_HALFLIFE = .1;
export const REAIM_TIME = .18;         // a held windup can still change direction this early
export const createIntent = () => ({ x: 0, y: 0 });
export function nudgeIntent(m, dx, dy) { m.x += dx; m.y += dy; return m; }
export function decayIntent(m, dt) { const k = Math.pow(.5, dt / INTENT_HALFLIFE); m.x *= k; m.y *= k; return m; }
/** Change a held (unreleased) windup's direction early in the windup. */
export function reaim(f, dir) {
  if (f.phase !== 'windup' || f.released || f.t > REAIM_TIME || !dir) return false;
  f.dir = dir; return true;
}
/** For click-to-attack: a random direction, different from the previous blow. */
export function randomDir(prev, rng = Math.random) {
  const opts = DIRS.filter(d => d !== prev);
  return opts[Math.floor(rng() * opts.length) % opts.length];
}
