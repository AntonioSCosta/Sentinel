// Baseline do protótipo em Chromium. JSON para comparar a mesma configuração entre revisões.
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { ROOT, startBrowser } from './e2e-lib.mjs';

const { values } = parseArgs({
  options: {
    gpu: { type: 'string', default: 'software' },
    headed: { type: 'boolean', default: false },
    runs: { type: 'string', default: '3' },
    'sample-ms': { type: 'string', default: '5000' },
  },
});
const runs = Number(values.runs);
const sampleMs = Number(values['sample-ms']);
if (!['software', 'hardware'].includes(values.gpu) || !Number.isSafeInteger(runs) || runs < 1
    || !Number.isSafeInteger(sampleMs) || sampleMs < 1) {
  throw new Error('Uso: node tools/measure-tactical-proto.mjs [--gpu software|hardware] [--headed] [--runs 3] [--sample-ms 5000]');
}
const root = process.env.SENTINEL_PROTO_ROOT || ROOT;
const viewport = { width: 1280, height: 720 };

function revision() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

async function trackNetwork(cdp) {
  const requests = new Map();
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  cdp.on('Network.requestWillBeSent', ({ requestId, request, timestamp, wallTime }) => {
    if (request.url.startsWith('http')) requests.set(requestId, { start: timestamp, wall: wallTime });
  });
  cdp.on('Network.loadingFinished', ({ requestId, timestamp, encodedDataLength }) => {
    const entry = requests.get(requestId);
    if (entry) Object.assign(entry, { end: timestamp, bytes: encodedDataLength });
  });
  cdp.on('Network.loadingFailed', ({ requestId, timestamp }) => {
    const entry = requests.get(requestId);
    if (entry) Object.assign(entry, { end: timestamp, failed: true });
  });
  return (origin, cutoff) => {
    const atStartup = [...requests.values()].filter(entry => entry.wall * 1000 - origin <= cutoff);
    const completed = atStartup.filter(entry => entry.end !== undefined
      && (entry.wall + entry.end - entry.start) * 1000 - origin <= cutoff);
    return {
      requests: atStartup.length,
      transferredBytes: completed.reduce((total, entry) => total + (entry.bytes ?? 0), 0),
      failed: completed.filter(entry => entry.failed).length,
      pending: atStartup.length - completed.length,
    };
  };
}

function installProbe() {
  const probe = window.__sentinelPerf = { readyMs: null, webglEvents: [] };
  for (const name of ['webglcontextcreationerror', 'webglcontextlost', 'webglcontextrestored']) {
    document.addEventListener(name, event => {
      if (event.target.id === 'view') probe.webglEvents.push({ name, atMs: performance.now(), message: event.statusMessage || '' });
    }, true);
  }
  function ready() {
    if (window.__proto?.info().calls > 0
        && [...document.querySelectorAll('#labels .lbl:not(.rom)')].some(label => label.getClientRects().length)) {
      probe.readyMs = performance.now();
    } else requestAnimationFrame(ready);
  }
  requestAnimationFrame(ready);
}

function sampleFrames(page, phase) {
  return page.evaluate(({ phase, sampleMs }) => new Promise(resolve => {
    const p = window.__proto;
    const intervals = [];
    let first, last, startBattleTime, frameId;
    let maxEngaged = 0;
    const end = reason => {
      clearTimeout(timeout);
      cancelAnimationFrame(frameId);
      resolve({ intervals, reason, startBattleTime, endBattleTime: p.ui.session?.battle.t ?? null, maxEngaged, renderer: p.info() });
    };
    const timeout = setTimeout(() => end('raf-timeout'), sampleMs + 10000);
    function frame(now) {
      const battle = p.ui.session?.battle;
      if (p.ui.phase !== phase) return end('phase-ended');
      if (first === undefined) {
        first = now;
        startBattleTime = battle?.t ?? null;
      }
      if (last !== undefined) intervals.push(now - last);
      last = now;
      maxEngaged = Math.max(maxEngaged, battle?.groups.filter(g => g.engaged && g.left === null).length ?? 0);
      if (now - first >= sampleMs) return end('complete');
      frameId = requestAnimationFrame(frame);
    }
    frameId = requestAnimationFrame(frame);
  }), { phase, sampleMs }).then(({ intervals, ...sample }) => {
    if (!intervals.length) return { ...sample, frames: 0, fps: null, frameMs: null };
    const sorted = [...intervals].sort((a, b) => a - b);
    const percentile = q => sorted[Math.ceil(q * sorted.length) - 1];
    const elapsedMs = intervals.reduce((total, interval) => total + interval, 0);
    return {
      ...sample, frames: intervals.length, elapsedMs, fps: intervals.length * 1000 / elapsedMs,
      frameMs: { p50: percentile(0.5), p95: percentile(0.95), max: sorted.at(-1), worst: sorted.slice(-5).reverse() },
    };
  });
}

