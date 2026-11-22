import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, groupOf, reveal, alert, step } from '../src/tactical/sim.js';
import { FIELD, WOODS, ROAD, EXITS, coverAt, concealAt, canPlace, nearestPlaceable, roadDistance, roadPoint, roadAhead } from '../src/tactical/proto/field.js';
import { createRomanStub } from '../src/tactical/proto/roman-stub.js';
import { createSession, defaultPlacement, placeGroup, toggleRole, startsHidden } from '../src/tactical/proto/session.js';

const SEEDS = [1, 2, 3, 4, 5];
const runToEnd = s => { while (!s.battle.over) s.tick(); return s.report(); };
const until = (s, pred) => { while (!s.battle.over && !pred()) s.tick(); };

/** Tenaz: guerreiros nos bosques dos dois lados, fundeiros a norte; sinal quando os vélites passam o meio. */
function pincer(seed) {
  const p = defaultPlacement();
  placeGroup(p, 'lobos', 82, 35); placeGroup(p, 'javalis', 70, 73); placeGroup(p, 'corvos', 100, 79); placeGroup(p, 'fundeiros', 110, 42);
  const s = createSession({ seed, placement: p });
  until(s, () => groupOf(s.battle, 'velites').x >= 76);
  s.order({ type: 'sinal' });
  s.order({ group: 'lobos', type: 'atacar', target: 'velites' });
  s.order({ group: 'javalis', type: 'atacar', target: 'retaguarda' });
  s.order({ group: 'corvos', type: 'atacar', target: 'retaguarda' });
  s.order({ group: 'fundeiros', type: 'atacar', target: 'vanguarda' });
  return s;
}

/** Ataque à retaguarda: deixar a vanguarda passar e cair sobre o fim da coluna. */
function rear(seed) {
  const p = defaultPlacement();
  placeGroup(p, 'lobos', 50, 31); placeGroup(p, 'javalis', 70, 73); placeGroup(p, 'corvos', 82, 35); placeGroup(p, 'fundeiros', 100, 79);
  const s = createSession({ seed, placement: p });
  until(s, () => groupOf(s.battle, 'retaguarda').x >= 62);
  s.order({ type: 'sinal' });
  for (const id of ['lobos', 'javalis', 'corvos']) s.order({ group: id, type: 'atacar', target: 'retaguarda' });
  s.order({ group: 'fundeiros', type: 'atacar', target: 'velites' });
  return s;
}

/** Carga frontal imediata a partir da orla, sem esperar nem esconder. */
function frontal(seed) {
  const s = createSession({ seed });
  s.order({ type: 'sinal' });
  for (const id of ['lobos', 'javalis', 'corvos', 'fundeiros']) s.order({ group: id, type: 'atacar', target: 'vanguarda' });
  return s;
}

/** A mesma tenaz, mas com os grupos em campo aberto junto à estrada, à vista. */
function exposed(seed) {
  const p = defaultPlacement();
  for (const g of p) placeGroup(p, g.id, g.x, 42);
  const s = createSession({ seed, placement: p });
  until(s, () => groupOf(s.battle, 'velites').x >= 76);
  s.order({ type: 'sinal' });
  s.order({ group: 'lobos', type: 'atacar', target: 'velites' });
  s.order({ group: 'javalis', type: 'atacar', target: 'retaguarda' });
  s.order({ group: 'corvos', type: 'atacar', target: 'retaguarda' });
  s.order({ group: 'fundeiros', type: 'atacar', target: 'vanguarda' });
  return s;
}

// --- campo ---

test('campo: o miolo dos bosques dá cobertura e esconde; a estrada não', () => {
  const w = WOODS[0];
  assert.equal(coverAt(w.x, w.y), 1);
  assert.equal(concealAt(w.x, w.y), 1);
  const r = roadPoint(60);
  assert.equal(coverAt(r.x, r.y), 0);
  assert.ok(coverAt(w.x + w.r * 0.8, w.y) > 0 && coverAt(w.x + w.r * 0.8, w.y) < 1, 'a orla dá cobertura parcial');
});

