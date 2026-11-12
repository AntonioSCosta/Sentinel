import test from 'node:test';
import assert from 'node:assert/strict';
import { MARCH_SPEED, PATROL_SPEED, ENCOUNTER_RADIUS, nearRoad, stepDay } from '../src/campaign/simulation.js';
import { newCampaign, foodPerDay, recruitsFrom } from '../src/campaign/state.js';
import { makeRng } from '../src/campaign/rng.js';

const rng = () => makeRng(7);
const fresh = () => newCampaign(3);
const find = (s, kind) => s.world.settlements.find(x => x.kind === kind);
const at = (s, p) => { s.party.x = p.x; s.party.y = p.y; };
const far = s => { s.party.x = 500; s.party.y = 10; }; // longe de tudo o que importa
const ACAMPAR = { kind: 'acampar' };

test('constantes', () => {
  assert.deepEqual([MARCH_SPEED, PATROL_SPEED, ENCOUNTER_RADIUS], [45, 35, 30]);
});

test('um dia avança o relógio e gasta comida', () => {
  const s = fresh(), food = s.food, men = s.men;
  const r = stepDay(s, ACAMPAR, rng());
  assert.equal(s.day, 1);
  assert.equal(s.food, food - foodPerDay(men));
  assert.ok(Array.isArray(r.events));
});

test('marchar move no máximo MARCH_SPEED e chega sem ultrapassar', () => {
  const s = fresh(), { x, y } = s.party;
  stepDay(s, { kind: 'marchar', to: { x: x + 1000, y } }, rng());
  assert.ok(Math.abs(Math.hypot(s.party.x - x, s.party.y - y) - MARCH_SPEED) < 1e-6 || s.party.x >= s.world.w - 1e-6);
  const t = fresh();
  const to = { x: t.party.x + 10, y: t.party.y };
  stepDay(t, { kind: 'marchar', to }, rng());
  assert.deepEqual(t.party, to);
});

test('a party nunca sai do mundo', () => {
  const s = fresh();
  for (let i = 0; i < 40; i++) stepDay(s, { kind: 'marchar', to: { x: -500, y: 5000 } }, rng());
  assert.ok(s.party.x >= 0 && s.party.x <= s.world.w && s.party.y >= 0 && s.party.y <= s.world.h);
});

test('acampar não move', () => {
  const s = fresh(), p = { ...s.party };
  stepDay(s, ACAMPAR, rng());
  assert.deepEqual(s.party, p);
});

test('sem comida: -10% (mín. 1), comida >= 0, derrota uma só vez', () => {
  const s = fresh(); s.food = 0; s.men = 30; far(s);
  stepDay(s, ACAMPAR, rng());
  assert.equal(s.food, 0);
  assert.equal(s.men, 27);
  s.men = 4; stepDay(s, ACAMPAR, rng());
  assert.equal(s.men, 3);
  s.men = 1; const r = stepDay(s, ACAMPAR, rng());
  assert.equal(s.men, 0);
  assert.equal(s.over, 'derrota');
  assert.equal(r.events.filter(e => e.type === 'derrota').length, 1);
  const r2 = stepDay(s, ACAMPAR, rng());
  assert.deepEqual(r2, { events: [], encounter: null });
  assert.equal(s.day, 3);
});

test('estado terminado: stepDay não faz nada', () => {
  const s = fresh(); s.over = 'vitoria';
  const before = JSON.stringify(s);
  assert.deepEqual(stepDay(s, ACAMPAR, rng()), { events: [], encounter: null });
  assert.equal(JSON.stringify(s), before);
});

test('postos largam patrulha e comboio alternados de 12 em 12 dias', () => {
  const s = fresh(); far(s); s.food = 1e6; s.fame = 1e6;
  const seen = [];
  for (let d = 0; d < 37; d++) {
    stepDay(s, ACAMPAR, rng());
    for (const p of s.patrols) if (!seen.find(q => q.id === p.id)) seen.push({ id: p.id, kind: p.kind, day: s.day });
  }
  assert.deepEqual(seen.map(p => p.kind), ['patrulha', 'comboio', 'patrulha']);
  assert.deepEqual(seen.map(p => p.day), [13, 25, 37]); // nasce ao passar o dia 12, 24, 36
});

test('patrulhas avançam PATROL_SPEED pela estrada e somem no fim', () => {
  const s = fresh(); far(s); s.food = 1e6; s.fame = 1e6; s.day = 12;
  stepDay(s, ACAMPAR, rng());
  assert.equal(s.patrols.length, 1);
  const p = s.patrols[0], x0 = p.x, y0 = p.y;
  assert.ok(nearRoad(s.world, p, 1));
  stepDay(s, ACAMPAR, rng());
  const q = s.patrols[0];
  assert.ok(Math.hypot(q.x - x0, q.y - y0) <= PATROL_SPEED + 1e-6 && q.x > x0);
  for (let i = 0; i < 60; i++) stepDay(s, ACAMPAR, rng()); // 60 dias < 12*5 — só uma outra pode nascer
  assert.ok(!s.patrols.some(t => t.id === p.id));
});

