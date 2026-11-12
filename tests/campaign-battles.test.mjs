import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLY_CAP, ENEMY_CAP, BATTLE_TYPES, battleSpec, applyResult } from '../src/campaign/battles.js';
import { newCampaign } from '../src/campaign/state.js';
import { makeRng } from '../src/campaign/rng.js';

const rng = () => makeRng(5);
const st = men => { const s = newCampaign(3); s.men = men; return s; };
const enc = (kind, waiting = false, foe = {}) => ({ kind, foe: { id: `${kind}-1`, ...foe }, waiting });
const res = (o = {}) => ({ won: true, alliesLost: 0, enemiesKilled: 5, ...o });

test('constantes e tipos', () => {
  assert.equal(ALLY_CAP, 25); assert.equal(ENEMY_CAP, 30);
  assert.equal(BATTLE_TYPES.length, 7);
});

test('mapeamento encontro -> tipo/local', () => {
  const s = st(14);
  let b = battleSpec(enc('patrulha', true), s, rng()); assert.equal(b.type, 'emboscada'); assert.equal(b.site, 'estrada');
  b = battleSpec(enc('comboio', true), s, rng()); assert.equal(b.type, 'assalto-coluna'); assert.equal(b.site, 'estrada');
  b = battleSpec(enc('patrulha'), s, rng()); assert.equal(b.type, 'campo-aberto'); assert.equal(b.site, 'campo');
  b = battleSpec(enc('comboio'), s, rng()); assert.equal(b.type, 'campo-aberto');
  b = battleSpec(enc('pretor', false, { men: 60 }), s, rng()); assert.equal(b.type, 'decisiva'); assert.equal(b.site, 'campo');
  assert.equal(b.enemies.centurion, true);
  b = battleSpec(enc('posto'), s, rng()); assert.equal(b.type, 'historica'); assert.equal(b.chapter, 'acampamento'); assert.equal(b.site, 'castro');
});

test('semente e foeId', () => {
  const b = battleSpec(enc('patrulha'), st(14), rng());
  assert.ok(Number.isInteger(b.seed) && b.seed >= 1);
  assert.equal(b.foeId, 'patrulha-1');
});

test('aliados limitados e bónus', () => {
  let b = battleSpec(enc('patrulha'), st(40), rng());
  assert.equal(b.allies, 25); assert.equal(b.bonus.allies, 15); assert.equal(b.realMen, 40);
  b = battleSpec(enc('patrulha'), st(14), rng());
  assert.equal(b.allies, 14); assert.equal(b.bonus.allies, 0); assert.equal(b.realMen, 14);
});

test('inimigos: divisão, limite e bónus', () => {
  let b = battleSpec(enc('patrulha', false, { men: 6 }), st(14), rng());
  assert.equal(b.enemies.legio + b.enemies.velites, 6); assert.equal(b.bonus.enemies, 0); assert.equal(b.enemies.centurion, false);
  b = battleSpec(enc('pretor', false, { men: 60 }), st(14), rng());
  assert.equal(b.enemies.legio + b.enemies.velites, 30); assert.equal(b.bonus.enemies, 30);
  b = battleSpec(enc('posto'), st(14), rng());
  assert.equal(b.enemies.legio + b.enemies.velites, 12);
});

test('baixas escaladas: 40 homens, 25 mostrados, 10 baixas -> 16', () => {
  const s = st(40), b = battleSpec(enc('patrulha'), s, rng());
  applyResult(s, b, res({ alliesLost: 10 }));
  assert.equal(s.men, 24);
});

test('baixas nunca excedem nem tornam men negativo', () => {
  const s = st(14), b = battleSpec(enc('patrulha'), s, rng());
  applyResult(s, b, res({ won: false, alliesLost: 999 }));
  assert.equal(s.men, 0);
  const s2 = st(14); applyResult(s2, battleSpec(enc('patrulha'), s2, rng()), res({ alliesLost: -5 }));
  assert.equal(s2.men, 14);
});

test('vitória dá saque e fama, remove o inimigo', () => {
  const s = st(14); s.patrols.push({ id: 'patrulha-1' }, { id: 'outra' });
  const food = s.food, arms = s.arms, fame = s.fame;
  const ev = applyResult(s, battleSpec(enc('patrulha', true), s, rng()), res());
  assert.equal(s.food, food + 6); assert.equal(s.arms, arms + 3); assert.equal(s.fame, fame + 5);
  assert.deepEqual(s.patrols.map(p => p.id), ['outra']);
  assert.equal(ev[0].type, 'vitoria');
  const s2 = st(14); applyResult(s2, battleSpec(enc('comboio', true), s2, rng()), res());
  assert.equal(s2.food, 60 + 20); assert.equal(s2.arms, 10 + 6);
});

test('derrota tira homens e comida mas não termina a campanha', () => {
  const s = st(14); s.patrols.push({ id: 'patrulha-1' });
  const ev = applyResult(s, battleSpec(enc('patrulha'), s, rng()), res({ won: false, alliesLost: 5 }));
  assert.equal(s.men, 9); assert.equal(s.food, 57); assert.equal(s.fame, 15);
  assert.equal(s.over, null); assert.equal(s.patrols.length, 1);
  assert.equal(ev[0].type, 'derrota'); assert.ok(!ev.some(e => e.type === 'ruina'));
});

test('derrota com fama a zero é ruína', () => {
  const s = st(14); s.fame = 4;
  const ev = applyResult(s, battleSpec(enc('patrulha'), s, rng()), res({ won: false }));
  assert.equal(s.over, 'derrota'); assert.ok(ev.some(e => e.type === 'ruina'));
});

test('retirada custa comida e fama, sem saque, inimigo fica', () => {
  const s = st(14); s.patrols.push({ id: 'patrulha-1' });
  const ev = applyResult(s, battleSpec(enc('patrulha'), s, rng()), res({ won: false, retreated: true, alliesLost: 2 }));
  assert.equal(s.food, 55); assert.equal(s.fame, 17); assert.equal(s.arms, 10); assert.equal(s.patrols.length, 1);
  assert.equal(s.men, 12); assert.equal(ev[0].type, 'retirada');
});

test('decisiva vencida termina o ano', () => {
  const s = st(14);
  const ev = applyResult(s, battleSpec(enc('pretor', false, { men: 60 }), s, rng()), res());
  assert.equal(s.over, 'vitoria'); assert.equal(s.fame, 20 + 15);
  assert.ok(ev.some(e => e.type === 'ano-vencido'));
});

test('cooldown = 2 em todos os resultados', () => {
  for (const r of [res(), res({ won: false }), res({ won: false, retreated: true })]) {
    const s = st(14); applyResult(s, battleSpec(enc('patrulha'), s, rng()), r);
    assert.equal(s.cooldown, 2);
  }
});
