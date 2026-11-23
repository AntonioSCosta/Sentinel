// PR 2 — recrutamento com custo real: postura, jovens, armas; origem dos homens; baixas e produção da aldeia de origem.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newCampaign, spend, serialize, deserialize } from '../src/campaign/state.js';
import { stepDay } from '../src/campaign/simulation.js';
import { makeRng } from '../src/campaign/rng.js';
import { applyResult } from '../src/campaign/battles.js';
import { eventText } from '../src/campaign/ui.js';
import {
  makeCommunity, COMMUNITY_IDS, IDENTITY, RECRUIT_RULE, LEVY_TRUST, DEATH_TRUST, POSTURES, youth, youthCap, production, bandOrigins, loseMen,
  recruitLimit, levy, postureFor, margin,
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
const fresh_c = id => makeCommunity(id, 'x');
const awaySum = s => COMMUNITY_IDS.reduce((n, id) => n + s.communities[id].away, 0);

test('recrutar numa aldeia amiga: até um quarto dos jovens, e saem dos jovens dela', () => {
  const s = fresh(), c = visit(s, 'souto', { posture: 'amiga' });
  const men = s.men, arms = s.arms, y0 = youth(c), n = Math.floor(y0 / 4);
  assert.ok(n >= 2);
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
  assert.deepEqual(RECRUIT_RULE.receosa, {}); assert.deepEqual(RECRUIT_RULE.colabora, {});
});

test('limites do GDD: comprometida um terço, amiga um quarto, neutra só 3 voluntários, receosa e colabora nada', () => {
  const got = posture => {   // o Penedo tem 28 jovens
    const s = fresh(), c = visit(s, 'penedo', { posture, arms: 99 });
    assert.equal(youth(c), 28);
    stepDay(s, order(s, 'penedo'), rng());
    return c.away;
  };
  assert.equal(got('comprometida'), 9);   // floor(28 / 3)
  assert.equal(got('amiga'), 7);          // floor(28 / 4)
  assert.equal(got('neutra'), 3);         // voluntários, não percentagem
  assert.deepEqual(RECRUIT_RULE.neutra, { volunteers: 3 });
  for (const p of ['receosa', 'colabora']) assert.equal(recruitLimit({ ...fresh_c('penedo'), posture: p }, 99).limit, 0, p);
});

test('neutra: o número de voluntários não cresce com a aldeia; com poucos jovens dá os que há', () => {
  const small = fresh_c('vau'), big = fresh_c('ribeira');
  big.posture = small.posture = 'neutra';
  assert.equal(recruitLimit(big, 99).limit, 3); assert.equal(recruitLimit(small, 99).limit, 3);
  small.away = youthCap(small) - 2; assert.equal(recruitLimit(small, 99).limit, 2);
});

test('a fama não limita o recrutamento', () => {
  const run = fame => { const s = fresh(), c = visit(s, 'souto', { posture: 'amiga', fame }); stepDay(s, order(s, 'souto'), rng()); return { away: c.away, fame: s.fame }; };
  const low = run(1), high = run(500);
  assert.equal(low.away, high.away);
  assert.equal(low.away, 3);   // floor(15 / 4), com a fama a 1 ou a 500
  assert.equal(recruitLimit(fresh_c('souto'), 99).byPosture, 3);
});

test('os jovens disponíveis são o teto: sem jovens recusa; com um, a neutra dá um', () => {
  const s = fresh(), c = visit(s, 'vau', { posture: 'neutra', arms: 99 });
  c.away = youthCap(c) - 1; s.men += c.away;
  assert.equal(youth(c), 1);
  stepDay(s, order(s, 'vau'), rng());
  assert.equal(youth(c), 0);
  const before = snap(s), r = stepDay(s, order(s, 'vau'), rng());
  assert.equal(r.refused, true);
  assert.deepEqual(r.events.map(e => [e.type, e.why]), [['recrutar-recusado', 'jovens']]);
  assert.equal(snap(s), before);
});

/** Uma comunidade com `avail` jovens disponíveis e a postura dada. */
const withYouth = (id, posture, avail) => { const c = fresh_c(id); c.posture = posture; c.away = youthCap(c) - avail; return c; };

test('mínimo de um recruta: comprometida com dois jovens disponíveis dá um', () => {
  const c = withYouth('vau', 'comprometida', 2);
  assert.equal(youth(c), 2);
  assert.equal(recruitLimit(c, 99).limit, 1);   // floor(2 / 3) = 0, sobe para 1
});

test('mínimo de um recruta: amiga com três jovens disponíveis dá um', () => {
  const c = withYouth('vau', 'amiga', 3);
  assert.equal(youth(c), 3);
  assert.equal(recruitLimit(c, 99).limit, 1);   // floor(3 / 4) = 0, sobe para 1
});

test('sem jovens disponíveis não dá nenhum, comprometida ou amiga', () => {
  for (const p of ['comprometida', 'amiga']) {
    const c = withYouth('vau', p, 0);
    assert.equal(youth(c), 0);
    const r = recruitLimit(c, 99);
    assert.deepEqual([r.limit, r.why], [0, 'jovens'], p);
  }
});

test('o mínimo de um não rompe o teto: com jovens a sério continua 1/3 e 1/4; a neutra, 3', () => {
  for (const [p, avail, want] of [['comprometida', 3, 1], ['comprometida', 6, 2], ['comprometida', 28, 9], ['amiga', 4, 1], ['amiga', 8, 2], ['amiga', 28, 7], ['neutra', 1, 1], ['neutra', 28, 3]])
    assert.equal(recruitLimit(withYouth('penedo', p, avail), 99).limit, want, `${p} com ${avail}`);
  for (const p of ['receosa', 'colabora']) assert.equal(recruitLimit(withYouth('penedo', p, 28), 99).limit, 0, p);
});

test('uma aldeia pequena e leal recruta em jogo: um homem de uma amiga com três jovens', () => {
  const s = fresh(), c = visit(s, 'vau', { posture: 'amiga', arms: 99 });
  c.away = youthCap(c) - 3; s.men += c.away;
  const men = s.men; stepDay(s, order(s, 'vau'), rng());
  assert.equal(s.men, men + 1); assert.equal(youth(c), 2);
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

test('produção: desce METADE da proporção de jovens que estão fora (GDD)', () => {
  const s = fresh(), c = s.communities.souto;   // 15 jovens; serra: 48 no outono
  assert.equal(youthCap(c), 15);
  assert.equal(production(c, 'outono').food, 48);
  c.away = 3;  assert.equal(production(c, 'outono').food, Math.round(48 * (1 - 0.5 * 3 / 15)));    // 20% fora -> -10%
  c.away = 15; assert.equal(production(c, 'outono').food, 24);                                      // todos fora -> metade
  c.away = 7;  assert.equal(production(c, 'outono').food, Math.round(48 * (1 - 0.5 * 7 / 15)));
  const f = s.communities.fonte; f.away = 0; assert.equal(production(f, 'verão').arms, 4);   // 22 jovens
  f.away = 22; assert.equal(production(f, 'verão').arms, 2);
  f.away = 11; assert.equal(production(f, 'verão').arms, 3);
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

test('levar jovens acima de um sexto custa −2 de confiança por homem', () => {
  const c = fresh_c('souto');   // 15 jovens: o sexto livre são 2
  assert.equal(LEVY_TRUST, -2);
  const t0 = c.trust;
  levy(c, 2, 5); assert.equal(c.trust, t0, 'até um sexto não custa');
  levy(c, 1, 6); assert.equal(c.trust, t0 - 2, 'o terceiro já custa 2');
  levy(c, 2, 7); assert.equal(c.trust, t0 - 6, 'depois do sexto, cada um custa 2 (conta os que já lá estão)');
  assert.equal(c.away, 5);
});

test('recrutar acima de um sexto regista o motivo «Levaste-nos os filhos»', () => {
  const s = fresh(), c = visit(s, 'souto', { posture: 'comprometida', arms: 99 });   // um terço de 15 = 5; o sexto livre são 2
  const t0 = c.trust; stepDay(s, order(s, 'souto'), rng());
  assert.equal(c.away, 5); assert.equal(c.trust, t0 - 2 * 3);
  const m = c.motives.at(-1);
  assert.deepEqual([m.key, m.text, m.v, m.day], ['jovens-levados', 'Levaste-nos os filhos', -6, 0]);
});

test('cada baixa de um homem da aldeia custa −3 de confiança', () => {
  assert.equal(DEATH_TRUST, -3);
  const s = fresh(); s.men = 20; s.communities.souto.away = 10;
  const t0 = s.communities.souto.trust;
  spend(s, { men: 4 });   // 4 de 20: metade do bando é do Souto -> 2 mortos seus
  assert.equal(s.communities.souto.away, 8);
  assert.equal(s.communities.souto.trust, t0 - 6);
  const m = s.communities.souto.motives.at(-1);
  assert.deepEqual([m.key, m.v], ['baixas', -6]);
  assert.equal(s.communities.vau.trust, newCampaign(3).communities.vau.trust, 'quem não perdeu ninguém não sente nada');
});

test('baixas de uma batalha custam confiança à aldeia de origem; a fome e o traidor não', () => {
  const s = fresh(); s.men = 20; s.communities.souto.away = 10;
  const t0 = s.communities.souto.trust;
  const spec = { type: 'emboscada', allies: 20, realMen: 20, enemies: { legio: 6, velites: 2, centurion: false }, bonus: { allies: 0, enemies: 0 } };
  applyResult(s, spec, { won: true, alliesLost: 8, enemiesKilled: 8, cartsCaptured: 0, cartsTotal: 0 });
  assert.equal(s.communities.souto.trust, t0 - 12);   // 4 homens do Souto
  const u = fresh(); u.men = 20; u.communities.souto.away = 10; u.food = 0;
  const t1 = u.communities.souto.trust; stepDay(u, { kind: 'acampar' }, rng());
  assert.ok(u.communities.souto.away < 10 || u.men < 20); assert.equal(u.communities.souto.trust, t1);
});
