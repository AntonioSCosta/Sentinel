import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, command, step, run, summary, groupOf } from '../src/tactical/sim.js';
import { ambush } from '../src/tactical/scenarios.js';

const EXITS = { lusitanos: [{ x: 0, y: -100 }], romanos: [{ x: 0, y: 100 }] };
const one = (extra = {}) => ({ id: 'a', role: 'guerreiro', men: 3, x: 0, y: 0, ...extra });
const foe = (extra = {}) => ({ id: 'r', role: 'legionario', men: 3, x: 0, y: 40, ...extra });
const make = (groups, extra = {}) => createBattle({ seed: 1, exits: EXITS, groups, ...extra });

// --- validação dos dados de entrada ---

test('createBattle recusa homens que não sejam um número inteiro positivo', () => {
  for (const men of [NaN, 0, -2, Infinity, '5', undefined]) assert.throws(() => make([one({ men })]), /homens/, `men = ${men}`);
});

test('createBattle recusa posições e frentes que não sejam números finitos', () => {
  assert.throws(() => make([one({ x: NaN })]), /posição/);
  assert.throws(() => make([one({ y: undefined })]), /posição/);
  assert.throws(() => make([one({ facing: Infinity })]), /frente/);
});

test('createBattle recusa grupos, saídas e funções do terreno inválidos', () => {
  assert.throws(() => createBattle({ seed: 1, exits: EXITS, groups: null }), /grupos/);
  assert.throws(() => make([one({ id: '' })]), /id/);
  assert.throws(() => createBattle({ seed: 1, groups: [one()], exits: { lusitanos: [{ x: 0, y: NaN }], romanos: EXITS.romanos } }), /saídas/);
  assert.throws(() => make([one()], { coverAt: 3 }), /coverAt/);
  assert.throws(() => make([one()], { los: 'sim' }), /los/);
  assert.throws(() => make([one()], { maxTime: -1 }), /maxTime/);
});

test('createBattle valida a ordem inicial como valida as ordens dadas depois', () => {
  assert.throws(() => make([one({ order: { type: 'mover', path: [] } })]), /ordem inicial.*caminho/);
  assert.throws(() => make([one({ order: { type: 'mover', path: [{ x: 1, y: NaN }] } })]), /ordem inicial.*caminho/);
  assert.throws(() => make([one({ order: { type: 'dançar' } })]), /ordem inicial.*ordem/);
  assert.throws(() => make([one({ order: { type: 'atacar', target: 'ninguem' } }), foe()]), /ordem inicial.*alvo/);
  assert.throws(() => make([one({ order: { type: 'atacar', target: 'a' } })]), /ordem inicial.*alvo/);   // o próprio lado
  assert.doesNotThrow(() => make([one({ order: { type: 'atacar', target: 'r' } }), foe()]));
});

test('command recusa caminhos com pontos inválidos, em vez de os ignorar', () => {
  const b = make([one(), foe()]);
  assert.equal(command(b, 'lusitanos', { group: 'a', type: 'mover', path: [{ x: 5, y: 5 }, { x: 'x', y: 2 }] }).why, 'caminho');
  assert.equal(command(b, 'lusitanos', null).why, 'ordem');
});

test('uma cobertura inválida devolvida pelo terreno conta como sem cobertura e não estraga as contas', () => {
  // fundeiros parados a 30 m de vélites: só as salvas ferem, e todas caem num sítio com «cobertura» NaN
  const b = make([{ id: 'f', role: 'fundeiro', men: 6, x: 0, y: 0 }, { id: 'v', role: 'velite', men: 4, x: 0, y: 30 }], { coverAt: () => NaN });
  const ev = run(b, 30);
  assert.ok(ev.some(e => e.type === 'salva' && e.group === 'f'), 'os fundeiros dispararam');
  for (const g of b.groups) assert.ok(Number.isInteger(g.men) && Number.isFinite(g.wounds), `${g.id}: men=${g.men} wounds=${g.wounds}`);
  const s = summary(b);
  for (const side of ['lusitanos', 'romanos']) { const c = s[side]; assert.equal(c.alive + c.dead + c.fled + c.withdrawn + c.escaped, c.start); }
  assert.ok(s.romanos.dead > 0, 'as fundas continuam a ferir');
});

// --- seleção de alvos ---

test('não se pode mandar atacar um grupo escondido que o lado não vê', () => {
  const b = make([one({ hidden: true }), foe()]);
  assert.equal(command(b, 'romanos', { group: 'r', type: 'atacar', target: 'a' }).why, 'alvo');
});

test('não se pode mandar atacar um grupo destruído ou que já saiu; a ordem antiga passa a «manter»', () => {
  const b = make([one(), foe({ men: 1, y: 2 })]);
  assert.ok(command(b, 'lusitanos', { group: 'a', type: 'atacar', target: 'r' }).ok);
  groupOf(b, 'r').left = 'fugiu';
  assert.equal(command(b, 'lusitanos', { group: 'a', type: 'atacar', target: 'r' }).why, 'alvo');
  step(b);
  assert.equal(groupOf(b, 'a').order.type, 'manter');
});

test('em corpo a corpo, um inimigo que ainda luta tem prioridade sobre o alvo antigo em debandada', () => {
  const b = make([one({ men: 4 }), foe({ id: 'fugido', y: 1 }), foe({ id: 'firme', y: -1 })]);
  const a = groupOf(b, 'a'), fugido = groupOf(b, 'fugido'), firme = groupOf(b, 'firme');
  fugido.state = 'debandada';
  a.target = 'fugido';
  step(b);
  assert.equal(a.target, 'firme');
  assert.ok(firme.wounds > 0 || firme.dead > 0, 'o firme foi atingido');
});

test('fundeiros sem linha de vista aproximam-se do alvo em vez de ficarem parados ao alcance', () => {
  const los = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < 15;   // só se vê a menos de 15 m
  const b = make([{ id: 'f', role: 'fundeiro', men: 4, x: 0, y: 0 }, foe({ y: 35 })], { los });
  const f = groupOf(b, 'f'), r = groupOf(b, 'r');
  r.alerted = true;
  assert.ok(command(b, 'lusitanos', { group: 'f', type: 'atacar', target: 'r' }).ok);
  const ev = run(b, 15);
  assert.ok(Math.hypot(f.x - r.x, f.y - r.y) < 30, 'aproximaram-se');
  assert.ok(ev.some(e => e.type === 'salva' && e.group === 'f'), 'e acabaram por disparar');
});
