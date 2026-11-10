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

test('a held attack strikes once the windup is complete, then recovers', () => {
  const f = C.createFighter();
  C.beginAttack(f, 'left'); C.releaseAttack(f);
  const ev = [];
  for (let i = 0; i < 40; i++) ev.push(...C.tickFighter(f, .05));
  assert.deepEqual(ev.filter(e => e.type === 'strike').map(e => e.dir), ['left']);
  assert.ok(ev.some(e => e.type === 'recovered'));
  assert.equal(f.phase, 'idle');
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
  for (let i = 0; i < 12; i++) C.tickFighter(f, .05); // into recovery
  assert.equal(f.phase, 'recovery');
  assert.equal(C.beginAttack(f, 'left'), false);
  tickUntilIdle(f);
  const g = C.createFighter(); let started = 0;
  for (let k = 0; k < 10; k++) { if (C.beginAttack(g, 'right')) { started++; C.releaseAttack(g); tickUntilIdle(g); } }
  assert.ok(g.stamina < 30);
  assert.ok(started < 10, `started ${started}`);
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