test('patrulha a <= ENCOUNTER_RADIUS dá encontro; esperar na estrada dá waiting', () => {
  const s = fresh();
  s.patrols.push({ id: 'p1', kind: 'patrulha', x: 500, y: 300, i: 1, men: 6 });
  s.party = { x: 510, y: 300 };
  s.world.road = [{ x: 0, y: 300 }, { x: 1000, y: 300 }];
  const r = stepDay(s, { kind: 'esperar' }, rng());
  assert.equal(r.encounter.kind, 'patrulha');
  assert.equal(r.encounter.foe.id, 'p1');
  assert.equal(r.encounter.waiting, true);
  const t = fresh();
  t.world.road = s.world.road;
  t.patrols.push({ id: 'p1', kind: 'comboio', x: 500, y: 300, i: 1, men: 8 });
  t.party = { x: 510, y: 300 };
  const r2 = stepDay(t, ACAMPAR, rng());
  assert.equal(r2.encounter.kind, 'comboio');
  assert.equal(r2.encounter.waiting, false);
});

test('esconder: patrulhas ignoram a party', () => {
  const s = fresh();
  s.patrols.push({ id: 'p1', kind: 'patrulha', x: 500, y: 300, i: 1, men: 6 });
  s.party = { x: 505, y: 300 };
  assert.equal(stepDay(s, { kind: 'esconder' }, rng()).encounter, null);
});

test('pretor próximo dá encontro e tem precedência', () => {
  const s = fresh();
  s.praetor = { id: 't', name: 'T', x: 500, y: 300, men: 50, speed: 0, traits: { pursuit: 0, scorch: 0 } };
  s.patrols.push({ id: 'p1', kind: 'patrulha', x: 505, y: 300, i: 1, men: 6 });
  s.party = { x: 500, y: 305 };
  const r = stepDay(s, ACAMPAR, rng());
  assert.equal(r.encounter.kind, 'pretor');
  assert.equal(r.encounter.foe, s.praetor);
});

test('cooldown suprime encontros e desce 1 por dia', () => {
  const s = fresh();
  s.patrols.push({ id: 'p1', kind: 'patrulha', x: 500, y: 300, i: 1, men: 6 });
  s.party = { x: 505, y: 300 };
  s.cooldown = 2;
  assert.equal(stepDay(s, ACAMPAR, rng()).encounter, null);
  assert.equal(s.cooldown, 1);
});

test('recrutar numa aldeia', () => {
  const s = fresh(), v = find(s, 'aldeia');
  at(s, v); s.fame = 35; s.arms = 10;
  const men = s.men, gain = recruitsFrom(35);
  stepDay(s, { kind: 'recrutar', id: v.id }, rng());
  assert.equal(s.men, men + gain);
  assert.equal(s.arms, 10 - gain);
  assert.equal(s.villages[v.id].recruitedDay, 0);
  const m2 = s.men;
  stepDay(s, { kind: 'recrutar', id: v.id }, rng());
  assert.equal(s.men, m2); // < 10 dias
  s.day = 10;
  stepDay(s, { kind: 'recrutar', id: v.id }, rng());
  assert.equal(s.men, m2 + gain);
});

test('recrutar não excede as armas', () => {
  const s = fresh(), v = find(s, 'aldeia');
  at(s, v); s.fame = 80; s.arms = 2;
  const men = s.men;
  stepDay(s, { kind: 'recrutar', id: v.id }, rng());
  assert.equal(s.men, men + 2);
  assert.equal(s.arms, 0);
});

test('recrutar inválido: longe, queimada ou id desconhecido', () => {
  const s = fresh(), v = find(s, 'aldeia');
  const men = s.men, arms = s.arms;
  let r = stepDay(s, { kind: 'recrutar', id: v.id }, rng()); // party longe (início é serra)
  assert.ok(r.events.some(e => e.type === 'ordem-invalida'));
  at(s, v); s.villages[v.id].burnt = true;
  r = stepDay(s, { kind: 'recrutar', id: v.id }, rng());
  assert.ok(r.events.some(e => e.type === 'ordem-invalida'));
  r = stepDay(s, { kind: 'recrutar', id: 'nada' }, rng());
  assert.ok(r.events.some(e => e.type === 'ordem-invalida'));
  assert.equal(s.men, men); assert.equal(s.arms, arms);
});

