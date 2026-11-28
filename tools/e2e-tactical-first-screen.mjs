// Primeiro ecrã do protótipo, sem ninguém a ajudar (preparação do playtest M1.2): em 1280×720, 1366×768 e 1920×1080,
// os quatro grupos estão visíveis e arrastáveis sem mexer na câmara, o objetivo está escrito no painel, e na batalha a dica
// fica acima da barra de baixo. Capturas em production/qa/evidence/tactical-proto-m12/primeiro-ecra-<largura>.jpg.
//   node tools/e2e-tactical-first-screen.mjs
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, startBrowser } from './e2e-lib.mjs';

const OUT = path.join(ROOT, 'production/qa/evidence/tactical-proto-m12');
fs.mkdirSync(OUT, { recursive: true });
let harness;
try { harness = await startBrowser({ entry: 'tactical-proto.html' }); }
catch (error) { console.error(`Teste NÃO executado. ${error.message}`); process.exit(2); }
const { url, browser, close } = harness;
const failures = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failures.push(name); };
const inside = (p, r) => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;

try {
  for (const [w, h] of [[1280, 720], [1366, 768], [1920, 1080]]) {
    const tag = `${w}×${h}`;
    const page = await browser.newPage({ viewport: { width: w, height: h }, locale: 'en-GB' });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => window.__proto?.info().calls > 0);
    await page.waitForTimeout(300);

    const geo = await page.evaluate(() => {
      const p = window.__proto, r = id => document.getElementById(id).getBoundingClientRect();
      const box = e => ({ left: e.left, right: e.right, top: e.top, bottom: e.bottom });
      return {
        top: box(r('top')), prep: box(r('prep')), bar: box(r('bar')),
        bands: p.ui.placement.map(g => ({ id: g.id, at: p.view.project(g.x, g.y, 0), label: p.view.project(g.x, g.y, 4.2) })),
        goal: document.getElementById('goal').innerText,
      };
    });
    check(`${tag}: objetivo escrito no painel de preparação`, /Break it before it leaves the valley/.test(geo.goal), geo.goal);
    for (const b of geo.bands) {
      const free = [geo.top, geo.prep, geo.bar].every(r => !inside(b.at, r) && !inside(b.label, r));
      check(`${tag}: ${b.id} e a etiqueta visíveis, fora dos painéis`, b.at.visible && free && b.label.y > geo.top.bottom && b.at.y < geo.bar.top,
        `grupo ${Math.round(b.at.x)},${Math.round(b.at.y)} · etiqueta y ${Math.round(b.label.y)} · topo ${Math.round(geo.top.bottom)}`);
    }
    await page.screenshot({ path: path.join(OUT, `primeiro-ecra-${w}.jpg`), type: 'jpeg', quality: 82 });

    // Arrastar cada grupo com o rato real, a partir do sítio onde aparece, para um bosque: tem de ficar escondido.
    for (const [i, b] of geo.bands.entries()) {
      const wood = await page.evaluate(i => { const p = window.__proto, w = [{ x: 50, y: 31 }, { x: 82, y: 35 }, { x: 110, y: 42 }, { x: 132, y: 83 }][i]; return p.view.project(w.x, w.y, 0); }, i);
      await page.mouse.move(b.at.x, b.at.y); await page.mouse.down();
      await page.mouse.move(wood.x, wood.y, { steps: 10 }); await page.mouse.up();
    }
    const states = await page.locator('#cards .card .state').allInnerTexts();
    check(`${tag}: os quatro grupos arrastados diretamente para o mato ficam «Hidden»`, states.length === 4 && states.every(s => s === 'Hidden'), states.join(', '));

    // Batalha: a dica (com B e R) fica acima da barra de baixo, mesmo quando esta passa a duas linhas.
    await page.click('#start');
    await page.evaluate(() => { const p = window.__proto; p.ui.paused = true; p.run(1); p.ui.paused = false; p.ui.selected = 'lobos'; });
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__proto.ui.phase === 'battle');
    await page.waitForTimeout(300);
    const lay = await page.evaluate(() => {
      const r = id => document.getElementById(id).getBoundingClientRect();
      return { hintShown: !document.getElementById('hint').hidden, help: document.getElementById('help').innerText, tip: document.getElementById('retreat').title, label: document.getElementById('retreat').innerText };
    });
    check(`${tag}: sem dica automática de controlos na batalha`, !lay.hintShown);
    check(`${tag}: «Controlos» (a pedido) distingue B (fica) de R (abandona)`, /stays on the field/.test(lay.help) && /leave the field for good/.test(lay.help));
    check(`${tag}: R diz que abandona a batalha (botão e dica do botão)`, /Leave battle/.test(lay.label) && /for good/.test(lay.tip));
    if (w === 1366) await page.screenshot({ path: path.join(OUT, `primeiro-ecra-${w}-batalha.jpg`), type: 'jpeg', quality: 82 });
    check(`${tag}: sem erros na consola`, errors.length === 0, errors.join(' | '));
    await page.close();
  }

  // Português de Portugal: o objetivo também está traduzido.
  // O idioma gravado pelo menu do jogo (mesma chave) é o que o protótipo usa: não há seletor próprio.
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.addInitScript(() => localStorage.setItem('viriato.language', 'pt-PT'));
  await page.goto(url);
  await page.waitForFunction(() => window.__proto?.info().calls > 0);
  check('pt-PT: sem seletor de idioma, usa a escolha gravada', !(await page.$('#lang')) && await page.evaluate(() => document.documentElement.lang) === 'pt-PT');
  const goal = await page.locator('#goal').innerText();
  check('pt-PT: objetivo traduzido', /Desbarata-a antes que saia do vale/.test(goal), goal);
  await page.screenshot({ path: path.join(OUT, 'primeiro-ecra-1366-pt.jpg'), type: 'jpeg', quality: 82 });
  await page.close();
} finally { await close(); }

console.log(failures.length ? `\n${failures.length} falha(s)` : '\ntudo ok');
process.exit(failures.length ? 1 : 0);
