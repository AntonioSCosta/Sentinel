import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFlow, loadFlow, STORAGE_KEY } from '../src/campaign/flow.js';
import { intelView } from '../src/campaign/intel.js';
import { LANGUAGE_KEY } from '../src/i18n/index.js';
import { makeCheckpoint, memoryStorage, PLAYTEST_SEED, ROAD_INDEX, seedEmptySlot } from '../tools/campaign-playtest/fixture.mjs';

test('playtest v1 checkpoint is exactly a new campaign followed by recorded march orders', () => {
  const { orders, raw, castro } = makeCheckpoint();
  assert.equal(raw, makeCheckpoint().raw);
  const storage = memoryStorage();
  const flow = createFlow({ seed: PLAYTEST_SEED, storage });
  for (const order of orders) assert.equal(flow.order(order).refused, undefined);
  assert.equal(storage.getItem(STORAGE_KEY), raw);
  const loaded = loadFlow(memoryStorage(raw));
  assert.equal(loaded.phase, 'mapa');
  assert.equal(castro.id, 'castro-1');
  assert.deepEqual([loaded.state.day, loaded.state.men, loaded.state.food, loaded.state.arms, loaded.state.fame], [4, 14, 52, 15, 20]);
  assert.ok(intelView(loaded.state).forces.some(f => f.id === 'patrulha-3' && f.status === 'confirmada'));

  const old = JSON.parse(raw);
  delete old.journal;
  delete old.state.intel;
  delete old.state.communities;
  const migrated = loadFlow(memoryStorage(JSON.stringify(old)));
  assert.equal(migrated.state.day, 4);
  assert.ok(migrated.state.communities && migrated.state.intel);
});

test('the same seeded road encounter can be avoided or opened as an M3.1 ambush', () => {
  const { flow, storage, castro } = makeCheckpoint();
  flow.order({ kind: 'pedir-ajuda', id: castro.id });
  flow.order({ kind: 'marchar', to: flow.state.world.road[ROAD_INDEX] });
  flow.order({ kind: 'esperar' });
  assert.equal(flow.state.day, 7);
  const alternate = loadFlow(memoryStorage(storage.getItem(STORAGE_KEY)));
  alternate.order({ kind: 'esconder' });
  flow.order({ kind: 'esperar' });
  assert.equal(alternate.state.day, flow.state.day);
  assert.deepEqual(alternate.state.patrols, flow.state.patrols);
  assert.equal(alternate.phase, 'mapa');
  assert.equal(flow.phase, 'batalha');
  assert.equal(flow.battle.foeId, 'patrulha-3');
  assert.equal(flow.tactical.seed, 826356531);
  assert.deepEqual(flow.tactical.sources.map(s => s.atStart), [14, 6]);
});

test('launcher writes to an empty slot only and keeps v1 bytes identical across languages', () => {
  for (const locale of ['en', 'pt-PT']) {
    const storage = memoryStorage();
    assert.ok(seedEmptySlot(storage, locale));
    assert.equal(storage.getItem(STORAGE_KEY), makeCheckpoint().raw);
    assert.equal(storage.getItem(LANGUAGE_KEY), locale);
    assert.equal(seedEmptySlot(storage, locale === 'en' ? 'pt-PT' : 'en'), false);
    assert.equal(storage.getItem(LANGUAGE_KEY), locale);
  }
  for (const existing of ['', 'invalid JSON', makeCheckpoint().raw]) {
    const storage = memoryStorage(existing);
    assert.equal(seedEmptySlot(storage, 'en'), false);
    assert.equal(storage.getItem(STORAGE_KEY), existing);
    assert.equal(storage.getItem(LANGUAGE_KEY), null);
  }
});
