import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadFlow } from '../src/campaign/flow.js';
import { finishBalanceBattle } from '../tools/balance-battle.mjs';
import { PATROL_ID, patrolSave } from './fixtures/m31-campaign.mjs';

test('the balance CLI completes seed 5 and counts each battle only once', () => {
  const output = execFileSync(process.execPath, ['tools/balance.mjs'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, BALANCE_SEEDS: '5', BALANCE_DIAG: '', TRACE: '', VERBOSE: '' },
    encoding: 'utf8',
  });
  const row = output.match(/^\s*5 +\d+ +(\d+) +(vitoria|derrota) .+$/m);
  assert.ok(row, 'seed 5 has a final campaign result');
  assert.match(row[0], /\bemboscada:[1-9]\d*/);
  const counts = [...row[0].matchAll(/[a-z-]+:(\d+)/g)].map(match => Number(match[1]));
  assert.equal(counts.reduce((total, count) => total + count, 0), Number(row[1]));
});

test('the balance adapter records deployed losses and keeps reserves and patrol identity', () => {
  for (const { result, outcome, alliedDead, romanDead } of [
    { result: { won: true, alliesLost: 2, enemiesKilled: 18 }, outcome: 'vitoria', alliedDead: 2, romanDead: 13 },
    { result: { won: false, alliesLost: 16, enemiesKilled: 5 }, outcome: 'derrota', alliedDead: 15, romanDead: 5 },
  ]) {
    let saved = JSON.stringify(patrolSave());
    const storage = { getItem: () => saved, setItem: (_key, value) => { saved = value; } };
    const flow = loadFlow(storage);
    flow.order({ kind: 'esperar' });
    assert.ok(flow.tactical);
    assert.equal(flow.finishBattle(result).refused, true);

    const romanSurvivors = 18 - romanDead;
    const { events, refused } = finishBalanceBattle(flow, result);
    assert.ok(!refused);
    assert.deepEqual(events.find(event => event.type === 'emboscada-tatica'), {
      type: 'emboscada-tatica', outcome, alliedDead, romanDead, romanSurvivors,
    });
    assert.equal(flow.phase, 'mapa');
    assert.equal(flow.state.men, 22 - alliedDead);
    assert.equal(flow.state.battles, 1);
    assert.equal(flow.state.kills, romanDead);
    assert.equal(flow.state.patrols.find(patrol => patrol.id === PATROL_ID).men, romanSurvivors);
    const reopened = loadFlow(storage);
    assert.equal(reopened.phase, 'mapa');
    assert.equal(reopened.tactical, null);
    assert.equal(reopened.journal.filter(event => event.type === 'emboscada-tatica').length, 1);
  }
});
