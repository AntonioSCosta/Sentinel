// Mapa ilustrado como vista por defeito: percurso real do jogador (sem query params), fallback para o 3D
// quando as texturas falham, e os dois opt-ins (?map=3d, ?map=illustrated). Uso: node tools/e2e-campaign-default-map.mjs [pasta-de-capturas]
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { startBrowser } from './e2e-lib.mjs';

const evidence = process.argv[2];
if (evidence) await mkdir(evidence, { recursive: true });
const { url, browser, close } = await startBrowser({ entry: 'index.html' });
const errors = [], warnings = [];
const open = async (query = '', route) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'pt-PT' });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/\b404\b/.test(m.text())) errors.push(m.text()); if (m.type() === 'warning') warnings.push(m.text()); });
  if (route) await page.route(...route);
  await page.goto(new URL('index.html' + query, url).href);
  await page.waitForFunction(() => window.__game?.campaign, null, { timeout: 60000 });
  return page;
};
const shot = (page, name) => evidence && page.screenshot({ path: join(evidence, name + '.jpg'), type: 'jpeg', quality: 90 });
const camera = page => page.evaluate(() => window.__game.campaign.view().scale);
/** Abre o mapa sem prólogo (para os testes de renderer); o percurso A faz o prólogo a sério. */
const openMap = page => page.evaluate(() => { window.__game.campaign.fresh(1234); window.__game.showCampaignMap(); });
const renderer = page => page.evaluate(() => ({
  canvas: !document.getElementById('mapcv').closest('.hidden') && !document.getElementById('mapcv').classList.contains('hidden'),
  stage3d: document.getElementById('campaign-map-3d').dataset.status ?? null,
}));

