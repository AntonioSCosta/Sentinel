import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DT } from '../src/tactical/data.js';
import { createBattle, command, step, run, summary, groupOf, OUTCOMES } from '../src/tactical/sim.js';
import { ambush, FIELD } from '../src/tactical/scenarios.js';

const SEEDS = Array.from({ length: 10 }, (_, i) => i + 1);
const EXITS = { lusitanos: [{ x: 0, y: -100 }], romanos: [{ x: 0, y: 100 }] };

/** Emboscada bem feita: sinal quando a cabeça da coluna passa x = 92, guerreiros dos dois lados, fundeiros nos vélites. */
function goodAmbush(b) {
  while (!b.over && groupOf(b, 'legionarios').x < 92) step(b);
  command(b, 'lusitanos', { type: 'sinal' });
  command(b, 'lusitanos', { group: 'guerreiros-norte', type: 'atacar', target: 'legionarios' });
  command(b, 'lusitanos', { group: 'guerreiros-sul', type: 'atacar', target: 'legionarios' });
  command(b, 'lusitanos', { group: 'fundeiros', type: 'atacar', target: 'velites' });
}

/** Um grupo de guerreiros contra legionários parados, alerta e virados para ele: carga frontal sem surpresa. */
function frontalCharge(seed) {
  const b = createBattle({ seed, exits: EXITS, groups: [
    { id: 'g', role: 'guerreiro', men: 5, x: 0, y: -30, facing: Math.PI / 2 },
    { id: 'l', role: 'legionario', men: 6, x: 0, y: 0, facing: -Math.PI / 2 },
  ] });
  groupOf(b, 'l').alerted = true;
  command(b, 'lusitanos', { group: 'g', type: 'atacar', target: 'l' });
  return b;
}

/** Corre a batalha e verifica, passo a passo, que cada lado conserva os homens. */
function runChecked(b) {
  const sides = ['lusitanos', 'romanos'];
  const start = Object.fromEntries(sides.map(s => [s, summary(b)[s].start]));
  while (!b.over) {
    step(b);
    const s = summary(b);
    for (const side of sides) {
      const c = s[side];
      assert.equal(c.start, start[side], 'o total inicial não muda');
      assert.equal(c.alive + c.dead + c.fled + c.withdrawn + c.escaped, c.start, `homens conservados (${side}, t=${b.t})`);
    }
    for (const g of b.groups) assert.ok(Number.isInteger(g.men) && g.men >= 0 && g.men <= g.start, `homens inteiros em ${g.id}`);
  }
  return summary(b);
}

test('createBattle: o lado vem do papel; dados inválidos são recusados', () => {
  const b = ambush(1);
  assert.equal(groupOf(b, 'legionarios').side, 'romanos');
  assert.equal(groupOf(b, 'fundeiros').side, 'lusitanos');
  const one = { id: 'a', role: 'guerreiro', men: 3, x: 0, y: 0 };
  assert.throws(() => createBattle({ seed: 1, exits: EXITS, groups: [{ ...one, role: 'arqueiro' }] }), /papel/);
  assert.throws(() => createBattle({ seed: 1, exits: EXITS, groups: [one, one] }), /repetido/);
  assert.throws(() => createBattle({ seed: 1, exits: { lusitanos: EXITS.lusitanos }, groups: [one] }), /saídas/);
});

test('o passo é fixo: 10 passos são 1 segundo de jogo', () => {
  const b = ambush(1);
  for (let i = 0; i < 10; i++) step(b);
  assert.equal(b.t, Math.round(10 * DT * 1000) / 1000);
});

test('determinismo: mesma semente e mesmas ordens dão os mesmos acontecimentos e o mesmo resultado', () => {
  for (const seed of SEEDS) {
    const play = () => { const b = ambush(seed); goodAmbush(b); const ev = run(b); return { ev, s: summary(b) }; };
    assert.deepEqual(play(), play());
  }
});