async function stageCombat(page) {
  await page.evaluate(() => {
    const p = window.__proto;
    for (const [id, x, y] of [['lobos', 82, 35], ['javalis', 70, 73], ['corvos', 100, 79], ['fundeiros', 110, 42]]) p.place(id, x, y);
    p.ui.paused = true;
  });
  await page.click('#start');   // A gesture unlocks the same audio as during play.
  return page.evaluate(() => {
    const p = window.__proto;
    const battle = p.ui.session.battle;
    for (const [id, target] of [['lobos', 'velites'], ['javalis', 'retaguarda'], ['corvos', 'retaguarda'], ['fundeiros', 'vanguarda']]) {
      p.order(id, { type: 'atacar', target });
    }
    const column = battle.groups.find(g => g.id === 'velites');
    for (let i = 0; i < 240 && !battle.over && column.x < 76; i++) p.run(0.5);
    if (battle.over || column.x < 76) throw new Error('A coluna não chegou à posição do cenário de medição.');
    p.signal();
    for (let i = 0; i < 60 && !battle.over && !battle.groups.some(g => g.engaged); i++) p.run(0.5);
    if (battle.over || !battle.groups.some(g => g.engaged)) throw new Error('O cenário de medição não chegou a combate ativo.');
    // The fixed-step setup bypasses the frame loop that normally clears these transient effects.
    p.ui.slow = 0;
    p.view.camera.shake = 0;
    p.ui.paused = false;
    return { seed: p.ui.seed, signalAt: p.ui.session.stats.signalAt, stagedAt: battle.t };
  });
}

async function memory(cdp) {
  return cdp.send('Runtime.getHeapUsage').catch(() => null);
}

async function measure(browser, url) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'en-GB', serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    const errors = [], graphicsConsole = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      const text = message.text();
      if (message.type() === 'error') errors.push(text);
      if (/webgl|GL Driver|GPU stall|context lost/i.test(text)) graphicsConsole.push({ type: message.type(), text });
    });
    const cdp = await context.newCDPSession(page);
    const network = await trackNetwork(cdp);
    await page.addInitScript(installProbe);
    const response = await page.goto(url);
    if (!response.ok()) throw new Error(`HTTP ${response.status()} ao abrir o protótipo.`);
    try { await page.waitForFunction(() => window.__sentinelPerf.readyMs !== null, null, { timeout: 20000 }); }
    catch (error) {
      const events = await page.evaluate(() => window.__sentinelPerf.webglEvents);
      throw new Error(`Cena indisponível: ${JSON.stringify({ errors, graphicsConsole, events })}`, { cause: error });
    }
    const startup = await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0];
      return { origin: performance.timeOrigin, loadMs: navigation.loadEventEnd, sceneReadyMs: window.__sentinelPerf.readyMs };
    });
    const { origin, ...timings } = startup;
    const traffic = network(origin, Math.max(timings.loadMs, timings.sceneReadyMs));
    const renderer = await page.evaluate(() => {
      const gl = document.getElementById('view').getContext('webgl2') || document.getElementById('view').getContext('webgl');
      const debug = gl?.getExtension('WEBGL_debug_renderer_info');
      return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null;
    });
    const gpu = /swiftshader|llvmpipe|softpipe|software|basic render driver|warp|swrast|lavapipe/i.test(renderer ?? '') ? 'software'
      : /nvidia|radeon|\bamd\b|intel|apple|adreno|mali/i.test(renderer ?? '') ? 'hardware' : 'unknown';
    if (values.gpu === 'hardware' && gpu !== 'hardware') {
      throw new Error(`GPU física não confirmada: ${renderer ?? 'renderer indisponível'} (${gpu}).`);
    }

    const readyHeap = await memory(cdp);
    const preparation = await sampleFrames(page, 'prep');
    const scenario = await stageCombat(page);
    const combat = await sampleFrames(page, 'battle');
    const combatHeap = await memory(cdp);
    const webglEvents = await page.evaluate(() => window.__sentinelPerf.webglEvents);
    return {
      gpu, renderer, startup: { ...timings, ...traffic }, scenario, preparation, combat,
      memory: { readyHeap, combatHeap }, webglEvents, graphicsConsole, errors,
    };
  } finally {
    await context.close();
  }
}

const { url, browser, close } = await startBrowser({
  root, entry: 'tactical-proto.html', software: values.gpu === 'software', headless: !values.headed,
});
try {
  const samples = [];
  for (let i = 0; i < runs; i++) samples.push(await measure(browser, url));
  console.log(JSON.stringify({
    revision: revision(), chromium: browser.version(), platform: process.platform, architecture: process.arch,
    requestedGpu: values.gpu, headed: values.headed, viewport, deviceScaleFactor: 1, sampleMs, samples,
  }, null, 2));
} finally {
  await close();
}
