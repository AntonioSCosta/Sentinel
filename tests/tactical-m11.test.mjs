import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, TUNING } from '../src/tactical/data.js';
import { takenMult, meleeDamage } from '../src/tactical/combat.js';
import { createBattle, command, step, run, groupOf, alert } from '../src/tactical/sim.js';
import { createRomanStub } from '../src/tactical/proto/roman-stub.js';
import { createSession, columnVariant } from '../src/tactical/proto/session.js';
import { WOODS, EXITS, coverAt } from '../src/tactical/proto/field.js';

const W = WOODS[1];   // bosque w2
const grp = (role, extra = {}) => ({ role, side: ROLES[role].side, men: 5, x: 0, y: 0, facing: 0, state: 'ativo', disorderT: 0, chargeT: 0, rough: false, ...extra });
const battle = (groups, extra = {}) => createBattle({ seed: 1, exits: EXITS, coverAt, groups, ...extra });

// --- o mato desfaz a formação ---

test('combate: legionários em terreno difícil perdem o escudo da frente; quem não luta em formação não muda', () => {
  const front = { x: 10, y: 0 };
  assert.equal(takenMult(grp('legionario'), front, false), ROLES.legionario.shieldFront);
  assert.equal(takenMult(grp('legionario', { rough: true }), front, false), 1);
  assert.equal(takenMult(grp('legionario', { rough: true }), front, true), 1);
  assert.equal(takenMult(grp('guerreiro', { rough: true }), front, false), ROLES.guerreiro.shieldFront);
});

test('combate: os bónus juntos (carga × surpresa × costas) nunca passam de maxMult', () => {
  const target = grp('legionario', { x: 3, facing: 0, disorderT: 5 });   // de costas para quem ataca e surpreendido
  const g = grp('guerreiro', { x: 0, chargeT: 2, facing: 0, men: 4 });
  const plain = 4 * ROLES.guerreiro.melee * 0.1;
  assert.ok(Math.abs(meleeDamage(g, target, 0.1) - plain * TUNING.maxMult) < 1e-12);
});

test('simulação: entrar no mato marca o grupo como «rough» e anuncia a formação desfeita', () => {
  const b = battle([{ id: 'l', role: 'legionario', men: 5, x: W.x - 25, y: W.y, order: { type: 'atacar', x: W.x, y: W.y } }, { id: 'g', role: 'guerreiro', men: 2, x: 150, y: 100 }]);
  const ev = run(b, 15);
  assert.ok(ev.some(e => e.type === 'terreno' && e.group === 'l' && e.rough === true));
  assert.equal(groupOf(b, 'l').rough, true);
});

test('simulação: um ataque pelo flanco é anunciado uma vez por alvo', () => {
  const b = battle([{ id: 'r', role: 'legionario', men: 5, x: 50, y: 60, facing: 0 }, { id: 'g', role: 'guerreiro', men: 4, x: 50, y: 50, facing: Math.PI / 2 }]);
  groupOf(b, 'r').alerted = true;
  command(b, 'lusitanos', { group: 'g', type: 'atacar', target: 'r' });
  const ev = run(b, 3);
  const flanks = ev.filter(e => e.type === 'flanco' && e.group === 'g');
  assert.equal(flanks.length, 1);
  assert.ok(['flanco', 'costas'].includes(flanks[0].side));
});

// --- recuar para um ponto ---

test('retirar para um ponto: larga o combate, recua, fica no campo a manter; sem ponto continua a sair do campo', () => {
  const b = battle([{ id: 'g', role: 'guerreiro', men: 4, x: 50, y: 50 }, { id: 'r', role: 'legionario', men: 5, x: 50, y: 53.5 }]);
  groupOf(b, 'r').alerted = true;
  step(b);
  assert.ok(groupOf(b, 'g').engaged, 'começam em corpo a corpo');
  assert.ok(command(b, 'lusitanos', { group: 'g', type: 'retirar', x: W.x, y: W.y }).ok);
  const ev = run(b, 20);
  const g = groupOf(b, 'g');
  assert.ok(ev.some(e => e.type === 'recuou' && e.group === 'g'));
  assert.equal(g.left, null);
  assert.equal(g.order.type, 'manter');
  assert.ok(Math.hypot(g.x - W.x, g.y - W.y) <= TUNING.arrive + 1e-9);
  assert.equal(command(b, 'lusitanos', { group: 'g', type: 'retirar', x: NaN, y: 3 }).why, 'alvo');
  assert.ok(command(b, 'lusitanos', { group: 'g', type: 'retirar' }).ok);
  run(b, 60);
  assert.equal(g.left, 'retirou');
});

