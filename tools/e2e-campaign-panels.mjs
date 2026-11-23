// E2E (Chrome real, Playwright): o ecrã do vale reparte-se sem sobreposições. Barra de cima, mapa, coluna de assuntos
// (ou o painel da povoação) e barra de baixo não se tapam; a coluna cabe no ecrã e rola até ao fim; em ecrãs estreitos
// ou baixos a coluna é uma gaveta que se abre e fecha («Assuntos»); o registo curto não tapa a coluna.
//   node tools/e2e-campaign-panels.mjs [pasta-de-capturas]
import fs from 'node:fs';
import path from 'node:path';
import { startE2E } from './e2e-lib.mjs';

const OUT = process.argv[2] || '';
const { url, browser, check, hit, fmt, finish } = await startE2E();
const inside = (b, vp) => !!b && b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= vp.width + 0.5 && b.y + b.height <= vp.height + 0.5;

for (const vp of [{ width: 1366, height: 768 }, { width: 1280, height: 800 }, { width: 1024, height: 600 }, { width: 844, height: 390 }]) {
  const tag = `${vp.width}x${vp.height}`, narrow = vp.width <= 900 || vp.height <= 480;
  const page = await browser.newPage({ viewport: vp });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url); await page.waitForFunction(() => !!window.__game, null, { timeout: 60000 });
  await page.evaluate(() => {
    const G = window.__game; G.campaignStorage.clear(); G.startCampaign(1234); G.showCampaignMap();
    const c = G.campaign, s = c.flow.state;   // dois assuntos reais: um tributo pendente e um castigo recente
    s.communities.ribeira.situation = 'tributada'; s.communities.ribeira.due = { food: 10, day: s.day + 6 };
    c.flow.journal.push({ day: s.day, type: 'castigo', id: s.communities.vau.settlement, why: 'apoio' }); c.render();
  });
  await page.waitForSelector('#campaign-map-3d');
  const box = sel => page.locator(sel).boundingBox().catch(() => null);
  if (narrow) {
    check(`${tag}: ecrã pequeno: a coluna começa fechada e o mapa ocupa a largura`, !(await page.locator('#mside').isVisible()), fmt(await box('#campaign-map-3d')));
    await page.click('#m-side-toggle');
    check(`${tag}: «Assuntos» abre a gaveta`, await page.locator('#mside').isVisible());
  }
  const top = await box('#mtop'), bot = await box('#mbot'), cv = await box('#campaign-map-3d'), side = await box('#mside');
  check(`${tag}: a coluna cabe no ecrã`, inside(side, vp), fmt(side));
  check(`${tag}: a coluna não tapa as barras`, !hit(side, top) && !hit(side, bot), `coluna ${fmt(side)} | cima ${fmt(top)} | baixo ${fmt(bot)}`);
  check(`${tag}: o mapa não fica por baixo das barras`, !hit(cv, top) && !hit(cv, bot), fmt(cv));
  if (!narrow) check(`${tag}: o mapa e a coluna ficam lado a lado`, !hit(cv, side) && cv.width >= vp.width * 0.6, `mapa ${fmt(cv)} | coluna ${fmt(side)}`);
  const issues = await page.evaluate(() => document.querySelectorAll('#missues-list .issue').length);
  check(`${tag}: os assuntos aparecem (${issues})`, issues >= 2);
  const end = await page.evaluate(() => { const s = document.getElementById('mside'); s.scrollTop = s.scrollHeight; const l = s.querySelector('#missues-list').lastElementChild.getBoundingClientRect(), u = s.getBoundingClientRect(); return l.bottom <= u.bottom + 1; });
  check(`${tag}: o último assunto alcança-se a rolar`, end);
  const lg = await box('#mlog');
  if (lg && !narrow) check(`${tag}: o registo curto não tapa a coluna`, !hit(lg, side), `registo ${fmt(lg)}`);
  // a povoação escolhida ocupa a coluna (não abre outra janela por cima do mapa)
  await page.click('#missues-list .issue .head');
  await page.waitForSelector('#mctx:not(.hidden)');
  const ctx = await box('#mctx');
  check(`${tag}: o painel da povoação fica dentro da coluna`, !!ctx && ctx.x >= side.x - 0.5 && ctx.x + ctx.width <= side.x + side.width + 0.5, `painel ${fmt(ctx)}`);
  check(`${tag}: com o painel aberto, os assuntos saem do caminho`, !(await page.locator('#missues').isVisible()));
  const last = await page.evaluate(() => { const s = document.getElementById('mside'); s.scrollTop = s.scrollHeight; const l = document.querySelector('#mctx').lastElementChild.getBoundingClientRect(), u = s.getBoundingClientRect(); return l.bottom <= u.bottom + 1; });
  check(`${tag}: o fim do painel alcança-se a rolar`, last);
  if (OUT) { fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, `paineis-${tag}.png`) }); }
  await page.keyboard.press('Escape');
  check(`${tag}: ESC volta aos assuntos`, await page.locator('#missues').isVisible() && !(await page.locator('#mctx').isVisible()));
  if (narrow) { await page.keyboard.press('Escape'); check(`${tag}: ESC outra vez fecha a gaveta`, !(await page.locator('#mside').isVisible()) && await page.locator('#map').isVisible()); }
  check(`${tag}: sem erros de página`, errors.length === 0, errors.join(' | '));
  await page.close();
}
await finish();
