// M1.2 — legibilidade: regressões dos dois bugs da auditoria (vélites a oscilar; ocultação perdida para sempre)
// e a informação mostrada ao jogador (estado de exposição, descoberta com causa, sinal sem surpresa, marcha, relatório).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupOf } from '../src/tactical/sim.js';
import { WOODS } from '../src/tactical/proto/field.js';
import { createSession, defaultPlacement, placeGroup } from '../src/tactical/proto/session.js';

/** A Batalha 2 da auditoria (semente 2): Wolves deixados na orla norte, o resto escondido; aos 9 s os Wolves vão para o bosque. */
function battle2() {
  const p = defaultPlacement();
  placeGroup(p, 'javalis', 82, 35); placeGroup(p, 'corvos', 50, 35); placeGroup(p, 'fundeiros', 110, 42);
  const s = createSession({ seed: 2, placement: p });
  const events = [];
  const until = pred => { while (!s.battle.over && !pred()) events.push(...s.tick().map(e => ({ t: s.battle.t, ...e }))); };
  until(() => s.battle.t >= 9);
  s.order({ group: 'lobos', type: 'atacar', x: 50, y: 28 });
  return { s, events, until };
}
/** Quantas vezes a ordem de um grupo volta ao tipo de há duas ordens, em menos de 2 s (A → B → A). */
const flips = orders => orders.filter((o, i) => i >= 2 && o.type === orders[i - 2].type && o.type !== orders[i - 1].type && o.t - orders[i - 2].t <= 2).length;

test('vélites (semente 2): ao cerrar fileiras não alternam entre abrigo e ataque, e chegam a lançar dardos antes do sinal', () => {
  const { s, events, until } = battle2();
  until(() => s.progress() >= 0.68);   // o sinal da Batalha 2 foi dado com a coluna a 68 %
  assert.ok(events.some(e => e.type === 'cerra' && e.group === 'velites'), 'a coluna da semente 2 cerra fileiras (pré-condição)');
  const orders = s.battle.log.filter(l => l.side === 'romanos' && l.group === 'velites');
  assert.ok(flips(orders) <= 2, `ordens a alternar: ${flips(orders)} em ${orders.length}`);
  assert.ok(events.some(e => e.type === 'salva' && e.group === 'velites'), 'os vélites dispararam pelo menos uma salva antes do sinal');
});

test('ocultação: um grupo visto continua visto mesmo depois de entrar no bosque (regra mantida no M1.2)', () => {
  const { s, until } = battle2();
  until(() => s.columnAlerted());
  until(() => s.battle.t >= 40);   // os Wolves já chegaram ao bosque (50, 28)
  const wolves = groupOf(s.battle, 'lobos');
  assert.ok(Math.hypot(wolves.x - 50, wolves.y - 28) < 3, 'os Wolves estão no bosque');
  assert.equal(wolves.hidden, false);
  assert.equal(s.exposureOf('lobos'), 'seen');
  assert.equal(s.detectionRange('lobos'), null, 'quem já foi visto não tem alcance de deteção a mostrar');
});

test('ecrã: exposição e alcance de deteção — à vista 30 m, escondido no miolo do mato 6 m, e «visto» depois de descoberto', () => {
  const { s, events, until } = battle2();
  assert.equal(s.exposureOf('lobos'), 'exposed');
  assert.equal(s.detectionRange('lobos'), 30);
  assert.equal(s.exposureOf('javalis'), 'hidden');
  assert.ok(Math.abs(s.detectionRange('javalis') - 6) < 1e-9, `${s.detectionRange('javalis')}`);
  until(() => s.columnAlerted());
  assert.equal(s.exposureOf('lobos'), 'seen');
  assert.equal(s.exposureOf('javalis'), 'hidden', 'quem continua escondido continua escondido');
  const seen = events.find(e => e.type === 'avistado');
  assert.deepEqual([seen.group, seen.cause, seen.d], ['lobos', 'open', 30], 'a descoberta diz quem, porquê e a que distância');
  assert.equal(s.stats.seen[0].t, 16);
});

test('ecrã: descoberto no mato por passar perto diz a causa «cover» e a distância', () => {
  const p = defaultPlacement();
  placeGroup(p, 'lobos', 78, 43);   // orla sul do bosque w2, junto à estrada: escondido, mas a coluna passa perto
  placeGroup(p, 'javalis', 82, 35); placeGroup(p, 'corvos', 50, 35); placeGroup(p, 'fundeiros', 110, 42);
  const s = createSession({ seed: 2, placement: p });
  assert.equal(s.exposureOf('lobos'), 'hidden', 'pré-condição: começa escondido');
  const events = [];
  while (!s.battle.over && !s.stats.seen.length) events.push(...s.tick());
  const e = events.find(x => x.cause);
  assert.equal(e?.cause, 'cover', JSON.stringify(e));
  assert.equal(e.group, 'lobos');
  assert.ok(e.d > 0 && e.d < 30, `descoberto a ${e.d} m: mais perto do que os 30 m de quem está à vista`);
});