test('campo: não se coloca ninguém na estrada, junto à entrada da coluna, nem fora do campo', () => {
  const r = roadPoint(80);
  assert.ok(!canPlace(r.x, r.y));
  assert.ok(!canPlace(10, 20));
  assert.ok(!canPlace(80, -3));
  assert.ok(canPlace(WOODS[1].x, WOODS[1].y));
  const p = nearestPlaceable(r.x, r.y);
  assert.ok(canPlace(p.x, p.y));
  assert.ok(roadDistance(p.x, p.y) >= 8 - 1e-9);
});

test('campo: roadPoint segue o eixo e roadAhead dá os pontos que faltam', () => {
  const a = roadPoint(0);
  assert.deepEqual([a.x, a.y], [ROAD[0].x, ROAD[0].y]);
  assert.ok(roadAhead(50).every(p => p.x > 51));
  assert.equal(roadAhead(FIELD.w + 10).length, 0);
});

// --- novas primitivas da simulação ---

test('reveal: tira um grupo do esconderijo e põe em alerta quem o viu, sem surpresa', () => {
  const b = createBattle({ seed: 1, exits: EXITS, groups: [
    { id: 'h', role: 'guerreiro', men: 3, x: 50, y: 30, hidden: true }, { id: 'r', role: 'legionario', men: 3, x: 50, y: 50 },
  ] });
  assert.equal(reveal(b, 'h', 'r'), true);
  assert.equal(groupOf(b, 'h').hidden, false);
  assert.equal(groupOf(b, 'r').alerted, true);
  assert.equal(groupOf(b, 'r').disorderT, 0);
  assert.equal(reveal(b, 'h', 'r'), false, 'segunda vez não muda nada');
  assert.equal(reveal(b, 'ninguem'), false);
});

test('alert: põe em alerta sem desordem, uma vez', () => {
  const b = createBattle({ seed: 1, exits: EXITS, groups: [{ id: 'r', role: 'legionario', men: 3, x: 50, y: 50 }] });
  assert.equal(alert(b, 'r'), true);
  assert.equal(alert(b, 'r'), false);
  assert.equal(groupOf(b, 'r').disorderT, 0);
});

// --- reação romana provisória ---

test('reação romana: um grupo escondido em campo aberto junto à estrada é descoberto; no mato, não', () => {
  const groups = [
    { id: 'aberto', role: 'guerreiro', men: 3, x: 40, y: 44, hidden: true },
    { id: 'mato', role: 'guerreiro', men: 3, x: WOODS[1].x, y: WOODS[1].y, hidden: true },
    { id: 'r', role: 'legionario', men: 5, x: 30, y: 56, order: { type: 'mover', path: roadAhead(30), pace: 'marcha', leave: true } },
  ];
  const b = createBattle({ seed: 1, exits: EXITS, groups, coverAt });
  const stub = createRomanStub(), seen = [];
  while (!b.over && b.t < 120) { step(b); seen.push(...stub.update(b)); }
  assert.ok(seen.some(e => e.type === 'descoberto' && e.group === 'aberto'));
  assert.ok(!seen.some(e => e.type === 'descoberto' && e.group === 'mato'));
});

test('reação romana: grupos à vista perto da coluna tiram-lhe a surpresa do sinal', () => {
  const p = defaultPlacement();
  for (const g of p) placeGroup(p, g.id, g.x, 42);
  const s = createSession({ seed: 1, placement: p });
  until(s, () => groupOf(s.battle, 'velites').x >= 76);
  assert.ok(s.battle.groups.filter(g => g.side === 'romanos').every(g => g.alerted));
  s.order({ type: 'sinal' });
  assert.ok(s.battle.groups.filter(g => g.side === 'romanos').every(g => g.disorderT === 0));
});

