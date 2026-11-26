import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { STORAGE_KEY } from '../src/campaign/flow.js';
import { makeCheckpoint, ROAD_INDEX } from './campaign-playtest/fixture.mjs';
import { ROOT, startBrowser } from './e2e-lib.mjs';

const out = process.argv[2];
if (out) await mkdir(out, { recursive: true });
const { browser, url, close } = await startBrowser({ entry: 'index.html?manual=1&map=3d' });
const stages = [], errors = [], warnings = [], cosmeticRequests = [];
const checkpoint = makeCheckpoint();
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf-8' }).trim();
const data = { revision, browser: browser.version(), seed: checkpoint.flow.state.seed, checkpointOrders: checkpoint.orders,
  viewport: { width: 1280, height: 720 }, renderer: 'SwiftShader (software)', stages, errors, warnings, cosmeticRequests };

try {
  const page = await browser.newPage({ viewport: data.viewport, locale: 'en', reducedMotion: 'reduce' });
  const favicon = new URL('/favicon.ico', url).href;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    const detail = message.text().replace(/^\[\.WebGL-0x[\da-f]+\]/i, '[WebGL]');
    if (message.type() === 'error') {
      if (message.location().url === favicon && /\b404\b/.test(detail)) cosmeticRequests.push({ path: '/favicon.ico', status: 404 });
      else errors.push(detail);
    }
    if (message.type() === 'warning' && !warnings.includes(detail)) warnings.push(detail);
  });
  const launcher = new URL('tools/campaign-playtest/index.html', url).href;
  const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
  const shot = name => out && page.screenshot({ path: join(out, `${name}.jpg`), type: 'jpeg', quality: 80 });
  async function record(action) {
    const save = await saved(), s = save.state;
    stages.push({ action, day: s.day, phase: save.phase, men: s.men, food: s.food, arms: s.arms, fame: s.fame, position: s.party,
      attention: s.rome?.attention, sightings: s.intel?.known, reports: s.intel?.reports.map(r => ({ id: r.id, got: r.got, src: r.src })),
      doctrine: { activity: s.doctrine?.activity, ambushes: s.doctrine?.mem.emboscada },
      patrols: s.patrols.map(({ id, kind, men, x, y }) => ({ id, kind, men, x, y })),
      pending: save.battle ? { type: (save.battle.spec ?? save.battle).type, chapter: save.battle.chapter,
        engine: save.battle.engine ?? 'legacy', seed: (save.battle.spec ?? save.battle).seed } : null,
      battles: s.battles ?? 0, kills: s.kills ?? 0, journal: save.journal });
    return save;
  }
  async function openMap() {
    await page.locator('#camp-cont:not(.hidden)').click({ timeout: 60000 });
    await page.locator('#campaign-map-3d[data-status=ready]').waitFor({ timeout: 60000 });
  }
  // Use the actual map controls and advance exactly one production tick without depending on the wall clock.
  async function day(buttonId) {
    return page.evaluate(id => {
      const campaign = window.__game.campaign;
      if (id) document.getElementById(id).click();
      campaign.pause();
      return campaign.step();
    }, buttonId);
  }

  await page.goto(launcher);
  await page.getByRole('button', { name: 'Open in English' }).click();
  await page.waitForURL(new URL('index.html', url).href);
  assert.deepEqual(await saved(), JSON.parse(checkpoint.raw));
  await page.goto(launcher);
  await page.getByRole('button', { name: 'Abrir em português' }).click();
  await page.locator('#status').filter({ hasText: /Já existe uma gravação/ }).waitFor();
  assert.deepEqual(await saved(), JSON.parse(checkpoint.raw));
  assert.equal(await page.evaluate(() => localStorage.getItem('viriato.language')), 'en');
  // The existing manual entry only stops the legacy frame clock. The map and battle entry points are unchanged.
  await page.goto(url);
  await openMap();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  const start = await record('Continue English campaign at Penedo Hillfort');
  await shot('01-checkpoint');
  const castro = page.locator('#campaign-map-3d [data-id="castro-1"]');
  await castro.evaluate(button => button.click());
  await page.locator('#mctx [data-act="pedir-ajuda"]').click();
  const supplied = await record('Ask for aid at the castro');
  assert.equal(supplied.state.day, 5);
  assert.equal(supplied.state.food, 90);
  assert.ok(supplied.journal.some(e => e.type === 'ajuda' && e.id === 'castro-1'));
  await page.evaluate(to => window.__game.campaign.order({ kind: 'marchar', to }), start.state.world.road[ROAD_INDEX]);
  const marched = await record('March to road waypoint 4');
  assert.equal(marched.state.day, 6);
  assert.deepEqual(marched.state.party, start.state.world.road[ROAD_INDEX]);
  assert.notDeepEqual(marched.state.patrols[0], supplied.state.patrols[0]);
  const firstWait = await day('m-ambush');
  assert.ok(firstWait.events.some(e => e.type === 'relato'));
  await record('Wait in ambush and receive a report');
  await day();
  const pending = await record('Wait in ambush and intercept patrulha-3');
  assert.equal(pending.state.day, 8);
  assert.equal(pending.battle.engine, 'm3.1-patrol');
  assert.equal(pending.battle.spec.foeId, 'patrulha-3');
  assert.equal(pending.battle.request.seed, 826356531);
  await shot('02-ambush-pending');

  await page.locator('#mb-fight').click();
  const arena = page.frameLocator('#campaign-tactical-arena');
  await arena.locator('#start').waitFor();
  assert.equal(await arena.locator('h1').textContent(), 'The Ambush');
  await arena.locator('#pause').click();
  await arena.locator('#view').evaluate(() => {
    const p = window.__proto;
    for (const args of [['lobos', 82, 35], ['javalis', 70, 73], ['corvos', 100, 79], ['fundeiros', 110, 42]]) p.place(...args);
  });
  await arena.locator('#start').click();
  await arena.locator('#signal').waitFor();
  await arena.locator('#view').evaluate(() => window.__proto.run(14));
  await arena.locator('#signal').click();
  await arena.locator('#view').evaluate(() => {
    const p = window.__proto;
    for (const [group, target] of [['lobos', 'velites'], ['javalis', 'retaguarda'], ['corvos', 'retaguarda'], ['fundeiros', 'vanguarda']]) {
      p.order(group, { type: 'atacar', target });
    }
    p.run(600);
  });
  await arena.locator('#campaign-return').waitFor();
  const report = await arena.locator('#view').evaluate(() => window.__proto.ui.session.report().data);
  assert.deepEqual([report.outcome, report.lusitanians.dead, report.romans.dead], ['vitoria', 2, 6]);
  data.tacticalReport = report;
  await arena.locator('#lang').selectOption('pt-PT');
  assert.equal(await arena.locator('h1').textContent(), 'A Emboscada');
  await shot('03-tactical-result');
  await arena.locator('#campaign-return').click();
  await page.locator('#campaign-tactical-arena').waitFor({ state: 'detached' });
  const afterTactical = await record('Return from tactical victory');
  assert.equal(afterTactical.phase, 'mapa');
  assert.equal(afterTactical.battle, null);
  assert.equal(afterTactical.state.day, 8);
  assert.equal(afterTactical.state.men, 12);
  assert.equal(afterTactical.state.food, 84);
  assert.equal(afterTactical.state.arms, 15);
  assert.equal(afterTactical.state.fame, 25);
  assert.equal(afterTactical.state.rome.attention, 10);
  assert.equal(afterTactical.state.doctrine.mem.emboscada, 1);
  assert.ok(!afterTactical.state.patrols.some(f => f.id === 'patrulha-3'));
  assert.equal(await page.locator('html').getAttribute('lang'), 'pt-PT');
  await page.reload();
  await openMap();
  assert.deepEqual(await saved(), afterTactical);

  await day('m-hide');
  await record('Hide and consume one day of supplies');
  const secondHide = await day();
  assert.ok(secondHide.events.some(e => e.type === 'avistamento' && e.id === 'patrulha-9'));
  await record('Hide and sight the new Roman patrol');
  await day();
  const story = await record('Next map order triggers the scheduled Captives chapter');
  assert.equal(story.state.day, 10);
  assert.deepEqual([story.battle.type, story.battle.chapter, story.battle.engine], ['historica', 'cativos', undefined]);
  await page.locator('#mb-fight').click();
  await page.locator('#hud:not(.hidden)').waitFor();
  assert.equal(await page.locator('#campaign-tactical-arena').count(), 0);
  assert.deepEqual(await page.evaluate(() => [window.__game.chapter, window.__game.view]), ['cativos', 'third']);
  // Exercise the actual third-person entry and browser pointer lock before using the game's Abandon action.
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.evaluate(() => { window.__game.step(1 / 60); window.__game.render(); });
  await shot('04-legacy-third-person');
  await page.evaluate(() => document.exitPointerLock());
  await page.locator('#abandon:not(.hidden)').click();
  await page.locator('#campaign-map-3d[data-status=ready]').waitFor();
  const afterLegacy = await record('Abandon the legacy battle using the pause menu');
  assert.equal(afterLegacy.phase, 'mapa');
  assert.equal(afterLegacy.battle, null);
  assert.equal(afterLegacy.state.day, 10);
  assert.equal(afterLegacy.state.battles, 2);
  assert.deepEqual([afterLegacy.state.men, afterLegacy.state.food, afterLegacy.state.arms, afterLegacy.state.fame, afterLegacy.state.kills], [11, 79, 15, 20, 6]);
  assert.equal(afterLegacy.state.done.filter(id => id === 'cativos').length, 1);

  await day();
  const final = await record('Continue hiding after returning to the map');
  assert.deepEqual([final.state.day, final.state.men, final.state.food], [11, 11, 78]);
  const a = afterLegacy.state.patrols.find(f => f.id === 'patrulha-9');
  const b = final.state.patrols.find(f => f.id === a.id);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 0);
  await page.reload();
  await openMap();
  assert.deepEqual(await saved(), final);
  const loaded = await page.evaluate(() => {
    const { state, phase, battle, journal } = window.__game.campaign.flow;
    return { state, phase, battle, journal };
  });
  assert.deepEqual(loaded, { state: final.state, phase: final.phase, battle: final.battle, journal: final.journal });
  assert.equal(final.journal.filter(e => e.type === 'emboscada-tatica').length, 1);
  assert.equal(final.journal.filter(e => e.type === 'derrota').length, 1);
  await page.locator('#m-diary').click();
  await page.locator('#mdiary-tab-historia').click();
  await page.getByRole('tabpanel').getByText(/Emboscada vencida/).waitFor();
  await page.getByRole('tabpanel').getByText(/Derrota/).waitFor();
  await shot('05-diary-after-reload');
  assert.deepEqual(errors, []);
  console.log('OK campaign from the natural day-4 checkpoint through both engines to day 11');
} catch (error) {
  data.failure = error.message;
  throw error;
} finally {
  if (out) await writeFile(join(out, 'run.json'), JSON.stringify(data, null, 2) + '\n');
  await close();
}
