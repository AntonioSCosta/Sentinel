// PR 3 — comida, reservas e estações: colheita no fim de cada estação, reserva de inverno, fome das aldeias e consumo do bando.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newCampaign, serialize, deserialize, foodPerDay } from '../src/campaign/state.js';
import { stepDay } from '../src/campaign/simulation.js';
import { makeRng } from '../src/campaign/rng.js';
import { season, YEAR_DAYS } from '../src/campaign/clock.js';
import { eventText } from '../src/campaign/ui.js';
import { COMMUNITY_IDS, production, margin, shift, postureFor, makeCommunity } from '../src/campaign/communities.js';
import { winterReserve, givableFood, isHungry, HUNGER_MARGIN, FIRST_HUNGER_SEASON } from '../src/campaign/harvest.js';

const rng = () => makeRng(7);
/** Uma campanha sem Roma por perto e com comida e homens que cheguem para andar o ano todo. */
const calm = () => { const s = newCampaign(3); s.praetor = null; s.patrols = []; s.food = 1e6; s.men = 40; s.fame = 50; return s; };
const step = s => stepDay(s, { kind: 'acampar' }, rng());
const harvests = ev => ev.filter(e => e.type === 'colheita');
const total = (s, season) => COMMUNITY_IDS.reduce((n, id) => n + production(s.communities[id], season).food, 0);

test('o vale produz o que o GDD diz em cada estação (cerca de 150, 230 e 200)', () => {
  const s = newCampaign(3);
  assert.deepEqual(['primavera', 'verão', 'outono'].map(x => total(s, x)), [152, 228, 196]);
});

test('reserva de inverno: uma unidade por família; as reservas iniciais ficam abaixo (0,6)', () => {
  const s = newCampaign(3);
  for (const id of COMMUNITY_IDS) {
    const c = s.communities[id];
    assert.equal(winterReserve(c), c.families, id);
    assert.ok(c.food < winterReserve(c), `${id}: começa abaixo da reserva de inverno`);
    assert.equal(c.food, Math.round(c.families * 0.6), id);
  }
});

test('a colheita entra nas reservas no fim de cada estação, e só então', () => {
  const s = calm(); s.day = 90;
  const before = Object.fromEntries(COMMUNITY_IDS.map(id => [id, s.communities[id].food]));
  const d1 = step(s);   // dia 91: ainda é primavera
  assert.equal(season(s.day), 'primavera'); assert.deepEqual(harvests(d1.events), []);
  assert.deepEqual(COMMUNITY_IDS.map(id => s.communities[id].food), COMMUNITY_IDS.map(id => before[id]), 'as reservas não mexem durante a estação');
  const d2 = step(s);   // dia 92: 1 de junho, a primavera acabou
  assert.equal(season(s.day), 'verão');
  const [h] = harvests(d2.events);
  assert.equal(h.season, 'primavera'); assert.equal(h.total, 152);
  for (const id of COMMUNITY_IDS) assert.equal(s.communities[id].food, before[id] + production(s.communities[id], 'primavera').food, id);
  assert.deepEqual(h.villages.map(v => v.id), COMMUNITY_IDS.map(id => s.communities[id].settlement));
});

test('há exatamente três colheitas por ano: primavera, verão e outono (esta no último dia)', () => {
  const s = calm(), got = [];
  while (s.day < YEAR_DAYS) for (const h of harvests(step(s).events)) got.push([h.season, s.day]);
  assert.deepEqual(got, [['primavera', 92], ['verão', 184], ['outono', YEAR_DAYS]]);
  const c = s.communities.ribeira;   // 42 + 56 + 140 + 70
  assert.equal(c.food, 42 + 56 + 140 + 70);
});

test('a colheita desce com os jovens fora, e uma aldeia queimada ou abandonada não colhe', () => {
  const s = calm(); s.day = 91;
  s.communities.souto.away = 15;              // todos os jovens do Souto no bando: metade da produção
  s.communities.vau.situation = 'queimada';
  s.communities.fonte.situation = 'abandonada';
  const f = Object.fromEntries(COMMUNITY_IDS.map(id => [id, s.communities[id].food]));
  step(s);
  assert.equal(s.communities.souto.food, f.souto + Math.round(30 * 0.6 * 0.5));
  assert.equal(s.communities.vau.food, f.vau); assert.equal(s.communities.fonte.food, f.fonte);
  assert.equal(s.communities.ribeira.food, f.ribeira + 56);
});

test('só a comprometida dá comida abaixo da reserva de inverno; a amiga só o que passa dela', () => {
  const c = makeCommunity('souto', 'x');   // 30 famílias, reserva de inverno 30
  c.food = 18;
  for (const [posture, want] of [['comprometida', 18], ['amiga', 0], ['neutra', 0], ['receosa', 0], ['colabora', 0]]) { c.posture = posture; assert.equal(givableFood(c), want, `${posture} abaixo da reserva`); }
  c.food = 50;
  for (const [posture, want] of [['comprometida', 50], ['amiga', 20], ['neutra', 0], ['receosa', 0], ['colabora', 0]]) { c.posture = posture; assert.equal(givableFood(c), want, `${posture} acima da reserva`); }
});

