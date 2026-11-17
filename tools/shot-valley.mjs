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
  await page.goto(url);
  await page.waitForFunction(() => !!window.__game, null, { timeout: 60000 });
  await page.evaluate(() => { const G = window.__game; G.campaignStorage.clear(); G.startCampaign(1); G.showCampaignMap(); G.campaign.pause?.(); });
  await page.waitForSelector('#map:not(.hidden)'); await page.waitForTimeout(1200);
  const shot = async name => page.screenshot({ path: path.join(OUT, `${name}-${tag}.png`) });
  await shot('inicio');
  await page.evaluate(() => { const c = window.__game.campaign; c.select(c.flow.state.communities.ribeira.settlement); });
  await page.waitForTimeout(400); await shot('ribeira');
  await page.evaluate(() => { const c = window.__game.campaign; c.select(null); for (let i = 0; i < 40 && c.flow.phase === 'mapa'; i++) c.flow.order({ kind: 'acampar' }); c.render(); });
  await page.waitForTimeout(600); await shot('dia40');
  check(`${tag}: sem erros de página`, errors.length === 0, errors.join(' | '));
  await page.close();
}
await finish();
