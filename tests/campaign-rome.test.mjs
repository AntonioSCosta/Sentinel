// PR 4 — Roma e as situações das aldeias: atenção, tributo, castigo, ocupação, queima e abandono, e o que cada uma muda
// (confiança, medo, produção, informação, apoio). Módulo: src/campaign/rome.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newCampaign, serialize, deserialize } from '../src/campaign/state.js';
import { stepDay } from '../src/campaign/simulation.js';
import { battleSpec, applyResult } from '../src/campaign/battles.js';
import { makeRng } from '../src/campaign/rng.js';
import { ensureDoctrine } from '../src/campaign/doctrine.js';
import { updateIntel, intelView } from '../src/campaign/intel.js';
import { eventText } from '../src/campaign/ui.js';
import { COMMUNITY_IDS, production, recruitLimit, margin, postureFor, bandOrigins, newsFrom, topMotives } from '../src/campaign/communities.js';
import {
  ensureRome, raiseAttention, bandOf, ATTENTION_GAIN, BANDS, TRIBUTE, PUNISH, ABANDON_BELOW, DENOUNCE_GAP, PUNISH_GAP, SUSPECT_DAYS,
  levyTribute, payTribute, refuseTribute, punish, burn, abandon, liberate, noteSupport, validRome, romeDay,
} from '../src/campaign/rome.js';

const rng = () => makeRng(7);
/** Uma campanha sem Roma por perto (nem destacamentos a sair), com comida e homens que cheguem. */
const calm = () => {
  const s = newCampaign(3); s.praetor = null; s.patrols = []; s.food = 1e6; s.men = 40; s.fame = 50; s.arms = 40;
  ensureDoctrine(s).nextSpawn = 1e9;
  return s;
};
const step = (s, order = { kind: 'acampar' }) => stepDay(s, order, rng());
const days = (s, n) => { const ev = []; for (let i = 0; i < n; i++) ev.push(...step(s).events); return ev; };
const places = s => Object.fromEntries(COMMUNITY_IDS.map(id => [id, s.world.settlements.find(x => x.id === s.communities[id].settlement)]));
const evs = (ev, type) => ev.filter(e => e.type === type);
/** Põe a comunidade numa postura (confiança/medo que dão essa margem). */
const MARGIN = { comprometida: [70, 10], amiga: [50, 30], neutra: [40, 30], receosa: [20, 50], colabora: [10, 70] };
const be = (c, posture) => { [c.trust, c.fear] = MARGIN[posture]; c.posture = postureFor(margin(c)); assert.equal(c.posture, posture); return c; };
const patrolAt = (s, p, id = 'p1') => { s.patrols.push({ id, kind: 'patrulha', x: p.x, y: p.y, i: 1, dir: 1, men: 6 }); };

test('atenção: cada causa soma o que o GDD diz e o total fica entre 0 e 100', () => {
  assert.deepEqual(ATTENTION_GAIN, { cobradores: 15, patrulha: 10, tributo: 10, denuncia: 5 });
  const s = calm();
  for (const [kind, n] of Object.entries(ATTENTION_GAIN)) { ensureRome(s).attention = 0; raiseAttention(s, kind); assert.equal(s.rome.attention, n, kind); }
  s.rome.attention = 95; raiseAttention(s, 'patrulha'); assert.equal(s.rome.attention, 100);
  assert.throws(() => raiseAttention(s, 'inventada'));
});

test('atenção: faixas de 0–24, 25–49, 50–74 e 75 ou mais', () => {
  assert.deepEqual(BANDS.map(b => b.id), ['rotina', 'vigilancia', 'castigo', 'pretor']);
  const at = { 0: 'rotina', 24: 'rotina', 25: 'vigilancia', 49: 'vigilancia', 50: 'castigo', 74: 'castigo', 75: 'pretor', 100: 'pretor' };
  for (const [a, band] of Object.entries(at)) assert.equal(bandOf(Number(a)), band, a);
});

test('atenção: raiseAttention devolve a mudança de faixa, e null quando fica na mesma', () => {
  const s = calm(); ensureRome(s).attention = 22;
  assert.deepEqual(raiseAttention(s, 'denuncia'), { from: 'rotina', to: 'vigilancia' });
  assert.equal(raiseAttention(s, 'denuncia'), null);
});

test('atenção: desce um ponto a cada dois dias e nunca abaixo de 0', () => {
  const s = calm(); ensureRome(s).attention = 20;
  days(s, 10); assert.equal(s.rome.attention, 15);
  s.rome.attention = 1; days(s, 10); assert.equal(s.rome.attention, 0);
});

test('atenção: vencer uma patrulha sobe 10; perder, ou o pretor, não', () => {
  const s = calm(), p = { id: 'p1', kind: 'patrulha', x: 100, y: 100, men: 6 };
  s.patrols = [p];
  const spec = battleSpec({ kind: 'patrulha', foe: p, waiting: true }, s, rng());
  applyResult(s, spec, { won: true, alliesLost: 0, enemiesKilled: 6 });
  assert.equal(ensureRome(s).attention, 10);
  const t = calm(); t.patrols = [{ ...p }];
  applyResult(t, battleSpec({ kind: 'patrulha', foe: t.patrols[0], waiting: true }, t, rng()), { won: false, alliesLost: 3, enemiesKilled: 0 });
  assert.equal(ensureRome(t).attention, 0);
});

