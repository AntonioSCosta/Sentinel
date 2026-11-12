import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEDULED, DECK, dueScheduled, rollEvent } from '../src/campaign/events.js';
import { newCampaign } from '../src/campaign/state.js';
import { makeRng } from '../src/campaign/rng.js';

const alwaysFire = () => ({ chance: () => true, pick: a => a[0], next: () => 0 });

test('cativos nunca antes do dia 10 nem depois do 20', () => {
  const s = newCampaign(1);
  for (let d = 0; d < 10; d++) { s.day = d; assert.equal(dueScheduled(s), null); }
  s.day = 10; assert.equal(dueScheduled(s).id, 'cativos');
  s.day = 20; assert.equal(dueScheduled(s).chapter, 'cativos');
  s.day = 21; assert.equal(dueScheduled(s), null);
  assert.equal(SCHEDULED[0].id, 'cativos');
});

test('cativos dispara no máximo uma vez', () => {
  const s = newCampaign(1);
  s.done.push('cativos');
  for (let d = 0; d <= 244; d++) { s.day = d; assert.equal(dueScheduled(s), null); }
});

test('cativos não dispara com a campanha terminada; dueScheduled não muta', () => {
  const s = newCampaign(1); s.day = 15; s.over = 'derrota';
  assert.equal(dueScheduled(s), null);
  s.over = null;
  dueScheduled(s);
  assert.deepEqual(s.done, []);
});

test('DECK tem exatamente os quatro ids, todos verosimil', () => {
  assert.deepEqual(DECK.map(e => e.id).sort(), ['enviado', 'pastores', 'seca', 'traidor']);
  assert.ok(DECK.every(e => e.kind === 'verosimil'));
});

const ev = id => DECK.find(e => e.id === id);

test('enviado dá homens; pastores dá comida', () => {
  const s = newCampaign(1); const m = s.men, f = s.food;
  assert.equal(typeof ev('enviado').apply(s), 'string');
  assert.equal(s.men, m + 3);
  ev('pastores').apply(s);
  assert.equal(s.food, f + 10);
});

test('seca tira comida sem a deixar negativa', () => {
  const s = newCampaign(1); s.food = 30; ev('seca').apply(s); assert.equal(s.food, 18);
  s.food = 5; ev('seca').apply(s); assert.equal(s.food, 0);
});

test('traidor tira armas e 1 homem, nunca com men a 1', () => {
  const s = newCampaign(1); s.men = 10; s.arms = 10; ev('traidor').apply(s);
  assert.equal(s.men, 9); assert.equal(s.arms, 6);
  s.men = 1; s.arms = 2; ev('traidor').apply(s);
  assert.equal(s.men, 1); assert.equal(s.arms, 0);
});

test('rollEvent nunca repete o id seguido e recursos nunca ficam negativos', () => {
  const s = newCampaign(3); const rng = alwaysFire(); let last = null;
  for (let i = 0; i < 50; i++) {
    const r = rollEvent(s, rng);
    assert.ok(r && typeof r.text === 'string');
    assert.notEqual(r.id, last); last = r.id;
    for (const k of ['men', 'food', 'arms']) assert.ok(s[k] >= 0);
  }
  const rng2 = makeRng(9); last = null;
  for (let i = 0; i < 300; i++) {
    const r = rollEvent(s, rng2);
    if (r) { assert.notEqual(r.id, last); last = r.id; }
  }
});

test('rollEvent: ~10% de acontecimentos em 1000 chamadas', () => {
  const s = newCampaign(5); const rng = makeRng(2024); let n = 0;
  for (let i = 0; i < 1000; i++) if (rollEvent(s, rng)) n++;
  assert.ok(n >= 50 && n <= 150, `n=${n}`);
});

test('rollEvent devolve null se a campanha terminou', () => {
  const s = newCampaign(1); s.over = 'vitoria';
  assert.equal(rollEvent(s, alwaysFire()), null);
});
