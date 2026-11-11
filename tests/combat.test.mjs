import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/combat.js';

const tickUntilIdle = (f, max = 5) => { for (let t = 0; t < max && f.phase !== 'idle'; t += .05) C.tickFighter(f, .05); };

test('dirFromMouse maps mouse motion to the four attack directions', () => {
  assert.equal(C.dirFromMouse(0, -20), 'up');
  assert.equal(C.dirFromMouse(-20, 2), 'left');
  assert.equal(C.dirFromMouse(20, 2), 'right');
  assert.equal(C.dirFromMouse(1, 1), 'thrust');
});

test('charge power grows from .5 to 1 over .8 s and caps', () => {
  for (const [hold, p] of [[0, .5], [.8, 1], [2, 1]]) {
    const f = C.createFighter();
    C.beginAttack(f, 'up');
    C.tickFighter(f, hold);
    assert.equal(C.releaseAttack(f).power, p);
  }
});

test('after the windup the blade travels its arc (swing events up to p=1), then recovers', () => {
  const f = C.createFighter();
  C.beginAttack(f, 'left'); C.releaseAttack(f);
  const ev = [];
  for (let i = 0; i < 60; i++) ev.push(...C.tickFighter(f, 1 / 60));
  assert.deepEqual(ev.filter(e => e.type === 'strike').map(e => e.dir), ['left']);
  const sw = ev.filter(e => e.type === 'swing');
  assert.ok(sw.length >= Math.floor(C.STRIKE_TIME.left * 60) - 1, 'one swing event per tick of the arc');
  assert.equal(sw[0].p0, 0); assert.equal(sw.at(-1).p1, 1);
  assert.ok(sw.every((e, i) => i === 0 || e.p0 === sw[i - 1].p1), 'contiguous arc');
  assert.ok(ev.some(e => e.type === 'recovered')); assert.equal(f.phase, 'idle');
});

test('being hit mid-swing interrupts the blow (flinch)', () => {
  const f = C.createFighter(); C.beginAttack(f, 'up'); C.releaseAttack(f);
  for (let i = 0; i < 32; i++) C.tickFighter(f, 1 / 60);
  assert.equal(f.phase, 'strike');
  C.resolveHit(f, { dir: 'left', power: 1, fromAngle: 0, baseDamage: 20 });
  assert.equal(f.phase, 'staggered');
});

test('stopBlade: a blocked blow ends the swing and goes to recovery', () => {
  const f = C.createFighter(); C.beginAttack(f, 'right'); C.releaseAttack(f);
  for (let i = 0; i < 24; i++) C.tickFighter(f, 1 / 60);
  assert.equal(f.phase, 'strike'); C.stopBlade(f);
  assert.equal(f.phase, 'recovery');
  assert.ok(!C.tickFighter(f, 1 / 60).some(e => e.type === 'swing'));
});

test('sword block started .1 s before impact is a perfect parry', () => {
  const d = C.createFighter(); C.beginBlock(d, 'sword'); C.tickFighter(d, .1);
  const r = C.resolveHit(d, { dir: 'right', power: 1, fromAngle: 0, baseDamage: 20 });
  assert.equal(r.result, 'parried'); assert.equal(r.staminaCost, 0); assert.ok(r.attackerStagger > 0); assert.equal(r.damage, 0);
});

test('sword block held .5 s blocks but costs stamina', () => {
  const d = C.createFighter(); C.beginBlock(d, 'sword'); C.tickFighter(d, .5);
  const r = C.resolveHit(d, { dir: 'right', power: 1, fromAngle: 10, baseDamage: 20 });
  assert.equal(r.result, 'blocked'); assert.equal(r.damage, 0); assert.ok(r.staminaCost > 0);
});

