// PR 2 — recrutamento com custo real: postura, jovens, armas; origem dos homens; baixas e produção da aldeia de origem.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newCampaign, spend, serialize, deserialize, recruitsFrom } from '../src/campaign/state.js';
import { stepDay } from '../src/campaign/simulation.js';
import { makeRng } from '../src/campaign/rng.js';
import { applyResult } from '../src/campaign/battles.js';
import { eventText } from '../src/campaign/ui.js';
import {
  COMMUNITY_IDS, IDENTITY, RECRUIT_SHARE, POSTURES, youth, production, bandOrigins, loseMen, postureFor, margin,
} from '../src/campaign/communities.js';

const rng = () => makeRng(7);
const fresh = () => newCampaign(3);
const place = (s, c) => s.world.settlements.find(x => x.id === c.settlement);
/** Põe o bando junto da comunidade `id` com a postura `posture` (ajusta confiança e medo) e armas/fama dadas. */
function visit(s, id, { posture, arms = 20, fame = 20 } = {}) {
  const c = s.communities[id], p = place(s, c);
  s.party.x = p.x; s.party.y = p.y; s.arms = arms; s.fame = fame;
  if (posture) {   // uma margem a meio do degrau pedido
    const m = { comprometida: 50, amiga: 25, neutra: 0, receosa: -25, colabora: -50 }[posture];
    c.trust = Math.max(0, m); c.fear = Math.max(0, -m); c.posture = postureFor(margin(c));
    assert.equal(c.posture, posture, 'a preparação do teste dá a postura pedida');
  }
  return c;
}
const order = (s, id) => ({ kind: 'recrutar', id: s.communities[id].settlement });
const snap = s => JSON.stringify(s);
const awaySum = s => COMMUNITY_IDS.reduce((n, id) => n + s.communities[id].away, 0);

test('recrutar numa aldeia amiga: os homens vêm dos jovens dela e ficam registados como dela', () => {
  const s = fresh(), c = visit(s, 'souto', { posture: 'amiga', fame: 35 });
  const men = s.men, arms = s.arms, y0 = youth(c), n = recruitsFrom(35);
  const r = stepDay(s, order(s, 'souto'), rng());
  assert.notEqual(r.refused, true);
  assert.equal(s.men, men + n); assert.equal(s.arms, arms - n);
  assert.equal(c.away, n); assert.equal(youth(c), y0 - n);
  assert.deepEqual(r.events.find(e => e.type === 'recrutou'), { type: 'recrutou', id: c.settlement, men: n });
});

test('já não há espera fixa: pode recrutar no dia seguinte, enquanto houver jovens, armas e vontade', () => {
  const s = fresh(), c = visit(s, 'souto', { posture: 'comprometida' });
  stepDay(s, order(s, 'souto'), rng());
  const a1 = c.away;
  const r = stepDay(s, order(s, 'souto'), rng());
  assert.notEqual(r.refused, true);
  assert.ok(!r.events.some(e => e.type === 'recrutar-cedo'));
  assert.ok(c.away > a1);
});

test('aldeia receosa ou que colabora com Roma não dá homens; nada muda e o dia não passa', () => {
  for (const [id, posture] of [['ribeira', 'receosa'], ['fonte', 'colabora']]) {
    const s = fresh(); visit(s, id, { posture });
    const before = snap(s), r = stepDay(s, order(s, id), rng());
    assert.equal(r.refused, true, posture);
    assert.deepEqual(r.events.map(e => [e.type, e.why]), [['recrutar-recusado', 'postura']], posture);
    assert.equal(snap(s), before, posture);
  }
  assert.equal(RECRUIT_SHARE.receosa, 0); assert.equal(RECRUIT_SHARE.colabora, 0);
});

test('a postura limita quantos jovens dá por visita (mais confiança, mais homens)', () => {
  const take = posture => {
    const s = fresh(), c = visit(s, 'penedo', { posture, fame: 200, arms: 99 });
    const y0 = youth(c); stepDay(s, order(s, 'penedo'), rng());
    return { got: c.away, cap: Math.max(1, Math.ceil(y0 * RECRUIT_SHARE[posture])) };
  };
  for (const p of ['neutra', 'amiga', 'comprometida']) { const { got, cap } = take(p); assert.equal(got, cap, p); }
  assert.ok(take('neutra').got < take('amiga').got && take('amiga').got < take('comprometida').got);
});

test('os jovens disponíveis são o teto: sem jovens recusa; com um, dá um', () => {
  const s = fresh(), c = visit(s, 'vau', { posture: 'comprometida', fame: 200, arms: 99 });
  c.away = Math.floor(c.families * IDENTITY.vau.youthRate) - 1; s.men += c.away;
  assert.equal(youth(c), 1);
  stepDay(s, order(s, 'vau'), rng());
  assert.equal(youth(c), 0);
  const before = snap(s), r = stepDay(s, order(s, 'vau'), rng());
  assert.equal(r.refused, true);
  assert.deepEqual(r.events.map(e => [e.type, e.why]), [['recrutar-recusado', 'jovens']]);
  assert.equal(snap(s), before);
});

