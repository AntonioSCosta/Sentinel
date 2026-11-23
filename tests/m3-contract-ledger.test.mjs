import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reconcileRoster } from '../tools/m3-contract-ledger.mjs';

function example() {
  const band = { kind: 'band', id: 'band' };
  const patrol = { kind: 'patrol', id: 7 };
  const anotherPatrol = { kind: 'patrol', id: '7' };
  const identity = { contractVersion: 1, campaignId: 'example', encounterId: 'enc-3', snapshotRevision: 12 };
  const request = {
    ...identity,
    sources: [{ ref: band, atStart: 14 }, { ref: patrol, atStart: 6 }, { ref: anotherPatrol, atStart: 2 }],
    groups: [
      { id: 'foot', side: 'lusitanos', source: band, men: 6 },
      { id: 'sling', side: 'lusitanos', source: band, men: 4 },
      { id: 'column-front', side: 'romanos', source: patrol, men: 4 },
      { id: 'column-rear', side: 'romanos', source: patrol, men: 2 },
      { id: 'scout', side: 'romanos', source: anotherPatrol, men: 1 },
    ],
  };
  const result = {
    ...identity, outcome: 'vitoria', ticksElapsed: 136,
    groups: [
      { id: 'foot', dead: 2, aliveOnField: 4, fled: 0, withdrawn: 0, escaped: 0 },
      { id: 'sling', dead: 1, aliveOnField: 0, fled: 0, withdrawn: 3, escaped: 0 },
      { id: 'column-front', dead: 2, aliveOnField: 0, fled: 2, withdrawn: 0, escaped: 0 },
      { id: 'column-rear', dead: 1, aliveOnField: 0, fled: 0, withdrawn: 0, escaped: 1 },
      { id: 'scout', dead: 0, aliveOnField: 0, fled: 1, withdrawn: 0, escaped: 0 },
    ],
  };
  return { request, result };
}

test('M3 roster keeps reserves and living dispositions separate for each typed source ID', () => {
  const { request, result } = example();
  assert.deepEqual(reconcileRoster(request, result), [
    { ref: { kind: 'band', id: 'band' }, atStart: 14, reserve: 4, dead: 3, aliveOnField: 4, fled: 0, withdrawn: 3, escaped: 0, survivors: 11 },
    { ref: { kind: 'patrol', id: 7 }, atStart: 6, reserve: 0, dead: 3, aliveOnField: 0, fled: 2, withdrawn: 0, escaped: 1, survivors: 3 },
    { ref: { kind: 'patrol', id: '7' }, atStart: 2, reserve: 1, dead: 0, aliveOnField: 0, fled: 1, withdrawn: 0, escaped: 0, survivors: 2 },
  ]);
});

test('M3 roster reconciliation is repeatable and leaves the pending snapshot and result intact', () => {
  const { request, result } = example();
  const before = structuredClone({ request, result });
  const first = reconcileRoster(request, result);
  const reordered = { ...result, groups: [...result.groups].reverse() };
  assert.deepEqual(reconcileRoster(request, reordered), first);
  assert.deepEqual({ request, result }, before);
});

test('M3 roster rejects another campaign, encounter, revision or contract version', () => {
  const { request, result } = example();
  for (const altered of [{ campaignId: 'another' }, { encounterId: 'enc-4' }, { snapshotRevision: 11 }]) {
    assert.throws(() => reconcileRoster(request, { ...result, ...altered }), /pending encounter/);
  }
  assert.throws(() => reconcileRoster(request, { ...result, contractVersion: 2 }), /version/);
  assert.throws(() => reconcileRoster(request, { ...result, outcome: null }), /final result/);
});

test('M3 roster refuses missing, extra and duplicated group results', () => {
  const { request, result } = example();
  assert.throws(() => reconcileRoster(request, { ...result, groups: result.groups.slice(1) }), /Missing group/);
  for (const group of [{ ...result.groups[0], id: 'unknown' }, result.groups[0]]) {
    assert.throws(() => reconcileRoster(request, { ...result, groups: [...result.groups, group] }), /Unknown or repeated/);
  }
});

test('M3 roster refuses headcount imbalance, fractions and negative values', () => {
  const { request, result } = example();
  for (const changed of [{ dead: 3 }, { dead: 2.5, aliveOnField: 3.5 }, { dead: -1, aliveOnField: 7 }]) {
    const [first, ...rest] = result.groups;
    assert.throws(() => reconcileRoster(request, { ...result, groups: [{ ...first, ...changed }, ...rest] }), /Headcount/);
  }
});

test('M3 roster refuses overcommitment, wrong-side and unresolved source references', () => {
  for (const changed of [{ men: 11 }, { side: 'romanos' }, { source: { kind: 'band', id: 'other' } }]) {
    const { request, result } = example();
    Object.assign(request.groups[0], changed);
    assert.throws(() => reconcileRoster(request, result), /allocation/);
  }
});

test('M3 roster refuses repeated sources and groups before applying any result', () => {
  const { request, result } = example();
  assert.throws(() => reconcileRoster({ ...request, sources: [...request.sources, request.sources[0]] }, result), /repeated source/);
  assert.throws(() => reconcileRoster({ ...request, groups: [...request.groups, request.groups[0]] }, result), /repeated group/);
});
