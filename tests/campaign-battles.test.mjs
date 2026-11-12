import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLY_CAP, ENEMY_CAP, BATTLE_TYPES, battleSpec, applyResult } from '../src/campaign/battles.js';
import { newCampaign } from '../src/campaign/state.js';
import { makeRng } from '../src/campaign/rng.js';

const rng = () => makeRng(5);
const st = men => { const s = newCampaign(3); s.men = men; return s; };
const enc = (kind, waiting = false, foe = {}) => ({ kind, foe: { id: `${kind}-1`, ...foe }, waiting });
const res = (o = {}) => ({ won: true, alliesLost: 0, enemiesKilled: 5, ...o });

test('constantes e tipos', () => {
  assert.equal(ALLY_CAP, 25); assert.equal(ENEMY_CAP, 30);
  assert.equal(BATTLE_TYPES.length, 7);
});

test('mapeamento encontro -> tipo/local', () => {
  const s = st(14);
  let b = battleSpec(enc('patrulha', true), s, rng()); assert.equal(b.type, 'emboscada'); assert.equal(b.site, 'estrada');
  b = battleSpec(enc('comboio', true), s, rng()); assert.equal(b.type, 'assalto-coluna'); assert.equal(b.site, 'estrada');
  b = battleSpec(enc('patrulha'), s, rng()); assert.equal(b.type, 'campo-aberto'); assert.equal(b.site, 'campo');
  b = battleSpec(enc('comboio'), s, rng()); assert.equal(b.type, 'campo-aberto');
  b = battleSpec(enc('pretor', false, { men: 60 }), s, rng()); assert.equal(b.type, 'decisiva'); assert.equal(b.site, 'campo');
  assert.equal(b.enemies.centurion, true);
  b = battleSpec(enc('posto'), s, rng()); assert.equal(b.type, 'historica'); assert.equal(b.chapter, 'acampamento'); assert.equal(b.site, 'castro');
});

test('semente e foeId', () => {
  const b = battleSpec(enc('patrulha'), st(14), rng());
  assert.ok(Number.isInteger(b.seed) && b.seed >= 1);
  assert.equal(b.foeId, 'patrulha-1');
});

test('aliados limitados e bónus', () => {
  let b = battleSpec(enc('patrulha'), st(40), rng());
  assert.equal(b.allies, 25); assert.equal(b.bonus.allies, 15); assert.equal(b.realMen, 40);
  b = battleSpec(enc('patrulha'), st(14), rng());
  assert.equal(b.allies, 14); assert.equal(b.bonus.allies, 0); assert.equal(b.realMen, 14);
});

test('inimigos: divisão, limite e bónus', () => {
  let b = battleSpec(enc('patrulha', false, { men: 6 }), st(14), rng());
  assert.equal(b.enemies.legio + b.enemies.velites, 6); assert.equal(b.bonus.enemies, 0); assert.equal(b.enemies.centurion, false);
  b = battleSpec(enc('pretor', false, { men: 60 }), st(14), rng());
  assert.equal(b.enemies.legio + b.enemies.velites, 30); assert.equal(b.bonus.enemies, 30);
  b = battleSpec(enc('posto'), st(14), rng());
  assert.equal(b.enemies.legio + b.enemies.velites, 12);
});

test('baixas escaladas: 40 homens, 25 mostrados, 10 baixas -> 16', () => {
  const s = st(40), b = battleSpec(enc('patrulha'), s, rng());
  applyResult(s, b, res({ alliesLost: 10 }));
  assert.equal(s.men, 24);
});

test('baixas nunca excedem nem tornam men negativo', () => {
  const s = st(14), b = battleSpec(enc('patrulha'), s, rng());
  applyResult(s, b, res({ won: false, alliesLost: 999 }));
  assert.equal(s.men, 0);
  const s2 = st(14); applyResult(s2, battleSpec(enc('patrulha'), s2, rng()), res({ alliesLost: -5 }));
  assert.equal(s2.men, 14);
});

