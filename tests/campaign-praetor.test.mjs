import test from 'node:test';
import assert from 'node:assert/strict';
import { PRAETORS, makePraetor, SIGHT, FINAL_CONVERGENCE, praetorStep } from '../src/campaign/praetor.js';
import { makeRng } from '../src/campaign/rng.js';
import { YEAR_DAYS } from '../src/campaign/clock.js';
import { generateWorld } from '../src/campaign/worldgen.js';

const mkState = (over = {}) => ({
  day: 10, fame: 20, party: { x: 100, y: 0 },
  world: { settlements: [
    { id: 'a1', kind: 'aldeia', x: 0, y: 300 },
    { id: 'a2', kind: 'aldeia', x: 0, y: -500 },
  ] },
  villages: { a1: { burnt: false, recruitedDay: -999 }, a2: { burnt: false, recruitedDay: -999 } },
  praetor: { id: 't', name: 'T', x: 0, y: 0, men: 50, speed: 30, traits: { pursuit: 1, scorch: .5 }, chronicleId: 't' },
  ...over,
});
const withTraits = (s, pursuit) => { s.praetor.traits.pursuit = pursuit; return s; };
const rng = makeRng(1);

test('constants and Vetilio data', () => {
  assert.equal(SIGHT, 140); assert.equal(FINAL_CONVERGENCE, 20);
  assert.deepEqual(PRAETORS.vetilio, { id: 'vetilio', name: 'Caio Vetílio', men: 60, speed: 30,
    traits: { pursuit: .7, scorch: .5 }, chronicleId: 'vetilio' });
});
test('pursuit 1 within SIGHT approaches the party by speed', () => {
  const s = withTraits(mkState(), 1);
  praetorStep(s, rng);
  assert.ok(Math.abs(s.praetor.x - 30) < 1e-9 && Math.abs(s.praetor.y) < 1e-9);
});
test('pursuit never overshoots the party', () => {
  const s = withTraits(mkState({ party: { x: 20, y: 0 } }), 1);
  praetorStep(s, rng);
  assert.deepEqual([s.praetor.x, s.praetor.y], [20, 0]);
});
test('pursuit 0 heads for nearest unburnt aldeia even with party in sight', () => {
  const s = withTraits(mkState(), 0);
  praetorStep(s, rng);
  assert.ok(Math.abs(s.praetor.y - 30) < 1e-9 && Math.abs(s.praetor.x) < 1e-9);
});
test('party outside SIGHT is ignored even with pursuit 1', () => {
  const s = withTraits(mkState({ party: { x: 500, y: 0 } }), 1);
  praetorStep(s, rng);
  assert.ok(s.praetor.y > 0 && s.praetor.x === 0);
});
test('arrival within 10 burns the village, costs 3 fame, emits event', () => {
  const s = withTraits(mkState(), 0);
  s.praetor.y = 280;
  const ev = praetorStep(s, rng);
  assert.deepEqual(ev, [{ type: 'aldeia-queimada', id: 'a1' }]);
  assert.equal(s.villages.a1.burnt, true);
  assert.equal(s.fame, 17);
});
test('fame never goes below 0', () => {
  const s = withTraits(mkState({ fame: 1 }), 0);
  s.praetor.y = 280;
  praetorStep(s, rng);
  assert.equal(s.fame, 0);
});
test('a burnt village is not targeted again', () => {
  const s = withTraits(mkState(), 0);
  s.villages.a1.burnt = true;
  praetorStep(s, rng);
  assert.ok(s.praetor.y < 0);
});
test('no unburnt aldeia left: goes for the party', () => {
  const s = withTraits(mkState({ party: { x: 900, y: 0 } }), 0);
  s.villages.a1.burnt = true; s.villages.a2.burnt = true;
  praetorStep(s, rng);
  assert.ok(s.praetor.x > 0);
});
test('final convergence: always the party, whatever the trait or distance', () => {
  for (const p of [0, 1]) {
    const s = withTraits(mkState({ day: YEAR_DAYS - FINAL_CONVERGENCE, party: { x: 900, y: 0 } }), p);
    praetorStep(s, rng);
    assert.ok(Math.abs(s.praetor.x - 30) < 1e-9 && Math.abs(s.praetor.y) < 1e-9);
  }
});
test('no praetor: no events', () => {
  assert.deepEqual(praetorStep(mkState({ praetor: null }), rng), []);
});
test('makePraetor: different seeds differ, traits in [0,1], starts at farthest posto', () => {
  const world = generateWorld(3);
  const a = makePraetor('vetilio', makeRng(1), world), b = makePraetor('vetilio', makeRng(2), world);
  assert.notDeepEqual(a.traits, b.traits);
  for (const p of [a, b]) for (const v of Object.values(p.traits)) assert.ok(v >= 0 && v <= 1);
  const postos = world.settlements.filter(x => x.kind === 'posto');
  const d = q => Math.hypot(q.x - world.start.x, q.y - world.start.y);
  const far = Math.max(...postos.map(d));
  assert.equal(d(a), far);
  assert.equal(a.id, 'vetilio'); assert.equal(PRAETORS.vetilio.traits.pursuit, .7);
});
