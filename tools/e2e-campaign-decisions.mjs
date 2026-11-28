import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadFlow, STORAGE_KEY } from '../src/campaign/flow.js';
import { startBrowser, setLanguage } from './e2e-lib.mjs';

const out = process.argv[2];
const baseline = process.env.SENTINEL_DECISIONS_BASELINE;
if (out) await mkdir(out, { recursive: true });
const { url, browser, close } = await startBrowser({ root: baseline });
const desktop = { width: 1440, height: 900 }, compact = { width: 844, height: 390 };
const errors = [];
const shot = (page, name) => out && page.screenshot({ path: join(out, name + '.jpg'), type: 'jpeg', quality: 82 });
const save = page => page.evaluate(key => localStorage.getItem(key), STORAGE_KEY);
const startMap = async (page, locale) => {
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => !!window.__game, null, { timeout: 60000 });
  await page.evaluate(locale => {
    const game = window.__game;
    game.campaignStorage.clear();
    game.startCampaign(1234);
    game.showCampaignMap();
    game.i18n.setLocale(locale);
  }, locale);
  await page.locator('#mapcv').waitFor({ timeout: 60000 });
};
const reload = async page => {
  await page.reload();
  await page.locator('#camp-cont:not(.hidden)').click({ timeout: 60000 });
  await page.locator('#map:not(.hidden)').waitFor({ timeout: 60000 });
};

async function decisions(page) {
  await startMap(page, 'en');
  await page.evaluate(hasBaseline => {
    const campaign = window.__game.campaign, { state, journal } = campaign.flow;
    if (!hasBaseline) campaign.select(state.communities.souto.settlement);
    Object.assign(state.communities.vau, { situation: 'tributada', due: { food: 6, day: state.day + 4 }, food: 30 });
    Object.assign(state.communities.ribeira, { situation: 'tributada', due: { food: 10, day: state.day + 6 }, food: 3 });
    journal.push({ day: state.day, type: 'castigo', id: state.communities.souto.settlement, why: 'apoio' });
    campaign.flow.save();
    campaign.render();
  }, !!baseline);
  if (baseline) {
    await page.locator('#m-side-toggle').click();
    await page.locator('#missues-list .t-tributo').first().waitFor();
    await shot(page, '01-before-tribute-compact');
    return;
  }

  const panel = page.locator('#mtribute'), pay = panel.locator('[data-act=pagar]');
  const refuse = panel.locator('[data-act=recusar]'), later = panel.locator('#mtribute-later');
  const pending = await save(page);
  await panel.waitFor();
  const bounds = await panel.locator('.card').boundingBox();
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= compact.width && bounds.y + bounds.height <= compact.height);
  assert.match(await panel.textContent(), /Rome demands tribute from Vau Village/);
  assert.match(await panel.textContent(), /Due in 4 days/);
  assert.equal(await page.locator('#mctx').isVisible(), true);
  assert.equal(await page.locator('#mctx').evaluate(el => el.closest('#mside').inert), true);
  assert.equal(await pay.evaluate(el => document.activeElement === el), true);
  assert.equal(await panel.locator('select').count(), 0, 'sem seletor de idioma na decisão (só no menu principal)');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await later.evaluate(el => document.activeElement === el), true);
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowRight');
  await page.mouse.click(16, compact.height - 16);
  assert.equal(await page.evaluate(() => window.__game.campaign.dest), null);
  assert.equal(await page.locator('#m-ambush').getAttribute('aria-pressed'), 'false');   // o toque no canto não atravessa o painel
  assert.equal(await save(page), pending);
  await shot(page, '02-after-tribute-compact');

  await later.focus();
  await setLanguage(page, 'pt-PT');
  assert.match(await panel.textContent(), /Roma exige tributo a Aldeia do Vau/);
  assert.equal(await later.evaluate(el => document.activeElement === el), true, 'mudar de idioma não tira o foco do painel');
  await page.keyboard.press('Escape');
  assert.match(await panel.textContent(), /Roma exige tributo a Aldeia da Ribeira/);
  assert.equal(await pay.count(), 0);
  assert.match(await panel.textContent(), /Pagar exige 10 de comida/);
  assert.equal(await refuse.evaluate(el => document.activeElement === el), true);
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden' });
  assert.match(await page.locator('#m-int').textContent(), /Decisões pendentes: 2/);
  assert.equal(await page.evaluate(() => window.__game.campaign.running), false);
  assert.equal(await save(page), pending);

  await reload(page);
  await panel.waitFor();
  assert.match(await panel.textContent(), /Aldeia do Vau/);
  await setLanguage(page, 'en');
  await page.setViewportSize(desktop);
  await shot(page, '03-after-tribute-desktop');
  const oldPay = await pay.elementHandle();
  await pay.press('Enter');
  await oldPay.evaluate(el => el.click()); // a stale second activation cannot charge twice
  assert.match(await panel.textContent(), /Ribeira Village/);
  await refuse.click();
  await panel.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.__game.campaign.running), false);
  assert.match(await page.locator('#m-int').textContent(), /You refused the tribute/);

  let expected = pending;
  const memory = { getItem: () => expected, setItem: (_key, next) => { expected = next; } };
  const oracle = loadFlow(memory);
  assert.ok(!oracle.payTribute('vau').refused);
  assert.ok(!oracle.refuseTribute('ribeira').refused);
  assert.deepEqual(JSON.parse(await save(page)), JSON.parse(expected));
}