test('tributo: no início de cada estação a Ribeira e a Fonte devem 30% do que passa da reserva de inverno, em dez dias', () => {
  assert.equal(TRIBUTE.share, 0.3); assert.equal(TRIBUTE.days, 10);
  const s = calm(), c = be(s.communities.ribeira, 'neutra');
  c.food = 100; s.day = 91;
  const expected = Math.round(0.3 * (c.food + production(c, 'primavera').food - c.families));
  const ev = step(s).events;   // dia 92: começa o verão
  assert.equal(s.day, 92);
  assert.equal(c.situation, 'tributada'); assert.deepEqual(c.due, { food: expected, day: 102 });
  assert.deepEqual(evs(ev, 'tributo-exigido').map(e => [e.id, e.food, e.day]), [[c.settlement, expected, 102]]);
});

test('tributo: a Fonte, devedora, e as aldeias receosas ou colaboradoras pagam sozinhas, sem custo de confiança', () => {
  const s = calm(), fonte = s.communities.fonte, ribeira = s.communities.ribeira;
  assert.equal(fonte.posture, 'colabora'); assert.equal(ribeira.posture, 'receosa');
  fonte.food = 100; ribeira.food = 100; s.day = 91;
  const [f0, r0] = [fonte, ribeira].map(c => ({ food: c.food + production(c, 'primavera').food, trust: c.trust, fear: c.fear, families: c.families }));
  const pay = f => Math.round(0.3 * (f.food - f.families));
  const ev = step(s).events;
  assert.equal(fonte.food, f0.food - pay(f0)); assert.equal(ribeira.food, r0.food - pay(r0));
  for (const c of [fonte, ribeira]) { assert.equal(c.situation, 'livre'); assert.equal(c.due, null); }
  assert.equal(fonte.trust, f0.trust); assert.equal(ribeira.trust, r0.trust);
  assert.deepEqual(evs(ev, 'tributo-pago').map(e => [e.id, e.auto]).sort(), [[ribeira.settlement, true], [fonte.settlement, true]].sort());
});

test('tributo: sem excedente não há tributo', () => {
  const s = calm(), c = be(s.communities.ribeira, 'neutra');
  c.food = 0; s.day = 91;
  const ev = step(s).events;
  assert.equal(c.situation, 'livre'); assert.equal(c.due, null); assert.deepEqual(evs(ev, 'tributo-exigido'), []);
});

test('tributo: as outras aldeias só o devem se Roma desconfia delas (apoiaram o bando nos últimos 30 dias)', () => {
  assert.equal(SUSPECT_DAYS, 30);
  const s = calm(), c = be(s.communities.souto, 'amiga');
  c.food = 200; s.day = 91;
  step(s); assert.equal(c.situation, 'livre');
  const t = calm(), d = be(t.communities.souto, 'amiga');
  d.food = 200; t.day = 91; ensureRome(t).suspects.souto = 80;
  step(t); assert.equal(d.situation, 'tributada'); assert.ok(d.due.food > 0);
});

test('tributo: pagar custa a comida e 5 de confiança, e Roma não repara', () => {
  assert.equal(TRIBUTE.trust, -5);
  const s = calm(), c = be(s.communities.souto, 'amiga');
  c.situation = 'tributada'; c.due = { food: 42, day: 102 }; c.food = 200; ensureRome(s).attention = 12;
  const ev = payTribute(s, 'souto');
  assert.equal(c.food, 158); assert.equal(c.trust, 45); assert.equal(c.due, null); assert.equal(c.situation, 'livre');
  assert.equal(s.rome.attention, 12);
  assert.deepEqual(ev.map(e => [e.type, e.id, e.food, e.auto]), [['tributo-pago', c.settlement, 42, false]]);
  assert.deepEqual(payTribute(s, 'souto'), [], 'sem pedido pendente não há nada a pagar');
});

test('tributo: recusar sobe a atenção em 10 e a aldeia é castigada', () => {
  const s = calm(), c = be(s.communities.souto, 'amiga');
  c.situation = 'tributada'; c.due = { food: 42, day: 102 };
  const ev = refuseTribute(s, 'souto');
  assert.equal(s.rome.attention, 10); assert.equal(c.situation, 'castigada'); assert.equal(c.due, null);
  assert.ok(evs(ev, 'castigo').length === 1);
});

test('tributo: passado o prazo sem pagar a aldeia é castigada e a atenção sobe 10', () => {
  const s = calm(), c = be(s.communities.souto, 'amiga');
  c.situation = 'tributada'; c.due = { food: 42, day: 100 }; s.day = 98;
  step(s); assert.equal(c.situation, 'tributada', 'ainda dentro do prazo');
  const ev = step(s).events; assert.equal(s.day, 100);
  assert.equal(c.situation, 'castigada'); assert.equal(c.due, null); assert.equal(s.rome.attention, 10);
  assert.equal(evs(ev, 'castigo')[0].why, 'tributo');
});