try {
  // A. Percurso real: sem query params → nova campanha → prólogo → mapa ilustrado → ordem → avançar → guardar → recarregar → continuar.
  {
    const page = await open();
    assert.equal(new URL(page.url()).search, '', 'sem query params');
    await page.locator('#camp-new').click();
    await page.waitForFunction(() => window.__game.chapter === 'prologo' && window.__game.introT > 0);
    await page.keyboard.press('Enter');                        // salta a abertura, como o jogador pode fazer
    await page.waitForFunction(() => !document.getElementById('hud').classList.contains('intro'));
    // A fuga é jogada a sério; o teste só leva Viriato até à brecha, que é o que dispara o epílogo do prólogo.
    await page.evaluate(() => { const g = window.__game; g.P.pos.x = g.ESCAPE.x; g.P.pos.z = g.ESCAPE.z; });
    await page.waitForFunction(() => [...document.body.children].some(e => e.textContent === 'ENTER para saltar' && e.style.display === 'block'));
    await page.keyboard.press('Enter');                        // salta o epílogo → showCampaignMap()
    await page.locator('#mapcv').waitFor({ timeout: 60000 });
    await page.waitForFunction(() => window.__game.campaign.active && window.__game.campaign.flow.phase === 'mapa');
    assert.deepEqual(await renderer(page), { canvas: true, stage3d: null }, 'mapa ilustrado visível, 3D nunca montado');
    await page.waitForTimeout(500);
    // HUD limpo: sem «Ir», sem seletor de idioma no cabeçalho; a marcha é o clique simples no mapa.
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#mbot button')].map(b => b.id)), ['m-ambush', 'm-hide', 'm-recon', 'm-diary']);
    assert.equal(await page.locator('#m-go, #map-language, #mtop select').count(), 0);
    await shot(page, '01-mapa-inicial');

    const box = await page.locator('#mapcv').boundingBox();
    const initial = await camera(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -480);
    await page.waitForFunction(s => window.__game.campaign.view().scale > 1.8 * s, initial);
    await page.waitForTimeout(450);
    await shot(page, '02-mapa-zoom');
    await page.locator('#mapcv').focus();
    await page.keyboard.press('Home');
    await page.waitForFunction(s => Math.abs(window.__game.campaign.view().scale - s) < .01, initial);

    // Destino: terreno livre (a mais de 50 unidades de qualquer povoação) à vista, a ~100 unidades do bando.
    const target = await page.evaluate(() => {
      const c = window.__game.campaign, { party, world } = c.flow.state, v = c.view(), r = document.getElementById('mapcv').getBoundingClientRect();
      for (let a = 0; a < 360; a += 15) {
        const p = { x: party.x + 100 * Math.cos(a * Math.PI / 180), y: party.y + 100 * Math.sin(a * Math.PI / 180) };
        const x = r.left + v.ox + p.x * v.scale, y = r.top + v.oy + p.y * v.scale;
        const free = world.settlements.every(s => Math.hypot(s.x - p.x, s.y - p.y) > 50);
        if (free && x > r.left + 80 && x < r.right - 80 && y > r.top + 80 && y < r.bottom - 120) return { x, y };
      }
      throw new Error('sem terreno livre à vista');
    });
    await page.mouse.click(target.x, target.y);
    await page.waitForFunction(() => window.__game.campaign.dest !== null);
    await page.mouse.move(2, 4);
    await page.waitForTimeout(300);
    await shot(page, '03-mapa-rota');

    // Sem o «Ir»: clicar no bando cancela a marcha; depois de Emboscar ou Reconhecer, voltar a marchar é intuitivo.
    await page.evaluate(() => window.__game.campaign.pause());
    const dest = () => page.evaluate(() => window.__game.campaign.dest);
    const band = await page.evaluate(() => {
      const c = window.__game.campaign, { party } = c.flow.state, v = c.view(), r = document.getElementById('mapcv').getBoundingClientRect();
      return { x: r.left + v.ox + party.x * v.scale, y: r.top + v.oy + party.y * v.scale };
    });
    await page.mouse.click(band.x, band.y);
    assert.equal(await dest(), null, 'clicar no bando cancela a marcha');
    await page.locator('#m-ambush').click();
    assert.equal(await page.evaluate(() => window.__game.campaign.stance), 'esperar');
    assert.match(await page.locator('#m-status').textContent(), /clica no mapa para (voltar a )?marchar/);
    await page.mouse.click(target.x, target.y);
    assert.notEqual(await dest(), null, 'depois de Emboscar, um clique no mapa volta a marchar');
    assert.equal(await page.evaluate(() => window.__game.campaign.stance), null);
    await page.evaluate(() => window.__game.campaign.pause());
    await page.locator('#m-recon').click();
    assert.equal(await page.locator('#m-recon').getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('#m-status').textContent(), /ESC/);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#m-recon').getAttribute('aria-pressed'), 'false', 'Esc desiste do reconhecimento');
    assert.equal(await page.locator('#mapcv').isVisible(), true, 'e fica no mapa');
    assert.notEqual(await dest(), null, 'a marcha continua ordenada');

    const day0 = await page.evaluate(() => window.__game.campaign.flow.state.day);
    await page.evaluate(() => window.__game.campaign.play(4));
    await page.waitForFunction(d => window.__game.campaign.flow.state.day > d, day0, { timeout: 90000 });
    await page.evaluate(() => window.__game.campaign.pause());
    const before = await page.evaluate(() => { const s = window.__game.campaign.flow.state; return { day: s.day, party: { ...s.party }, saved: window.__game.campaign.savedState() }; });
    assert.ok(before.day > day0, 'a campanha avançou');
    assert.equal(before.saved.day, before.day, 'o dia está guardado');
    assert.deepEqual(before.saved.party, before.party, 'a posição do bando está guardada');

    await page.reload();
    await page.waitForFunction(() => window.__game?.campaign);
    await page.locator('#camp-cont:not(.hidden)').click({ timeout: 60000 });
    await page.locator('#mapcv').waitFor({ timeout: 60000 });
    await page.waitForFunction(() => window.__game.campaign.active);
    const after = await page.evaluate(() => { const s = window.__game.campaign.flow.state; return { day: s.day, party: { ...s.party } }; });
    assert.deepEqual(after, { day: before.day, party: before.party }, 'continuar retoma o mesmo dia e a mesma posição');
    assert.deepEqual(await renderer(page), { canvas: true, stage3d: null });
    await page.close();
  }

  // E. O idioma escolhe-se no menu principal, fica guardado e o mapa fala essa língua (já não há seletor no HUD).
  {
    const page = await open();
    await page.locator('#tab-language').click();
    await page.locator('#menu-language [data-menu-language="en"]').click();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.equal(await page.evaluate(() => localStorage.getItem('viriato.language')), 'en');
    await page.reload();
    await page.waitForFunction(() => window.__game?.campaign);
    assert.equal(await page.locator('html').getAttribute('lang'), 'en', 'a preferência sobrevive ao recarregar');
    await openMap(page);
    await page.locator('#mapcv').waitFor({ timeout: 60000 });
    assert.equal(await page.locator('#m-date').textContent(), '1 March 147 BC');
    assert.equal(await page.locator('#m-ambush').textContent(), 'Ambush');
    assert.equal(await page.locator('#map-language').count(), 0);
    await page.close();
  }

  // B. Fallback: se a pintura do mapa não carrega, a campanha abre no mapa 3D em vez de ficar sem mapa.
  {
    const seen = errors.length;
    const page = await open('', ['**/brushes.webp', r => r.abort()]);
    await openMap(page);
    await page.locator('#campaign-map-3d[data-status=ready]').waitFor({ timeout: 60000 });
    assert.deepEqual(await renderer(page), { canvas: false, stage3d: 'ready' }, 'fallback: 3D montado, canvas ilustrado escondido');
    assert.ok(warnings.some(w => /Illustrated map unavailable/.test(w)), 'o fallback avisa na consola');
    errors.splice(seen, errors.length, ...errors.slice(seen).filter(e => !/ERR_FAILED/.test(e)));   // o pedido abortado de propósito
    await page.close();
  }

  // C. ?map=3d: o 3D legado, sem sequer pedir a pintura ilustrada.
  {
    const asked = [];
    const page = await open('?map=3d', ['**/*', r => { if (/brushes\.webp/.test(r.request().url())) asked.push(r.request().url()); r.continue(); }]);
    await openMap(page);
    await page.locator('#campaign-map-3d[data-status=ready]').waitFor({ timeout: 60000 });
    assert.deepEqual(await renderer(page), { canvas: false, stage3d: 'ready' });
    assert.deepEqual(asked, [], '?map=3d não carrega a pintura do mapa ilustrado');
    await page.close();
  }

  // D. ?map=illustrated: preview com campanha própria (?seed) e o save real do browser intocado.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'pt-PT' });
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => localStorage.setItem('viriato.campaign', 'existing-save'));
    await page.goto(new URL('index.html?map=illustrated&seed=1234', url).href);
    await page.waitForFunction(() => window.__game?.campaign.active, null, { timeout: 60000 });
    assert.deepEqual(await renderer(page), { canvas: true, stage3d: null });
    assert.equal(await page.evaluate(() => window.__game.campaign.flow.state.seed), 1234);
    await page.evaluate(() => window.__game.campaign.step());
    assert.equal(await page.evaluate(() => localStorage.getItem('viriato.campaign')), 'existing-save', 'o preview não escreve no localStorage');
    await page.close();
  }

  assert.deepEqual(errors, []);
  console.log('OK — percurso real (menu → prólogo → mapa ilustrado → ordem → avançar → guardar → recarregar → continuar), HUD sem «Ir» nem idioma (cancelar marcha, regressar após Emboscar/Reconhecer, idioma pelo menu), fallback 3D, ?map=3d e ?map=illustrated');
} finally {
  await close();
}