test('fome: a partir de setembro, reservas abaixo do inverno somam −15 à margem e baixam a postura', () => {
  const s = calm(); s.day = 182;
  const c = s.communities.vau;            // 50/30: margem 20, amiga
  c.food = 0;
  assert.equal(c.posture, 'amiga'); assert.equal(margin(c), 20);
  step(s);   // dia 183: ainda verão
  assert.equal(season(s.day), 'verão'); assert.equal(c.hungry ?? false, false); assert.equal(c.posture, 'amiga');
  const ev = step(s).events;   // dia 184: 1 de setembro
  assert.equal(season(s.day), 'outono');
  assert.equal(c.hungry, true); assert.equal(margin(c), 20 - 15); assert.equal(HUNGER_MARGIN, 15);
  assert.equal(c.posture, 'neutra');
  assert.deepEqual(ev.filter(e => e.type === 'aldeia-fome').map(e => [e.id, e.from, e.to]), [[c.settlement, 'amiga', 'neutra']]);
  const m = c.motives.at(-1); assert.deepEqual([m.key, m.v, m.day], ['fome', -15, 184]);
  assert.equal(FIRST_HUNGER_SEASON, 'outono');
});

test('a fome não se repete todos os dias, e a confiança e o medo não a desfazem', () => {
  const s = calm(); s.day = 183; const c = s.communities.vau; c.food = 0;
  step(s);
  const n = c.motives.length;
  const ev = step(s).events;
  assert.deepEqual(ev.filter(e => e.type === 'aldeia-fome'), []); assert.equal(c.motives.length, n);
  shift(c, { trust: 1 }, { key: 'k', text: 't' }, s.day);
  assert.equal(c.posture, 'neutra', 'a margem continua a contar com a fome');
});

test('com comida outra vez, a aldeia volta ao que sentia', () => {
  const s = calm(); s.day = 183; const c = s.communities.vau; c.food = 0;
  step(s); assert.equal(c.posture, 'neutra');
  c.food = c.families;   // chega para o inverno
  const ev = step(s).events;
  assert.equal(c.hungry, false); assert.equal(c.posture, 'amiga');
  assert.deepEqual(ev.filter(e => e.type === 'aldeia-fome-fim').map(e => [e.id, e.to]), [[c.settlement, 'amiga']]);
  assert.deepEqual([c.motives.at(-1).key, c.motives.at(-1).v], ['fome-fim', 15]);
});

test('antes de setembro, reservas baixas não são fome; aldeias queimadas ou abandonadas não passam fome', () => {
  const c = makeCommunity('vau', 'x'); c.food = 0;
  assert.equal(isHungry(c, 'verão'), false); assert.equal(isHungry(c, 'primavera'), false); assert.equal(isHungry(c, 'outono'), true);
  c.situation = 'queimada'; assert.equal(isHungry(c, 'outono'), false);
  c.situation = 'abandonada'; assert.equal(isHungry(c, 'outono'), false);
  c.situation = 'livre'; c.families = 0; assert.equal(isHungry(c, 'outono'), false);
});

test('consumo do bando: 22 homens comem cerca de 180 por estação e as reservas das aldeias não são tocadas', () => {
  const s = calm(); s.men = 22; s.food = 1000;
  const res = COMMUNITY_IDS.map(id => s.communities[id].food);
  for (let i = 0; i < 91; i++) step(s);   // a primavera inteira, até ao dia 91
  assert.equal(season(s.day), 'primavera');
  assert.equal(foodPerDay(22), 2);
  assert.equal(1000 - s.food, 2 * 91);    // 182
  assert.deepEqual(COMMUNITY_IDS.map(id => s.communities[id].food), res);
});

test('o bando sem comida passa fome e perde homens (como antes)', () => {
  const s = calm(); s.food = 0; s.men = 30;
  const ev = step(s).events;
  assert.ok(ev.some(e => e.type === 'fome' && e.mortos === 3)); assert.equal(s.men, 27);
});

test('os textos da colheita e da fome das aldeias lêem-se', () => {
  const s = calm(); s.day = 91;
  const h = harvests(step(s).events)[0];
  assert.match(eventText(h, s), /primavera.*colheita.*152/i);
  const v = s.communities.vau;
  assert.match(eventText({ type: 'aldeia-fome', id: v.settlement, from: 'amiga', to: 'neutra' }, s), /inverno.*neutra/i);
  assert.match(eventText({ type: 'aldeia-fome-fim', id: v.settlement, from: 'neutra', to: 'amiga' }, s), /amiga/i);
});

test('gravação: hungry é opcional, valida-se e faz ida e volta; gravações do PR 2 carregam', () => {
  const s = calm(); s.day = 183; s.communities.vau.food = 0; step(s);
  assert.equal(s.communities.vau.hungry, true);
  const back = deserialize(serialize(s)); assert.ok(back); assert.equal(back.communities.vau.hungry, true);
  const old = JSON.parse(serialize(newCampaign(3))); for (const id of COMMUNITY_IDS) delete old.communities[id].hungry;
  assert.ok(deserialize(JSON.stringify(old)), 'sem o campo carrega');
  const bad = JSON.parse(serialize(s)); bad.communities.vau.hungry = 'sim';
  assert.equal(deserialize(JSON.stringify(bad)), null);
});
