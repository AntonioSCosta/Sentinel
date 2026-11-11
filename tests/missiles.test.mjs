import test from 'node:test';
import assert from 'node:assert/strict';
import { JAVELINS, throwPower, allyThrows, veliteState } from '../src/missiles.js';

test('each Lusitanian carries 3 javelins, each velite 10', () => {
  assert.equal(JAVELINS.lusitano, 3);
  assert.equal(JAVELINS.velite, 10);
});
test('a held throw flies faster and hits harder, up to a limit', () => {
  const tap = throwPower(0), half = throwPower(.5), full = throwPower(1), long = throwPower(4);
  assert.ok(tap.speed < half.speed && half.speed < full.speed);
  assert.ok(tap.dmg < full.dmg);
  assert.deepEqual(long, full);
  assert.ok(tap.speed >= 20, 'even a quick throw carries');
});
test('a companion throws only with javelins left, free hands, a clear view and the Roman at javelin range', () => {
  const ok = { dist: 15, jav: 3, phase: 'idle', cd: 0, sees: true };
  assert.equal(allyThrows(ok), true);
  assert.equal(allyThrows({ ...ok, jav: 0 }), false);
  assert.equal(allyThrows({ ...ok, dist: 3 }), false, 'too close: sword');
  assert.equal(allyThrows({ ...ok, dist: 40 }), false);
  assert.equal(allyThrows({ ...ok, phase: 'windup' }), false);
  assert.equal(allyThrows({ ...ok, cd: .5 }), false);
  assert.equal(allyThrows({ ...ok, sees: false }), false);
});
test('a velite skirmishes while he has javelins, then closes in with the sword', () => {
  assert.equal(veliteState(10), 'skirmish');
  assert.equal(veliteState(1), 'skirmish');
  assert.equal(veliteState(0), 'chase');
});