test('reação romana: depois de atacados, os romanos dão ordens próprias e resistem', () => {
  const s = pincer(1);
  runToEnd(s);
  assert.ok(s.battle.log.some(e => e.side === 'romanos'), 'há ordens romanas no registo');
  assert.ok(s.report().data.lusitanians.dead > 0, 'a vitória custa homens');
});

test('reação romana: sem ninguém à vista a coluna passa e escapa', () => {
  const p = defaultPlacement();
  placeGroup(p, 'lobos', 82, 35); placeGroup(p, 'javalis', 70, 73); placeGroup(p, 'corvos', 100, 79); placeGroup(p, 'fundeiros', 110, 42);
  const r = runToEnd(createSession({ seed: 2, placement: p }));
  assert.equal(r.data.outcome, 'escapou');
  assert.equal(r.data.romans.escaped, r.data.romans.start);
});

// --- sessão ---

test('sessão: colocação em mato começa escondida, em campo aberto à vista; papéis trocam-se na preparação', () => {
  const p = defaultPlacement();
  assert.ok(!startsHidden(p[0].x, p[0].y), 'a orla norte é campo aberto');
  placeGroup(p, 'lobos', WOODS[1].x, WOODS[1].y);
  assert.ok(startsHidden(p[0].x, p[0].y));
  assert.ok(toggleRole(p, 'lobos'));
  assert.equal(p[0].role, 'fundeiro');
  assert.throws(() => createSession({ seed: 1, placement: [{ ...p[0], x: 80, y: 53 }] }), /colocação/);
});

test('sessão: determinista — mesma semente, colocação e ordens dão o mesmo relatório', () => {
  for (const seed of SEEDS) assert.deepEqual(runToEnd(pincer(seed)).data, runToEnd(pincer(seed)).data);
});

test('sessão: o relatório traz desfecho, sinal, contas que fecham e um JSON legível', () => {
  const r = runToEnd(pincer(1));
  assert.match(r.text, /Outcome: vitoria/);
  assert.match(r.text, /Signal: [\d.]+s \(column at \d+%\)/);
  const json = JSON.parse(r.text.slice(r.text.indexOf('{')));
  assert.deepEqual(json, r.data);
  for (const side of ['lusitanians', 'romans']) {
    const c = r.data[side];
    assert.equal(c.alive + c.dead + c.fled + c.withdrawn + c.escaped, c.start);
  }
  assert.ok(r.data.signalAt > 0 && r.data.combatSeconds > 0);
});

// --- jogabilidade (afinação do protótipo M1.1) ---

const SEEDS20 = Array.from({ length: 20 }, (_, i) => i + 1);
const tally = (make, after = runToEnd) => {
  const out = {};
  for (const seed of SEEDS20) { const s = make(seed); after(s); while (!s.battle.over) s.tick(); const o = s.report().data.outcome; out[o] = (out[o] || 0) + 1; }
  return out;
};
const nearestWood = g => WOODS.reduce((b, w) => (!b || Math.hypot(g.x - w.x, g.y - w.y) < Math.hypot(g.x - b.x, g.y - b.y) ? w : b), null);
/** Recuar todos os grupos para o bosque w2 aos `secs` segundos e esperar lá; quem estiver livre ataca um romano que entre no mato, sem o perseguir para fora. */
function fallBackToWoods(secs) {
  return s => {
    const t0 = s.battle.t, w = WOODS[1];
    until(s, () => s.battle.t >= t0 + secs);
    const mine = () => s.battle.groups.filter(g => g.side === 'lusitanos' && g.left === null && g.state === 'ativo' && !g.hidden);
    for (const g of mine()) s.order({ group: g.id, type: 'retirar', x: w.x, y: w.y });
    while (!s.battle.over) {
      const t1 = s.battle.t; until(s, () => s.battle.t >= t1 + 1);
      const inWoods = s.battle.groups.find(g => g.side === 'romanos' && g.left === null && g.state === 'ativo' && g.rough);
      for (const g of mine()) {
        if (g.engaged || g.order.type === 'retirar') continue;
        if (inWoods) s.order({ group: g.id, type: 'atacar', target: inWoods.id });
        else if (g.order.type === 'atacar' && g.order.target) s.order({ group: g.id, type: 'retirar', x: w.x, y: w.y });   // não perseguir para fora do mato
      }
    }
  };
}