async function interruption(page) {
  await startMap(page, 'en');
  const state = await page.evaluate(historicalBaseline => {
    const campaign = window.__game.campaign, flow = campaign.flow;
    flow.state.food = 2;
    // B3.1 keeps food warnings in the HUD. The spring harvest is information: it no longer stops a march.
    if (!historicalBaseline) flow.state.day = 91;
    const place = flow.state.world.settlements.find(p => p.id === flow.state.communities.vau.settlement);
    campaign.select(place.id);
    document.querySelector('#mctx [data-act=ir]').click();
    campaign.step();
    return { reasons: campaign.interrupt.map(x => x.type), running: campaign.running, dest: campaign.dest };
  }, !!baseline);
  assert.equal(await page.locator('#mctx').isVisible(), true);
  if (baseline) {
    assert.ok(state.reasons.includes('comida'));
    assert.equal(state.running, false);
    assert.equal(await page.locator('#m-int').isVisible(), false);
    await shot(page, '04-before-interruption-selected');
    return;
  }
  assert.deepEqual(state.reasons, [], 'a colheita não interrompe');
  assert.equal(state.running, true, 'a marcha continua');
  assert.ok(state.dest);
  assert.equal(await page.locator('#m-int').isVisible(), false, 'sem faixa de interrupção');
  await page.evaluate(() => window.__game.campaign.pause());
  const log = page.locator('#mlog');
  assert.match(await log.textContent(), /The spring harvest added/, 'a colheita fica no registo');
  assert.equal(await page.locator('#m-food-raw').textContent(), '(0)');
  await shot(page, '05-after-harvest-no-interruption');
  await setLanguage(page, 'pt-PT');
  assert.match(await log.textContent(), /A colheita de primavera acrescentou/, 'o registo muda de idioma');
}

async function chapter(page) {
  await startMap(page, 'en');
  await page.evaluate(() => {
    const campaign = window.__game.campaign;
    campaign.flow.state.day = 10;
    campaign.flow.save();
    campaign.render();
  });
  assert.match(await page.locator('#m-int').textContent(), /The next order opens The Captives/);
  assert.equal(await page.locator('#mbattle').isVisible(), false);
  await page.evaluate(() => window.__game.campaign.step());
  const battle = page.locator('#mbattle');
  await battle.waitFor();
  assert.match(await battle.textContent(), /Campaign chapter.*The Captives/s);
  assert.equal(await page.locator('#mb-withdraw').isVisible(), false);
  assert.equal(await page.locator('#mb-fight').evaluate(el => document.activeElement === el), true);
  const pending = await save(page);
  assert.equal(JSON.parse(pending).state.day, 10);
  assert.equal(JSON.parse(pending).battle.chapter, 'cativos');
  assert.equal(await battle.locator('select').count(), 0);
  await setLanguage(page, 'pt-PT');
  assert.match(await battle.textContent(), /Capítulo da campanha.*Os Cativos/s);
  await shot(page, '07-after-pending-chapter');
  await reload(page);
  assert.equal(await battle.isVisible(), true);
  assert.equal(await save(page), pending);
}

try {
  const decisionPage = await browser.newPage({ viewport: compact, locale: 'en', reducedMotion: 'reduce' });
  await decisions(decisionPage); await decisionPage.close();
  const marchPage = await browser.newPage({ viewport: compact, locale: 'en', reducedMotion: 'reduce' });
  await interruption(marchPage); await marchPage.close();
  if (!baseline) {
    const chapterPage = await browser.newPage({ viewport: compact, locale: 'en', reducedMotion: 'reduce' });
    await chapter(chapterPage); await chapterPage.close();
  }
  assert.deepEqual(errors, []);
  console.log(baseline ? 'OK baseline tribute and hidden interruption' : 'OK campaign decisions, language, keyboard, persistence and responsive interruption');
} finally {
  await close();
}
