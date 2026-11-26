import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { newCampaign } from '../src/campaign/state.js';
import { startE2E } from './e2e-lib.mjs';

const { url, browser, check, finish } = await startE2E({ entry: 'index.html?manual=1&map=3d' });
const captures = process.argv[2];
if (captures) await mkdir(captures, { recursive: true });

async function open(legacy = false, init) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce', locale: 'pt-PT' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (init) await page.addInitScript(init);
  const state = newCampaign(3);
  delete state.communities;
  state.food = 400;
  state.done.push('cativos');
  const legacySave = JSON.stringify({ v: 1, phase: 'mapa', state, battle: null });
  await page.addInitScript(save => localStorage.setItem('viriato.campaign', save), legacySave);
  await page.goto(legacy ? url + '&legacy-map-test=1' : url);
  await page.waitForFunction(() => !!window.__game, null, { timeout: 60000 });
  await page.locator('#camp-cont:not(.hidden)').click({ timeout: 60000 });
  await page.locator('#map:not(.hidden)').waitFor();
  return { page, errors };
}

async function checkReconClicks(page) {
  // Clear the replay's standing march before testing a new mouse order.
  await page.evaluate(() => {
    const { campaign } = window.__game;
    if (campaign.dest) { document.getElementById('m-ambush').click(); document.getElementById('m-ambush').click(); campaign.pause(); }   // outra ordem cancela-a; o segundo clique desarma a emboscada e o tempo volta a parar
  });
  await page.locator('#m-recon').click();
  let spot;
  for (const [x, y] of [[650, 242], [685, 264], [655, 300], [750, 270]]) {
    if (!await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id === 'm-scene', [x, y])) continue;
    await page.mouse.move(x, y);
    try {
      await page.locator('.map-preview').filter({ hasText: /Reconhecer.*batedores/ }).waitFor({ timeout: 1200 });
      spot = [x, y];
      break;
    } catch {}
  }
  assert.ok(spot, 'a point of terrain within reconnaissance range is visible');
  const read = () => page.evaluate(() => {
    const { campaign } = window.__game;
    return { day: campaign.flow.state.day, dest: campaign.dest, running: campaign.running };
  });
  const { day } = await read();
  await page.mouse.dblclick(...spot);
  assert.deepEqual(await read(), { day: day + 1, dest: null, running: false },
    'the second click after reconnaissance must not start a march');

  await page.locator('#m-recon').click();
  await page.mouse.click(...spot);
  assert.deepEqual(await read(), { day: day + 2, dest: null, running: false },
    'explicitly rearming reconnaissance enables another mouse order');

  await page.waitForTimeout(650);
  await page.mouse.click(...spot);
  assert.ok((await read()).dest, 'an intentional later click can still set a destination');
  await page.locator('#m-pause').click();
  check('Reconhecimento com rato: duplo clique não marcha, nova ordem explícita e clique tardio funcionam', true);
}

