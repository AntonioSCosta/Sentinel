// E2E (Chrome real): o menu inicial é uma lista vertical e cada entrada abre a sua janela.
// Em todas as resoluções comuns: a lista e a ação principal de cada janela estão à vista sem rolar, as janelas abrem e fecham com
// rato e teclado, as opções alcançam-se a rolar e a confirmação de «Começar de novo» não sobrevive ao fecho da janela.
//   node tools/e2e-menu.mjs [pasta-de-capturas]
import fs from 'node:fs';
import path from 'node:path';
import { startE2E } from './e2e-lib.mjs';

const OUT = process.argv[2] || '';
const { url, browser, check, fmt, finish } = await startE2E();
const inside = (b, vp) => !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width + 0.5 && b.y + b.height <= vp.height + 0.5;
const SECTIONS = ['campaign', 'missions', 'controls', 'chronicle', 'language'];
const shown = page => page.evaluate(() => [...document.querySelectorAll('#menu .menu-win')].filter(w => !w.hidden && w.getClientRects().length).map(w => w.id));

const viewports = [[1920, 1080], [1366, 768], [1280, 800], [1024, 600], [844, 390], [432, 390]];
for (const [vp, locale] of viewports.flatMap(([width, height]) => ['pt-PT', 'en'].map(locale => [{ width, height }, locale]))) {
  const tag = `${vp.width}x${vp.height}-${locale}`;
  const english = locale === 'en';
  const compact = vp.width <= 860 || vp.height <= 560;
  const page = await browser.newPage({ viewport: vp, locale });
  const close = sec => page.click(compact ? `#sec-${sec} [data-close]` : `#tab-${sec}`);
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url); await page.waitForFunction(() => window.game && !document.getElementById('start').disabled, null, { timeout: 60000 });
  const box = sel => page.locator(sel).boundingBox();
  const shot = async name => {
    if (!OUT) return;
    fs.mkdirSync(OUT, { recursive: true });
    await page.evaluate(async () => { await document.fonts.ready; window.game.step(); });
    await page.screenshot({ path: path.join(OUT, `menu-${name}-${tag}.png`) });
  };

  // sem campanha gravada: só o título, a lista e o ano; nenhuma janela aberta
  check(`${tag}: abre sem janelas, com as entradas fechadas`, (await shown(page)).length === 0
    && await page.evaluate(() => [...document.querySelectorAll('.menu-nav [data-sec]')].every(b => b.getAttribute('aria-expanded') === 'false')));
  check(`${tag}: título «Sentinel» com a cor da paleta`, await page.locator('.menu-head h1').evaluate(h => h.textContent === 'Sentinel'
    && getComputedStyle(h).color === getComputedStyle(document.body).color));
  check(`${tag}: data sob o título`, (await page.locator('.menu-head .menu-year').innerText()).trim() === (english ? '147 BC' : '147 A.C.')
    && inside(await box('#menu .menu-year'), vp));
  for (const sec of SECTIONS) check(`${tag}: entrada ${sec} à vista`, inside(await box(`#tab-${sec}`), vp));
  await shot('inicio');

  // A entrada ativa fecha a sua janela em desktop. Na versão compacta, há um botão de fecho acessível.
  for (const sec of SECTIONS) {
    await page.click(`#tab-${sec}`);
    const open = await shown(page);
    check(`${tag}: ${sec} abre só a sua janela`, open.length === 1 && open[0] === `sec-${sec}`
      && await page.getAttribute(`#tab-${sec}`, 'aria-expanded') === 'true', open.join(','));
    const w = await box(`#sec-${sec}`);
    check(`${tag}: a janela ${sec} cabe no ecrã`, inside(w, vp), fmt(w));
    const closeButton = page.locator(`#sec-${sec} [data-close]`);
    check(`${tag}: fecho ${sec} disponível conforme o formato`, await closeButton.isVisible() === compact
      && await closeButton.getAttribute('aria-label') === (english ? 'Close' : 'Fechar')
      && await page.locator(`#sec-${sec}`).getAttribute('role') === (compact ? 'dialog' : 'region'));
    if (sec === 'campaign') { check(`${tag}: «Nova campanha» à vista`, inside(await box('#camp-new'), vp)); await shot('campanha'); }
    if (sec === 'missions') { const st = await box('#start'); check(`${tag}: «Começar» da missão à vista, sem rolar`, inside(st, vp), fmt(st)); await shot('missoes'); }
    if (sec === 'language') {
      check(`${tag}: seletor à vista numa janela compacta`, inside(await box('#menu-language'), vp) && w.height < vp.height / 2);
      if (compact) {
        await page.keyboard.press('Shift+Tab');
        const last = await page.evaluate(() => document.activeElement.id);
        await page.keyboard.press('Tab');
        check(`${tag}: Tab fica dentro da janela opaca`, last === 'menu-language' && await closeButton.evaluate(b => b === document.activeElement));
      }
      await shot('idioma');
    }
    if (sec === 'controls') {
      check(`${tag}: Opções localizadas`, await page.locator('#sec-controls-h').textContent() === (english ? 'Options' : 'Opções'));
      const r = await page.evaluate(() => {
        const body = document.querySelector('#sec-controls .win-body');
        const last = [...body.querySelectorAll('.keys span, .keys b')].filter(e => e.textContent.trim()).pop();
        body.scrollTop = body.scrollHeight; const l = last.getBoundingClientRect(), c = body.getBoundingClientRect();
        return { top: l.top, bottom: l.bottom, boxTop: c.top, boxBottom: c.bottom, overflow: body.scrollWidth - body.clientWidth };
      });
      check(`${tag}: a última linha dos controlos alcança-se a rolar`, r.top >= r.boxTop - 1 && r.bottom <= r.boxBottom + 1, `última ${Math.round(r.top)}–${Math.round(r.bottom)}`);
      check(`${tag}: Opções sem scroll horizontal`, r.overflow === 0);
      await page.locator('#sec-controls .win-body').evaluate(body => { body.scrollTop = 0; });
      await shot('controlos');
    }
    if (sec === 'chronicle') {
      const list = page.locator('#menu-chron');
      const locked = list.locator('.locked');
      const galba = list.locator('[data-entry="galba"]');
      check(`${tag}: a Crónica sem gravação oculta as invenções e os dados da entrada bloqueada`, await list.locator('li').count() === 4
        && await list.locator('details').count() === 3 && await locked.count() === 1
        && await locked.textContent() === (english ? 'Not yet lived' : 'Ainda não vivido') && await locked.getAttribute('data-entry') === null);
      await galba.locator('summary').click();
      check(`${tag}: a Crónica localiza o corpo e a citação`, (await galba.locator('p').first().textContent()).startsWith(english ? 'According to Appian' : 'Segundo Apiano')
        && (await galba.locator('.cit').textContent()).startsWith(english ? 'Appian, Iberian Wars' : 'Apiano, Ibérica'));
      await shot('cronica-bloqueada');
    }
    await close(sec);
    check(`${tag}: fechar ${sec} devolve o foco à entrada`, (await shown(page)).length === 0
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
  await page.evaluate(() => {
    const G = window.__game;
    G.campaignStorage.clear(); G.startCampaign(1); G.showCampaignMap();
    const flow = G.campaign.flow;
    flow.state.done.push('cativos'); flow.state.seen = ['seca']; flow.save();
  });
  await page.keyboard.press('Escape'); await page.waitForSelector('#menu:not(.hidden)');
  check(`${tag}: com campanha gravada, a janela Campanha abre sozinha`, (await shown(page)).join() === 'sec-campaign');
  check(`${tag}: com campanha gravada, «Continuar» é a ação principal`, await page.evaluate(() => !document.getElementById('camp-cont').classList.contains('hidden')
    && document.getElementById('camp-cont').classList.contains('go') && !document.getElementById('camp-new').classList.contains('go')));
  await page.click('#camp-new'); await page.waitForSelector('#camp-confirm:not(.hidden)');
  const yes = await box('#camp-confirm-yes'), no = await box('#camp-confirm-no');
  check(`${tag}: a confirmação cabe no ecrã e os dois botões estão à vista`, inside(yes, vp) && inside(no, vp), `sim ${fmt(yes)} | voltar ${fmt(no)}`);
  await shot('confirmacao');
  const save = () => page.evaluate(() => localStorage.getItem('viriato.campaign'));
  const originalSave = await save();
  await page.keyboard.press('Escape');
  check(`${tag}: Escape cancela só a confirmação`, await page.locator('#camp-confirm').isHidden() && (await shown(page)).join() === 'sec-campaign'
    && await page.locator('#camp-new').evaluate(button => document.activeElement === button));
  await page.click('#camp-new');
  await close('campaign');
  await page.click('#tab-campaign');
  check(`${tag}: reabrir Campanha limpa a confirmação e preserva a gravação`, await page.locator('#camp-confirm').isHidden() && await save() === originalSave);
  await page.click('#camp-new');
  await page.click('#camp-confirm-no');
  check(`${tag}: Cancelar fecha a confirmação e preserva a gravação`, await page.locator('#camp-confirm').isHidden() && await save() === originalSave);
  await close('campaign');
  await page.click('#tab-chronicle');
  check(`${tag}: Os Cativos desbloqueia e a seca registada fica fora da Crónica`, await page.locator('#menu-chron [data-entry="cativos"] details').count() === 1
    && await page.locator('#menu-chron li.locked, #menu-chron [data-entry="seca"]').count() === 0
    && await page.locator('#menu-chron li').count() === 4);
  await shot('cronica');
  await close('chronicle');
  await page.click('#tab-campaign');
  await page.click('#camp-new');
  await page.click('#camp-confirm-yes');
  check(`${tag}: confirmar substitui a gravação de teste e abre o prólogo`, await save() !== originalSave && await page.evaluate(() => window.__game.campIntro));
  check(`${tag}: sem erros de página`, errors.length === 0, errors.join(' | '));
  await page.close();
}
await finish();