test('shield covers 75 degrees each side; sword 60; nothing protects from behind', () => {
  const s = () => { const d = C.createFighter(); C.beginBlock(d, 'shield'); C.tickFighter(d, .5); return d; };
  const w = () => { const d = C.createFighter(); C.beginBlock(d, 'sword'); C.tickFighter(d, .5); return d; };
  assert.equal(C.resolveHit(s(), { dir: 'left', power: 1, fromAngle: 70, baseDamage: 20 }).result, 'blocked');
  assert.equal(C.resolveHit(s(), { dir: 'left', power: 1, fromAngle: -80, baseDamage: 20 }).result, 'hit');
  assert.equal(C.resolveHit(w(), { dir: 'left', power: 1, fromAngle: 65, baseDamage: 20 }).result, 'hit');
  assert.ok(C.resolveHit(s(), { dir: 'up', power: 1, fromAngle: 180, baseDamage: 20 }).damage > 0);
});

test('shield without enough stamina: guard breaks and damage gets through', () => {
  const d = C.createFighter({ stamina: 5 }); C.beginBlock(d, 'shield'); C.tickFighter(d, .5);
  const r = C.resolveHit(d, { dir: 'up', power: 1, fromAngle: 0, baseDamage: 20 });
  assert.equal(r.result, 'guardBroken'); assert.ok(r.damage > 0); assert.equal(d.blocking, null);
});

test('javelins stick in the shield (max 3) and each one makes blocking cost more', () => {
  const d = C.createFighter(); C.beginBlock(d, 'shield'); C.tickFighter(d, .5);
  for (let i = 0; i < 5; i++) C.resolveHit(d, { dir: 'thrust', power: 1, fromAngle: 0, baseDamage: 15, kind: 'javelin' });
  assert.equal(d.stuckJavelins, C.MAX_STUCK);
  d.stamina = 100;
  const r = C.resolveHit(d, { dir: 'up', power: 1, fromAngle: 0, baseDamage: 20 });
  assert.ok(Math.abs(r.staminaCost - C.SHIELD_COST * (1 + 3 * C.JAVELIN_SHIELD_PENALTY)) < 1e-9);
});

test('spam: no new attack during recovery, and stamina runs out after a flurry', () => {
  const f = C.createFighter();
  C.beginAttack(f, 'up'); C.releaseAttack(f);
  for (let i = 0; i < 100 && f.phase !== 'recovery'; i++) C.tickFighter(f, 1 / 60); // into recovery
  assert.equal(f.phase, 'recovery');
  assert.equal(C.beginAttack(f, 'left'), false);
  tickUntilIdle(f);
  const g = C.createFighter(); let started = 0;
  for (let k = 0; k < 30; k++) { if (C.beginAttack(g, 'right')) { started++; C.releaseAttack(g); tickUntilIdle(g); } if (k === 4) assert.ok(g.stamina > 60, `after five swings ${g.stamina}`); }
  assert.ok(g.stamina < 30);
  assert.ok(started >= 14 && started < 30, `started ${started}`);   // a long exchange, but not endless
});

test('feint during windup returns to idle immediately', () => {
  const f = C.createFighter(); C.beginAttack(f, 'up'); C.tickFighter(f, .2);
  C.feint(f);
  assert.equal(f.phase, 'idle'); assert.equal(C.beginAttack(f, 'left'), true);
});

test('being hit during windup interrupts the attack', () => {
  const f = C.createFighter(); C.beginAttack(f, 'up'); C.tickFighter(f, .2);
  const r = C.resolveHit(f, { dir: 'left', power: 1, fromAngle: 0, baseDamage: 20 });
  assert.equal(r.result, 'hit'); assert.notEqual(f.phase, 'windup');
});

test('Q mashing: a guard re-raised within the cooldown gets no perfect parry', () => {
  const d = C.createFighter();
  C.beginBlock(d, 'sword'); C.tickFighter(d, .05); C.endBlock(d); C.tickFighter(d, .1);
  C.beginBlock(d, 'sword'); C.tickFighter(d, .05);
  assert.equal(C.resolveHit(d, { dir: 'left', power: 1, fromAngle: 0, baseDamage: 20 }).result, 'blocked');
  C.endBlock(d); C.tickFighter(d, C.PARRY_COOLDOWN + .05);
  C.beginBlock(d, 'sword'); C.tickFighter(d, .05);
  assert.equal(C.resolveHit(d, { dir: 'left', power: 1, fromAngle: 0, baseDamage: 20 }).result, 'parried');
});

