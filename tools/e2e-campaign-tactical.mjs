import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PATROL_ID, patrolSave } from '../tests/fixtures/m31-campaign.mjs';
import { startBrowser } from './e2e-lib.mjs';

const out = process.argv[2];
if (out) await mkdir(out, { recursive: true });
const { browser, url, close } = await startBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, locale: 'en', reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const shot = name => out && page.screenshot({ path: join(out, `${name}.jpg`), type: 'jpeg', quality: 82 });
  await page.addInitScript(save => {
    if (window === top && !sessionStorage.getItem('m31-fixture')) {
      localStorage.setItem('viriato.campaign', save);
      sessionStorage.setItem('m31-fixture', '1');
    }
    if (window !== top && sessionStorage.getItem('m31-fail-webgl')) {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
        return /^webgl|experimental-webgl/.test(kind) ? null : getContext.call(this, kind, ...args);
      };
    }
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'viriato.campaign' && sessionStorage.getItem('m31-fail-save') && JSON.parse(value).m3?.lastResolved) throw new Error('write blocked');
      return setItem.call(this, key, value);
    };
  }, JSON.stringify(patrolSave()));
  const save = () => page.evaluate(() => JSON.parse(localStorage.getItem('viriato.campaign')));
  const flag = (key, yes) => page.evaluate(([key, yes]) => yes ? sessionStorage.setItem(key, '1') : sessionStorage.removeItem(key), [key, yes]);
  const openMap = async () => {
    await page.locator('#camp-cont:not(.hidden)').click({ timeout: 60000 });
    await page.locator('#campaign-map-3d[data-status=ready]').waitFor({ timeout: 60000 });
  };
  const fight = page.locator('#mb-fight');
  const iframe = page.frameLocator('#campaign-tactical-arena');
  await page.goto(url);
  await openMap();
  await page.locator('#m-ambush').click();
  await fight.waitFor();
  assert.equal(await page.locator('#mb-type').textContent(), 'Ambush a Roman patrol');
  const pending = await save();
  assert.equal(pending.battle.request.objective.targetRef.id, PATROL_ID);
  assert.equal(pending.state.day, 1);
  await shot('01-map-encounter');

  await flag('m31-fail-webgl', true);
  await fight.click();
  await page.getByText('The battlefield could not open.', { exact: false }).waitFor({ timeout: 20000 });
  assert.deepEqual(await save(), pending);
  assert.equal(await page.locator('#campaign-tactical-arena').count(), 0);
  await flag('m31-fail-webgl', false);
  errors.length = 0;
  await page.reload();
  await openMap();
  await fight.click();
  await iframe.locator('#start').waitFor({ timeout: 30000 });
  assert.equal(await iframe.locator('h1').textContent(), 'The Ambush');

  // Keep the first arena's preparation queued until a second arena has opened.
  const saveKey = 'viriato.campaign';
  await page.evaluate(key => new Promise(locked => {
    void navigator.locks.request(key, () => new Promise(release => {
      window.releaseCampaignWrite = release;
      locked();
    }));
  }), saveKey);
  await iframe.locator('#view').evaluate(() => window.__proto.place('lobos', 82, 35));
  await iframe.locator('#start').evaluate(button => button.click());
  await page.waitForFunction(async key => (await navigator.locks.query()).pending.some(lock => lock.name === key), saveKey);
  await iframe.locator('#campaign-cancel').click();
  await fight.waitFor();
  assert.deepEqual(await save(), pending);
  await fight.click();
  await iframe.locator('#start').waitFor({ timeout: 30000 });
  await page.evaluate(async key => {
    window.releaseCampaignWrite();
    await navigator.locks.request(key, () => {});
  }, saveKey);
  assert.deepEqual(await save(), pending, 'the closed arena must not write into the reopened encounter');
  await iframe.locator('#pause').click();
  await iframe.locator('#view').evaluate(() => {
    const p = window.__proto;
    p.place('lobos', 82, 35); p.place('javalis', 70, 73); p.place('corvos', 100, 79); p.place('fundeiros', 110, 42);
  });
  await iframe.locator('#start').click();
  await iframe.locator('#signal').waitFor();
  const deployed = await iframe.locator('#view').evaluate(() => window.__proto.ui.session.report().data);
  assert.equal(deployed.seed, pending.battle.request.seed);
  assert.equal(deployed.lusitanians.start, 15);
  assert.equal(deployed.romans.start, 13);
  await iframe.locator('#view').evaluate(() => {
    const p = window.__proto;
    for (const [group, target] of [['lobos', 'velites'], ['javalis', 'retaguarda'], ['corvos', 'retaguarda'], ['fundeiros', 'vanguarda']]) {
      p.order(group, { type: 'atacar', target });
    }
    p.run(22);
  });
  await iframe.locator('#signal').click();
  await iframe.locator('#view').evaluate(() => window.__proto.run(7));
  await shot('02-tactical-battle');
  await iframe.locator('#view').evaluate(() => window.__proto.run(600));
  await iframe.locator('#campaign-return').waitFor({ timeout: 20000 });
  await iframe.locator('#lang').selectOption('pt-PT');
  assert.equal(await iframe.locator('h1').textContent(), 'A Emboscada');
  assert.equal(await iframe.locator('#campaign-return').textContent(), 'Voltar à campanha');
  await shot('03-tactical-result');
  const report = await iframe.locator('#view').evaluate(() => window.__proto.ui.session.report().data);
  assert.ok(report.lusitanians.dead + report.romans.dead > 0, 'the replay exercises real casualties');

  const prepared = await save();
  await flag('m31-fail-save', true);
  await iframe.locator('#campaign-return').click();
  await iframe.locator('#campaign-result-error').waitFor();
  assert.deepEqual(await save(), prepared);
  await flag('m31-fail-save', false);
  await iframe.locator('#campaign-return').click();
  await page.locator('#map:not(.hidden)').waitFor();
  await page.locator('#campaign-map-3d[data-status=ready]').waitFor();
  assert.equal(await page.locator('#campaign-tactical-arena').count(), 0);
  assert.equal(await page.locator('html').getAttribute('lang'), 'pt-PT');
  const resolved = await save();
  assert.equal(resolved.phase, 'mapa');
  assert.equal(resolved.battle, null);
  assert.equal(resolved.state.day, pending.state.day);
  assert.equal(resolved.state.battles, 1);
  assert.equal(resolved.state.men, pending.state.men - report.lusitanians.dead);
  assert.equal(resolved.state.patrols.find(p => p.id === PATROL_ID)?.men, 18 - report.romans.dead);
  const outcome = resolved.journal.filter(e => e.type === 'emboscada-tatica');
  assert.equal(outcome.length, 1);
  assert.equal(outcome[0].outcome, report.outcome);
  await page.locator('#m-diary').click();
  await page.locator('#mdiary-tabs [data-tab="historia"]').click();
  await page.getByRole('tabpanel').getByText(/Romanos sobreviventes:/).waitFor();
  await shot('04-map-diary');
  await page.reload();
  await openMap();
  assert.deepEqual(await save(), resolved);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ seed: report.seed, outcome: report.outcome, alliedDead: report.lusitanians.dead, romanDead: report.romans.dead,
    band: resolved.state.men, patrol: resolved.state.patrols.find(p => p.id === PATROL_ID).men, day: resolved.state.day }));
  console.log('OK: v1 map → encounter → WebGL failure/retry → real battle → save failure/retry → 3D map → reload (en, pt-PT)');
} finally {
  await close();
}
