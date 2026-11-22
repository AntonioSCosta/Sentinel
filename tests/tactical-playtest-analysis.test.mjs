import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../tools/analyze-tactical-playtests.mjs', import.meta.url));
const examples = fileURLToPath(new URL('../docs/playtest/m1-examples/', import.meta.url));
const run = (input, output) => spawnSync(process.execPath, [cli, input, output], { encoding: 'utf8' });

async function dirs(t) {
  const root = await mkdtemp(join(tmpdir(), 'sentinel-playtest-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = join(root, 'input'), output = join(root, 'output');
  await mkdir(input);
  return { input, output };
}

const read = (dir, file) => readFile(join(dir, file), 'utf8');
const summary = async dir => JSON.parse(await read(dir, 'summary.json'));
const write = (dir, file, data) => writeFile(join(dir, file), JSON.stringify(data));
const report = (fields = {}) => ({ version: 'm1.1-proto-2', outcome: 'vitoria', time: 25, ...fields });

test('CLI generates three outputs, version cohorts and same-player deltas from the documented examples', async t => {
  const { output } = await dirs(t);
  const result = run(examples, output);
  assert.equal(result.status, 0, result.stderr);
  const data = await summary(output);
  assert.deepEqual([data.filesRead, data.battleCount, data.rejectedCount], [4, 4, 0]);
  const [m1, m11, m12] = data.versions;
  assert.equal(m1.version, 'm1-proto-1');
  assert.equal(m1.battles[0].calculated.signalStatus, 'not-given');
  assert.equal(m1.metrics.tacticalFallbacks.available, 0);
  assert.deepEqual(m11.outcomes, { derrota: 1, vitoria: 1 });
  assert.deepEqual(m11.romanReactions, { available: 2, byType: { apoio: 1, persegue: 1 } });
  assert.deepEqual(m11.battles[0].calculated.groupsDiscoveredBeforeSignal, ['lobos']);
  assert.equal(m11.battles[1].feedback.wouldPlayAgain, 'no');
  assert.equal(m12.version, 'm1.2-proto-1');
  assert.equal(m12.battles[0].calculated.surprisedRomanGroups, 0);
  assert.deepEqual(m12.battles[0].calculated.groupsDiscoveredBeforeSignal, ['corvos']);
  assert.deepEqual(m12.battles[0].calculated.groupsSeenBeforeSignal, ['corvos', 'lobos']);
  assert.equal(m12.battles[0].measured.seen[0].cause, 'open');
  const [pair] = m11.comparisons;
  assert.deepEqual([pair.playerId, pair.sameSeed, pair.delta.signalAt, pair.delta.lusitanianDeaths, pair.delta.acceptedOrders],
    ['P01', true, 8, -6, 2]);
  assert.match(await read(output, 'summary.md'), /Respostas humanas[\s\S]+P01 \| 2 \| não/);
  assert.match(await read(output, 'battles.csv'), /"surprisedRomanGroups"/);
  assert.equal(run(examples, output).status, 0, 'repeat runs can refresh the outputs');
});

test('signal evidence, discovery time, zero and absent data retain distinct meanings', async t => {
  const { input, output } = await dirs(t);
  await write(input, '01-given.json', report({
    signalAt: 10, orders: 0, keyMoments: [{ code: 'signalSpotted' }], romanResponses: [],
    discovered: [{ group: 'lobos', t: 1 }, { group: 'lobos', t: 7 }, { group: 'corvos', t: 10 }, { group: 'javalis', t: 11 }],
  }));
  await write(input, '02-absent.json', report({ discovered: [] }));
  await write(input, '03-no-signal.json', report({ signalAt: null, discovered: [] }));
  assert.equal(run(input, output).status, 0);
  const [cohort] = (await summary(output)).versions;
  const [given, absent, noSignal] = cohort.battles.map(battle => battle.calculated);
  assert.equal(given.surprisedRomanGroups, 0);
  assert.deepEqual(given.groupsDiscoveredBeforeSignal, ['lobos']);
  assert.equal(given.romanReactionCount, 0);
  assert.equal(absent.signalStatus, 'unavailable');
  assert.equal(noSignal.signalStatus, 'not-given');
  assert.equal(noSignal.groupsDiscoveredBeforeSignalCount, null);
  assert.deepEqual(cohort.metrics.acceptedOrders, { available: 1, sum: 0, mean: 0 });
});

test('unsupported versions and invalid JSON are reported without discarding valid battles', async t => {
  const { input, output } = await dirs(t);
  await write(input, '01-valid.json', report({ orders: '4', feedback: { controlsClarity: 7 },
    discovered: [{ group: 'lobos', t: 30 }], unrelatedPrivateField: 'omit this field' }));
  await write(input, '02-unsupported.json', report({ version: 'm1.2-proto-3' }));
  await writeFile(join(input, '03-bad.json'), 'not JSON');
  await write(input, '04-unfinished.json', report({ outcome: null }));
  await writeFile(join(input, 'readme.txt'), 'ignored');
  assert.equal(run(input, output).status, 2);
  const data = await summary(output);
  assert.deepEqual([data.filesRead, data.battleCount, data.rejectedCount], [4, 1, 3]);
  assert.equal(data.issues.filter(issue => issue.level === 'warning').length, 3);
  assert.ok(data.issues.some(issue => issue.message.includes('m1.2-proto-3')));
  assert.equal(data.versions[0].battles[0].measured.acceptedOrders, null);
  assert.ok(!(await read(output, 'summary.json')).includes('omit this field'));
});

test('ambiguous round slots are rejected and rounds across versions are never paired', async t => {
  const { input, output } = await dirs(t);
  await write(input, 'duplicate-a.json', report({ playerId: 'P01', battleNumber: 1 }));
  await write(input, 'duplicate-b.json', report({ playerId: 'P01', battleNumber: 1 }));
  await write(input, 'm1-first.json', report({ version: 'm1-proto-1', playerId: 'P02', battleNumber: 1 }));
  await write(input, 'm11-second.json', report({ playerId: 'P02', battleNumber: 2 }));
  assert.equal(run(input, output).status, 2);
  const data = await summary(output);
  assert.deepEqual([data.battleCount, data.rejectedCount], [2, 2]);
  assert.ok(data.versions.every(cohort => cohort.comparisons.length === 0));
  assert.equal(data.issues.filter(issue => issue.message.includes('duplicados')).length, 2);
});

test('CSV escapes spreadsheet text and Markdown escapes notes while JSON preserves manual answers', async t => {
  const { input, output } = await dirs(t);
  const notes = '=SUM("a"|b)\n<em>nota</em>';
  await write(input, 'safe.json', report({ playerId: 'P01', battleNumber: 1, feedback: { notes, tacticalDecisions: 5 } }));
  assert.equal(run(input, output).status, 0);
  assert.match(await read(output, 'battles.csv'), /"'=SUM\(""a""\|b\)\n<em>nota<\/em>"/);
  const markdown = await read(output, 'summary.md');
  assert.match(markdown, /&#124;/);
  assert.match(markdown, /&#60;em&#62;nota/);
  assert.equal((await summary(output)).versions[0].battles[0].feedback.notes, notes);
});

test('no battles yield a diagnostic summary, and input is protected from output writes', async t => {
  const { input, output } = await dirs(t);
  assert.equal(run(input, input).status, 1);
  assert.equal(run(input, output).status, 2);
  const data = await summary(output);
  assert.equal(data.battleCount, 0);
  assert.deepEqual(data.versions, []);
});