test('determinismo: o registo de ordens chega para repetir a batalha', () => {
  const a = ambush(7);
  goodAmbush(a);
  run(a);
  const b = ambush(7), queue = [...a.log];
  while (!b.over) {
    while (queue.length && queue[0].t <= b.t + 1e-9) { const { t, side, ...cmd } = queue.shift(); assert.ok(command(b, side, cmd).ok); }
    step(b);
  }
  assert.deepEqual(summary(b), summary(a));
});

test('sementes diferentes dão batalhas diferentes (a variação dos golpes depende da semente)', () => {
  const logs = SEEDS.map(seed => { const b = ambush(seed); goodAmbush(b); return JSON.stringify(run(b)); });
  assert.ok(new Set(logs).size > 1);
});

test('conservação de homens em todos os desfechos', () => {
  for (const seed of SEEDS) {
    const good = ambush(seed); goodAmbush(good); runChecked(good);
    runChecked(ambush(seed));                 // ninguém se mexe: a coluna passa
    runChecked(frontalCharge(seed));
    const back = ambush(seed); command(back, 'lusitanos', { type: 'sinal' });
    for (const id of ['guerreiros-norte', 'guerreiros-sul', 'fundeiros']) command(back, 'lusitanos', { group: id, type: 'retirar' });
    runChecked(back);
  }
});

test('fim: vitória numa boa emboscada', () => {
  for (const seed of SEEDS) {
    const b = ambush(seed); goodAmbush(b);
    const s = runChecked(b);
    assert.equal(s.outcome, 'vitoria');
    assert.equal(s.romanos.alive + s.romanos.escaped, 0);
  }
});

test('fim: a coluna escapa se o bando nunca dá o sinal; os escondidos não fazem nada', () => {
  const b = ambush(3);
  const s = runChecked(b);
  assert.equal(s.outcome, 'escapou');
  assert.equal(s.romanos.escaped, 8);
  assert.equal(s.lusitanos.dead, 0);
  assert.ok(b.groups.filter(g => g.side === 'lusitanos').every(g => g.hidden));
});

test('fim: derrota numa carga frontal contra legionários em ordem', () => {
  for (const seed of SEEDS) {
    const s = runChecked(frontalCharge(seed));
    assert.equal(s.outcome, 'derrota');
    assert.ok(s.lusitanos.dead > s.romanos.dead);
  }
});

test('fim: retirada quando todos os grupos saem em ordem', () => {
  const b = ambush(2);
  command(b, 'lusitanos', { type: 'sinal' });
  for (const id of ['guerreiros-norte', 'guerreiros-sul', 'fundeiros']) assert.ok(command(b, 'lusitanos', { group: id, type: 'retirar' }).ok);
  const s = runChecked(b);
  assert.equal(s.outcome, 'retirada');
  assert.equal(s.lusitanos.withdrawn, 14);
});

test('fim: o tempo máximo fecha uma batalha parada', () => {
  const b = createBattle({ seed: 1, maxTime: 5, exits: EXITS, groups: [
    { id: 'g', role: 'guerreiro', men: 3, x: 0, y: -60 }, { id: 'l', role: 'legionario', men: 3, x: 0, y: 60 },
  ] });
  const s = runChecked(b);
  assert.equal(s.outcome, 'tempo');
  assert.equal(s.t, 5);
  assert.ok(OUTCOMES.includes(s.outcome));
});

test('rotura: um grupo que perde homens demais debanda e foge pela saída', () => {
  const b = frontalCharge(4);
  const ev = run(b);
  const broke = ev.find(e => e.type === 'quebrou' && e.group === 'g');
  assert.ok(broke, 'os guerreiros quebram');
  const g = groupOf(b, 'g');
  assert.equal(g.left, 'fugiu');
  assert.ok(g.dead / g.start >= 0.7);
});

