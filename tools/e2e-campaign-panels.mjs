// E2E (Chrome real, Playwright): os painéis «Lugares» (#mplaces) e «Relatos» (#mintel) do mapa de campanha
// podem estar abertos ao mesmo tempo e não se sobrepõem, nem a #mctx, nem saem do ecrã.
//   node tools/e2e-campaign-panels.mjs [pasta-de-capturas]
// Playwright não é dependência do repositório: procura-se em PLAYWRIGHT_DIR, /opt/node-tools ou node_modules.
// Chrome: CHROME_PATH ou /usr/bin/google-chrome. Sem eles o teste falha (saída 2); nunca passa em silêncio.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || '';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2' };

async function loadPlaywright() {
  const dirs = [process.env.PLAYWRIGHT_DIR, '/opt/node-tools/node_modules/playwright', path.join(ROOT, 'node_modules/playwright')].filter(Boolean);
  for (const d of dirs) { try { return await import(pathToFileURL(path.join(d, 'index.mjs')).href); } catch { /* próxima */ } }
  console.error('Playwright não encontrado (PLAYWRIGHT_DIR, /opt/node-tools, node_modules). Teste NÃO executado.'); process.exit(2);
}

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/index.html?manual=1`;

const { chromium } = await loadPlaywright();
const chrome = process.env.CHROME_PATH || '/usr/bin/google-chrome';
let browser;
try { browser = await chromium.launch({ executablePath: chrome, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }); }
catch (e) { console.error(`Chrome não arrancou (${chrome}): ${e.message}. Teste NÃO executado.`); server.close(); process.exit(2); }

const failures = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failures.push(name); };
const hit = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const fmt = b => b ? `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}` : 'sem caixa';

for (const vp of [{ width: 1280, height: 800 }, { width: 1024, height: 600 }, { width: 844, height: 390 }]) {
  const tag = `${vp.width}x${vp.height}`;
  const page = await browser.newPage({ viewport: vp });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url); await page.waitForFunction(() => !!window.__game, null, { timeout: 60000 });
  await page.evaluate(() => { const G = window.__game; G.campaignStorage.clear(); G.startCampaign(1234); G.showCampaignMap(); });
  await page.waitForSelector('#m-places', { state: 'visible' });
  // alguns dias de espera, para haver relatos reais (se o simulador os der); o resultado conta-se, não se inventa
  for (let i = 0; i < 8; i++) {
    if (await page.evaluate(() => window.__game.campaign.flow.phase !== 'mapa')) break;
    await page.click('#m-esperar'); await page.waitForTimeout(150);
  }
  if (await page.evaluate(() => window.__game.campaign.flow.phase !== 'mapa')) { check(`${tag}: ficou no mapa para abrir os painéis`, false, 'batalha a meio'); await page.close(); continue; }
  await page.click('#m-places'); await page.click('#m-intel'); await page.waitForTimeout(250);
  const box = id => page.locator(id).boundingBox();
  const pl = await box('#mplaces'), it = await box('#mintel');
  const items = await page.evaluate(() => ({ places: document.querySelectorAll('#mplaces button[data-place]').length, reports: document.querySelectorAll('#mintel button[data-report]').length }));
  check(`${tag}: ambos os painéis abertos`, !!pl && !!it, `lugares ${fmt(pl)} | relatos ${fmt(it)} | ${items.places} lugares, ${items.reports} relatos`);
  if (pl && it) {
    check(`${tag}: lugares e relatos não se sobrepõem`, !hit(pl, it), `lugares ${fmt(pl)} | relatos ${fmt(it)}`);
    for (const [n, b] of [['lugares', pl], ['relatos', it]]) {
      check(`${tag}: ${n} dentro do ecrã`, b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width && b.y + b.height <= vp.height, fmt(b));
      check(`${tag}: ${n} com altura útil (≥ 60px)`, b.height >= 60, fmt(b));
    }
    // o cabeçalho (#mtop) e a barra de baixo (#mbot) ficam livres
    for (const id of ['#mtop', '#mbot']) {
      const o = await page.locator(id).boundingBox().catch(() => null);
      if (o) check(`${tag}: nenhum painel cobre ${id}`, !hit(pl, o) && !hit(it, o), `${id} ${fmt(o)}`);
    }
    // cada lista continua utilizável: o último item de cada uma alcança-se a rolar
    for (const [n, sel] of [['lugares', '#mplaces'], ['relatos', '#mintel']]) {
      const ok = await page.evaluate(s => { const ul = document.querySelector(s); ul.scrollTop = ul.scrollHeight; const l = ul.lastElementChild.getBoundingClientRect(), u = ul.getBoundingClientRect(); return l.bottom <= u.bottom + 1 && l.top >= u.top - 1; }, sel);
      check(`${tag}: ${n}: o último item alcança-se a rolar`, ok);
    }
  }
  // #mctx (povoação selecionada) também não pode ficar por baixo
  await page.evaluate(() => { const s = window.__game.campaign.flow.state, v = s.world.settlements[0]; document.querySelector('#mplaces button[data-place]')?.click(); return v.id; });
  await page.waitForTimeout(150);
  const ctx = await page.locator('#mctx').boundingBox().catch(() => null);
  if (ctx && pl && it) check(`${tag}: #mctx não se sobrepõe a nenhum painel`, !hit(ctx, await box('#mplaces')) && !hit(ctx, await box('#mintel')), `mctx ${fmt(ctx)}`);
  if (OUT) { fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, `paineis-${tag}.png`) }); }
  check(`${tag}: sem erros de página`, errors.length === 0, errors.join(' | '));
  await page.close();
}
await browser.close(); server.close();
console.log(failures.length ? `\n${failures.length} falha(s)` : '\ntudo ok');
process.exit(failures.length ? 1 : 0);
