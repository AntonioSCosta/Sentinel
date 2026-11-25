import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { newCampaign } from '../src/campaign/state.js';
import { startBrowser } from './e2e-lib.mjs';

const out = process.argv[2];
const baseline = process.env.SENTINEL_MAP_BASELINE;
if (out) await mkdir(out, { recursive: true });
const { url, browser, close } = await startBrowser({ root: baseline });
const sizes = [[1440, 900], [1280, 800], [1024, 600], [844, 390], [432, 390]];
const shot = (page, name) => out && page.screenshot({ path: join(out, name + '.jpg'), type: 'jpeg', quality: 80 });
const fixture = newCampaign(1234);
fixture.day = 30;
fixture.done.push('cativos');
for (const [id, posture, trust, fear] of [
  ['ribeira', 'comprometida', 85, 25], ['souto', 'amiga', 31, 20], ['penedo', 'neutra', 40, 40],
  ['vau', 'receosa', 27, 49], ['fonte', 'colabora', 15, 75],
]) Object.assign(fixture.communities[id], { posture, trust, fear });
fixture.intel = {
  n: 3,
  known: {
    patrol: { kind: 'patrulha', x: 345, y: 300, day: 30, men: 6 },
    convoy: { kind: 'comboio', x: 515, y: 485, day: 29, men: 9 },
  },
  reports: [
    { id: 1, kind: 'pretor', x: 600, y: 265, r: 55, seen: 0, got: 0, rel: 'fraca', src: 'rumor' },
    { id: 2, kind: 'patrulha', x: 425, y: 405, r: 55, seen: 28, got: 28, rel: 'fraca', src: 'rumor' },
    { id: 3, kind: 'pretor', x: 670, y: 365, r: 55, seen: 29, got: 29, rel: 'fraca', src: 'rumor' },
  ],
};
const raw = JSON.stringify({ v: 1, phase: 'mapa', state: fixture, battle: null });
const errors = [];
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

function measure(page) {
  return page.evaluate(() => {
    const box = element => element?.getBoundingClientRect();
    const visible = element => element && box(element).width > 0 && getComputedStyle(element).visibility === 'visible';
    const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const q = selector => document.querySelector(selector);
    const labels = Array.from(document.querySelectorAll('#campaign-map-3d .map-label')).filter(visible);
    const rects = labels.map(box);
    const stage = box(q('#campaign-map-3d'));
    const inside = r => r.left >= stage.left && r.top >= stage.top && r.right <= stage.right && r.bottom <= stage.bottom;
    const dock = q('.map-dock'), party = q('.party-label'), strip = q('#m-int');
    const dockBox = box(dock);
    const actions = [q('#m-community'), q('#m-map-details')].filter(visible);
    const hud = q('#mtop'), resources = q('#mtop .res');
    const hudItems = [q('#mtop .when'), q('#m-time'), resources, q('#m-side-toggle'), q('#mtop .map-language')].filter(visible).map(box);
    return {
      labels: labels.length,
      communities: labels.filter(el => el.classList.contains('community')).length,
      known: labels.filter(el => el.dataset.kind === 'force').length,
      posts: labels.filter(el => el.dataset.id?.startsWith('posto-')).length,
      rumors: labels.filter(el => el.classList.contains('rumor-zone')).length,
      overlaps: rects.reduce((n, r, i) => n + rects.slice(i + 1).filter(other => overlaps(r, other)).length, 0),
      clipped: rects.filter(r => !inside(r)).length,
      party: visible(party),
      dockOverlap: visible(dock) && ((visible(party) && overlaps(box(dock), box(party)))
        || (visible(strip) && overlaps(box(dock), box(strip)))),
      labelsUnderDock: rects.filter(r => visible(dock) && overlaps(r, dockBox)).length,
      actionsVisible: actions.length,
      actionsOnTop: actions.every(el => {
        const r = box(el);
        return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }),
      hudFits: box(resources).right <= box(hud).right && Array.from(resources.children).every(el => box(el).right <= box(hud).right),
      hudOverlaps: hudItems.reduce((n, r, i) => n + hudItems.slice(i + 1).filter(other => overlaps(r, other)).length, 0),
      visibleCount: q('#m-community-count')?.textContent || '',
    };
  });
}

async function checkDetails(page) {
  const map = page.locator('#campaign-map-3d');
  const details = page.locator('#m-map-details');
  const start = await measure(page);
  const save = () => page.evaluate(() => localStorage.getItem('viriato.campaign'));
  const before = await save();
  await details.click();
  await map.locator('.map-label.place:not([data-id^="posto-"]):visible').first().waitFor();
  const expanded = await measure(page);
  assert.ok(expanded.labels > start.labels);
  assert.ok(expanded.rumors > start.rumors);
  assert.equal(expanded.known, start.known);
  await details.click();
  await settle(page);
  assert.equal((await measure(page)).labels, start.labels);
  assert.equal(await save(), before);
  await page.locator('#m-diary').click();
  await page.locator('#mdiary-tab-relatos').click();
  assert.equal(await page.locator('#mdiary [data-report]').count(), 2);
  await page.locator('#mdiary .arch').click();
  assert.equal(await page.locator('#mdiary [data-report]').count(), 1);
  await page.locator('#mdiary-close').click();
}