test('vitória dá saque e fama, remove o inimigo', () => {
  const s = st(14); s.patrols.push({ id: 'patrulha-1' }, { id: 'outra' });
  const food = s.food, arms = s.arms, fame = s.fame;
  const ev = applyResult(s, battleSpec(enc('patrulha', true), s, rng()), res());
  assert.equal(s.food, food + 6); assert.equal(s.arms, arms + 3); assert.equal(s.fame, fame + 5);
  assert.deepEqual(s.patrols.map(p => p.id), ['outra']);
  assert.equal(ev[0].type, 'vitoria');
  const s2 = st(14); applyResult(s2, battleSpec(enc('comboio', true), s2, rng()), res());
  assert.equal(s2.food, 60 + 20); assert.equal(s2.arms, 10 + 6);
});

test('derrota tira homens e comida mas não termina a campanha', () => {
  const s = st(14); s.patrols.push({ id: 'patrulha-1' });
  const ev = applyResult(s, battleSpec(enc('patrulha'), s, rng()), res({ won: false, alliesLost: 5 }));
  assert.equal(s.men, 9); assert.equal(s.food, 57); assert.equal(s.fame, 15);
  assert.equal(s.over, null); assert.equal(s.patrols.length, 1);
  assert.equal(ev[0].type, 'derrota'); assert.ok(!ev.some(e => e.type === 'ruina'));
});

test('derrota com fama a zero é ruína', () => {
  const s = st(14); s.fame = 4;
  const ev = applyResult(s, battleSpec(enc('patrulha'), s, rng()), res({ won: false }));
  assert.equal(s.over, 'derrota'); assert.ok(ev.some(e => e.type === 'ruina'));
});

test('retirada custa comida e fama, sem saque, inimigo fica', () => {
  const s = st(14); s.patrols.push({ id: 'patrulha-1' });
  const ev = applyResult(s, battleSpec(enc('patrulha'), s, rng()), res({ won: false, retreated: true, alliesLost: 2 }));
  assert.equal(s.food, 55); assert.equal(s.fame, 17); assert.equal(s.arms, 10); assert.equal(s.patrols.length, 1);
  assert.equal(s.men, 12); assert.equal(ev[0].type, 'retirada');
});

test('decisiva vencida termina o ano', () => {
  const s = st(14);
  const ev = applyResult(s, battleSpec(enc('pretor', false, { men: 60 }), s, rng()), res());
  assert.equal(s.over, 'vitoria'); assert.equal(s.fame, 20 + 15);
  assert.ok(ev.some(e => e.type === 'ano-vencido'));
});

test('cooldown = 2 em todos os resultados', () => {
  for (const r of [res(), res({ won: false }), res({ won: false, retreated: true })]) {
    const s = st(14); applyResult(s, battleSpec(enc('patrulha'), s, rng()), r);
    assert.equal(s.cooldown, 2);
  }
});

test('alliesLost malformado (undefined/NaN/Infinity) deixa men finito e inalterado', () => {
  for (const bad of [undefined, NaN, Infinity, -Infinity, 'x']) {
    const s = st(14), b = battleSpec(enc('patrulha'), s, rng());
    applyResult(s, b, { won: true, alliesLost: bad });
    assert.equal(s.men, 14);
    assert.ok(Number.isFinite(s.men));
  }
});

test('realMen > men do estado é limitado', () => {
  const s = st(10), b = battleSpec(enc('patrulha'), s, rng());
  b.realMen = 40; b.allies = 25;
  applyResult(s, b, res({ alliesLost: 25 }));
  assert.equal(s.men, 0);
});

test('retirada e derrota na decisiva não terminam o ano', () => {
  for (const r of [res({ won: false }), res({ won: false, retreated: true })]) {
    const s = st(14); s.praetor = { id: 'vetilio', men: 60 };
    applyResult(s, battleSpec(enc('pretor', false, { id: 'vetilio', men: 60 }), s, rng()), r);
    assert.equal(s.over, null); assert.equal(s.praetor.id, 'vetilio');
  }
});

