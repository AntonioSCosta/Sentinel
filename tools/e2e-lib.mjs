// Utilitários dos testes E2E (Chrome real, Playwright). Playwright não é dependência do repositório:
// procura-se em PLAYWRIGHT_DIR, /opt/node-tools ou node_modules. Chrome: CHROME_PATH,
// /usr/bin/google-chrome ou o Chromium instalado pelo Playwright.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2' };

async function loadPlaywright() {
  for (const dir of [process.env.PLAYWRIGHT_DIR, '/opt/node-tools/node_modules/playwright', path.join(ROOT, 'node_modules/playwright')].filter(Boolean)) {
    const entry = path.resolve(dir, 'index.mjs');
    if (fs.existsSync(entry)) return import(pathToFileURL(entry).href);
  }
  throw new Error('Playwright não encontrado (PLAYWRIGHT_DIR, /opt/node-tools, node_modules).');
}

/** Serve o checkout indicado e abre Chromium. O chamador fecha ambos com close(). */
export async function startBrowser({ root = ROOT, entry = 'index.html?manual=1', software = true, headless = true } = {}) {
  const dir = fs.realpathSync(root);
  if (!fs.existsSync(path.join(dir, entry.split('?')[0]))) {
    throw new Error(`Página ${entry} em falta em ${dir}. Para o protótipo, indica o checkout via SENTINEL_PROTO_ROOT.`);
  }
  const pw = await loadPlaywright();
  const executablePath = process.env.CHROME_PATH || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);
  const args = software ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-gpu'];
  const browser = await pw.chromium.launch({ executablePath, headless, args });
  const server = http.createServer((req, res) => {
    const p = path.resolve(dir, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(dir + path.sep) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
  });
  try {
    await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  } catch (error) {
    await browser.close();
    throw error;
  }
  const url = `http://127.0.0.1:${server.address().port}/${entry}`;
  const close = async () => {
    try { await browser.close(); }
    finally { await new Promise(resolve => server.close(resolve)); }
  };
  return { url, browser, close };
}

/** Arranca o servidor estático, o Chrome e devolve { url, browser, check, hit, fmt, finish }. */
export async function startE2E() {
  let harness;
  try { harness = await startBrowser(); }
  catch (error) { console.error(`Teste NÃO executado. ${error.message}`); process.exit(2); }
  const failures = [];
  const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failures.push(name); };
  const hit = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const fmt = b => b ? `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}` : 'sem caixa';
  const finish = async () => { await harness.close(); console.log(failures.length ? `\n${failures.length} falha(s)` : '\ntudo ok'); process.exit(failures.length ? 1 : 0); };
  return { url: harness.url, browser: harness.browser, check, hit, fmt, finish };
}
