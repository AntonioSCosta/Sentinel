import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, isConnected, MIN_GAP } from '../src/campaign/worldgen.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
const distToRoad = (p, road) => Math.min(...road.slice(1).map((q, i) => distToSegment(p, road[i], q)));
const count = (w, k) => w.settlements.filter(s => s.kind === k).length;

test('a mesma semente dá o mesmo mundo', () => {
  assert.deepEqual(generateWorld(7), generateWorld(7));
});

test('sementes diferentes dão mundos diferentes', () => {
  assert.notDeepEqual(generateWorld(1), generateWorld(2));
});

test('contagens exatas, nomes únicos, limites e distância mínima', () => {
  const w = generateWorld(42);
  assert.equal(w.w, 1000); assert.equal(w.h, 700);
  assert.equal(count(w, 'aldeia'), 12);
  assert.equal(count(w, 'castro'), 3);
  assert.equal(count(w, 'serra'), 5);
  assert.equal(count(w, 'posto'), 2);
  assert.equal(new Set(w.settlements.map(s => s.name)).size, w.settlements.length);
  for (const s of w.settlements) {
    assert.ok(s.x >= 40 && s.x <= w.w - 40 && s.y >= 40 && s.y <= w.h - 40);
  }
});

test('a estrada vai de x≈0 a x≈w e é monótona em x', () => {
  const w = generateWorld(5);
  assert.ok(w.road[0].x <= 5);
  assert.ok(w.road[w.road.length - 1].x >= w.w - 5);
  for (let i = 1; i < w.road.length; i++) assert.ok(w.road[i].x > w.road[i - 1].x);
});

test('sementes 1…200: conectado, postos na estrada, início numa serra longe dos postos, folga mínima', () => {
  const t0 = Date.now();
  for (let seed = 1; seed <= 200; seed++) {
    const w = generateWorld(seed);
    const postos = w.settlements.filter(s => s.kind === 'posto');
    assert.ok(isConnected(w), `semente ${seed} não conectada`);
    assert.equal(postos.length, 2);
    for (const p of postos) assert.ok(distToRoad(p, w.road) <= 30, `semente ${seed}: posto longe da estrada`);
    assert.ok(w.settlements.some(s => s.kind === 'serra' && s.x === w.start.x && s.y === w.start.y), `semente ${seed}: início fora de serra`);
    for (const p of postos) assert.ok(dist(w.start, p) >= 150, `semente ${seed}: início perto de posto`);
    for (let i = 0; i < w.settlements.length; i++) {
      const a = w.settlements[i];
      assert.ok(a.x >= 40 && a.x <= w.w - 40 && a.y >= 40 && a.y <= w.h - 40);
      for (let j = i + 1; j < w.settlements.length; j++) assert.ok(dist(a, w.settlements[j]) >= MIN_GAP, `semente ${seed}: povoações juntas`);
    }
    assert.equal(count(w, 'aldeia'), 12); assert.equal(count(w, 'castro'), 3); assert.equal(count(w, 'serra'), 5);
    assert.equal(new Set(w.settlements.map(s => s.name)).size, 22);
  }
  assert.ok(Date.now() - t0 < 1000, 'demasiado lento');
});

test('isConnected deteta mundos desligados', () => {
  const w = generateWorld(3);
  assert.equal(isConnected(w, 1), false);
});