test('applyResult em estado terminado não altera nada', () => {
  const s = st(14); s.over = 'derrota';
  const b = battleSpec(enc('pretor', false, { men: 60 }), s, rng());
  const before = JSON.stringify(s);
  assert.deepEqual(applyResult(s, b, res({ alliesLost: 3 })), []);
  assert.equal(JSON.stringify(s), before);
});

// Task 14: defesa de aldeia
const defesa = (s, foe = {}) => battleSpec({ kind: 'defesa', foe: { id: 'patrulha-1', kind: 'patrulha', men: 6, ...foe }, villageId: 'v1', waiting: false }, s, rng());
const withV = () => { const s = st(14); s.villages.v1 = { burnt: false, recruitedDay: -999 }; s.patrols.push({ id: 'patrulha-1' }); return s; };

test('defesa: tipo defesa-aldeia, local castro, guarda a aldeia e o inimigo', () => {
  const s = withV(), b = defesa(s);
  assert.equal(b.type, 'defesa-aldeia'); assert.equal(b.site, 'castro'); assert.equal(b.villageId, 'v1');
  assert.equal(b.foeId, 'patrulha-1'); assert.equal(b.enemies.legio + b.enemies.velites, 6);
  const p = defesa(s, { id: 'vetilio', men: 60 });
  assert.equal(p.enemies.legio + p.enemies.velites, 30); assert.equal(p.bonus.enemies, 30);
});

test('defesa vencida: aldeia intacta, saque de campo aberto e +3 de fama', () => {
  const s = withV(), food = s.food, arms = s.arms, fame = s.fame;
  const ev = applyResult(s, defesa(s), res());
  assert.equal(s.villages.v1.burnt, false);
  assert.equal(s.food, food + 4); assert.equal(s.arms, arms + 2); assert.equal(s.fame, fame + 8);
  assert.equal(s.patrols.length, 0); assert.equal(ev[0].type, 'vitoria');
});

test('defesa perdida, abandonada ou em retirada: a aldeia arde e a fama cai mais 3', () => {
  for (const [r, fameLoss] of [[res({ won: false }), 5 + 3], [res({ won: false, retreated: true }), 3 + 3]]) {
    const s = withV(), fame = s.fame;
    const ev = applyResult(s, defesa(s), r);
    assert.equal(s.villages.v1.burnt, true);
    assert.equal(s.fame, fame - fameLoss);
    assert.ok(ev.some(e => e.type === 'aldeia-queimada' && e.id === 'v1'));
  }
  const s = withV(); s.fame = 6;
  applyResult(s, defesa(s), res({ won: false }));
  assert.equal(s.fame, 0); assert.equal(s.over, 'derrota');
});

// Task 15: assalto a coluna: o saque depende dos carros tomados; a coluna que foge custa só fama
const coluna = s => battleSpec(enc('comboio', true), s, rng());
test('assalto-coluna: o saque escala com os carros capturados', () => {
  for (const [cap, food, arms] of [[0, 4, 2], [1, 9, 3], [2, 15, 5], [3, 20, 6]]) {
    const s = st(14);
    applyResult(s, coluna(s), res({ cartsCaptured: cap, cartsTotal: 3 }));
    assert.deepEqual([s.food - 60, s.arms - 10], [food, arms], `${cap}/3`);
  }
  const s = st(14); applyResult(s, coluna(s), res());   // sem os campos: todos capturados
  assert.deepEqual([s.food, s.arms], [80, 16]);
  const t = st(14); applyResult(t, coluna(t), res({ cartsCaptured: 9, cartsTotal: 0 }));   // malformado: nunca mais que tudo
  assert.deepEqual([t.food, t.arms], [80, 16]);
});

