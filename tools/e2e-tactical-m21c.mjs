import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startBrowser } from './e2e-lib.mjs';

const out = process.argv[2];
if (out) await mkdir(out, { recursive: true });
const { browser, url, close } = await startBrowser({ entry: 'tactical-proto.html', software: process.env.SENTINEL_GPU !== 'hardware' });
const viewport = { width: 1280, height: 720 };
const seed = 83026358;
const plan = [['lobos', 'velites'], ['javalis', 'retaguarda'], ['corvos', 'retaguarda'], ['fundeiros', 'vanguarda']];

async function withPage(path, run) {
  const page = await browser.newPage({ viewport, locale: 'en' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await page.goto(new URL(path, url).href);
    const result = await run(page);
    assert.deepEqual(errors, []);
    return result;
  } finally { await page.close(); }
}

async function prepare(page) {
  await page.waitForFunction(() => !!window.__proto);
  await page.evaluate(seed => {
    const p = window.__proto;
    p.seed(seed);
    for (const spot of [['lobos', 82, 35], ['javalis', 70, 73], ['corvos', 100, 79], ['fundeiros', 110, 42]]) p.place(...spot);
    p.start();
    document.getElementById('pause').click();
  }, seed);
}

const tickTo = (page, time) => page.evaluate(time => {
  const p = window.__proto;
  p.run(time - p.ui.session.battle.t);
}, time);
const orders = (page, list) => page.evaluate(list => {
  for (const [group, target] of list) window.__proto.order(group, { type: 'atacar', target });
}, list);
const state = page => page.evaluate(() => {
  const p = window.__proto, { battle } = p.ui.session;
  return { tick: battle.tick, groups: battle.groups, log: battle.log, report: p.ui.session.report().data };
});
const readGroup = (page, id) => page.evaluate(id => window.__proto.ui.session.battle.groups.find(g => g.id === id), id);
const shot = (page, name) => out && page.screenshot({ path: join(out, `${name}.jpg`), type: 'jpeg', quality: 78 });
const strategic = page => page.waitForFunction(() => window.__proto.cameraExperiment?.busy === false);
const closeView = page => page.waitForFunction(() => window.__proto.cameraExperiment?.clearance < 4);
async function follow(page, id) {
  await page.locator('#camera-group').selectOption(id);
  await page.locator('#camera-follow').evaluate(button => button.click());
  await page.waitForFunction(id => {
    const { pose, targetId, clearance } = window.__proto.cameraExperiment;
    const group = window.__proto.ui.session.battle.groups.find(g => g.id === id);
    return targetId === id && clearance < 4 && Math.hypot(group.x - pose.x, group.y - pose.z) < 8;
  }, id);
}
async function troops(page, mode) {
  const selector = page.locator(windowBench(page) ? '#troop-style' : '#preview-troops');
  await selector.selectOption(mode);
  await page.waitForFunction(mode => (window.__proto ?? window.__troopBench).info().troops === mode, mode);
}
const windowBench = page => page.url().includes('tactical-troop-bench.html');

async function settle(page, advance = false) {
  await page.evaluate(advance => {
    const { view, ui } = window.__proto, groups = ui.session.battle.groups;
    if (advance) Object.assign(view.camera, { tx: 39, ty: 60, dist: 55 });
    for (let i = 0; i < 9; i++) view.sync(groups, 0.12, { selected: ui.selected, lookup: id => groups.find(g => g.id === id) });
  }, advance);
}

async function sample(page, expected) {
  return page.evaluate(async expected => {
    const { info } = window.__proto ?? window.__troopBench;
    const times = [];
    for (let i = 0; i < 19; i++) times.push(await new Promise(resolve => requestAnimationFrame(resolve)));
    const frames = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
    const canvas = document.getElementById('view');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const stats = info();
    if (stats.soldiers !== expected) throw new Error(`expected ${expected} visible soldiers, drew ${stats.soldiers}`);
    return { ...stats, p50Ms: frames[Math.floor(frames.length / 2)], p95Ms: frames[Math.ceil(frames.length * 0.95) - 1],
      samples: frames.length, jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null };
  }, expected);
}

try {
  const baseline = await withPage('tactical-proto.html', async page => {
    await prepare(page);
    assert.equal(await page.locator('#preview-troops').count(), 0);
    assert.equal(await page.locator('#camera-experiment').count(), 0);
    assert.equal(await page.evaluate(() => performance.getEntriesByType('resource').some(e => e.name.includes('hybrid-'))), false);
    await tickTo(page, 14);
    await page.evaluate(() => window.__proto.signal());
    await orders(page, plan);
    await tickTo(page, 34);
    await page.evaluate(() => window.__proto.order('javalis', { type: 'retirar' }));
    await tickTo(page, 600);
    return state(page);
  });
  console.log('OK original replay without preview resources');

  const live = await withPage('tactical-proto.html?visual=m21c', async page => {
    await prepare(page);
    await page.locator('#preview-troops').waitFor();
    await tickTo(page, 8);
    await follow(page, 'javalis');
    const forestM1 = await sample(page, 28);
    const beforeSwitch = await state(page);
    await troops(page, 'c');
    await settle(page);
    assert.deepEqual(await state(page), beforeSwitch);
    assert.ok((await readGroup(page, 'javalis')).hidden);
    await shot(page, '06-c-vegetation');
    const forestC = await sample(page, 28);

    await follow(page, 'vanguarda');
    const marchX = await page.evaluate(() => window.__proto.cameraExperiment.pose.x);
    await tickTo(page, 14);
    await page.waitForFunction(x => window.__proto.cameraExperiment.pose.x > x + 4, marchX);
    await page.keyboard.press('Escape');
    await strategic(page);
    await page.keyboard.press('1');
    await page.keyboard.press('c');
    await closeView(page);
    const before = await state(page);
    await page.mouse.move(633, 352); await page.mouse.down({ button: 'right' });
    await page.mouse.move(672, 369, { steps: 3 }); await page.mouse.up({ button: 'right' });
    await page.keyboard.press('f');
    assert.equal(await page.evaluate(() => window.__proto.ui.speed), 2);
    assert.deepEqual(await state(page), before);
    await page.keyboard.press('Escape');
    await strategic(page);
    await page.evaluate(() => window.__proto.signal());
    const target = await page.evaluate(() => {
      const { view, ui } = window.__proto;
      const foe = ui.session.battle.groups.find(g => g.id === 'velites');
      return view.project(foe.x, foe.y);
    });
    await page.mouse.click(target.x, target.y);
    assert.equal((await state(page)).log.at(-1).target, 'velites');
    await orders(page, plan.slice(1));
    await tickTo(page, 25);
    assert.ok((await readGroup(page, 'javalis')).chargeT > 0);
    await tickTo(page, 34);
    assert.ok((await readGroup(page, 'javalis')).engaged);
    const melee = await state(page);
    const soldiers = melee.groups.filter(g => g.left == null).reduce((sum, g) => sum + g.men, 0);
    await troops(page, 'm1');
    await settle(page, true);
    await page.locator('#banner:not(.show)').waitFor();
    await shot(page, '01-m12-strategic');
    const meleeM1 = await sample(page, soldiers);
    await troops(page, 'c');
    await settle(page);
    await shot(page, '02-c-strategic');
    const meleeC = await sample(page, soldiers);
    await follow(page, 'javalis');
    await shot(page, '03-c-following');
    await page.keyboard.press('Escape');
    await strategic(page);
    await page.keyboard.press('2');
    await page.keyboard.press('c');
    await closeView(page);
    await shot(page, '04-c-immersive');
    await follow(page, 'retaguarda');
    await shot(page, '05-c-melee');
    assert.deepEqual(await state(page), melee);
    await follow(page, 'javalis');
    await page.evaluate(() => window.__proto.order('javalis', { type: 'retirar' }));
    await tickTo(page, 36);
    assert.equal((await readGroup(page, 'javalis')).order.type, 'retirar');
    await tickTo(page, 600);
    await strategic(page);
    const result = await state(page);
    assert.ok(result.groups.some(g => g.state === 'debandada'));
    assert.deepEqual(result, baseline);
    await page.locator('#lang').selectOption('pt-PT');
    assert.equal(await page.locator('#preview-troops').getAttribute('aria-label'), 'Representação das tropas');
    await page.evaluate(() => {
      const p = window.__proto;
      p.start();
      document.getElementById('pause').click();
      window.m21cLiveSession = p.ui.session;
    });
    const startTick = (await state(page)).tick;
    await troops(page, 'm1');
    await page.keyboard.press('c');
    await closeView(page);
    await page.waitForFunction(tick => window.__proto.ui.session === window.m21cLiveSession
      && window.__proto.ui.session.battle.tick > tick, startTick);
    await page.keyboard.press('Escape');
    await strategic(page);
    return { forest: { m1: forestM1, c: forestC }, melee: { m1: meleeM1, c: meleeC },
      tick: melee.tick, outcome: result.report.outcome, initialSoldiers: 28 };
  });
  console.log('OK in-battle switching, camera, selection, charge, withdrawal, rout and exact replay parity');

  const bench = {};
  for (const n of [100, 200]) {
    bench[n] = await withPage(`tactical-troop-bench.html?n=${n}`, async page => {
      await page.waitForFunction(n => window.__troopBench?.info().soldiers === n, n);
      const m1 = await sample(page, n);
      await troops(page, 'c');
      const c = await sample(page, n);
      return { m1, c };
    });
    console.log(`OK visual-only benchmark with ${n} soldiers`);
  }
  const metrics = { browser: browser.version(), viewport, seed, live, bench };
  if (out) await writeFile(join(out, 'measurement.json'), JSON.stringify(metrics, null, 2) + '\n');
  console.log(JSON.stringify(metrics));
} finally { await close(); }