test('castigo: medo +25, metade da produção e 20 dias; o motivo fica registado', () => {
  assert.deepEqual([PUNISH.fear, PUNISH.days, PUNISH.production], [25, 20, 0.5]);
  const s = calm(), c = s.communities.vau, normal = production(c, 'verão').food, fear0 = c.fear;
  s.day = 50;
  const ev = punish(s, 'vau', 'tributo');
  assert.equal(c.situation, 'castigada'); assert.equal(c.until, 70); assert.equal(c.fear, fear0 + 25);
  assert.equal(production(c, 'verão').food, Math.round(normal / 2));
  assert.ok(topMotives(c, 1)[0].v <= -5 && topMotives(c, 1)[0].key === 'castigo');
  assert.equal(evs(ev, 'castigo')[0].id, c.settlement);
});

test('castigo: a inclinação do chefe conta (o prudente Camalo sente 1,5 vezes o medo)', () => {
  const s = calm(), c = s.communities.ribeira, fear0 = c.fear;
  punish(s, 'ribeira', 'apoio'); assert.equal(c.fear, Math.min(100, Math.round(fear0 + 25 * 1.5)));
});

test('castigo: acaba passados 20 dias e a aldeia volta a ser livre', () => {
  const s = calm(), c = s.communities.vau; s.day = 10;
  punish(s, 'vau', 'apoio');
  const ev = days(s, 19); assert.equal(c.situation, 'castigada');
  ev.push(...step(s).events);
  assert.equal(s.day, 30); assert.equal(c.situation, 'livre'); assert.equal(c.until, null);
  assert.equal(evs(ev, 'castigo-fim').length, 1);
});

test('castigo: voltar a castigar quem já está castigada põe guarnição (ocupada)', () => {
  const s = calm(), c = s.communities.vau; ensureRome(s).attention = 55;
  punish(s, 'vau', 'apoio');
  const ev = punish(s, 'vau', 'apoio');
  assert.equal(c.situation, 'ocupada'); assert.equal(c.until, null);
  assert.equal(evs(ev, 'ocupada').length, 1);
});

test('ocupação: medo +2 por dia, não dá homens e só acaba quando o bando derrota a guarnição', () => {
  const s = calm(), c = s.communities.souto; ensureRome(s).attention = 55;
  punish(s, 'souto', 'apoio'); punish(s, 'souto', 'apoio');
  const fear0 = c.fear; days(s, 5);
  assert.equal(c.situation, 'ocupada'); assert.ok(c.fear >= fear0 + 5 * 2 || c.fear === 100);
  assert.deepEqual([recruitLimit(c, 40).limit, recruitLimit(c, 40).why], [0, 'ocupada']);
  const ev = liberate(s, 'souto');
  assert.equal(c.situation, 'livre'); assert.equal(evs(ev, 'ocupada-fim').length, 1);
  assert.notEqual(recruitLimit(be(c, 'amiga'), 40).why, 'ocupada');
});

test('queima: perde 40% das famílias e as reservas, e os sobreviventes vão para a vizinha mais amiga', () => {
  const s = calm(), vau = s.communities.vau, souto = s.communities.souto;
  vau.food = 77; vau.hungry = true;
  const total = COMMUNITY_IDS.reduce((n, id) => n + s.communities[id].families, 0), souto0 = souto.families;
  const ev = burn(s, 'vau', 'castigo');
  assert.equal(vau.situation, 'queimada'); assert.equal(vau.families, 0); assert.equal(vau.food, 0); assert.equal(vau.hungry, false);
  assert.equal(vau.due, null); assert.equal(vau.until, null);
  assert.equal(souto.families, souto0 + 15, 'o Souto é a aldeia mais amiga e recebe os 15 que sobraram dos 25');
  assert.equal(COMMUNITY_IDS.reduce((n, id) => n + s.communities[id].families, 0), total - 10);
  assert.equal(s.villages[vau.settlement].burnt, true);
  assert.deepEqual(evs(ev, 'comunidade-queimada').map(e => [e.id, e.lost, e.to, e.by]), [[vau.settlement, 10, souto.settlement, 'castigo']]);
});

test('queima: os homens do bando que vinham da aldeia passam para a que a acolhe (sem passar das famílias)', () => {
  const s = calm(); s.men = 40;
  s.communities.vau.away = 3; s.communities.souto.away = 2;
  burn(s, 'vau', 'castigo');
  const { vau, souto } = s.communities;
  assert.equal(vau.away, 0); assert.equal(souto.away, 5);
  for (const id of COMMUNITY_IDS) assert.ok(s.communities[id].away <= s.communities[id].families, id);
  assert.deepEqual(bandOrigins(s), { souto: 5, sem: 35 });
  assert.ok(deserialize(serialize(s)), 'a gravação continua válida');
});

test('queima: sem aldeia que acolha os sobreviventes, eles perdem-se', () => {
  const s = calm();
  for (const id of ['ribeira', 'souto', 'fonte']) burn(s, id, 'castigo');
  s.communities.penedo.situation = 'abandonada'; s.communities.penedo.families = 0;
  burn(s, 'vau', 'castigo');
  assert.equal(s.communities.vau.families, 0);
  assert.ok(COMMUNITY_IDS.every(id => s.communities[id].families === 0));
});