test('a coluna escapou-se: sem saque, só -2 de fama e os homens que caíram; o comboio fica no mapa', () => {
  const s = st(14); s.patrols.push({ id: 'comboio-1' });
  const ev = applyResult(s, coluna(s), res({ won: false, escaped: true, alliesLost: 2, cartsCaptured: 0, cartsTotal: 3 }));
  assert.deepEqual([s.men, s.food, s.arms, s.fame], [12, 60, 10, 18]);
  assert.equal(s.patrols.length, 1); assert.equal(ev[0].type, 'fuga'); assert.equal(ev[0].lost, 2);
});

// Task 16: retirada (só em campo aberto, decisiva e defesa de aldeia, com uma serra a <= 80 no mapa)
const serras = s => s.world.settlements.filter(x => x.kind === 'serra');
const at = (s, x, y) => { s.party = { x, y }; return s; };
test('retirada: possível com uma serra a <= 80, escolhe a mais próxima', () => {
  const s = st(14), [a] = serras(s);
  at(s, a.x + 50, a.y);
  for (const e of [enc('patrulha'), enc('pretor', false, { men: 60 }), { kind: 'defesa', foe: { id: 'p', kind: 'patrulha' }, villageId: 'v1', waiting: false }]) {
    const b = battleSpec(e, s, rng());
    assert.deepEqual(b.retreat, { possible: true, serraId: a.id }, b.type);
  }
  at(s, a.x + 80, a.y); assert.equal(battleSpec(enc('patrulha'), s, rng()).retreat.possible, true);
  at(s, a.x + 81, a.y); const near = serras(s).some(x => Math.hypot(x.x - s.party.x, x.y - s.party.y) <= 80);
  assert.equal(battleSpec(enc('patrulha'), s, rng()).retreat.possible, near);
});

test('retirada: longe das serras não há; emboscada, assalto e histórica nunca', () => {
  const s = st(14);
  let far = null;   // um ponto do mapa a mais de 80 de todas as serras
  for (let x = 0; x <= s.world.w && !far; x += 10) for (let y = 0; y <= s.world.h && !far; y += 10)
    if (serras(s).every(q => Math.hypot(q.x - x, q.y - y) > 80)) far = { x, y };
  at(s, far.x, far.y);
  assert.deepEqual(battleSpec(enc('patrulha'), s, rng()).retreat, { possible: false, serraId: null });
  const [a] = serras(s); at(s, a.x, a.y);
  for (const e of [enc('patrulha', true), enc('comboio', true), enc('posto')]) assert.equal(battleSpec(e, s, rng()).retreat.possible, false, e.kind);
});

test('retirada: o bando vai para a serra, além de -5 comida e -3 fama', () => {
  const s = st(14), [a, b] = serras(s);
  at(s, b.x + 40, b.y);
  const spec = battleSpec(enc('patrulha'), s, rng());
  assert.equal(spec.retreat.serraId, b.id);
  at(s, 1, 1);   // o mapa pode ter mudado entretanto: conta a serra do spec
  const ev = applyResult(s, spec, res({ won: false, retreated: true, alliesLost: 1 }));
  assert.deepEqual(s.party, { x: b.x, y: b.y });
  assert.equal(s.food, 55); assert.equal(s.fame, 17); assert.equal(s.over, null);
  assert.equal(ev[0].type, 'retirada'); assert.equal(ev[0].serraId, b.id);
  assert.notEqual(a.id, b.id);
});

test('retirada sem serra no spec (provisória, gravações antigas) não mexe no bando', () => {
  const s = st(14); at(s, 3, 4);
  const spec = battleSpec(enc('patrulha', true), s, rng());
  applyResult(s, spec, res({ won: false, retreated: true }));
  assert.deepEqual(s.party, { x: 3, y: 4 });
  const old = { ...spec }; delete old.retreat;
  applyResult(s, old, res({ won: false, retreated: true }));
  assert.deepEqual(s.party, { x: 3, y: 4 });
});