async function replay(legacy) {
  const { page, errors } = await open(legacy);
  const stage = page.locator('#campaign-map-3d');
  try {
    if (!legacy) {
      await page.locator('#campaign-map-3d[data-status=ready]').waitFor({ timeout: 60000 });
      assert.equal(await page.locator('#mapcv').isVisible(), false);
      assert.equal(await page.getByRole('button', { name: /mapa 2D/i }).count(), 0);
      assert.equal(await page.evaluate(() => window.__game.campaign.flow.state.day), 0);
      if (captures) await page.screenshot({ path: join(captures, 'campanha-geral.png') });
    } else {
      assert.equal(await stage.isVisible(), false);
    }

    const march = await page.evaluate(legacyMap => {
      const { campaign } = window.__game;
      const s = campaign.flow.state;
      const place = s.world.settlements.find(p => p.id === s.communities.ribeira.settlement);
      function clickPlace() {
        if (!legacyMap) {
          document.getElementById('campaign-map-3d').querySelector(`[data-id="${place.id}"]`).click();
          return;
        }
        const view = campaign.view(), canvas = document.getElementById('mapcv');
        const rect = canvas.getBoundingClientRect();
        canvas.dispatchEvent(new MouseEvent('click', {
          clientX: rect.left + view.ox + place.x * view.scale,
          clientY: rect.top + view.oy + place.y * view.scale,
        }));
      }
      clickPlace();
      const selected = document.getElementById('mctx').textContent.includes('Aldeia da Ribeira');
      document.querySelector('#mctx [data-act="ir"]').click();
      const destination = campaign.dest;
      document.getElementById('m-pause').click();
      campaign.step();
      // Use the same exact strategic coordinates in both renderers for save parity.
      campaign.order({ kind: 'reconhecer', to: { x: place.x, y: place.y } });
      return { selected, destination, place, day: s.day };
    }, legacy);
    assert.equal(march.selected, true);
    assert.deepEqual(march.destination, { x: march.place.x, y: march.place.y });
    assert.equal(march.day, 2);
    if (!legacy) {
      await page.locator('.map-preview').filter({ hasText: /comida/ }).waitFor();
      if (captures) {
        await page.locator('#campaign-map-3d [data-camera=in]').click();
        await page.screenshot({ path: join(captures, 'campanha-aproximada.png') });
      }
    }

    const before = await page.evaluate(() => {
      const c = window.__game.campaign;
      return { state: c.flow.state, journal: c.flow.journal, phase: c.flow.phase,
        save: localStorage.getItem('viriato.campaign') };
    });

    if (!legacy) {
      await page.locator('#m-recon').click();
      await page.locator(`#campaign-map-3d [data-id="${march.place.id}"]`).evaluate(button => button.click());
      assert.equal(await page.evaluate(() => window.__game.campaign.flow.state.day), 3);
      await page.locator('#m-time [data-speed="1"]').click();
      await page.waitForFunction(() => window.__game.campaign.flow.state.day >= 4);
      await page.locator('#m-pause').click();
      assert.equal(await page.evaluate(() => window.__game.campaign.running), false);
      await checkReconClicks(page);
      await page.setViewportSize({ width: 844, height: 390 });
      if (!await page.locator('#mside').isVisible()) await page.locator('#m-side-toggle').click();
      await page.locator('#mside').waitFor();
      await page.waitForFunction(() => {
        const stage = document.getElementById('campaign-map-3d');
        const panel = document.getElementById('mside').getBoundingClientRect();
        const canvas = document.getElementById('m-scene');
        const labels = [...stage.querySelectorAll('.map-label')].filter(label => label.style.visibility === 'visible');
        return canvas.clientWidth === canvas.width && labels.length > 0 &&
          labels.every(label => label.getBoundingClientRect().right <= panel.left);
      });
      check('No ecrã estreito, os rótulos evitam a gaveta de assuntos', true);
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.evaluate(() => {
        const G = window.__game;
        // Keep the test campaign alive after the forced defeat.
        G.campaign.flow.state.fame = 50;
        const men = G.campaign.flow.state.men;
        G.campaignTest.forceBattle({ type: 'historica', chapter: 'cativos', seed: 1, site: 'castro',
          realMen: men, allies: men, enemies: { legio: 1 } });
        window.flowBeforeBattle = G.campaign.flow;
      });
      await page.locator('#mb-fight').click();
      await page.locator('#map').waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => window.__game.chapter), 'cativos');
      await page.evaluate(() => {
        if (document.pointerLockElement) document.exitPointerLock();
        else document.dispatchEvent(new Event('pointerlockchange'));
      });
      await page.locator('#abandon:not(.hidden)').click();
      await page.locator('#map:not(.hidden)').waitFor();
      assert.ok(await page.evaluate(() => window.__game.campaign.flow === window.flowBeforeBattle &&
        window.__game.campaign.flow.phase === 'mapa'));
      await page.locator('#campaign-map-3d[data-status=ready]').waitFor();
      assert.equal(await page.locator('#mapcv').isVisible(), false);
      check('3D predefinido: gravação v1, seleção, marcha, reconhecimento, tempo e regresso do combate', true);
      await page.locator('#m-scene').dispatchEvent('webglcontextlost');
      await page.locator('#campaign-map-3d .map-error').waitFor();
      assert.match(await page.locator('#campaign-map-3d .map-error').textContent(), /WebGL/);
      assert.equal(await page.locator('#mapcv').isVisible(), false);
      check('Perda do contexto apresenta mensagem e mantém o 2D oculto', true);
    }
    assert.deepEqual(errors, []);
    return before;
  } finally {
    await page.close();
  }
}

try {
  const legacy = await replay(true);
  const current = await replay(false);
  assert.deepEqual(current, legacy);
  check('2D legado e 3D: estado, Diário, fase e gravação idênticos após as mesmas ordens', true);

  const { page } = await open(false, () => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      if (this.id === 'm-scene' && kind.includes('webgl')) return null;
      return original.call(this, kind, ...args);
    };
  });
  try {
    await page.locator('#campaign-map-3d .map-error').waitFor();
    assert.match(await page.locator('#campaign-map-3d .map-error').textContent(), /WebGL/);
    assert.equal(await page.locator('#mapcv').isVisible(), false);
    assert.equal(await page.locator('#m-ambush').isDisabled(), true);
    check('Falha de WebGL apresenta mensagem e mantém o 2D oculto', true);
  } finally {
    await page.close();
  }
} catch (error) {
  check('Regressão do mapa estratégico', false, error.stack);
}
await finish();