test('queima: o pretor ou uma batalha perdida queimam a aldeia e a comunidade fica queimada', () => {
  const s = calm(), c = s.communities.vau;
  s.villages[c.settlement].burnt = true;   // o que o pretor faz em praetor.js
  const ev = step(s).events;
  assert.equal(c.situation, 'queimada'); assert.equal(c.families, 0);
  assert.deepEqual(evs(ev, 'comunidade-queimada').map(e => e.by), ['pretor']);
  const t = calm(), d = t.communities.souto;   // defesa de aldeia não ganha
  const spec = { type: 'defesa-aldeia', villageId: d.settlement, withdraw: { possible: false } };
  applyResult(t, { ...spec, seed: 1, allies: 5, realMen: t.men, enemies: { legio: 1, velites: 0 }, bonus: { allies: 0, enemies: 0 } }, { won: false, alliesLost: 1, enemiesKilled: 0 });
  assert.equal(d.situation, 'queimada');
});

test('queima: uma aldeia queimada não colhe, não tem fome nem dá homens', () => {
  const s = calm(), c = s.communities.vau; burn(s, 'vau', 'pretor');
  assert.deepEqual(production(c, 'verão'), { food: 0, arms: 0 });
  assert.deepEqual([recruitLimit(c, 40).limit, recruitLimit(c, 40).why], [0, 'destruida']);
  s.day = 183; days(s, 70); assert.equal(c.hungry, false);
});

test('abandono: com menos de 10 famílias a aldeia deixa de contar e as que restam vão para a mais amiga', () => {
  assert.equal(ABANDON_BELOW, 10);
  const s = calm(), c = s.communities.vau, souto0 = s.communities.souto.families;
  c.families = 9; c.away = 0;
  const ev = step(s).events;
  assert.equal(c.situation, 'abandonada'); assert.equal(c.families, 0); assert.equal(s.communities.souto.families, souto0 + 9);
  assert.deepEqual(evs(ev, 'comunidade-abandonada').map(e => [e.id, e.to]), [[c.settlement, s.communities.souto.settlement]]);
  assert.deepEqual([production(c, 'verão').food, recruitLimit(c, 40).why], [0, 'destruida']);
  const t = calm(); t.communities.vau.families = 10; step(t); assert.equal(t.communities.vau.situation, 'livre');
  assert.equal(abandon(t, 'vau')[0].type, 'comunidade-abandonada');
});

test('apoio: ajudar o bando sem Roma à vista torna a aldeia suspeita, mas não a castiga', () => {
  const s = calm();
  const ev = noteSupport(s, 'souto', 'homens');
  assert.equal(s.communities.souto.situation, 'livre'); assert.equal(s.rome.suspects.souto, s.day); assert.deepEqual(evs(ev, 'castigo'), []);
});

test('apoio: ajudar o bando à vista de Roma (uma patrulha, caçadores ou o pretor a menos de 30) castiga a aldeia', () => {
  const s = calm(), p = places(s).souto;
  patrolAt(s, { x: p.x + 20, y: p.y });
  const ev = noteSupport(s, 'souto', 'homens');
  assert.equal(s.communities.souto.situation, 'castigada'); assert.equal(evs(ev, 'castigo')[0].why, 'apoio');
  const t = calm(), q = places(t).vau; t.patrols = []; t.praetor = { x: q.x, y: q.y + 29, men: 60 };
  noteSupport(t, 'vau', 'comida'); assert.equal(t.communities.vau.situation, 'castigada');
  const u = calm(), r = places(u).vau; patrolAt(u, { x: r.x + 31, y: r.y });
  noteSupport(u, 'vau', 'homens'); assert.equal(u.communities.vau.situation, 'livre', 'a mais de 30 não vê');
});

test('apoio: recrutar à vista de Roma dá os homens e castiga a aldeia; sem Roma só a torna suspeita', () => {
  const s = calm(), p = places(s).souto; s.party = { x: p.x, y: p.y }; be(s.communities.souto, 'comprometida');
  patrolAt(s, p);
  const ev = step(s, { kind: 'recrutar', id: p.id }).events;
  assert.ok(evs(ev, 'recrutou')[0].men > 0); assert.equal(s.communities.souto.situation, 'castigada');
  const t = calm(), q = places(t).souto; t.party = { x: q.x, y: q.y }; be(t.communities.souto, 'comprometida');
  step(t, { kind: 'recrutar', id: q.id });
  assert.equal(t.communities.souto.situation, 'livre'); assert.equal(typeof t.rome.suspects.souto, 'number');
});

test('apoio: pedir ajuda ao castro do Penedo também conta como apoio', () => {
  const s = calm(), p = places(s).penedo; s.party = { x: p.x, y: p.y }; patrolAt(s, p);
  step(s, { kind: 'pedir-ajuda', id: p.id });
  assert.equal(s.communities.penedo.situation, 'castigada');
});

test('apoio: reincidir à vista de Roma, já castigada, leva à ocupação; com atenção ≥ 75, à queima', () => {
  const s = calm(), p = places(s).vau; patrolAt(s, p);
  ensureRome(s).attention = 60;
  noteSupport(s, 'vau', 'homens'); noteSupport(s, 'vau', 'homens');
  assert.equal(s.communities.vau.situation, 'ocupada');
  const t = calm(), q = places(t).vau; patrolAt(t, q); ensureRome(t).attention = 80;
  noteSupport(t, 'vau', 'homens'); noteSupport(t, 'vau', 'homens');
  assert.equal(t.communities.vau.situation, 'queimada');
});

