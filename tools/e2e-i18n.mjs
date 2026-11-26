// Browser-language detection, live changes and v1 save parity across locales.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { newCampaign } from '../src/campaign/state.js';
import { startE2E } from './e2e-lib.mjs';

const { url, browser, check, finish } = await startE2E();
const captures = process.argv[2];
if (captures) await mkdir(captures, { recursive: true });

async function assertControls(page, selectors) {
  const problems = await page.evaluate(selectors => {
    const inside = (a, b) => a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
    const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    return selectors.flatMap(([group, child]) => {
      const container = document.querySelector(group).getBoundingClientRect();
      const controls = [...document.querySelectorAll(child)].map(element => ({ element, bounds: element.getBoundingClientRect() }))
        .filter(({ bounds }) => bounds.width && bounds.height);
      return controls.flatMap(({ element, bounds }, index) => {
        const label = element.id || element.textContent;
        const issues = controls.slice(index + 1).filter(control => overlaps(bounds, control.bounds))
          .map(control => `${label} overlaps ${control.element.id || control.element.textContent}`);
        if (!inside(bounds, container) || element.scrollWidth > element.clientWidth + 1) issues.push(label);
        return issues;
      });
    });
  }, selectors);
  assert.deepEqual(problems, []);
}

async function scenario(browserLocale, initial, next) {
  const page = await browser.newPage({ locale: browserLocale, viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.text().startsWith('Missing translation')) errors.push(message.text()); });
  try {
    const state = newCampaign(3);
    delete state.communities;
    state.food = 1000;
    state.done.push('cativos');
    // uma entrada do Diário gravada antes da tradução do baralho: traz `text` em pt-PT, mas mostra-se na língua escolhida
    const journal = [{ type: 'acontecimento', id: 'traidor', text: 'Um traidor foge de noite e leva armas consigo.', day: 1 }];
    const save = JSON.stringify({ v: 1, phase: 'mapa', state, battle: null, journal });
    await page.addInitScript(save => {
      if (!localStorage.getItem('viriato.campaign')) localStorage.setItem('viriato.campaign', save);
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, options) {
        return getContext.call(this, kind, this.id === 'm-scene' && kind.includes('webgl')
          ? { ...options, preserveDrawingBuffer: true } : options);
      };
    }, save);
    await page.goto(url);
    await page.waitForFunction(() => window.__game, null, { timeout: 60000 });
    assert.equal(await page.title(), 'Sentinel');
    assert.equal(await page.locator('html').getAttribute('lang'), initial);
    assert.equal(await page.locator('#start').textContent(), initial === 'en' ? 'PLAY' : 'COMEÇAR');
    if (captures) {
      await page.setViewportSize({ width: 390, height: 730 });
      await assertControls(page, [['#menu', '#menu .menu-foot button']]);
      await page.screenshot({ path: join(captures, `menu-${initial}.png`) });
      await page.setViewportSize({ width: 1366, height: 768 });
    }
    await page.locator('#camp-cont:not(.hidden)').click();
    await page.locator('#campaign-map-3d[data-status=ready]').waitFor();
    assert.equal(await page.locator('#m-date').textContent(), initial === 'en' ? '1 March 147 BC' : '1 de março de 147 a.C.');
    assert.equal(await page.locator('#m-food-raw').textContent(), initial === 'en' ? '(1,000)' : '(1000)');
    assert.equal(await page.evaluate(() => localStorage.getItem('viriato.campaign')), save);
    const destination = await page.evaluate(() => {
      const { campaign: c } = window.__game;
      const place = c.flow.state.world.settlements.find(s => s.id === c.flow.state.communities.ribeira.settlement);
      c.select(place.id);
      document.getElementById('m-go').click();
      document.querySelector(`#campaign-map-3d [data-kind=settlement][data-id="${place.id}"]`).click();
      document.getElementById('m-pause').click();
      window.flowBeforeLocale = c.flow;
      return place;
    });
    await page.locator('[data-camera=in]').click();
    await page.locator('[data-camera=right]').click();

    const snapshot = () => page.evaluate(() => {
      const { campaign: c } = window.__game;
      return { sameFlow: c.flow === window.flowBeforeLocale, save: localStorage.getItem('viriato.campaign'),
        state: JSON.stringify(c.flow.state), journal: JSON.stringify(c.flow.journal),
        dest: c.dest, running: c.running, speed: c.speed, interruptions: c.interrupt };
    });
    const before = await snapshot();
    const mapPixels = () => page.locator('#m-scene').evaluate(canvas => canvas.toDataURL());
    const beforePixels = await mapPixels();
    await page.locator('#map-language').selectOption(next);
    await page.locator(`html[lang="${next}"]`).waitFor();
    const title = next === 'en' ? 'Ribeira Village' : 'Aldeia da Ribeira';
    assert.equal(await page.locator('#mctx h3').textContent(), title);
    await page.locator(`#campaign-map-3d [data-id="${destination.id}"]`).filter({ hasText: title }).waitFor({ state: 'attached' });
    assert.equal(await page.locator('[data-camera=reset]').textContent(), next === 'en' ? 'Centre' : 'Centrar');
    assert.deepEqual(await snapshot(), before);
    assert.equal(await mapPixels(), beforePixels, 'changing language preserves camera and rendered geometry');
    await page.locator('#m-diary').click();
    await page.locator('#mdiary-tab-historia').click();
    assert.match(await page.locator('#mdiary-body').textContent(), next === 'en'
      ? /A traitor flees in the night and takes weapons with him\./ : /Um traidor foge de noite e leva armas consigo\./);
    await page.locator('#mdiary-close').click();
    if (captures) {
      await page.screenshot({ path: join(captures, `map-${next}.png`) });
      const layout = [['#mbot', '#mbot button'], ['#mtop', '#mtop button, #m-date, #mtop .res, #mtop .map-language'], ['#campaign-map-3d', '[data-camera]']];
      await page.setViewportSize({ width: 844, height: 390 });
      await assertControls(page, layout);
      await page.screenshot({ path: join(captures, `map-small-${next}.png`) });
      await page.setViewportSize({ width: 390, height: 730 });
      await assertControls(page, layout);
      await page.locator('#map-language').click({ trial: true });
      await page.screenshot({ path: join(captures, `map-phone-${next}.png`) });
    }

    const result = await page.evaluate(({ x, y }) => {
      const { campaign: c } = window.__game;
      c.step();
      c.order({ kind: 'reconhecer', to: { x, y } });
      assertCampaignDay();
      function assertCampaignDay() { if (c.flow.state.day !== 2) throw new Error('Both orders must run'); }
      return localStorage.getItem('viriato.campaign');
    }, destination);
    await page.reload();
    await page.waitForFunction(() => window.__game, null, { timeout: 60000 });
    assert.equal(await page.locator('html').getAttribute('lang'), next);
    assert.equal(await page.locator('#menu-language').inputValue(), next);
    assert.equal(await page.evaluate(() => localStorage.getItem('viriato.campaign')), result);
    assert.deepEqual(errors, []);
    return result;
  } finally { await page.close(); }
}

try {
  const pt = await scenario('fr-FR', 'en', 'pt-PT');
  const en = await scenario('pt-BR', 'pt-PT', 'en');
  assert.equal(pt, en);
  check('Deteção do browser, preferência persistente, troca em jogo e gravação v1 idêntica após as mesmas ordens', true);
} catch (error) {
  check('Internacionalização no navegador', false, error.stack);
}
await finish();
