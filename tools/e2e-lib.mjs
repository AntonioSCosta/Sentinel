// Utilitários dos testes E2E (Chrome real, Playwright). Playwright não é dependência do repositório:
// procura-se em PLAYWRIGHT_DIR, /opt/node-tools ou node_modules. Chrome: CHROME_PATH ou /usr/bin/google-chrome.
// Sem eles os testes falham com saída 2 (nunca passam em silêncio).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2' };

/** Arranca o servidor estático, o Chrome e devolve { url, browser, check, hit, fmt, finish }. */
export async function startE2E() {
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/index.html?manual=1`;
  let pw;
  for (const d of [process.env.PLAYWRIGHT_DIR, '/opt/node-tools/node_modules/playwright', path.join(ROOT, 'node_modules/playwright')].filter(Boolean)) {
    try { pw = await import(pathToFileURL(path.join(d, 'index.mjs')).href); break; } catch { /* próxima */ }
  }
  if (!pw) { console.error('Playwright não encontrado (PLAYWRIGHT_DIR, /opt/node-tools, node_modules). Teste NÃO executado.'); server.close(); process.exit(2); }
  const chrome = process.env.CHROME_PATH || '/usr/bin/google-chrome';
  let browser;
  try { browser = await pw.chromium.launch({ executablePath: chrome, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }); }
  catch (e) { console.error(`Chrome não arrancou (${chrome}): ${e.message}. Teste NÃO executado.`); server.close(); process.exit(2); }
  const failures = [];
  const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failures.push(name); };
  const hit = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const fmt = b => b ? `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}` : 'sem caixa';
  const finish = async () => { await browser.close(); server.close(); console.log(failures.length ? `\n${failures.length} falha(s)` : '\ntudo ok'); process.exit(failures.length ? 1 : 0); };
  return { url, browser, check, hit, fmt, finish };
}
