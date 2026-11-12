import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnPlan, tallyResult, isBridged, BRIDGED } from '../src/campaign/bridge.js';
import { ENEMY_CAP, ALLY_CAP } from '../src/campaign/battles.js';

const spec = (o = {}) => ({ type: 'emboscada', seed: 77, allies: 8, enemies: { legio: 6, velites: 2, centurion: false }, bonus: { allies: 0, enemies: 0 }, realMen: 8, ...o });
const kinds = p => p.enemies.reduce((m, e) => (m[e.kind] = (m[e.kind] || 0) + 1, m), {});

test('tipos com cena 3D', () => {
  assert.deepEqual(BRIDGED, ['emboscada', 'campo-aberto', 'defesa-aldeia', 'assalto-coluna']);
  assert.ok(isBridged(spec()) && isBridged(spec({ type: 'campo-aberto' })) && isBridged(spec({ type: 'defesa-aldeia' })));
  for (const t of ['retirada', 'decisiva', 'historica']) assert.ok(!isBridged(spec({ type: t })));
  assert.ok(!isBridged(null));
});

test('spawnPlan: contagens exatas do spec', () => {
  const p = spawnPlan(spec());
  assert.equal(p.allies, 8);
  assert.deepEqual(kinds(p), { legio: 6, velite: 2 });
  const c = spawnPlan(spec({ enemies: { legio: 5, velites: 1, centurion: true } }));
  assert.deepEqual(kinds(c), { centurion: 1, legio: 5, velite: 1 });
  assert.equal(c.enemies[0].kind, 'centurion');
});

test('spawnPlan: respeita os tetos (o excedente é bónus, não figuras)', () => {
  const p = spawnPlan(spec({ allies: 80, enemies: { legio: 40, velites: 12, centurion: true } }));
  assert.equal(p.allies, ALLY_CAP);
  assert.equal(p.enemies.length, ENEMY_CAP);
  assert.equal(kinds(p).centurion, 1);
  assert.ok(kinds(p).velite > 0);
});

test('spawnPlan: valores estragados não rebentam', () => {
  const p = spawnPlan({ type: 'emboscada', seed: NaN, allies: -3, enemies: { legio: 'x', velites: undefined } });
  assert.equal(p.allies, 0); assert.equal(p.enemies.length, 0);
});

test('spawnPlan: a semente decide a disposição, de forma determinista', () => {
  assert.deepEqual(spawnPlan(spec()), spawnPlan(spec()));
  assert.notDeepEqual(spawnPlan(spec()).enemies, spawnPlan(spec({ seed: 78 })).enemies);
});

test('spawnPlan: ninguém em cima de ninguém', () => {
  for (const type of BRIDGED) {
    const p = spawnPlan(spec({ type, enemies: { legio: 22, velites: 8, centurion: false } }));
    for (let i = 0; i < p.enemies.length; i++) for (let j = i + 1; j < p.enemies.length; j++) {
      const a = p.enemies[i], b = p.enemies[j];
      assert.ok(Math.hypot(a.along - b.along, a.side - b.side) > 1.2, `${type}: ${i} e ${j} sobrepostos`);
    }
  }
});

test('spawnPlan: vélites espalhados pela coluna, não todos juntos', () => {
  const p = spawnPlan(spec({ enemies: { legio: 6, velites: 2, centurion: false } }));
  const idx = p.enemies.map((e, i) => e.kind === 'velite' ? i : -1).filter(i => i >= 0);
  assert.ok(idx[1] - idx[0] >= 3);
});

test('spawnPlan: campo aberto põe a frente romana a 40–60 m e em fileiras', () => {
  const p = spawnPlan(spec({ type: 'campo-aberto', enemies: { legio: 22, velites: 8, centurion: false } }));
  assert.ok(p.gap >= 40 && p.gap <= 60);
  const ranks = new Set(p.enemies.map(e => Math.round(e.along / 2.2)));
  assert.equal(ranks.size, 3);
  assert.equal(spawnPlan(spec()).gap, 0);
});

