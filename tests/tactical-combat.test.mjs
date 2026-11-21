import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, TUNING } from '../src/tactical/data.js';
import { wrap, sideOf, takenMult, dealtMult, volleyDamage, meleeDamage, radius, contactDistance, inContact, routThreshold } from '../src/tactical/combat.js';

// um grupo mínimo para as fórmulas: virado para +x, em ordem
const grp = (role, extra = {}) => ({ role, side: ROLES[role].side, men: 6, x: 0, y: 0, facing: 0, state: 'ativo', disorderT: 0, chargeT: 0, ...extra });

test('wrap reduz ângulos a ]-π, π]', () => {
  assert.equal(wrap(3 * Math.PI), Math.PI);
  assert.ok(Math.abs(wrap(-3 * Math.PI / 2) - Math.PI / 2) < 1e-12);
  assert.equal(wrap(0.5), 0.5);
});

test('sideOf: frente, flanco e costas pela frente do alvo', () => {
  const t = grp('legionario');
  assert.equal(sideOf(t, { x: 10, y: 0 }), 'frente');
  assert.equal(sideOf(t, { x: 0, y: 10 }), 'flanco');
  assert.equal(sideOf(t, { x: -10, y: 0 }), 'costas');
});

test('takenMult: o escudo romano só vale pela frente e em ordem', () => {
  const t = grp('legionario'), front = { x: 10, y: 0 }, flank = { x: 0, y: 10 }, rear = { x: -10, y: 0 };
  assert.equal(takenMult(t, front, false), ROLES.legionario.shieldFront);
  assert.equal(takenMult(t, front, true), ROLES.legionario.missileFront);
  assert.equal(takenMult(t, flank, false), TUNING.flankMult);
  assert.equal(takenMult(t, rear, false), TUNING.rearMult);
  assert.equal(takenMult({ ...t, disorderT: 2 }, front, true), TUNING.disorder.taken);   // surpreendido: sem escudo
  assert.equal(takenMult({ ...t, state: 'debandada' }, front, false), TUNING.routed.taken);
});

test('dealtMult: carga multiplica, desordem reduz', () => {
  assert.equal(dealtMult(grp('guerreiro')), 1);
  assert.equal(dealtMult(grp('guerreiro', { chargeT: 1 })), TUNING.charge.mult);
  assert.equal(dealtMult(grp('guerreiro', { disorderT: 1 })), TUNING.disorder.dealt);
});

test('meleeDamage cresce com os homens e com o passo', () => {
  const t = grp('legionario', { x: 3 });
  const a = grp('guerreiro', { men: 4, facing: Math.PI }), b = grp('guerreiro', { men: 8, facing: Math.PI });
  assert.ok(Math.abs(meleeDamage(b, t, 0.1) - 2 * meleeDamage(a, t, 0.1)) < 1e-12);
  assert.ok(Math.abs(meleeDamage(a, t, 0.2) - 2 * meleeDamage(a, t, 0.1)) < 1e-12);
});

test('volleyDamage: cobertura total corta pela metade; a cobertura é limitada a [0, 1]', () => {
  const f = grp('fundeiro', { men: 4 }), t = grp('velite', { x: 30, facing: 0 });
  const open = volleyDamage(f, t, 0), full = volleyDamage(f, t, 1);
  assert.ok(open > 0);
  assert.ok(Math.abs(full - open * (1 - TUNING.coverMissile)) < 1e-12);
  assert.equal(volleyDamage(f, t, 5), full);
  assert.equal(volleyDamage(f, t, -1), open);
});

test('raio e contacto: grupos maiores tocam-se de mais longe', () => {
  assert.ok(radius(9) > radius(4));
  assert.equal(radius(0), radius(1));
  const a = grp('guerreiro', { men: 5 }), b = grp('legionario', { men: 6 });
  const d = contactDistance(a, b);
  assert.ok(inContact(a, { ...b, x: d }));
  assert.ok(!inContact(a, { ...b, x: d + 0.01 }));
});

test('routThreshold: romanos surpreendidos quebram mais cedo do que em ordem', () => {
  assert.equal(routThreshold(grp('legionario')), TUNING.rout.romanos.formed);
  assert.equal(routThreshold(grp('legionario', { disorderT: 1 })), TUNING.rout.romanos.disordered);
  assert.ok(TUNING.rout.romanos.disordered < TUNING.rout.romanos.formed);
  assert.equal(routThreshold(grp('guerreiro')), TUNING.rout.lusitanos.formed);
});
