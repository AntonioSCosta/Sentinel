// E2E (Chrome real): no mapa da campanha, «Objetivo» está à vista, abre um painel curto que cabe no ecrã sem tapar
// a barra de cima nem a de baixo, e nenhum «ENTER para saltar» fica no mapa depois do prólogo.
//   node tools/e2e-map-info.mjs [pasta-de-capturas]
import fs from 'node:fs';
import path from 'node:path';
import { startE2E } from './e2e-lib.mjs';

const OUT = process.argv[2] || '';
const { url, browser, check, fmt, finish } = await startE2E();
const inside = (b, vp) => !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width + 0.5 && b.y + b.height <= vp.height + 0.5;
const apart = (a, b) => a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5 || a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5;

for (const vp of [{ width: 1280, height: 800 }, { width: 1024, height: 600 }, { width: 844, height: 390 }]) {
  const tag = `${vp.width}x${vp.height}`;
  const page = await browser.newPage({ viewport: vp });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(() => !!window.__game, null, { timeout: 60000 });
  await page.evaluate(() => { const G = window.__game; G.campaignStorage.clear(); G.startCampaign(1); G.showCampaignMap(); });
  await page.waitForSelector('#map:not(.hidden)'); await page.waitForTimeout(2500);   // deixa o ciclo real (RAF) correr no mapa
  const box = id => page.locator(id).boundingBox();
  const g = await box('#m-goal');
  check(`${tag}: «Objetivo» à vista na barra de baixo`, inside(g, vp), fmt(g));
  for (const id of ['m-acampar', 'm-esperar', 'm-esconder', 'm-recon', 'm-places', 'm-intel', 'm-cronica']) { const b = await box('#' + id); check(`${tag}: «${id}» à vista na barra de baixo`, inside(b, vp), fmt(b)); }
  const hint = await page.evaluate(() => [...document.querySelectorAll('div')].some(d => /ENTER para saltar/.test(d.textContent) && d.children.length === 0 && getComputedStyle(d).display !== 'none' && d.getBoundingClientRect().width > 0));
  check(`${tag}: «ENTER para saltar» não aparece no mapa`, !hint);
  await page.click('#m-goal');
  const p = await box('#mgoal'), top = await box('#mtop'), bot = await box('#mbot');
  check(`${tag}: o painel «Objetivo» cabe no ecrã`, inside(p, vp), fmt(p));
  check(`${tag}: não tapa a barra de cima nem a de baixo`, apart(p, top) && apart(p, bot), `painel ${fmt(p)} | cima ${fmt(top)} | baixo ${fmt(bot)}`);
  const all = await page.evaluate(() => { const ul = document.getElementById('mgoal'); return { clipped: ul.scrollHeight > ul.clientHeight + 1, text: ul.textContent }; });
  check(`${tag}: o texto lê-se (rola se for preciso) e diz vitória, derrota e primeiros dias`, /Vitória/.test(all.text) && /Derrota/.test(all.text) && /Primeiros dias/.test(all.text), all.clipped ? 'com rolagem' : 'sem rolagem');
  if (OUT) { fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, `mapa-objetivo-${tag}.png`) }); }
  await page.click('#m-places');
  const open = await page.evaluate(() => ({ goal: !document.getElementById('mgoal').classList.contains('hidden'), places: !document.getElementById('mplaces').classList.contains('hidden') }));
  check(`${tag}: abrir «Lugares» fecha «Objetivo»`, open.places && !open.goal);
  check(`${tag}: sem erros de página`, errors.length === 0, errors.join(' | '));
  await page.close();
}
await finish();