test('denúncia: a aldeia colaboradora denuncia o bando quando passa perto; Roma fica a saber onde está', () => {
  assert.equal(DENOUNCE_GAP, 10);
  const s = calm(), p = places(s).fonte; s.party = { x: p.x + 10, y: p.y };
  assert.equal(s.communities.fonte.posture, 'colabora');
  const ev = step(s).events;
  assert.equal(s.rome.attention, 5); assert.deepEqual(evs(ev, 'denuncia').map(e => e.id), [p.id]);
  const seen = s.doctrine.lastSeen; assert.deepEqual([seen.x, seen.y, seen.day], [s.party.x, s.party.y, s.day]);
  assert.deepEqual(evs(step(s).events, 'denuncia'), [], 'não denuncia todos os dias');
  assert.equal(evs(days(s, DENOUNCE_GAP), 'denuncia').length, 1, 'passados 10 dias denuncia outra vez');
});

test('denúncia: só a colaboradora e só quando o bando passa perto', () => {
  const s = calm(), p = places(s).fonte; s.party = { x: p.x + 10, y: p.y };
  be(s.communities.fonte, 'receosa'); step(s); assert.equal(s.rome.attention, 0);
  be(s.communities.fonte, 'colabora'); s.party = { x: p.x + 200, y: p.y }; step(s); assert.equal(s.rome.attention, 0);
});

test('castigo de Roma: com atenção 50–74 castiga a aldeia mais suspeita, uma de cada vez e de dez em dez dias', () => {
  assert.equal(PUNISH_GAP, 10);
  const s = calm(); ensureRome(s).attention = 62; s.rome.suspects.souto = 0; s.day = 1;
  const ev = step(s).events;
  assert.deepEqual(evs(ev, 'castigo').map(e => [e.id, e.why]), [[s.communities.souto.settlement, 'suspeita']]);
  s.rome.attention = 62; step(s);
  assert.deepEqual(COMMUNITY_IDS.filter(id => s.communities[id].situation === 'castigada'), ['souto'], 'só uma de cada vez');
  s.rome.attention = 62; days(s, PUNISH_GAP);
  assert.equal(COMMUNITY_IDS.filter(id => s.communities[id].situation === 'castigada').length, 2, 'passados 10 dias, outra');
});

test('castigo de Roma: abaixo de 50 Roma não castiga por si; com atenção ≥ 75 volta a castigar quem já está castigada, e queima-a', () => {
  const s = calm(); ensureRome(s).attention = 49; s.rome.suspects.souto = 0;
  days(s, 3); assert.ok(COMMUNITY_IDS.every(id => s.communities[id].situation === 'livre'));
  const t = calm(); ensureRome(t).attention = 80; t.rome.suspects.souto = 0; t.day = 1;
  punish(t, 'souto', 'apoio'); t.rome.nextPunish = 0;
  const ev = step(t).events;
  assert.equal(t.communities.souto.situation, 'queimada', 'castigada e outra vez a mais suspeita: castigo máximo');
  assert.deepEqual(evs(ev, 'comunidade-queimada').map(e => e.by), ['castigo']);
});

test('informação: só dão notícias as comunidades de pé, e a postura decide quando', () => {
  const s = calm();
  const news = p => { const c = be(s.communities.souto, p); return newsFrom(c); };
  assert.deepEqual(news('comprometida'), { delay: 0, chance: 1 });
  assert.deepEqual(news('amiga'), { delay: 1, chance: 1 });
  assert.deepEqual(news('neutra'), { delay: null, chance: 0.5 });
  assert.equal(news('receosa'), null); assert.equal(news('colabora'), null);
  const c = be(s.communities.souto, 'comprometida');
  for (const situation of ['ocupada', 'queimada', 'abandonada']) { c.situation = situation; assert.equal(newsFrom(c), null, situation); }
  c.situation = 'castigada'; assert.notEqual(newsFrom(c), null, 'castigada ainda fala (com a postura que tiver)');
});

test('informação: uma força romana junto de uma comunidade comprometida chega no próprio dia; junto de uma receosa não chega', () => {
  const mk = posture => {
    const s = calm(); s.party = { x: 20, y: 20 };
    s.world.settlements = s.world.settlements.filter(x => x.kind !== 'castro' || x.id === s.communities.penedo.settlement);
    for (const v of Object.values(s.villages)) v.burnt = true;   // as outras aldeias não dão relatos
    const c = s.communities.penedo; be(c, posture); const p = places(s).penedo;
    s.patrols = [{ id: 'c1', kind: 'cacadores', hunt: true, x: p.x + 5, y: p.y, men: 10, target: { x: p.x + 5, y: p.y }, left: 99 }];
    return s;
  };
  const reports = (s, n = 12) => { const out = []; for (let i = 0; i < n; i++) { s.day += 1; updateIntel(s); out.push(...s.intel.reports.filter(r => r.src === 'aldeia')); } return out; };
  const a = mk('comprometida'), ra = reports(a);
  assert.ok(ra.length > 0); assert.ok(ra.every(r => r.got === r.seen), 'no próprio dia');
  const b = mk('receosa'); assert.deepEqual(reports(b), []);
  const c = mk('amiga'), rc = reports(c); assert.ok(rc.length > 0); assert.ok(rc.every(r => r.got - r.seen >= 1), 'com pelo menos um dia de atraso');
});

