import test from 'node:test';
import assert from 'node:assert/strict';
import { newCampaign, START, foodPerDay, recruitsFrom, spend, checkRuin, serialize, deserialize } from '../src/campaign/state.js';

test('newCampaign starts with START values, party at world.start, villages only for aldeias', () => {
  const s = newCampaign(5);
  for (const k of Object.keys(START)) assert.equal(s[k], START[k]);
  assert.deepEqual(s.party, s.world.start);
  assert.equal(s.v, 1); assert.equal(s.seed, 5); assert.equal(s.day, 0);
  assert.equal(s.praetor, null); assert.deepEqual(s.patrols, []); assert.deepEqual(s.done, []);
  assert.equal(s.over, null); assert.equal(s.cooldown, 0);
  const aldeias = s.world.settlements.filter(x => x.kind === 'aldeia');
  assert.equal(Object.keys(s.villages).length, aldeias.length);
  for (const a of aldeias) assert.deepEqual(s.villages[a.id], { burnt: false, recruitedDay: -999 });
});
test('formulas', () => {
  assert.equal(foodPerDay(14), 3); assert.equal(foodPerDay(1), 1); assert.equal(foodPerDay(0), 1);
  assert.equal(recruitsFrom(20), 2);
});
test('spend saturates at 0 and ignores undefined fields', () => {
  const s = newCampaign(5);
  spend(s, { men: 100, food: 5, fame: undefined });
  assert.equal(s.men, 0); assert.equal(s.food, 55); assert.equal(s.fame, START.fame); assert.equal(s.arms, START.arms);
  spend(s, { arms: 999, food: 999 });
  assert.equal(s.arms, 0); assert.equal(s.food, 0);
});
test('initial food runs out before day 30 with no income', () => {
  let food = START.food, day = 0;
  while (food > 0) { food = Math.max(0, food - foodPerDay(START.men)); day++; }
  assert.ok(day < 30, `food lasted ${day} days`);
});
test('checkRuin fires once', () => {
  const s = newCampaign(5);
  assert.equal(checkRuin(s), false); assert.equal(s.over, null);
  s.men = 0;
  assert.equal(checkRuin(s), true); assert.equal(s.over, 'derrota');
  assert.equal(checkRuin(s), false); assert.equal(s.over, 'derrota');
  const f = newCampaign(5); f.fame = 0;
  assert.equal(checkRuin(f), true);
  const v = newCampaign(5); v.over = 'vitoria'; v.men = 0;
  assert.equal(checkRuin(v), false); assert.equal(v.over, 'vitoria');
});
test('serialize/deserialize round trip', () => {
  const s = newCampaign(7); s.day = 12; s.men = 9;
  assert.deepEqual(deserialize(serialize(s)), s);
});
test('deserialize returns null for bad input without throwing', () => {
  const good = JSON.parse(serialize(newCampaign(5)));
  const bad = ['', 'lixo{', 'null', '42', '"x"', '[]', '{}',
    JSON.stringify({ ...good, v: undefined }), JSON.stringify({ ...good, v: 99 }), JSON.stringify({ ...good, v: 2 })];
  for (const k of ['day', 'men', 'food', 'arms', 'fame', 'party', 'world']) bad.push(JSON.stringify({ ...good, [k]: undefined }));
  bad.push(JSON.stringify({ ...good, world: { settlements: 'x' } }));
  for (const t of bad) assert.equal(deserialize(t), null, t.slice(0, 40));
  assert.equal(deserialize(undefined), null);
});
