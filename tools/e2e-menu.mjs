// E2E (Chrome real): no menu inicial, «COMEÇAR» e «CAMPANHA» estão à vista sem rolar, em todas as resoluções comuns,
// e o resto do menu (opções e controlos) continua alcançável a rolar. A confirmação de «Começar de novo» também cabe no ecrã.
//   node tools/e2e-menu.mjs [pasta-de-capturas]
import fs from 'node:fs';
import path from 'node:path';
import { startE2E } from './e2e-lib.mjs';

const OUT = process.argv[2] || '';
const { url, browser, check, fmt, finish } = await startE2E();
const inside = (b, vp) => !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width && b.y + b.height <= vp.height;

for (const vp of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 1280, height: 800 }, { width: 1024, height: 600 }, { width: 844, height: 390 }]) {
  const tag = `${vp.width}x${vp.height}`;
  const page = await browser.newPage({ viewport: vp });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url); await page.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 60000 });
  const box = id => page.locator(id).boundingBox();
  const st = await box('#start'), cp = await box('#camp-new');
  check(`${tag}: «COMEÇAR» à vista, sem rolar`, inside(st, vp), fmt(st));
  check(`${tag}: «CAMPANHA» à vista, sem rolar`, inside(cp, vp), fmt(cp));
  if (OUT) { fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, `menu-${tag}.png`) }); }
  // o resto continua acessível: rolar até ao fim mostra a última linha dos controlos por cima do rodapé, e os botões ficam à vista
  const r = await page.evaluate(() => {
    const card = document.querySelector('#menu .card'), foot = document.querySelector('.menu-foot') || document.getElementById('start'), last = [...document.querySelectorAll('#menu .keys span, #menu .keys b')].filter(e => e.textContent.trim()).pop();
    card.scrollTop = card.scrollHeight; const f = foot.getBoundingClientRect(), l = last.getBoundingClientRect(), c = card.getBoundingClientRect();
    return { lastBottom: l.bottom, footTop: f.top, lastTop: l.top, cardTop: c.top, scrolls: card.scrollHeight > card.clientHeight };
  });
  check(`${tag}: a última linha dos controlos alcança-se a rolar (acima do rodapé)`, r.lastBottom <= r.footTop + 1 && r.lastTop >= r.cardTop, `última ${Math.round(r.lastTop)}–${Math.round(r.lastBottom)}, rodapé ${Math.round(r.footTop)}`);
  const st2 = await box('#start'), cp2 = await box('#camp-new');
  check(`${tag}: os botões continuam à vista depois de rolar`, inside(st2, vp) && inside(cp2, vp));
  // com uma campanha a meio, a confirmação aparece inteira no ecrã e «Voltar» fecha-a sem apagar nada
  await page.evaluate(() => { const G = window.__game; G.campaignStorage.clear(); G.startCampaign(1); G.showCampaignMap(); });
  await page.keyboard.press('Escape'); await page.waitForSelector('#menu:not(.hidden)');
  await page.click('#camp-new'); await page.waitForSelector('#camp-confirm:not(.hidden)');
  const yes = await box('#camp-confirm-yes'), no = await box('#camp-confirm-no');
  check(`${tag}: a confirmação cabe no ecrã e os dois botões estão à vista`, inside(yes, vp) && inside(no, vp), `sim ${fmt(yes)} | voltar ${fmt(no)}`);
  await page.click('#camp-confirm-no');
  check(`${tag}: «Voltar» fecha a confirmação e a campanha continua gravada`, await page.evaluate(() => document.getElementById('camp-confirm').classList.contains('hidden') && !!localStorage.getItem('viriato.campaign')));
  check(`${tag}: sem erros de página`, errors.length === 0, errors.join(' | '));
  await page.close();
}
await finish();