test('informação: uma aldeia queimada deixa de dar relatos (e o fumo continua a mostrar-se)', () => {
  const s = calm(); burn(s, 'vau', 'pretor');
  assert.equal(newsFrom(s.communities.vau), null);
});

test('gravação: rome é opcional (gravações antigas carregam) e uma gravação com rome e situações volta igual', () => {
  const s = calm(); assert.equal(s.rome, undefined);
  assert.ok(deserialize(serialize(s)));
  ensureRome(s).attention = 33; s.rome.suspects.souto = 4; punish(s, 'vau', 'apoio'); burn(s, 'fonte', 'pretor');
  const back = deserialize(serialize(s));
  assert.deepEqual(back.rome, s.rome); assert.deepEqual(back.communities, s.communities);
  assert.equal(back.v, 1);
});

test('gravação: rome inválido recusa a gravação', () => {
  const bad = mut => { const s = calm(); ensureRome(s); mut(s.rome); return deserialize(serialize(s)); };
  assert.equal(bad(r => { r.attention = -1; }), null);
  assert.equal(bad(r => { r.attention = 101; }), null);
  assert.equal(bad(r => { r.attention = 'x'; }), null);
  assert.equal(bad(r => { r.suspects = []; }), null);
  assert.equal(bad(r => { r.suspects = { souto: 'ontem' }; }), null);
  assert.equal(bad(r => { r.nextPunish = NaN; }), null);
  assert.ok(bad(r => { r.attention = 50; }));
  assert.equal(validRome(null), false); assert.equal(validRome(undefined), false);
});

test('determinismo: duas campanhas com a mesma semente e as mesmas ordens ficam iguais, com Roma a castigar', () => {
  const run = () => {
    const s = newCampaign(11); s.food = 1e6; s.men = 40; s.arms = 40; s.fame = 60;
    const cmds = [{ kind: 'acampar' }, { kind: 'esperar' }, { kind: 'marchar', to: { x: 400, y: 300 } }];
    for (let i = 0; i < 120 && !s.over; i++) {
      if (i === 20) { ensureRome(s).attention = 70; s.rome.suspects.souto = i; }
      stepDay(s, cmds[i % 3], makeRng(s.seed + s.day * 7919));
    }
    return serialize(s);
  };
  assert.equal(run(), run());
});

test('invariantes: depois de qualquer situação, away ≤ famílias, Σ away ≤ homens e nada fica negativo', () => {
  const s = calm(); s.communities.vau.away = 4; s.communities.souto.away = 3;
  punish(s, 'vau', 'apoio'); burn(s, 'vau', 'castigo'); abandon(s, 'souto');
  assert.ok(COMMUNITY_IDS.every(id => { const c = s.communities[id]; return c.away <= c.families && c.food >= 0 && c.families >= 0 && c.trust >= 0 && c.fear <= 100; }));
  assert.ok(COMMUNITY_IDS.reduce((n, id) => n + s.communities[id].away, 0) <= s.men);
  assert.ok(deserialize(serialize(s)));
});

test('texto: cada acontecimento novo tem uma frase que nomeia a aldeia', () => {
  const s = calm(), id = s.communities.vau.settlement, name = 'Aldeia do Vau';   // o nome da comunidade, não o do lugar no mundo gerado (PR 5)
  const all = [
    { type: 'tributo-exigido', id, food: 20, day: 102 }, { type: 'tributo-pago', id, food: 20, auto: true }, { type: 'tributo-pago', id, food: 20, auto: false },
    { type: 'castigo', id, why: 'tributo' }, { type: 'castigo', id, why: 'apoio' }, { type: 'castigo', id, why: 'suspeita' }, { type: 'castigo-fim', id },
    { type: 'ocupada', id }, { type: 'ocupada-fim', id }, { type: 'comunidade-queimada', id, lost: 10, to: id, by: 'castigo' }, { type: 'comunidade-queimada', id, lost: 10, to: null, by: 'pretor' },
    { type: 'comunidade-abandonada', id, to: id }, { type: 'denuncia', id },
  ];
  for (const ev of all) { const t = eventText(ev, s); assert.ok(typeof t === 'string' && t.includes(name), `${ev.type}: ${t}`); }
  assert.ok(eventText({ type: 'roma-atencao', from: 'rotina', to: 'castigo' }, s).length > 0);
  assert.ok(eventText({ type: 'recrutar-recusado', id, why: 'ocupada' }, s).includes(name));
  assert.ok(eventText({ type: 'recrutar-recusado', id, why: 'destruida' }, s).includes(name));
});

test('romeDay sem comunidades (estado parcial) não faz nada nem rebenta', () => {
  const s = calm(); delete s.communities;
  assert.deepEqual(romeDay(s, 0), []);
});

// ——— revisão do PR 4: casos-limite do tributo e da queima ———

const owing = (s, id = 'souto', food = 42, day = 102) => { const c = be(s.communities[id], 'amiga'); c.situation = 'tributada'; c.due = { food, day }; return c; };