test('mouse intent: motion just before the click still picks the direction, old motion fades', () => {
  const m = C.createIntent();
  C.nudgeIntent(m, -30, 2);               // swept left, then clicked
  C.decayIntent(m, .08);
  assert.equal(C.dirFromMouse(m.x, m.y), 'left');
  C.decayIntent(m, .6);                   // long ago → nothing left → thrust
  assert.equal(C.dirFromMouse(m.x, m.y), 'thrust');
  C.nudgeIntent(m, 3, -25); assert.equal(C.dirFromMouse(m.x, m.y), 'up');
});
test('re-aim: a windup can change direction early, not once released or late', () => {
  const f = C.createFighter(); C.beginAttack(f, 'thrust');
  assert.equal(C.reaim(f, 'right'), true); assert.equal(f.dir, 'right');
  f.t = C.REAIM_TIME + .01; assert.equal(C.reaim(f, 'left'), false); assert.equal(f.dir, 'right');
  const g = C.createFighter(); C.beginAttack(g, 'up'); C.releaseAttack(g);
  assert.equal(C.reaim(g, 'left'), false);
});

test('random blow: any of the four directions, never the same twice in a row', () => {
  let prev = null; const seen = new Set(); let r = 0; const rng = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 200; i++) { const d = C.randomDir(prev, rng); assert.ok(C.DIRS.includes(d)); assert.notEqual(d, prev); seen.add(d); prev = d; }
  assert.equal(seen.size, 4);
});

test('passive shield: an idle fighter holding a shield stops frontal melee blows (narrower arc, dearer) without a button', () => {
  const d = C.createFighter({ passiveShield: true });
  const r = C.resolveHit(d, { dir: 'left', power: 1, fromAngle: 20, baseDamage: 20 });
  assert.equal(r.result, 'blocked'); assert.equal(r.damage, 0);
  assert.ok(r.staminaCost > C.SHIELD_COST, 'passive guard costs more than a raised shield');
  assert.equal(C.resolveHit(d, { dir: 'left', power: 1, fromAngle: 70, baseDamage: 20 }).result, 'hit', 'wide angles are not covered');
});
test('passive shield does not apply while winding up, striking or without a shield', () => {
  const w = C.createFighter({ passiveShield: true }); C.beginAttack(w, 'up');
  assert.equal(C.resolveHit(w, { dir: 'left', power: 1, fromAngle: 0, baseDamage: 20 }).result, 'hit');
  const n = C.createFighter({ passiveShield: true, shieldHP: 0 });
  assert.equal(C.resolveHit(n, { dir: 'left', power: 1, fromAngle: 0, baseDamage: 20 }).result, 'hit');
  const none = C.createFighter();
  assert.equal(C.resolveHit(none, { dir: 'left', power: 1, fromAngle: 0, baseDamage: 20 }).result, 'hit');
});

test('the shield can be raised out of an attack recovery (no helpless gap after swinging)', () => {
  const f = C.createFighter(); C.beginAttack(f, 'left'); C.releaseAttack(f);
  for (let i = 0; i < 400 && f.phase !== 'recovery'; i++) C.tickFighter(f, 1 / 120);
  assert.equal(f.phase, 'recovery');
  assert.equal(C.beginBlock(f, 'shield'), true);
  assert.equal(f.phase, 'idle'); assert.equal(f.blocking, 'shield');
});

test('blocking a blow costs little stamina: a dozen blocks before the arm gives out', () => {
  const d = C.createFighter(); C.beginBlock(d, 'shield');
  for (let i = 0; i < 12; i++) assert.notEqual(C.resolveHit(d, { dir: 'left', power: 1, fromAngle: 0, baseDamage: 20 }).result, 'hit', `block ${i}`);
});