test('jogabilidade: a tenaz é forte mas não é uma vitória automática', () => {
  const out = tally(pincer);
  assert.ok((out.vitoria || 0) >= 12, JSON.stringify(out));
  assert.ok((out.vitoria || 0) < 20, `a tenaz sem ordens depois do sinal não pode ganhar sempre: ${JSON.stringify(out)}`);
});

test('jogabilidade: uma decisão a meio do combate (recuar para o bosque) salva uma carga frontal falhada', () => {
  const stay = tally(frontal), back = tally(frontal, fallBackToWoods(10));
  assert.ok((stay.derrota || 0) >= 18, `sem decisão: ${JSON.stringify(stay)}`);
  assert.ok((back.derrota || 0) <= 3, `com a decisão: ${JSON.stringify(back)}`);
  assert.ok((back.vitoria || 0) >= 5, `com a decisão há vitórias: ${JSON.stringify(back)}`);
});

test('jogabilidade: esperar no mato sem combater não ganha — a coluna segue caminho', () => {
  const turtle = seed => {
    const p = defaultPlacement();
    placeGroup(p, 'lobos', 82, 35); placeGroup(p, 'javalis', 78, 30); placeGroup(p, 'corvos', 86, 38); placeGroup(p, 'fundeiros', 80, 40);
    const s = createSession({ seed, placement: p });
    until(s, () => groupOf(s.battle, 'velites').x >= 76);
    s.order({ type: 'sinal' });
    return s;
  };
  const out = tally(turtle);
  assert.ok((out.escapou || 0) >= 15, JSON.stringify(out));
});

test('jogabilidade: duas estratégias diferentes ganham na maioria das sementes; a frontal perde mais do que ganha', () => {
  for (const make of [pincer, rear]) assert.ok((tally(make).vitoria || 0) >= 12);
  const out = tally(frontal);
  assert.ok((out.vitoria || 0) < (out.derrota || 0) + (out.escapou || 0), JSON.stringify(out));
});

// M1.2: com os vélites corrigidos (já não abandonam a coluna a meio da luta), «à vista» deixou de perder pelo desfecho
// «escapou» e passou a ganhar parte das vezes — mas a um custo muito maior do que esconder-se. É isso que se exige aqui.
test('jogabilidade: jogar à vista custa muito mais homens e ganha menos do que a tenaz escondida', () => {
  const losses = make => SEEDS20.reduce((n, seed) => { const s = make(seed); runToEnd(s); return n + s.report().data.lusitanians.dead; }, 0);
  assert.ok(losses(exposed) >= 1.5 * losses(pincer), `baixas à vista ${losses(exposed)} contra ${losses(pincer)} na tenaz`);
  assert.ok((tally(exposed).vitoria || 0) < (tally(pincer).vitoria || 0));
});

test('jogabilidade: o combate de uma boa emboscada dura entre 30 s e 4 min', () => {
  for (const seed of SEEDS) {
    const r = runToEnd(rear(seed)).data;
    assert.ok(r.combatSeconds >= 30 && r.combatSeconds <= 240, `semente ${seed}: ${r.combatSeconds}s`);
  }
});

test('reação romana: alerta mas sem ninguém à vista, a coluna retoma a marcha pela estrada', () => {
  const b = createBattle({ seed: 1, exits: EXITS, coverAt, groups: [
    { id: 'r', role: 'legionario', men: 5, x: 60, y: 49 }, { id: 'longe', role: 'guerreiro', men: 3, x: 150, y: 104 },
  ] });
  alert(b, 'r');
  const stub = createRomanStub();
  for (let i = 0; i < 10; i++) { step(b); stub.update(b); }
  const o = groupOf(b, 'r').order;
  assert.equal(o.type, 'mover');
  assert.ok(o.leave && o.path.every(p => p.x > 60));
});