test('as armas são o teto: uma arma, um homem; sem armas, recusa sem gastar a vez', () => {
  const s = fresh(), c = visit(s, 'souto', { posture: 'amiga', fame: 200, arms: 1 });
  stepDay(s, order(s, 'souto'), rng());
  assert.equal(c.away, 1); assert.equal(s.arms, 0);
  const before = snap(s), r = stepDay(s, order(s, 'souto'), rng());
  assert.equal(r.refused, true); assert.equal(r.events[0].type, 'sem-armas'); assert.equal(snap(s), before);
});

test('só as comunidades dão homens: o castro do Penedo sim; uma aldeia fora do vale não', () => {
  const s = fresh(), c = visit(s, 'penedo', { posture: 'neutra' });
  assert.notEqual(stepDay(s, order(s, 'penedo'), rng()).refused, true);
  assert.ok(c.away > 0);
  const t = fresh(), used = new Set(COMMUNITY_IDS.map(id => t.communities[id].settlement));
  const other = t.world.settlements.find(x => x.kind === 'aldeia' && !used.has(x.id));
  t.party.x = other.x; t.party.y = other.y;
  const before = snap(t), r = stepDay(t, { kind: 'recrutar', id: other.id }, rng());
  assert.equal(r.refused, true); assert.deepEqual(r.events.map(e => [e.type, e.why]), [['recrutar-recusado', 'sem-comunidade']]);
  assert.equal(snap(t), before);
});

test('os textos das novas recusas dizem o motivo e que o dia não passa', () => {
  const s = fresh();
  for (const why of ['postura', 'jovens', 'sem-comunidade']) {
    const t = eventText({ type: 'recrutar-recusado', id: s.communities.souto.settlement, why, posture: 'receosa' }, s);
    assert.match(t, /O dia não passa\./, why); assert.ok(t.length > 25, why);
  }
});

test('origem do bando: quem não veio de nenhuma aldeia conta à parte', () => {
  const s = fresh(); s.men = 22; s.communities.souto.away = 6; s.communities.vau.away = 2;
  assert.deepEqual(bandOrigins(s), { souto: 6, vau: 2, sem: 14 });
});

test('baixas repartem-se pelas origens em proporção ao bando, sem passar de quem lá está', () => {
  const s = fresh(); s.men = 22; s.communities.souto.away = 6; s.communities.vau.away = 2;
  const out = loseMen(s, 8);
  assert.equal(s.men, 14);
  assert.deepEqual(bandOrigins(s), { souto: 4, vau: 1, sem: 9 });
  assert.deepEqual(out, { souto: 2, vau: 1, sem: 5 });
  // determinístico: mesma entrada, mesma repartição
  const t = fresh(); t.men = 22; t.communities.souto.away = 6; t.communities.vau.away = 2;
  assert.deepEqual(loseMen(t, 8), out);
});

test('spend (batalhas, retiradas), fome e o resto passam todos pela origem', () => {
  const s = fresh(); s.men = 20; s.communities.penedo.away = 10;
  spend(s, { men: 4 });
  assert.equal(s.communities.penedo.away, 8); assert.equal(s.men, 16);
  s.food = 0; stepDay(s, { kind: 'acampar' }, rng());
  assert.ok(s.men < 16); assert.equal(awaySum(s) + bandOrigins(s).sem, s.men);
});

test('baixas de uma batalha caem na aldeia de origem (applyResult)', () => {
  const s = fresh(); s.men = 20; s.communities.souto.away = 10;
  const spec = { type: 'emboscada', allies: 20, realMen: 20, enemies: { legio: 6, velites: 2, centurion: false }, bonus: { allies: 0, enemies: 0 } };
  applyResult(s, spec, { won: true, alliesLost: 8, enemiesKilled: 8, cartsCaptured: 0, cartsTotal: 0 });
  assert.equal(s.men, 12); assert.equal(s.communities.souto.away, 6);
});

test('morrem todos: away nunca fica negativo nem passa de men', () => {
  const s = fresh(); s.men = 5; s.communities.ribeira.away = 3; s.communities.vau.away = 2;
  spend(s, { men: 99 });
  assert.equal(s.men, 0); assert.equal(awaySum(s), 0);
});

test('produção da aldeia desce em proporção aos homens que estão fora', () => {
  const s = fresh(), c = s.communities.souto;   // 30 famílias, serra: 1.6 no outono
  assert.equal(production(c, 'outono').food, 48);
  c.away = 3; assert.equal(production(c, 'outono').food, Math.round(30 * 1.6 * 0.9));
  c.away = 15; assert.equal(production(c, 'outono').food, Math.round(30 * 1.6 * 0.5));
  const f = s.communities.fonte; f.away = 0; assert.equal(production(f, 'verão').arms, 4);
  f.away = 22; assert.equal(production(f, 'verão').arms, Math.round(4 * (1 - 22 / 45)));
  f.families = 0; f.away = 0; assert.deepEqual(production(f, 'verão'), { food: 0, arms: 0 });
});

test('gravação: os homens fora não podem ser mais do que o bando; ida e volta mantém a origem', () => {
  const s = fresh(), c = visit(s, 'souto', { posture: 'amiga' });
  stepDay(s, order(s, 'souto'), rng());
  const back = deserialize(serialize(s));
  assert.ok(back); assert.equal(back.communities.souto.away, c.away);
  const o = JSON.parse(serialize(s)); o.men = awaySum(s) - 1;
  assert.equal(deserialize(JSON.stringify(o)), null);
});