test('escondidos: aceitam ordens mas só as cumprem depois do sinal', () => {
  const b = ambush(1);
  const g = groupOf(b, 'guerreiros-norte'), x0 = g.x, y0 = g.y;
  assert.ok(command(b, 'lusitanos', { group: g.id, type: 'atacar', x: 20, y: 20 }).ok);
  run(b, 3);
  assert.deepEqual([g.x, g.y], [x0, y0]);
  command(b, 'lusitanos', { type: 'sinal' });
  run(b, 1);
  assert.ok(!g.hidden);
  assert.notDeepEqual([g.x, g.y], [x0, y0]);
});

test('sinal: só uma vez; apanha de surpresa os romanos que ainda não estavam alerta', () => {
  const b = ambush(1);
  assert.equal(groupOf(b, 'legionarios').disorderT, 0);
  assert.deepEqual(command(b, 'lusitanos', { type: 'sinal' }), { ok: true });
  assert.ok(groupOf(b, 'legionarios').disorderT > 0);
  assert.ok(groupOf(b, 'legionarios').alerted);
  assert.deepEqual(command(b, 'lusitanos', { type: 'sinal' }), { ok: false, why: 'sinal-dado' });
});

test('descoberta: um grupo escondido no caminho da coluna é encontrado, e quem o encontra não fica surpreendido', () => {
  const b = ambush(1, { lusitanos: [{ id: 'na-estrada', role: 'guerreiro', men: 5, x: 60, y: FIELD.roadY }] });
  const ev = run(b, 60);
  const found = ev.find(e => e.type === 'revelado' && e.group === 'na-estrada');
  assert.ok(found);
  assert.ok(['legionarios', 'velites'].includes(found.by));
  const finder = groupOf(b, found.by);
  assert.ok(finder.alerted);
});

test('carga: só quem corre ≥ 8 m até ao contacto ganha a carga; quem marcha não', () => {
  const b = ambush(1); goodAmbush(b);
  const charges = run(b).filter(e => e.type === 'carga');
  assert.ok(charges.some(e => e.group.startsWith('guerreiros')));
  assert.ok(!charges.some(e => e.group === 'legionarios' || e.group === 'velites'));
});

test('ordens inválidas são recusadas sem mexer em nada', () => {
  const b = ambush(1);
  const before = JSON.stringify(b.groups);
  assert.equal(command(b, 'lusitanos', { group: 'legionarios', type: 'manter' }).why, 'grupo');
  assert.equal(command(b, 'lusitanos', { group: 'ninguem', type: 'manter' }).why, 'grupo');
  assert.equal(command(b, 'lusitanos', { group: 'fundeiros', type: 'atacar', target: 'guerreiros-sul' }).why, 'alvo');
  assert.equal(command(b, 'lusitanos', { group: 'fundeiros', type: 'dançar' }).why, 'ordem');
  assert.equal(command(b, 'lusitanos', { group: 'fundeiros', type: 'mover', path: [] }).why, 'caminho');
  assert.equal(command(b, 'gauleses', { type: 'sinal' }).why, 'lado');
  assert.equal(JSON.stringify(b.groups), before);
  assert.equal(b.log.length, 0);
  run(b);
  assert.equal(command(b, 'lusitanos', { group: 'fundeiros', type: 'manter' }).why, 'acabou');
});

test('jogabilidade: a carga frontal custa pelo menos o dobro dos homens de uma boa emboscada', () => {
  // mesma força (14 homens); na frontal, sinal logo no início e todos aos legionários, sem esperar pela coluna
  let ambushLoss = 0, frontalLoss = 0;
  for (const seed of SEEDS) {
    const a = ambush(seed); goodAmbush(a); run(a); ambushLoss += summary(a).lusitanos.dead;
    const f = ambush(seed); command(f, 'lusitanos', { type: 'sinal' });
    for (const id of ['guerreiros-norte', 'guerreiros-sul', 'fundeiros']) command(f, 'lusitanos', { group: id, type: 'atacar', target: 'legionarios' });
    run(f); frontalLoss += summary(f).lusitanos.dead;
  }
  assert.ok(frontalLoss >= 2 * Math.max(1, ambushLoss), `frontal ${frontalLoss} vs emboscada ${ambushLoss}`);
});
