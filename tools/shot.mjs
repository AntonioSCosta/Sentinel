// Headless screenshot harness: serves the repo, maps CDN imports to node_modules, runs a JS scenario, saves PNGs.
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path';
const require = createRequire('/opt/npm-tools/node_modules/');
const puppeteer = require('puppeteer');
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.wasm': 'application/wasm', '.json': 'application/json' };
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  let f = u.startsWith('/__nm/') ? path.join(ROOT, 'node_modules', u.slice(6)) : path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
}).listen(0);
const port = srv.address().port;
const [,, scenario, outDir = '/home/claude/shots'] = process.argv;
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=960,540'] });
const page = await browser.newPage(); await page.setViewport({ width: 960, height: 540 });
page.on('console', m => console.log('[page]', m.text().slice(0, 300))); page.on('pageerror', e => console.log('[err]', e.message)); page.on('requestfailed', q => console.log('[fail]', q.url()));
await page.setRequestInterception(true);
page.on('request', q => {
  const u = q.url();
  if (u.startsWith('https://cdn.jsdelivr.net/npm/three@0.160.0/')) { const f = path.join(ROOT, 'node_modules/three', u.split('three@0.160.0/')[1]); return q.respond({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(f) }); }
  if (u.includes('rapier3d-compat')) return q.respond({ status: 404, body: '' });
  q.continue();
});
await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
globalThis.shot = async (name) => { await page.screenshot({ path: path.join(outDir, name + '.png') }); console.log('shot', name); };
globalThis.page = page;
const mod = await import(path.resolve(scenario));
try { await mod.default(page, shot); } catch (e) { console.log('scenario error', e); }
await browser.close(); srv.close();
