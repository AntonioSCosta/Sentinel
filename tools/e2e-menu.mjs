// E2E (Chrome real): o menu inicial é uma lista vertical (campanha, missões, controlos, crónica, idioma) e cada entrada abre a sua janela.
// Em todas as resoluções comuns: a lista e a ação principal de cada janela estão à vista sem rolar, as janelas abrem e fecham com
// rato e teclado (Voltar, Escape, setas), os controlos alcançam-se a rolar, a confirmação de «Começar de novo» cabe no ecrã e a
// Crónica abre o que já foi vivido.
//   node tools/e2e-menu.mjs [pasta-de-capturas]
import fs from 'node:fs';
import path from 'node:path';
import { startE2E } from './e2e-lib.mjs';

const OUT = process.argv[2] || '';
const { url, browser, check, fmt, finish } = await startE2E();
const inside = (b, vp) => !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width + 0.5 && b.y + b.height <= vp.height + 0.5;
const SECTIONS = ['campaign', 'missions', 'controls', 'chronicle', 'language'];
const shown = page => page.evaluate(() => [...document.querySelectorAll('#menu .menu-win')].filter(w => !w.hidden && w.getClientRects().length).map(w => w.id));

for (const vp of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 1280, height: 800 }, { width: 1024, height: 600 }, { width: 844, height: 390 }]) {
  const tag = `${vp.width}x${vp.height}`;
  const page = await browser.newPage({ viewport: vp, locale: 'pt-PT' });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url); await page.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 60000 });
  const box = sel => page.locator(sel).boundingBox();
  const shot = async name => { if (OUT) { fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, `menu-${name}-${tag}.png`) }); } };

  // sem campanha gravada: só o título, a lista e o ano; nenhuma janela aberta
  check(`${tag}: abre sem janelas, com as entradas fechadas`, (await shown(page)).length === 0
    && await page.evaluate(() => [...document.querySelectorAll('.menu-nav [data-sec]')].every(b => b.getAttribute('aria-expanded') === 'false')));
  check(`${tag}: título só «Sentinel»`, (await page.locator('#menu .menu-head').innerText()).trim().toLowerCase() === 'sentinel');
  check(`${tag}: «147 A.C.» na coluna da lista`, (await page.locator('#menu .menu-year').innerText()).replace(/\s+/g, ' ').trim().toUpperCase() === '147 A.C.'
    && inside(await box('#menu .menu-year'), vp));
  for (const sec of SECTIONS) check(`${tag}: entrada ${sec} à vista`, inside(await box(`#tab-${sec}`), vp));
  await shot('inicio');

  // cada entrada abre só a sua janela, que cabe no ecrã; «Voltar» fecha-a e devolve o foco à entrada
  for (const sec of SECTIONS) {
    await page.click(`#tab-${sec}`);
    const open = await shown(page);
    check(`${tag}: ${sec} abre só a sua janela`, open.length === 1 && open[0] === `sec-${sec}`
      && await page.getAttribute(`#tab-${sec}`, 'aria-expanded') === 'true', open.join(','));
    const w = await box(`#sec-${sec}`);
    check(`${tag}: a janela ${sec} cabe no ecrã`, inside(w, vp), fmt(w));
    if (sec === 'campaign') { check(`${tag}: «Nova campanha» à vista`, inside(await box('#camp-new'), vp)); await shot('campanha'); }
    if (sec === 'missions') { const st = await box('#start'); check(`${tag}: «Começar» da missão à vista, sem rolar`, inside(st, vp), fmt(st)); await shot('missoes'); }
    if (sec === 'language') check(`${tag}: o idioma está à vista`, inside(await box('#menu-language'), vp));
    if (sec === 'controls') {
      const r = await page.evaluate(() => {
        const body = document.querySelector('#sec-controls .win-body');
        const last = [...body.querySelectorAll('.keys span, .keys b')].filter(e => e.textContent.trim()).pop();
        body.scrollTop = body.scrollHeight; const l = last.getBoundingClientRect(), c = body.getBoundingClientRect();
        return { top: l.top, bottom: l.bottom, boxTop: c.top, boxBottom: c.bottom };
      });
      check(`${tag}: a última linha dos controlos alcança-se a rolar`, r.top >= r.boxTop - 1 && r.bottom <= r.boxBottom + 1, `última ${Math.round(r.top)}–${Math.round(r.bottom)}`);
      await shot('controlos');
    }
    await page.click(`#sec-${sec} [data-close]`);
    check(`${tag}: «Voltar» fecha ${sec} e o foco volta à entrada`, (await shown(page)).length === 0
      && await page.evaluate(sec => document.activeElement.id === `tab-${sec}`, sec));
  }

  // teclado: setas, Home e End percorrem a lista; Enter abre com o foco no título da janela; Escape fecha
  await page.focus('#tab-campaign'); await page.keyboard.press('ArrowDown');
  check(`${tag}: seta para baixo passa para Missões`, await page.evaluate(() => document.activeElement.id === 'tab-missions'));
  await page.keyboard.press('End');
  check(`${tag}: End vai para Idioma`, await page.evaluate(() => document.activeElement.id === 'tab-language'));
  await page.keyboard.press('ArrowDown');
  check(`${tag}: a seta dá a volta à lista`, await page.evaluate(() => document.activeElement.id === 'tab-campaign'));
  await page.keyboard.press('End'); await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  check(`${tag}: Enter abre Missões com o foco no título`, (await shown(page)).join() === 'sec-missions'
    && await page.evaluate(() => document.activeElement.id === 'sec-missions-h'));
  await page.keyboard.press('Escape');
  check(`${tag}: Escape fecha a janela e devolve o foco`, (await shown(page)).length === 0
    && await page.evaluate(() => document.activeElement.id === 'tab-missions'));

  // com uma campanha a meio: a janela Campanha abre sozinha, continuar é a ação principal, a confirmação cabe no ecrã
  await page.evaluate(() => { const G = window.__game; G.campaignStorage.clear(); G.startCampaign(1); G.showCampaignMap(); });
  await page.keyboard.press('Escape'); await page.waitForSelector('#menu:not(.hidden)');
  check(`${tag}: com campanha gravada, a janela Campanha abre sozinha`, (await shown(page)).join() === 'sec-campaign');
  check(`${tag}: com campanha gravada, «Continuar» é a ação principal`, await page.evaluate(() => !document.getElementById('camp-cont').classList.contains('hidden')
    && document.getElementById('camp-cont').classList.contains('go') && !document.getElementById('camp-new').classList.contains('go')));
  await page.click('#camp-new'); await page.waitForSelector('#camp-confirm:not(.hidden)');
  const yes = await box('#camp-confirm-yes'), no = await box('#camp-confirm-no');
  check(`${tag}: a confirmação cabe no ecrã e os dois botões estão à vista`, inside(yes, vp) && inside(no, vp), `sim ${fmt(yes)} | voltar ${fmt(no)}`);
  await page.click('#camp-confirm-no');
  check(`${tag}: «Voltar» fecha a confirmação e a campanha continua gravada`, await page.evaluate(() => document.getElementById('camp-confirm').classList.contains('hidden') && !!localStorage.getItem('viriato.campaign')));
  await page.click('#sec-campaign [data-close]');
  await page.click('#tab-chronicle');
  const chron = await page.evaluate(() => ({ open: document.querySelectorAll('#menu-chron details').length, locked: document.querySelectorAll('#menu-chron li.locked').length }));
  check(`${tag}: a Crónica mostra entradas abertas e por viver`, chron.open >= 7 && chron.locked >= 1, JSON.stringify(chron));
  await shot('cronica');
  check(`${tag}: sem erros de página`, errors.length === 0, errors.join(' | '));
  await page.close();
}
await finish();
