// Capturas do ecrã do mapa da campanha (verificação visual do PR 5), nas quatro resoluções de referência.
//   node tools/shot-valley.mjs <pasta>
// Para cada resolução: o mapa no início (semente 1), com a Ribeira selecionada, e ao dia 40 (40 dias parado).
// Só usa a API pública de window.__game.campaign, por isso corre na interface antiga e na nova.
import fs from 'node:fs';
import path from 'node:path';
import { startE2E } from './e2e-lib.mjs';

const OUT = process.argv[2];
if (!OUT) { console.error('uso: node tools/shot-valley.mjs <pasta>'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const { url, browser, check, finish } = await startE2E();
for (const vp of [{ width: 1366, height: 768 }, { width: 1280, height: 800 }, { width: 1024, height: 600 }, { width: 844, height: 390 }]) {
  const tag = `${vp.width}x${vp.height}`, page = await browser.newPage({ viewport: vp });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url + '&legacy-map-test=1');
  await page.waitForFunction(() => !!window.__game, null, { timeout: 60000 });
  await page.evaluate(() => { const G = window.__game; G.campaignStorage.clear(); G.startCampaign(1); G.showCampaignMap(); G.campaign.pause?.(); });
  await page.waitForSelector('#map:not(.hidden)'); await page.waitForTimeout(1200);
  const shot = async name => page.screenshot({ path: path.join(OUT, `${name}-${tag}.png`) });
  await shot('inicio');
  await page.evaluate(() => { const c = window.__game.campaign; c.select(c.flow.state.communities.ribeira.settlement); });
  await page.waitForTimeout(400); await shot('ribeira');
  await page.evaluate(() => { const c = window.__game.campaign; c.select(null); c.flow.state.done.push('cativos'); for (let i = 0; i < 40 && c.flow.phase === 'mapa'; i++) c.flow.order({ kind: 'acampar' }); c.render(); });
  await page.waitForTimeout(600); await shot('dia40');
  // só na interface nova (PR 5): um tributo pendente com a interrupção do dia, e o Diário
  if (await page.evaluate(() => !!document.getElementById('missues'))) {
    await page.evaluate(() => {
      const c = window.__game.campaign, s = c.flow.state, r = s.communities.ribeira;
      r.situation = 'tributada'; r.due = { food: 18, day: s.day + 7 }; r.food = Math.max(r.food, 40);
      s.communities.vau.situation = 'castigada'; s.communities.vau.until = s.day + 12;
      c.flow.journal.push({ day: s.day, type: 'castigo', id: s.communities.vau.settlement, why: 'apoio' });
      c.render();
    });
    await page.waitForTimeout(400); await shot('assuntos');
    await page.evaluate(() => window.__game.campaign.openDiary('comunidades'));
    await page.waitForTimeout(300); await shot('diario');
    await page.evaluate(() => window.__game.campaign.closeDiary());
    // uma interrupção a sério: o último dia da primavera (colheita e tributo no mesmo dia, numa só janela)
    await page.evaluate(() => { const c = window.__game.campaign, s = c.flow.state; s.communities.ribeira.situation = 'livre'; s.communities.ribeira.due = null; s.day = 91; s.food = 400; c.step(); });
    await page.waitForTimeout(400); await shot('interrupcao');
    // a rota prevista e a dica do rato numa comunidade
    await page.evaluate(() => window.__game.campaign.play());
    const pt = await page.evaluate(() => { const c = window.__game.campaign, s = c.flow.state, v = c.view(), r = document.getElementById('mapcv').getBoundingClientRect();
      const to = s.world.settlements.find(x => x.id === s.communities.fonte.settlement), q = s.world.settlements.find(x => x.id === s.communities.vau.settlement);
      return { go: { x: r.left + v.ox + (to.x + 60) * v.scale, y: r.top + v.oy + (to.y + 40) * v.scale }, over: { x: r.left + v.ox + q.x * v.scale, y: r.top + v.oy + q.y * v.scale } }; });
    if (await page.locator('#mside').isVisible() && (await page.evaluate(() => innerWidth <= 900))) await page.keyboard.press('Escape');
    await page.mouse.click(pt.go.x, pt.go.y); await page.evaluate(() => window.__game.campaign.pause());
    await page.mouse.move(pt.over.x, pt.over.y); await page.waitForTimeout(300); await shot('rota');
  }
  check(`${tag}: sem erros de página`, errors.length === 0, errors.join(' | '));
  await page.close();
}
await finish();
