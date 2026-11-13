import test from 'node:test';
import assert from 'node:assert/strict';
import { PRAETORS, makePraetor, SIGHT, FINAL_CONVERGENCE, praetorStep, MARCH_FROM, BURN_REST } from '../src/campaign/praetor.js';
import { makeRng } from '../src/campaign/rng.js';
import { YEAR_DAYS } from '../src/campaign/clock.js';
import { generateWorld } from '../src/campaign/worldgen.js';

const mkState = (over = {}) => ({
  day: 20, fame: 20, party:   // depois de MARCH_FROM (Task 18)
 { x: 100, y: 0 },
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
  assert.deepEqual(PRAETORS.vetilio, { id: 'vetilio', name: 'Caio Vetílio', men: 60, speed: 22,
    traits: { pursuit: .6, scorch: .5 }, chronicleId: 'vetilio' });
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
  assert.equal(a.id, 'vetilio'); assert.equal(PRAETORS.vetilio.traits.pursuit, .6);
});

test('o pretor não marcha antes de MARCH_FROM (salvo na convergência final)', () => {
  assert.equal(MARCH_FROM, 15);
  const s = withTraits(mkState({ day: MARCH_FROM - 1 }), 1);
  assert.deepEqual(praetorStep(s, rng), []);
  assert.deepEqual([s.praetor.x, s.praetor.y], [0, 0]);
  s.day = MARCH_FROM; praetorStep(s, rng);
  assert.ok(s.praetor.x > 0);
});

test('depois de queimar fica BURN_REST dias parado; a convergência final ignora o descanso', () => {
  assert.equal(BURN_REST, 12);
  const s = withTraits(mkState(), 0);
  s.praetor.y = 280;
  praetorStep(s, rng);
  assert.equal(s.praetor.rest, BURN_REST);
  const y = s.praetor.y;
  for (let i = 0; i < BURN_REST; i++) { assert.deepEqual(praetorStep(s, rng), []); assert.equal(s.praetor.y, y); }
  praetorStep(s, rng);
  assert.notEqual(s.praetor.y, y);
  const t = withTraits(mkState({ day: YEAR_DAYS - FINAL_CONVERGENCE, party: { x: 900, y: 0 } }), 0);
  t.praetor.rest = 5; praetorStep(t, rng);
  assert.ok(t.praetor.x > 0);
});

// Fix wave: o feitio do pretor conta. Perseguir é uma probabilidade; scorch decide o descanso e o alvo.
import { burnRest } from '../src/campaign/praetor.js';
import { newCampaign } from '../src/campaign/state.js';
import { stepDay } from '../src/campaign/simulation.js';
const fixed = v => ({ ...makeRng(1), chance: () => v });
test('perseguir: rng.chance(traits.pursuit) decide, a cada dia', () => {
  const yes = withTraits(mkState(), .5); praetorStep(yes, fixed(true));
  assert.ok(Math.abs(yes.praetor.x - 30) < 1e-9);   // atrás do bando
  const no = withTraits(mkState(), .5); praetorStep(no, fixed(false));
  assert.ok(no.praetor.x === 0 && no.praetor.y !== 0);   // para uma aldeia
});
test('burnRest: round(BURN_REST * (1.5 - scorch)) entre 4 e 18', () => {
  assert.equal(burnRest(.5), 12); assert.equal(burnRest(1), 6); assert.equal(burnRest(0), 18); assert.equal(burnRest(.2), 16);
  assert.equal(burnRest(5), 4); assert.equal(burnRest(-5), 18);
  const s = withTraits(mkState(), 0); s.praetor.traits.scorch = .9; s.praetor.y = 280;
  praetorStep(s, rng); assert.equal(s.praetor.rest, burnRest(.9));
});
test('alvo: scorch >= .5 a aldeia mais perto dele; < .5 a aldeia mais perto do bando', () => {
  const mk = scorch => { const s = withTraits(mkState({ party: { x: 0, y: -450 } }), 0); s.praetor.traits.scorch = scorch; return s; };
  const hot = mk(.8); praetorStep(hot, rng); assert.ok(hot.praetor.y > 0);    // a1, a 300 dele
  const cold = mk(.2); praetorStep(cold, rng); assert.ok(cold.praetor.y < 0);  // a2, ao pé do bando
});
test('dois pretores com feitios diferentes fazem anos diferentes no mesmo mapa', () => {
  const run = traits => {
    const s = newCampaign(11); s.praetor = { ...makePraetor('vetilio', makeRng(1), s.world), traits };
    s.party = { x: s.world.w / 2, y: s.world.h / 2 };
    const trace = [];
    for (let d = 0; d < 45; d++) { stepDay(s, { kind: 'esconder' }, makeRng(1000 + d)); trace.push(`${Math.round(s.praetor.x)},${Math.round(s.praetor.y)}`); s.cooldown = 99; }
    return { trace, burnt: Object.keys(s.villages).filter(k => s.villages[k].burnt).sort() };
  };
  const a = run({ pursuit: .9, scorch: .8 }), b = run({ pursuit: .2, scorch: .2 });
  assert.notDeepEqual(a.trace, b.trace);
  assert.notDeepEqual(a.burnt, b.burnt);
});