test('tributo: sem comida para pagar tudo a ordem falha, nada muda, o pedido fica e o prazo continua a contar (não há pagamento parcial)', () => {
  const s = calm(), c = owing(s); c.food = 41; s.day = 98; ensureRome(s);
  const trust0 = c.trust;
  const ev = payTribute(s, 'souto');
  assert.deepEqual(ev, [{ type: 'tributo-sem-comida', id: c.settlement, food: 42, have: 41 }]);
  assert.deepEqual([c.food, c.trust, c.situation, c.due], [41, trust0, 'tributada', { food: 42, day: 102 }]);
  assert.equal(s.rome.attention, 0);
  days(s, 4);   // chega ao dia 102 sem pagar: castigo normal
  assert.equal(c.situation, 'castigada'); assert.equal(s.rome.attention, 10);
});

test('tributo: com exatamente a comida devida paga-se tudo e a reserva fica a zero; pagar zero nunca limpa a dívida', () => {
  const s = calm(), c = owing(s); c.food = 42;
  const ev = payTribute(s, 'souto');
  assert.deepEqual([c.food, c.due, c.situation, ev[0].food], [0, null, 'livre', 42]);
  const t = calm(), d = owing(t); d.food = 0;
  assert.equal(payTribute(t, 'souto')[0].type, 'tributo-sem-comida');
  assert.deepEqual([d.due, d.situation], [{ food: 42, day: 102 }, 'tributada']);
});

test('tributo: só se paga ou recusa uma aldeia tributada com pedido pendente', () => {
  const s = calm(), c = be(s.communities.souto, 'amiga'); c.food = 200;
  assert.deepEqual([payTribute(s, 'souto'), refuseTribute(s, 'souto'), payTribute(s, 'inventada')], [[], [], []]);
  c.due = { food: 42, day: 102 };   // pedido sem estar tributada (estado incoerente): ignora-se
  assert.deepEqual([payTribute(s, 'souto'), refuseTribute(s, 'souto')], [[], []]);
  assert.deepEqual([c.food, c.due], [200, { food: 42, day: 102 }]);
});

test('tributo: pagar antes do prazo evita o castigo e a atenção; passado o dia antigo nada acontece', () => {
  const s = calm(), c = owing(s, 'souto', 42, 102); c.food = 200; s.day = 100; ensureRome(s);
  step(s); assert.equal(s.day, 101);
  payTribute(s, 'souto');   // último dia para dar a ordem: state.day < due.day
  days(s, 5);
  assert.deepEqual([c.situation, s.rome.attention, c.food], ['livre', 0, 158]);
});

test('tributo: recusar antes do prazo castiga logo e o prazo antigo não castiga nem sobe a atenção uma segunda vez', () => {
  const s = calm(), c = owing(s, 'souto', 42, 102); s.day = 95; ensureRome(s);
  const ev = refuseTribute(s, 'souto');
  assert.deepEqual([c.situation, c.due, s.rome.attention], ['castigada', null, 10]);
  assert.deepEqual(evs(ev, 'roma-atencao'), [], 'continua na faixa de rotina');
  days(s, 12);   // passa o dia 102
  assert.equal(s.rome.attention, 4, 'subiu 10 uma só vez (não 20) e desceu 6 em 12 dias');
  assert.equal(c.situation, 'castigada', 'o castigo de 20 dias (desde o dia 95) ainda não acabou');
});

test('tributo: no dia do prazo já é tarde (a aldeia foi castigada ao virar o dia) e ordens a seguir não fazem nada', () => {
  const s = calm(), c = owing(s, 'souto', 42, 100); c.food = 200; s.day = 99;
  step(s); assert.equal(s.day, 100);
  assert.deepEqual(payTribute(s, 'souto'), []); assert.deepEqual([c.food, c.situation], [200, 'castigada']);
});

test('tributo: se Roma castiga por apoio uma aldeia tributada, o pedido cai e já não há prazo a cumprir', () => {
  const s = calm(), c = owing(s, 'souto'), p = places(s).souto; patrolAt(s, p);
  noteSupport(s, 'souto', 'homens');
  assert.deepEqual([c.situation, c.due], ['castigada', null]);
  days(s, 15); assert.equal(s.rome.attention, 0, 'sem prazo, sem segunda punição pelo mesmo tributo');
});

test('tributo: a aldeia queimada ou abandonada com pedido pendente perde o pedido', () => {
  const s = calm(); owing(s, 'souto'); burn(s, 'souto', 'pretor');
  assert.equal(s.communities.souto.due, null);
  const t = calm(); owing(t, 'vau'); abandon(t, 'vau'); assert.equal(t.communities.vau.due, null);
});

test('queima: os homens do bando que vinham da aldeia não desaparecem, mesmo que haja menos sobreviventes do que homens', () => {
  const s = calm(); s.men = 100;
  const vau = s.communities.vau; vau.away = 20;   // 25 famílias: arde, 15 sobrevivem, mas 20 homens são dela
  burn(s, 'vau', 'castigo');
  assert.equal(s.communities.souto.away, 20); assert.equal(vau.away, 0);
  assert.deepEqual(bandOrigins(s), { souto: 20, sem: 80 });
  assert.equal(s.men, 100);
});