test('pedir-ajuda num castro: +25 comida, +2 homens com fama >= 30, 1 vez por 30 dias', () => {
  const s = fresh(), c = find(s, 'castro');
  at(s, c); s.fame = 30;
  const food = s.food, men = s.men, need = foodPerDay(men + 2);
  stepDay(s, { kind: 'pedir-ajuda', id: c.id }, rng());
  assert.equal(s.men, men + 2);
  assert.equal(s.food, food + 25 - need);
  const f2 = s.food, m2 = s.men;
  stepDay(s, { kind: 'pedir-ajuda', id: c.id }, rng());
  assert.equal(s.men, m2);
  assert.ok(s.food < f2);
  s.day = 30;
  stepDay(s, { kind: 'pedir-ajuda', id: c.id }, rng());
  assert.equal(s.men, m2 + 2);
  const t = fresh(), c2 = find(t, 'castro'); at(t, c2); t.fame = 29;
  const m3 = t.men; stepDay(t, { kind: 'pedir-ajuda', id: c2.id }, rng());
  assert.equal(t.men, m3);
});

test('atacar um posto dá encontro posto; longe é inválido', () => {
  const s = fresh(), p = find(s, 'posto');
  let r = stepDay(s, { kind: 'atacar', id: p.id }, rng());
  assert.ok(r.events.some(e => e.type === 'ordem-invalida'));
  assert.equal(r.encounter, null);
  at(s, p);
  r = stepDay(s, { kind: 'atacar', id: p.id }, rng());
  assert.equal(r.encounter.kind, 'posto');
  assert.equal(r.encounter.foe.id, p.id);
});

test('nearRoad', () => {
  const w = { road: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
  assert.equal(nearRoad(w, { x: 50, y: 20 }), true);
  assert.equal(nearRoad(w, { x: 50, y: 30 }), false);
  assert.equal(nearRoad(w, { x: 130, y: 0 }, 40), true);
});

// Task 14: defesa de aldeia
const withVillage = (vx = 520, vy = 330) => {
  const s = fresh();
  s.world.road = [{ x: 0, y: 300 }, { x: 1000, y: 300 }];
  s.world.settlements = s.world.settlements.filter(x => x.kind !== 'aldeia');
  s.world.settlements.push({ id: 'av', kind: 'aldeia', name: 'Aldeia de Teste', x: vx, y: vy });
  s.villages = { av: { burnt: false, recruitedDay: -999 } };
  return s;
};

test('defesa: party junto a uma aldeia e patrulha a <= ENCOUNTER_RADIUS dela', () => {
  const s = withVillage(520, 325);
  s.patrols.push({ id: 'p1', kind: 'patrulha', x: 480, y: 300, i: 1, men: 6 });   // anda 35 -> (515,300), a ~25 da aldeia
  s.party = { x: 530, y: 340 };   // a ~18 da aldeia, a ~42 da patrulha
  const r = stepDay(s, ACAMPAR, rng());
  assert.equal(r.encounter.kind, 'defesa');
  assert.equal(r.encounter.villageId, 'av');
  assert.equal(r.encounter.foe.id, 'p1');
});

test('defesa tem precedência sobre a patrulha simples, mas não sobre o pretor na party', () => {
  const s = withVillage(510, 310);
  s.patrols.push({ id: 'p1', kind: 'patrulha', x: 470, y: 300, i: 1, men: 6 });   // -> (505,300), perto da party e da aldeia
  s.party = { x: 510, y: 305 };
  assert.equal(stepDay(s, ACAMPAR, rng()).encounter.kind, 'defesa');
  const t = withVillage(510, 310);
  t.patrols.push({ id: 'p1', kind: 'patrulha', x: 470, y: 300, i: 1, men: 6 });
  t.party = { x: 510, y: 305 };
  t.praetor = { id: 't', name: 'T', x: 515, y: 305, men: 50, speed: 0, traits: { pursuit: 0, scorch: 0 } };
  assert.equal(stepDay(t, ACAMPAR, rng()).encounter.kind, 'pretor');
});

test('defesa: o pretor junto da aldeia (longe da party) também a ameaça', () => {
  const s = withVillage(500, 400);
  s.praetor = { id: 't', name: 'T', x: 500, y: 425, men: 50, speed: 0, traits: { pursuit: 0, scorch: 0 } };
  s.party = { x: 500, y: 380 };   // a 20 da aldeia, a 45 do pretor
  const r = stepDay(s, ACAMPAR, rng());
  assert.equal(r.encounter.kind, 'defesa');
  assert.equal(r.encounter.foe, s.praetor);
  assert.equal(r.encounter.villageId, 'av');
});

test('defesa: aldeia queimada, party longe ou escondida não dão defesa', () => {
  const mk = () => { const s = withVillage(510, 310); s.patrols.push({ id: 'p1', kind: 'patrulha', x: 470, y: 300, i: 1, men: 6 }); return s; };
  let s = mk(); s.villages.av.burnt = true; s.party = { x: 510, y: 305 };
  assert.equal(stepDay(s, ACAMPAR, rng()).encounter.kind, 'patrulha');
  s = mk(); s.party = { x: 540, y: 340 };   // a ~42 da aldeia: fora dos 25; e a ~53 da patrulha
  assert.equal(stepDay(s, ACAMPAR, rng()).encounter, null);
  s = mk(); s.party = { x: 510, y: 305 };
  assert.equal(stepDay(s, { kind: 'esconder' }, rng()).encounter, null);
});
