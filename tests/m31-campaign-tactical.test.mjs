import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadFlow, STORAGE_KEY } from '../src/campaign/flow.js';
import { patrolColumn, patrolPlacement, patrolResult } from '../src/campaign/tactical-patrol.js';
import { createSession } from '../src/tactical/proto/session.js';
import { PATROL_ID, patrolSave } from './fixtures/m31-campaign.mjs';

function savedCampaign(fixture = patrolSave()) {
  let raw = JSON.stringify(fixture);
  return { blocked: false, getItem: () => raw, setItem(_key, next) {
    if (this.blocked) throw new Error('storage unavailable');
    raw = next;
  } };
}

function encounter(fixture) {
  const storage = savedCampaign(fixture);
  const flow = loadFlow(storage);
  flow.order({ kind: 'esperar' });
  assert.equal(flow.phase, 'batalha');
  return { flow, storage, request: flow.tactical };
}

const start = request => createSession({ seed: request.seed, placement: patrolPlacement(request), column: patrolColumn(request) });
function tickToEnd(session) {
  for (let i = 0; i < 6100 && !session.battle.over; i++) session.tick();
  assert.ok(session.battle.over);
}

function report(request, outcome, change) {
  const battle = start(request).battle;
  battle.over = outcome;
  battle.tick = 300;
  for (const group of battle.groups) change(group);
  return patrolResult(request, battle);
}

test('a v1 map creates and persists a tactical encounter only for its real road patrol', () => {
  const { flow, storage, request } = encounter();
  assert.equal(flow.battle.foeId, PATROL_ID);
  assert.equal(request.seed, flow.battle.seed);
  assert.deepEqual(request.sources.map(s => [s.ref.id, s.atStart]), [['band', 22], [PATROL_ID, 18]]);
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).battle.engine, 'm3.1-patrol');
  assert.deepEqual(loadFlow(storage).tactical, request);

  const convoy = encounter(patrolSave({ kind: 'comboio' }));
  assert.equal(convoy.flow.battle.type, 'assalto-coluna');
  assert.equal(convoy.request, null);
  const old = patrolSave();
  old.phase = 'batalha'; old.battle = flow.battle;
  const legacy = loadFlow(savedCampaign(old));
  assert.equal(legacy.tactical, null);
  assert.ok(!legacy.finishBattle({ won: true }).refused);
});

test('the seeded arena allocates only real soldiers and preserves the prepared roster on reload', () => {
  for (const [allies, romans] of [[1, 1], [8, 6], [22, 18]]) {
    const { flow, storage, request } = encounter(patrolSave({ allies, romans }));
    const initial = start(request).report().data;
    assert.equal(initial.lusitanians.start, Math.min(15, allies));
    assert.equal(initial.romans.start, Math.min(13, romans));
    const placement = patrolPlacement(request);
    assert.equal(flow.prepareTactical(request, placement.map(p => ({ ...p, men: p.men + 1 }))), null);
    placement[0] = { ...placement[0], x: 82, y: 35, role: 'fundeiro' };
    const prepared = flow.prepareTactical(request, placement);
    assert.deepEqual(loadFlow(storage).tactical, prepared);
    assert.deepEqual(patrolPlacement(prepared), placement);
  }
});

test('exact casualties and reserves survive a victory, and duplicate or stale results never write again', () => {
  const { flow, storage, request } = encounter();
  const anotherTab = loadFlow(storage);
  const world = flow.state.world, day = flow.state.day;
  const result = report(request, 'vitoria', group => {
    if (group.id === 'vanguarda' || group.id === 'lobos') { group.dead = 2; group.men -= 2; }
    if (group.side === 'romanos') group.left = 'fugiu';
  });
  assert.ok(flow.finishBattle({ won: true }).refused);
  assert.ok(flow.finishTactical({ ...result, encounterId: 'stale' }).refused);
  assert.ok(!flow.finishTactical(result).refused);
  assert.equal(flow.phase, 'mapa');
  assert.equal(flow.state.day, day);
  assert.equal(flow.state.world, world);
  assert.equal(flow.state.men, 20);
  assert.deepEqual(flow.state.patrols.map(p => [p.id, p.men]), [[PATROL_ID, 16]]);
  assert.equal(flow.state.intel.known[PATROL_ID].men, 16);
  assert.equal(flow.state.kills, 2);
  assert.equal(flow.state.battles, 1);
  const saved = storage.getItem(STORAGE_KEY);
  assert.ok(flow.finishTactical(result).refused);
  assert.ok(anotherTab.finishTactical(result).refused);
  assert.ok(!anotherTab.save());
  assert.equal(storage.getItem(STORAGE_KEY), saved);
  assert.equal(loadFlow(storage).finishTactical(result).refused, true);
  assert.equal(loadFlow(storage).journal.filter(e => e.type === 'emboscada-tatica').length, 1);
});

test('a failed final write keeps the same encounter, day, force totals and diary for a retry', () => {
  const { flow, storage, request } = encounter();
  const result = report(request, 'derrota', group => {
    if (group.side !== 'lusitanos') return;
    group.dead = group.start; group.men = 0; group.left = 'morto';
  });
  const before = storage.getItem(STORAGE_KEY);
  storage.blocked = true;
  assert.ok(flow.finishTactical(result).refused);
  assert.equal(flow.tactical, request);
  assert.equal(JSON.stringify(flow.state), JSON.stringify(JSON.parse(before).state));
  assert.equal(storage.getItem(STORAGE_KEY), before);
  storage.blocked = false;
  assert.ok(!flow.finishTactical(result).refused);
  assert.equal(flow.state.men, 7);
  assert.equal(flow.state.patrols[0].men, 18);
});

test('only a patrol with zero survivors is removed from both the campaign and intel', () => {
  const { flow, request } = encounter(patrolSave({ romans: 8 }));
  const result = report(request, 'vitoria', group => {
    if (group.side !== 'romanos') return;
    group.dead = group.start; group.men = 0; group.left = 'morto';
  });
  assert.ok(!flow.finishTactical(result).refused);
  assert.equal(flow.state.patrols.length, 0);
  assert.equal(flow.state.intel.known[PATROL_ID], undefined);
});

test('retreat and Roman escape from the real simulator conserve living troops and replay deterministically', () => {
  for (const outcome of ['retirada', 'escapou']) {
    const { flow, request } = encounter();
    const placement = patrolPlacement(request).map((g, i) => ({ ...g, x: [82, 70, 100, 110][i], y: [35, 73, 79, 42][i] }));
    const prepared = flow.prepareTactical(request, placement);
    const replay = () => {
      const session = start(prepared);
      if (outcome === 'retirada') {
        session.order({ type: 'sinal' });
        for (const group of placement) assert.ok(session.order({ group: group.id, type: 'retirar' }).ok);
      }
      tickToEnd(session);
      return patrolResult(prepared, session.battle);
    };
    const result = replay();
    assert.deepEqual(replay(), result);
    assert.equal(result.outcome, outcome);
    assert.ok(!flow.finishTactical(result).refused);
    assert.equal(flow.state.men, 22 - result.groups.filter(g => placement.some(p => p.id === g.id)).reduce((sum, g) => sum + g.dead, 0));
    assert.equal(flow.state.patrols[0].men, 18 - flow.state.kills);
  }
});