test('ecrã: a marcha romana diz quando retoma depois de parar, e passa a «em combate» no corpo a corpo', () => {
  const { s, until } = battle2();
  assert.equal(s.march().mode, 'marching');
  until(() => s.columnAlerted());
  until(() => s.battle.t >= 20);
  const m = s.march();
  assert.equal(m.mode, 'halted');
  assert.ok(m.resumeIn > 0 && m.resumeIn <= 15, JSON.stringify(m));
  until(() => s.battle.t >= 40);
  assert.notEqual(s.march().mode, 'halted', 'depois de esperar retoma a marcha');
  until(() => s.progress() >= 0.68);
  s.order({ type: 'sinal' });
  for (const id of ['lobos', 'javalis', 'corvos', 'fundeiros']) s.order({ group: id, type: 'atacar', target: 'retaguarda' });
  until(() => s.battle.groups.some(g => g.side === 'romanos' && g.engaged));
  assert.equal(s.march().mode, 'fighting');
});

test('ecrã: sinal dado depois de a coluna ver alguém não surpreende ninguém e fica marcado como tal no relatório', () => {
  const { s, until } = battle2();
  until(() => s.progress() >= 0.68);
  s.order({ type: 'sinal' });
  assert.equal(s.stats.signalSurprised, 0);
  for (const id of ['lobos', 'javalis', 'corvos', 'fundeiros']) s.order({ group: id, type: 'atacar', target: 'retaguarda' });
  until(() => false);
  const k = s.report().data.keyMoments;
  assert.ok(k.some(m => m.code === 'signalLate' && m.count === 0));
  assert.ok(!k.some(m => m.code === 'signal'));
});

test('relatório: até cinco momentos, por ordem cronológica, com tempo, sem duas reações romanas e sem o que não aconteceu', () => {
  const { s, until } = battle2();
  until(() => s.progress() >= 0.68);
  s.order({ type: 'sinal' });
  for (const id of ['lobos', 'javalis', 'corvos', 'fundeiros']) s.order({ group: id, type: 'atacar', target: 'retaguarda' });
  until(() => false);
  const k = s.report().data.keyMoments;
  assert.ok(k.length >= 3 && k.length <= 5, JSON.stringify(k));
  assert.ok(k.every((m, i) => typeof m.t === 'number' && (i === 0 || m.t >= k[i - 1].t)), 'por ordem cronológica');
  assert.equal(k[0].code, 'seen');
  assert.ok(k.filter(m => m.code === 'support' || m.code === 'hold').length <= 1, 'uma só reação romana');
  for (const m of k.filter(x => x.code === 'lost' || x.code === 'romanBroke')) {
    const b = s.stats.broke.find(x => x.group === m.group);
    assert.ok(b && Math.abs(b.t - m.t) < 0.1 && b.foes === m.foes, 'quem quebrou e contra quantos vem do registo da simulação');
  }
  assert.ok(!k.some(m => m.code === 'fallBack'), 'ninguém recuou nesta partida');
});

test('relatório: o recuo para o bosque entra no «Porquê» com o grupo e o tempo', () => {
  const { s, until } = battle2();
  until(() => s.progress() >= 0.68);
  s.order({ type: 'sinal' });
  s.order({ group: 'corvos', type: 'atacar', target: 'retaguarda' });
  until(() => s.battle.t >= s.stats.signalAt + 8);
  s.order({ group: 'corvos', type: 'retirar', x: WOODS[0].x, y: WOODS[0].y });
  const at = s.battle.t;
  until(() => false);
  const fb = s.report().data.keyMoments.find(m => m.code === 'fallBack');
  assert.ok(fb, JSON.stringify(s.report().data.keyMoments));
  assert.equal(fb.group, 'corvos');
  assert.ok(Math.abs(fb.t - at) < 0.1);
});

test('determinismo: a Batalha 2 com as mesmas ordens dá o mesmo relatório, incluindo os momentos do «Porquê»', () => {
  const play = () => {
    const { s, until } = battle2();
    until(() => s.progress() >= 0.68);
    s.order({ type: 'sinal' });
    for (const id of ['lobos', 'javalis', 'corvos', 'fundeiros']) s.order({ group: id, type: 'atacar', target: 'retaguarda' });
    until(() => false);
    return s.report().data;
  };
  assert.deepEqual(play(), play());
});