test('tallyResult: vitória quando todos os romanos caem e Viriato está de pé', () => {
  assert.deepEqual(tallyResult({ allies: 8, alliesDead: 2, enemies: 8, enemiesDead: 8 }), { won: true, retreated: false, alliesLost: 2, enemiesKilled: 8 });
});

test('tallyResult: a morte de Viriato é derrota e conta como um homem', () => {
  assert.deepEqual(tallyResult({ allies: 8, alliesDead: 3, playerDead: true, enemies: 8, enemiesDead: 5 }), { won: false, retreated: false, alliesLost: 4, enemiesKilled: 5 });
});

test('tallyResult: abandonar é derrota, como a morte dele', () => {
  assert.deepEqual(tallyResult({ allies: 8, alliesDead: 1, enemies: 8, enemiesDead: 2, abandoned: true }), { won: false, retreated: false, alliesLost: 2, enemiesKilled: 2 });
});

test('tallyResult: com romanos vivos não há vitória', () => {
  assert.equal(tallyResult({ allies: 8, alliesDead: 0, enemies: 8, enemiesDead: 7 }).won, false);
});

// Task 15: assalto a coluna
test('tallyResult: carros capturados vão no resultado; sem carros os campos não aparecem', () => {
  const r = tallyResult({ allies: 8, alliesDead: 1, enemies: 8, enemiesDead: 8, carts: { captured: 2, total: 3 } });
  assert.deepEqual(r, { won: true, retreated: false, alliesLost: 1, enemiesKilled: 8, cartsCaptured: 2, cartsTotal: 3 });
  assert.ok(!('cartsTotal' in tallyResult({ enemies: 1, enemiesDead: 1 })));
});

test('tallyResult: a coluna escapou-se com a escolta viva', () => {
  const r = tallyResult({ allies: 8, alliesDead: 2, enemies: 8, enemiesDead: 3, escaped: true, carts: { captured: 0, total: 3 } });
  assert.deepEqual(r, { won: false, retreated: false, escaped: true, alliesLost: 2, enemiesKilled: 3, cartsCaptured: 0, cartsTotal: 3 });
});

test('assalto-coluna tem cena 3D; o plano é uma coluna na estrada', () => {
  assert.ok(isBridged(spec({ type: 'assalto-coluna' })));
  const p = spawnPlan(spec({ type: 'assalto-coluna' }));
  assert.equal(p.gap, 0); assert.ok(p.enemies.every(e => Math.abs(e.side) < 1.5));
});

test('assalto-coluna: 3 carros (2 com escolta < 8) entre as filas da escolta, sem se sobreporem', () => {
  for (const [men, n] of [[8, 3], [6, 2], [30, 3]]) {
    const p = spawnPlan(spec({ type: 'assalto-coluna', enemies: { legio: men - 2, velites: 2, centurion: false } }));
    assert.equal(p.carts.length, n, `${men} homens`);
    const al = p.enemies.map(e => e.along);
    for (const c of p.carts) {
      assert.ok(c.along < Math.max(...al) && c.along > Math.min(...al), 'dentro da coluna');
      assert.ok(p.enemies.every(e => Math.abs(e.along - c.along) > 2), 'longe de cada soldado');
    }
  }
  assert.deepEqual(spawnPlan(spec()).carts, []);
});

test('tallyResult: retirada é derrota sem a morte de Viriato, com retreated', () => {
  assert.deepEqual(tallyResult({ allies: 8, alliesDead: 3, enemies: 8, enemiesDead: 2, retreated: true }), { won: false, retreated: true, alliesLost: 3, enemiesKilled: 2 });
  // morto antes de chegar à orla: conta a morte
  assert.deepEqual(tallyResult({ allies: 8, alliesDead: 3, enemies: 8, enemiesDead: 2, retreated: true, playerDead: true }), { won: false, retreated: false, alliesLost: 4, enemiesKilled: 2 });
});
