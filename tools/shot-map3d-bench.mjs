// Capturas do banco de ensaio das peças do mapa 3D (Chrome real, Playwright): perto, zoom do mapa e à distância.
//   node tools/shot-map3d-bench.mjs <pasta>
import fs from 'node:fs';
import path from 'node:path';
import { startE2E } from './e2e-lib.mjs';

const OUT = process.argv[2];
if (!OUT) { console.error('uso: node tools/shot-map3d-bench.mjs <pasta>'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const { url, browser, check, finish } = await startE2E();
const base = url.replace('index.html?manual=1', 'tools/map3d-bench.html');
for (const vista of ['perto', 'zoom', 'longe']) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${base}?vista=${vista}`);
  await page.waitForFunction(() => window.__bench?.ready, null, { timeout: 120000 });
  await page.waitForTimeout(2500);   // texturas do chão
  const b = await page.evaluate(() => window.__bench);
  await page.screenshot({ path: path.join(OUT, `threejs_${vista}.png`) });
  check(`${vista}: ${b.houses} casa(s), ${b.calls} chamadas de desenho, ${b.triangles} triângulos`, b.ready);
  check(`${vista}: sem erros na consola`, errors.length === 0, errors.join(' | '));
  await page.close();
}
await finish();