const campaign = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'pt-PT', reducedMotion: 'reduce' });
campaign.on('pageerror', e => errors.push(e.message));
try {
  await campaign.addInitScript(save => localStorage.setItem('viriato.campaign', save), raw);
  await campaign.goto(url);
  await campaign.locator('#camp-cont:not(.hidden)').click({ timeout: 60000 });
  await campaign.locator('#campaign-map-3d[data-status=ready]').waitFor({ timeout: 60000 });
  const results = {};
  for (const [width, height] of sizes) {
    await campaign.setViewportSize({ width, height });
    if (width <= 844 && await campaign.locator('#mside').isVisible()) await campaign.locator('#m-side-toggle').click();
    await settle(campaign);
    const id = width + 'x' + height;
    const value = results[id] = await measure(campaign);
    await shot(campaign, (baseline ? 'before-' : 'after-') + id);
    assert.equal(value.overlaps, 0, id);
    assert.equal(value.clipped, 0, id);
    if (!baseline) {
      if (width > 432) assert.equal(value.known, 2, id);
      assert.ok(value.posts && value.party && (width <= 432 || value.rumors), JSON.stringify({ id, ...value }));
      assert.match(value.visibleCount, new RegExp(`^${value.communities}/5 `), id);
      assert.ok(!value.dockOverlap && !value.labelsUnderDock && value.hudFits && !value.hudOverlaps && value.actionsVisible === 2 && value.actionsOnTop, id);
      assert.equal(await campaign.locator('#m-community option').count(), 6);
    }
  }
  if (out) await writeFile(join(out, 'metrics.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results));

  if (baseline && process.env.SENTINEL_MAP_BLOCKER) {
    await campaign.setViewportSize({ width: 844, height: 390 });
    await campaign.locator('#map-language').selectOption('en');
    await campaign.evaluate(id => {
      const c = window.__game.campaign;
      Object.assign(c.flow.state.communities.fonte, { situation: 'abandonada', families: 0 });
      c.select(id);
      c.flow.state.food = 2;
      c.step();
    }, fixture.communities.fonte.settlement);
    await campaign.locator('#m-int:not(.hidden)').waitFor();
    if (await campaign.locator('#mside').isVisible()) await campaign.locator('#m-side-toggle').click();
    await settle(campaign);
    const paused = await measure(campaign);
    if (out) await writeFile(join(out, 'interruption.json'), JSON.stringify(paused, null, 2) + '\n');
    await shot(campaign, 'before-844x390-interruption');
    console.log(JSON.stringify({ beforePaused: paused }));
  }

  if (!baseline) {
    await campaign.setViewportSize({ width: 844, height: 390 });
    await settle(campaign);
    const expectFame = new RegExp('^' + fixture.fame + ' / 30$');
    assert.match(await campaign.locator('#m-fame').textContent(), expectFame);
    assert.equal(await campaign.locator('.confirmed[data-id="patrol"]').isVisible(), true);
    const lastSeen = campaign.locator('.estimated[data-id="convoy"]');
    assert.equal(await lastSeen.isVisible(), true);
    assert.match(await lastSeen.textContent(), /há 1 d/);
    assert.equal(await lastSeen.evaluate(el => getComputedStyle(el).borderStyle), 'dashed');
    const palette = await campaign.locator('.map-label.community').evaluateAll(elements => elements.map(el => {
      const css = getComputedStyle(el);
      const rgb = css.backgroundColor.match(/\d+/g).slice(0, 3).map(c => {
        const v = Number(c) / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      const light = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
      return { posture: el.dataset.posture, color: css.color, contrast: 1.05 / (light + 0.05) };
    }));
    assert.equal(new Set(palette.map(el => el.posture)).size, 5);
    assert.ok(palette.every(el => el.color === 'rgb(255, 255, 255)' && el.contrast >= 4.5));
    if (out) await writeFile(join(out, 'palette.json'), JSON.stringify(palette, null, 2) + '\n');
    console.log(JSON.stringify({ palette }));
    await campaign.setViewportSize({ width: 1440, height: 900 });
    await settle(campaign);
    await checkDetails(campaign);

    const souto = campaign.locator(`.map-label[data-id="${fixture.communities.souto.settlement}"]`);
    const match = await souto.elementHandle();
    await campaign.evaluate(() => {
      const c = window.__game.campaign, s = c.flow.state;
      Object.assign(s.communities.souto, { situation: 'tributada', due: { food: 5, day: s.day + 4 } });
      c.render();
    });
    await campaign.locator('#mtribute:not(.hidden)').waitFor();
    await campaign.keyboard.press('Escape');
    await settle(campaign);
    assert.equal(await souto.evaluate(el => el.classList.contains('has-issue')), true);
    await campaign.locator('#m-review').click();
    await campaign.locator('#mtribute [data-act=pagar]').click();
    await settle(campaign);
    assert.equal(await match.evaluate(el => el.isConnected && el.dataset.posture === 'neutra'), true);
    assert.equal(await campaign.evaluate(() => window.__game.campaign.running), false);

    const fonteId = fixture.communities.fonte.settlement;
    await campaign.evaluate(() => {
      const c = window.__game.campaign;
      Object.assign(c.flow.state.communities.fonte, { situation: 'abandonada', families: 0 });
      c.render();
    });
    await settle(campaign);
    const abandoned = campaign.locator(`.community[data-id="${fonteId}"]`);
    assert.equal(await abandoned.getAttribute('data-posture'), 'abandonada');
    assert.match(await abandoned.getAttribute('aria-label'), /abandonada/);
    assert.equal(await abandoned.evaluate(el => getComputedStyle(el).borderStyle), 'dashed');

    await campaign.setViewportSize({ width: 844, height: 390 });
    await campaign.locator('#map-language').selectOption('en');
    await settle(campaign);
    assert.match(await campaign.locator('#m-fame-box').textContent(), /Fame\s*20 \/ 30/);
    assert.match(await abandoned.getAttribute('aria-label'), /abandoned/);
    const zoom = campaign.locator('[data-camera=in]');
    for (let n = 0; n < 12; n++) await zoom.evaluate(el => el.click());
    await settle(campaign);
    const hidden = await campaign.locator('.map-label.community').evaluateAll(els =>
      els.find(el => getComputedStyle(el).visibility === 'hidden')?.dataset.id);
    assert.ok(hidden);
    assert.match(await campaign.locator('#m-community-count').textContent(), /^[0-4]\/5 visible$/);
    const select = campaign.locator('#m-community');
    await select.focus();
    assert.equal(await select.evaluate(el => el === document.activeElement), true);
    await select.selectOption(hidden);
    await campaign.locator('#mctx h3').waitFor();
    assert.equal(await campaign.locator('#mctx h3').evaluate(el => el === document.activeElement), true);
    await select.selectOption(fixture.communities.souto.settlement);
    await select.press('End');
    assert.equal(await campaign.locator('#mctx h3').textContent(), 'Fonte Village');
    await campaign.locator('[data-camera=reset]').evaluate(el => el.click());

    await campaign.evaluate(() => {
      const c = window.__game.campaign;
      c.flow.state.food = 2;
      c.step();
    });
    await campaign.locator('#m-int:not(.hidden)').waitFor();
    if (await campaign.locator('#mside').isVisible()) await campaign.locator('#m-side-toggle').click();
    await settle(campaign);
    const paused = await measure(campaign);
    console.log(JSON.stringify({ paused }));
    assert.ok(!paused.dockOverlap && paused.actionsOnTop && paused.party);
    assert.equal(paused.communities, 5);
    assert.equal(paused.known, 2);
    assert.equal(paused.overlaps + paused.clipped, 0);
    assert.equal(paused.labelsUnderDock, 0);
    assert.match(paused.visibleCount, /^5\/5 /);
    if (out) await writeFile(join(out, 'interruption.json'), JSON.stringify(paused, null, 2) + '\n');
    await shot(campaign, 'after-844x390-interruption');

    const other = await browser.newPage({ viewport: { width: 844, height: 390 }, locale: 'pt-PT' });
    other.on('pageerror', e => errors.push(e.message));
    await other.addInitScript(save => localStorage.setItem('viriato.campaign', save),
      JSON.stringify({ v: 1, phase: 'mapa', state: newCampaign(4711), battle: null }));
    await other.goto(url);
    await other.locator('#camp-cont:not(.hidden)').click();
    await other.locator('#campaign-map-3d[data-status=ready]').waitFor();
    if (await other.locator('#mside').isVisible()) await other.locator('#m-side-toggle').click();
    await settle(other);
    const otherResult = await measure(other);
    assert.equal(otherResult.communities, 5);
    assert.equal(otherResult.overlaps + otherResult.clipped, 0);
    assert.equal(otherResult.labelsUnderDock, 0);
    assert.match(otherResult.visibleCount, /^5\/5 /);
    if (out) await writeFile(join(out, 'seed-4711.json'), JSON.stringify(otherResult, null, 2) + '\n');
    await shot(other, 'after-seed-4711');
    await other.close();

    const viewer = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'en' });
    viewer.on('pageerror', e => errors.push(e.message));
    await viewer.goto(new URL('campaign-map-3d.html', url).href);
    await viewer.locator('#map-labels .map-label:visible').first().waitFor({ timeout: 60000 });
    await viewer.locator('#save-file').setInputFiles({ name: 'b2.json', mimeType: 'application/json', buffer: Buffer.from(raw) });
    await viewer.locator('#known-count').filter({ hasText: '2' }).waitFor();
    assert.equal(await viewer.locator('#map-labels [data-posture]').count(), 0);
    assert.equal(await viewer.locator('#m-map-details').count(), 0);
    await viewer.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await close();
}
