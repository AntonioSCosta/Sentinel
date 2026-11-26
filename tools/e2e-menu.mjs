// Browser regression checks for the persistent menu, Game/Steam Deck viewports and idle rendering.
import fs from 'node:fs';
import path from 'node:path';
import { startE2E } from './e2e-lib.mjs';

const OUT = process.argv[2];
const { url, browser, check, finish } = await startE2E();
const sections = ['campaign', 'missions', 'controls', 'chronicle', 'language'];
const viewports = [[1920, 1080], [1280, 800], [1366, 768], [1024, 600], [844, 390], [432, 390]];
const inside = (box, vp) => !!box && box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width + 1 && box.y + box.height <= vp.height + 1;

for (const [width, height] of viewports) for (const locale of ['pt-PT', 'en']) {
  const viewport = { width, height };
  const tag = `${width}x${height}-${locale}`;
  const english = locale === 'en';
  const page = await browser.newPage({ viewport, locale, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(url);
  await page.waitForFunction(() => window.__game, null, { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  const shot = async name => {
    if (!OUT) return;
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, `${tag}-${name}.png`) });
  };
  const tab = section => page.locator(`#tab-${section}`);
  const panel = section => page.locator(`#sec-${section}`);
  const visible = () => page.locator('#menu [role="tabpanel"]:visible').evaluateAll(panels => panels.map(p => p.id));
  const active = () => page.locator('#menu [aria-selected="true"]').getAttribute('id');
  const select = section => tab(section).click();

  check(`${tag}: Campanha abre como secção inicial`, (await visible()).join() === 'sec-campaign'
    && await active() === 'tab-campaign' && await page.locator('#camp-cont').isHidden()
    && inside(await page.locator('#camp-new').boundingBox(), viewport));
  check(`${tag}: título, data e paleta`, await page.locator('.menu-head h1').evaluate(h => h.textContent === 'Sentinel'
    && getComputedStyle(h).color === getComputedStyle(document.body).color)
    && await page.locator('.menu-year').innerText() === (english ? '147 BC' : '147 A.C.'));
  check(`${tag}: todas as secções estão visíveis na navegação`, (await Promise.all(sections.map(async section =>
    inside(await tab(section).boundingBox(), viewport)))).every(Boolean));
  await shot('campanha');

  const persistent = await page.locator('#menu-content').elementHandle();
  const bounds = await persistent.boundingBox();
  for (const section of sections) {
    await select(section);
    check(`${tag}: ${section} dentro do mesmo painel persistente`, (await visible()).join() === `sec-${section}`
      && await active() === `tab-${section}` && await tab(section).getAttribute('tabindex') === '0'
      && await panel(section).evaluate((element, content) => element.parentElement === content
        && getComputedStyle(element).backgroundColor === 'rgba(0, 0, 0, 0)'
        && getComputedStyle(element).position === 'static', persistent)
      && JSON.stringify(await persistent.boundingBox()) === JSON.stringify(bounds)
      && inside(await panel(section).boundingBox(), viewport)
      && await page.locator('#menu [aria-modal="true"]:visible').count() === 0);
  }

  await tab('language').focus();
  const narrow = width <= 700;
  await page.keyboard.press(narrow ? 'ArrowRight' : 'ArrowDown');
  const wrap = await active();
  await page.keyboard.press('End');
  const end = await active();
  await page.keyboard.press('Home');
  await page.keyboard.press(narrow ? 'ArrowRight' : 'ArrowDown');
  const focused = await page.evaluate(() => document.activeElement.id);
  await page.keyboard.press('Tab');
  check(`${tag}: setas, Home, End e Tab navegam sem bloquear o foco`, wrap === 'tab-campaign' && end === 'tab-language'
    && focused === 'tab-missions' && await panel('missions').evaluate(element => element.contains(document.activeElement))
    && await page.getByRole('tablist').getAttribute('aria-orientation') === (narrow ? 'horizontal' : 'vertical'));

  check(`${tag}: quatro missões e ação visível, resumo recolhido`, await panel('missions').locator('[data-ch]').count() === 4
    && inside(await page.locator('#start').boundingBox(), viewport) && await page.locator('#brief').isHidden());
  await panel('missions').locator('[data-ch="emboscada"]').click();
  await panel('missions').locator('summary').click();
  check(`${tag}: a missão selecionada atualiza o resumo e conserva a ação`, await page.evaluate(() => window.__game.chapter) === 'emboscada'
    && await page.locator('#brief').isVisible() && inside(await page.locator('#start').boundingBox(), viewport));
  await panel('missions').locator('summary').click();
  await shot('missoes');

  await select('controls');
  await panel('controls').locator('[data-diff="2"]').click();
  await panel('controls').locator('[data-q="low"]').click();
  await page.locator('#sens').focus();
  await page.keyboard.press('End');
  check(`${tag}: dificuldade, gráficos e sensibilidade funcionam`, await panel('controls').locator('[data-diff="2"]').getAttribute('aria-pressed') === 'true'
    && await page.evaluate(() => window.__game.quality === 'low') && await page.locator('#sens').inputValue() === '10');
  await shot('opcoes');
  await panel('controls').locator('summary').click();
  const optionsFit = await panel('controls').locator('.menu-section-body').evaluate(body => {
    body.scrollTop = body.scrollHeight;
    const last = [...body.querySelectorAll('.keys span')].filter(node => node.textContent.trim()).at(-1).getBoundingClientRect();
    const box = body.getBoundingClientRect();
    return body.scrollWidth === body.clientWidth && last.top >= box.top - 1 && last.bottom <= box.bottom + 1;
  });
  check(`${tag}: controlos alcançáveis sem scroll horizontal`, optionsFit);

  await select('chronicle');
  const chronicle = page.locator('#menu-chron');
  check(`${tag}: a Crónica lista apenas entradas desbloqueadas`, (await chronicle.locator('li').evaluateAll(rows =>
    rows.map(row => row.dataset.entry))).join() === 'galba,vetilio,traicao');
  await chronicle.locator('[data-entry="galba"] summary').click();
  const galba = await chronicle.locator('[data-entry="galba"] p').first().textContent();
  check(`${tag}: a Crónica apresenta conteúdo localizado`, galba.startsWith(english ? 'According to Appian' : 'Segundo Apiano'));
  await chronicle.locator('[data-entry="galba"] summary').click();
  await shot('cronicas');

  await select('language');
  const next = english ? 'pt-PT' : 'en';
  const language = value => page.locator(`[data-menu-language="${value}"]`);
  await language(next).click();
  check(`${tag}: Language atualiza seleção, navegação e idioma do documento`, await page.locator('html').getAttribute('lang') === next
    && await language(next).getAttribute('aria-pressed') === 'true' && await tab('controls').textContent() === (english ? 'Opções' : 'Options')
    && await tab('language').textContent() === 'Language');
  await language(locale).click();
  await shot('language');

  await page.evaluate(() => {
    const G = window.__game;
    G.startCampaign(1); G.showCampaignMap();
    const flow = G.campaign.flow;
    flow.state.done.push('cativos'); flow.state.seen = ['seca']; flow.save();
  });
  await page.keyboard.press('Escape');
  await page.locator('#menu:visible').waitFor();
  const save = () => page.evaluate(() => localStorage.getItem('viriato.campaign'));
  const originalSave = await save();
  check(`${tag}: a gravação volta à Campanha, com Continuar como ação principal`, await active() === 'tab-campaign'
    && await page.locator('#camp-cont.go').isVisible());
  await page.locator('#camp-new').click();
  check(`${tag}: a confirmação é apresentada na própria secção`, await panel('campaign').locator('#camp-confirm[role="group"]').isVisible()
    && inside(await page.locator('#camp-confirm-yes').boundingBox(), viewport) && inside(await page.locator('#camp-confirm-no').boundingBox(), viewport));
  await shot('confirmacao');
  await page.keyboard.press('Escape');
  check(`${tag}: Escape cancela sem alterar a gravação`, await page.locator('#camp-confirm').isHidden() && await save() === originalSave);
  await page.locator('#camp-new').click();
  await select('chronicle');
  check(`${tag}: Os Cativos desbloqueia, a seca fica fora da vista`, await chronicle.locator('[data-entry="cativos"]').count() === 1
    && await chronicle.locator('[data-entry="seca"]').count() === 0);
  await select('campaign');
  check(`${tag}: trocar de secção limpa a confirmação`, await page.locator('#camp-confirm').isHidden() && await save() === originalSave);
  await page.locator('#camp-cont').click();
  await page.waitForFunction(() => window.__game.state === 'map');
  check(`${tag}: Continuar carrega e preserva a gravação`, await save() === originalSave);
  check(`${tag}: sem erros de página`, errors.length === 0, errors.join(' | '));
  await page.close();
}

// Use the normal animation loop here, independently of the manual browser test mode.
const live = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await live.addInitScript(() => {
  const request = window.requestAnimationFrame.bind(window);
  window.__frameRequests = 0;
  window.requestAnimationFrame = callback => { window.__frameRequests++; return request(callback); };
});
await live.goto(url.split('?')[0]);
await live.waitForFunction(() => window.__game, null, { timeout: 60000 });
const still = await live.evaluate(async () => {
  const asset = new Image();
  asset.src = './assets/menu/forest.webp';
  await asset.decode();
  return { count: window.__frameRequests, source: getComputedStyle(document.getElementById('menu')).backgroundImage,
    width: asset.naturalWidth };
});
await live.locator('#tab-controls').click();
await live.locator('#tab-campaign').click();
await live.waitForTimeout(200);
check('menu real: a floresta estática carrega e trocar de secção não agenda frames', still.width === 1920 && still.source.includes('forest.webp')
  && await live.evaluate(() => window.__frameRequests) === still.count);
await live.locator('#camp-new').click();
await live.waitForFunction(() => window.__game.introT > 0);
check('menu real: iniciar campanha retoma a animação', await live.evaluate(() => window.__frameRequests) > still.count);
await live.evaluate(() => window.__game.showCampaignMap());
await live.keyboard.press('Escape');
await live.locator('#menu:visible').waitFor();
await live.waitForTimeout(100);
const afterReturn = await live.evaluate(() => window.__frameRequests);
await live.waitForTimeout(200);
check('menu real: voltar ao menu suspende os frames novamente', await live.evaluate(() => window.__frameRequests) === afterReturn);
await live.close();
await finish();
