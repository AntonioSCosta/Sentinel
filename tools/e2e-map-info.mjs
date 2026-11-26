// E2E (Chrome real): no mapa da campanha, a barra de cima (data, tempo, bando) e a barra de baixo (Emboscar,
// Esconder, Reconhecer, Diário) estão inteiras à vista; o Diário abre no separador «Campanha» com o objetivo, cabe no
// ecrã, e nenhum «ENTER para saltar» nem véu do prólogo fica por cima do mapa.
//   node tools/e2e-map-info.mjs [pasta-de-capturas]
import fs from 'node:fs';
import path from 'node:path';
import { startE2E } from './e2e-lib.mjs';

const OUT = process.argv[2] || '';
const { url, browser, check, fmt, finish } = await startE2E();
const inside = (b, vp) => !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width + 0.5 && b.y + b.height <= vp.height + 0.5;

for (const vp of [{ width: 1366, height: 768 }, { width: 1280, height: 800 }, { width: 1024, height: 600 }, { width: 844, height: 390 }]) {
  const tag = `${vp.width}x${vp.height}`;
  const page = await browser.newPage({ locale: 'pt-PT', viewport: vp });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(() => !!window.__game, null, { timeout: 60000 });
  await page.evaluate(() => { const G = window.__game; G.campaignStorage.clear(); G.startCampaign(1); G.showCampaignMap(); });
  await page.waitForSelector('#map:not(.hidden)'); await page.waitForTimeout(1500);
  const box = id => page.locator(id).boundingBox();
  for (const id of ['m-date', 'm-pause', 'm-men', 'm-food', 'm-arms']) { const b = await box('#' + id); check(`${tag}: «${id}» à vista na barra de cima`, inside(b, vp), fmt(b)); }
  for (const s of [1, 2, 4]) { const b = await box(`[data-speed="${s}"]`); check(`${tag}: ${s}× à vista`, inside(b, vp), fmt(b)); }
  const bot = await page.evaluate(() => [...document.querySelectorAll('#mbot button')].map(b => b.textContent.trim()));
  check(`${tag}: a barra de baixo tem só Emboscar, Esconder, Reconhecer e Diário (o «Ir» saiu: marchar é o clique no mapa)`, bot.join('|') === 'Emboscar|Esconder|Reconhecer|Diário', bot.join('|'));
  for (const id of ['m-ambush', 'm-hide', 'm-recon', 'm-diary']) { const b = await box('#' + id); check(`${tag}: «${id}» à vista`, inside(b, vp), fmt(b)); }
  const hint = await page.evaluate(() => [...document.querySelectorAll('div')].some(d => /ENTER para saltar/.test(d.textContent) && d.children.length === 0 && getComputedStyle(d).display !== 'none' && d.getBoundingClientRect().width > 0));
  check(`${tag}: «ENTER para saltar» não aparece no mapa`, !hint);
  const veil = await page.evaluate(() => [...document.body.children].filter(e => !e.closest('#map') && getComputedStyle(e).position === 'fixed' && getComputedStyle(e).display !== 'none' && +getComputedStyle(e).opacity > 0 && e.id !== 'gl' && e.getBoundingClientRect().width > innerWidth * 0.9 && (parseInt(getComputedStyle(e).zIndex) || 0) > 0).map(e => e.id || e.className || e.tagName));
  check(`${tag}: nada do prólogo fica por cima do mapa (véu, HUD)`, veil.length === 0, veil.join(','));
  await page.click('#m-diary');
  const d = await box('#mdiary .card'), top = await box('#mtop');
  check(`${tag}: o Diário abre e cabe no ecrã`, inside(d, vp), fmt(d));
  const all = await page.evaluate(() => ({ text: document.getElementById('mdiary-body').textContent, tab: document.querySelector('#mdiary-tabs [aria-selected="true"]')?.dataset.tab }));
  check(`${tag}: abre em «Campanha», com vitória, derrota, fama e primeiros dias`, all.tab === 'campanha' && /Vitória/.test(all.text) && /Derrota/.test(all.text) && /Fama: \d+/.test(all.text) && /Primeiros dias/.test(all.text));
  if (OUT) { fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, `mapa-diario-${tag}.png`) }); }
  await page.keyboard.press('Escape');
  check(`${tag}: ESC fecha o Diário e fica no mapa`, await page.evaluate(() => document.getElementById('mdiary').classList.contains('hidden') && !document.getElementById('map').classList.contains('hidden')), fmt(top));
  check(`${tag}: sem erros de página`, errors.length === 0, errors.join(' | '));
  await page.close();
}
await finish();