// --- reação romana ---

test('reação romana: o temperamento sai da semente — igual para a mesma semente, variado entre sementes', () => {
  const tempers = seed => { const s = createSession({ seed }); s.tick(); return ['vanguarda', 'retaguarda'].map(id => s.temperOf(id)).join(','); };
  assert.equal(tempers(7), tempers(7));
  const seen = new Set(Array.from({ length: 20 }, (_, i) => tempers(i + 1)).flatMap(t => t.split(',')));
  assert.deepEqual([...seen].sort(), ['agressivo', 'cauteloso']);
});

/** Um legionário alerta perto de um bosque com um grupo lusitano lá dentro; `temper` força o temperamento. */
function woodsScene(temper, retreating) {
  const b = battle([
    { id: 'r', role: 'legionario', men: 5, x: W.x, y: W.y + 22 },
    { id: 'g', role: 'guerreiro', men: 2, x: W.x, y: W.y + 9 },
  ]);
  alert(b, 'r');
  const stub = createRomanStub({ ...createRomanStub.defaults, every: 1, spotOpen: 30, spotCover: 6, alertedSpot: 1.3, engage: 18, halt: 45, skirmish: 32, support: 40, pursue: 40, weak: 0.5, aggressive: temper === 'agressivo' ? 1 : 0, holdFor: 15, closeRanks: 0 });
  if (retreating) command(b, 'lusitanos', { group: 'g', type: 'retirar', x: W.x, y: W.y });
  const ev = [];
  for (let i = 0; i < 80; i++) { step(b); ev.push(...stub.update(b)); }
  return { b, ev };
}

test('reação romana: os agressivos perseguem quem recua, mesmo para dentro do mato', () => {
  const { b, ev } = woodsScene('agressivo', true);
  assert.ok(ev.some(e => e.type === 'persegue' && e.group === 'r' && e.target === 'g'));
  assert.ok(groupOf(b, 'r').rough || groupOf(b, 'r').engaged, 'entraram no mato ou chegaram ao contacto');
});

test('reação romana: ninguém entra no mato atrás de quem lá espera sem recuar', () => {
  for (const temper of ['agressivo', 'cauteloso']) {
    const { b } = woodsScene(temper, false);
    assert.ok(!groupOf(b, 'r').rough, `${temper}: ficou fora do mato`);
  }
});

test('reação romana: um grupo livre vai apoiar o aliado atacado, sobre quem o está a flanquear', () => {
  const b = battle([
    { id: 'aliado', role: 'legionario', men: 5, x: 60, y: 56, facing: 0 },
    { id: 'livre', role: 'legionario', men: 5, x: 30, y: 56, facing: 0 },
    { id: 'g', role: 'guerreiro', men: 4, x: 60, y: 51, facing: Math.PI / 2 },
    { id: 'longe', role: 'guerreiro', men: 1, x: 150, y: 104 },
  ]);
  for (const id of ['aliado', 'livre']) alert(b, id);
  command(b, 'lusitanos', { group: 'g', type: 'atacar', target: 'aliado' });
  const stub = createRomanStub(), ev = [];
  for (let i = 0; i < 40; i++) { step(b); ev.push(...stub.update(b)); }
  assert.ok(ev.some(e => e.type === 'apoio' && e.group === 'livre' && e.target === 'g'), JSON.stringify(ev));
});

// --- variedade da coluna ---

test('coluna: a ordem de marcha sai da semente, é estável e varia entre sementes', () => {
  assert.equal(columnVariant(3), columnVariant(3));
  assert.ok(new Set(Array.from({ length: 30 }, (_, i) => columnVariant(i + 1))).size >= 2);
  const s = createSession({ seed: 5 });
  assert.equal(s.report().data.columnOrder, columnVariant(5));
});
