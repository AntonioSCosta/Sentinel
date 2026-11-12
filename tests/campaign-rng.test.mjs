import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/campaign/rng.js';

test('mesma semente dá a mesma sequência', () => {
  const a = makeRng(42), b = makeRng(42);
  const sa = Array.from({ length: 10 }, () => a.next());
  const sb = Array.from({ length: 10 }, () => b.next());
  assert.deepEqual(sa, sb);
});

test('sementes diferentes divergem', () => {
  const a = makeRng(1), b = makeRng(2);
  const sa = Array.from({ length: 10 }, () => a.next());
  const sb = Array.from({ length: 10 }, () => b.next());
  assert.notDeepEqual(sa, sb);
});

test('next() fica sempre em [0, 1)', () => {
  const r = makeRng(7);
  for (let i = 0; i < 1000; i++) {
    const v = r.next();
    assert.ok(v >= 0 && v < 1, `valor fora do intervalo: ${v}`);
  }
});

test('int(3,5) só devolve 3, 4 ou 5 e devolve os três', () => {
  const r = makeRng(99);
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    const v = r.int(3, 5);
    assert.ok([3, 4, 5].includes(v), `valor inesperado: ${v}`);
    seen.add(v);
  }
  assert.deepEqual([...seen].sort(), [3, 4, 5]);
});

test('range(a, b) fica em [a, b)', () => {
  const r = makeRng(5);
  for (let i = 0; i < 1000; i++) {
    const v = r.range(-2, 2);
    assert.ok(v >= -2 && v < 2, `valor fora do intervalo: ${v}`);
  }
});

test('pick nunca sai do array', () => {
  const arr = ['a', 'b', 'c'];
  const r = makeRng(3);
  for (let i = 0; i < 1000; i++) {
    assert.ok(arr.includes(r.pick(arr)));
  }
});

test('chance(0) nunca dá true e chance(1) dá sempre true', () => {
  const r = makeRng(11);
  for (let i = 0; i < 1000; i++) {
    assert.equal(r.chance(0), false);
    assert.equal(r.chance(1), true);
  }
});