test('queima: sem espaço na acolhedora (away ≤ famílias) o resto fica no bando sem origem; os homens contam todos', () => {
  const s = calm(); s.men = 100;
  const { vau, souto } = s.communities; vau.away = 20; souto.away = 30;   // o Souto já tem os 30 jovens… de 30 famílias: com os 15 que chegam, tem 45
  burn(s, 'vau', 'castigo');
  assert.equal(souto.families, 45); assert.equal(souto.away, 45, 'só cabem 15: 30 + 15');
  assert.equal(bandOrigins(s).sem, 100 - 45); assert.equal(s.men, 100);
  assert.ok(COMMUNITY_IDS.every(id => s.communities[id].away <= s.communities[id].families));
  assert.ok(COMMUNITY_IDS.reduce((n, id) => n + s.communities[id].away, 0) <= s.men);
  assert.ok(deserialize(serialize(s)));
});

test('queima: sem aldeia que acolha, os homens ficam no bando como «sem origem»', () => {
  const s = calm(); s.men = 40;
  for (const id of ['ribeira', 'penedo', 'souto', 'fonte']) { s.communities[id].situation = 'abandonada'; s.communities[id].families = 0; }
  s.communities.vau.away = 6;
  burn(s, 'vau', 'pretor');
  assert.deepEqual(bandOrigins(s), { sem: 40 }); assert.equal(s.men, 40);
});

test('abandono: os homens do bando e as famílias passam para a acolhedora, respeitando o espaço', () => {
  const s = calm(); s.men = 100;
  const { vau, souto } = s.communities; vau.families = 9; vau.away = 4; souto.away = 28;   // 30 famílias + 9 = 39: sobram 11 lugares
  abandon(s, 'vau');
  assert.equal(souto.families, 39); assert.equal(souto.away, 32);
  assert.deepEqual(bandOrigins(s), { souto: 32, sem: 68 });
  const t = calm(); t.men = 100; t.communities.vau.families = 9; t.communities.vau.away = 4; t.communities.souto.away = 30;
  abandon(t, 'vau');
  assert.equal(t.communities.souto.away, 34, 'cabem: 39 famílias');
});

test('texto: a ordem de pagar que falha por falta de comida diz quanto falta e nomeia a aldeia', () => {
  const s = calm(), id = s.communities.vau.settlement, name = 'Aldeia do Vau';   // o nome da comunidade, não o do lugar no mundo gerado (PR 5)
  const t = eventText({ type: 'tributo-sem-comida', id, food: 42, have: 30 }, s);
  assert.ok(t.includes(name) && t.includes('42') && t.includes('30'), t);
});

// ——— revisão final: as ordens só valem com state.day < due.day ———

test('prazo: payTribute e refuseTribute funcionam no dia anterior ao prazo', () => {
  const s = calm(), c = owing(s, 'souto', 42, 102); c.food = 200; s.day = 101;
  assert.equal(payTribute(s, 'souto')[0].type, 'tributo-pago'); assert.deepEqual([c.food, c.due, c.situation], [158, null, 'livre']);
  const t = calm(), d = owing(t, 'souto', 42, 102); t.day = 101;
  assert.equal(evs(refuseTribute(t, 'souto'), 'castigo').length, 1); assert.deepEqual([d.due, d.situation, t.rome.attention], [null, 'castigada', 10]);
});

test('prazo: no próprio dia do prazo, antes de romeDay, as duas ordens devolvem [] e não mudam nada', () => {
  for (const order of [payTribute, refuseTribute]) for (const day of [102, 103]) {
    const s = calm(), c = owing(s, 'souto', 42, 102); c.food = 200; s.day = day; ensureRome(s);
    const before = JSON.stringify(s);
    assert.deepEqual(order(s, 'souto'), [], `${order.name} no dia ${day}`);
    assert.equal(JSON.stringify(s), before, `${order.name} no dia ${day}: estado intacto`);
  }
});

test('prazo: romeDay castiga sozinho no dia do prazo, uma só vez, com a atenção a subir 10 uma só vez', () => {
  const s = calm(), c = owing(s, 'souto', 42, 102); s.day = 102; ensureRome(s);
  const ev = romeDay(s, 101);
  assert.equal(evs(ev, 'castigo').length, 1); assert.equal(evs(ev, 'castigo')[0].why, 'tributo');
  assert.deepEqual([c.situation, c.due, s.rome.attention], ['castigada', null, 10]);
  s.day = 103;   // o dia seguinte (ímpar: a atenção não desce): já não há pedido, nada de dupla punição
  assert.deepEqual(romeDay(s, 102), []);
  assert.equal(s.rome.attention, 10); assert.equal(c.until, 122);
  assert.equal(c.fear, Math.min(100, 30 + 25));
});

test('prazo: pelo stepDay, a ordem no último dia vale e a do dia do prazo já não', () => {
  const s = calm(), c = owing(s, 'souto', 42, 102); c.food = 200; s.day = 100;
  step(s); assert.equal(s.day, 101);
  assert.equal(payTribute(s, 'souto').length, 1);
  const t = calm(), d = owing(t, 'souto', 42, 102); d.food = 200; t.day = 101;
  step(t); assert.equal(t.day, 102);
  assert.deepEqual([payTribute(t, 'souto'), refuseTribute(t, 'souto')], [[], []]);
  assert.deepEqual([d.situation, t.rome.attention, d.food], ['castigada', 10, 200]);
});
