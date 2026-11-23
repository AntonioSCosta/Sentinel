import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startBrowser } from './e2e-lib.mjs';

const out = process.argv[2];
if (out) await mkdir(out, { recursive: true });
const { browser, url, close } = await startBrowser({ entry: 'tactical-proto.html' });
const seed = 83026358;
const plan = [['lobos', 'velites'], ['javalis', 'retaguarda'], ['corvos', 'retaguarda'], ['fundeiros', 'vanguarda']];
const withPage = async (size, experimental, run, reducedMotion = 'no-preference') => {
  const page = await browser.newPage({ viewport: size, locale: 'en', reducedMotion });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await page.goto(url + (experimental ? '?camera=experimental' : ''));
    await page.waitForFunction(() => !!window.__proto, null, { timeout: 60000 });
    if (experimental) await page.locator('#camera-experiment').waitFor();
    else assert.equal(await page.locator('#camera-experiment').count(), 0);
    const result = await run(page);
    assert.deepEqual(errors, []);
    return result;
  } finally { await page.close(); }
};

async function prepare(page) {
  await page.evaluate(seed => {
    const p = window.__proto;
    p.seed(seed);
    for (const args of [['lobos', 82, 35], ['javalis', 70, 73], ['corvos', 100, 79], ['fundeiros', 110, 42]]) p.place(...args);
    p.start();
    document.getElementById('pause').click();
  }, seed);
}

const tick = (page, secs) => page.evaluate(secs => window.__proto.run(secs), secs);
const battleState = page => page.evaluate(() => {
  const { battle } = window.__proto.ui.session;
  return { tick: battle.tick, over: battle.over, log: battle.log, groups: battle.groups };
});
const snapshot = page => page.evaluate(() => window.__proto.cameraExperiment);
const strategic = page => page.waitForFunction(() => window.__proto.cameraExperiment?.busy === false);
const near = page => page.waitForFunction(() => window.__proto.cameraExperiment?.clearance < 4.5);
const follow = async (page, id) => {
  await page.locator('#camera-group').selectOption(id);
  await page.locator('#camera-follow').click();
  await page.waitForFunction(id => {
    const { cameraExperiment: c, ui } = window.__proto;
    const g = ui.session?.battle.groups.find(g => g.id === id);
    return c?.targetId === id && c.clearance < 4.5 && Math.hypot(g.x - c.pose.x, g.y - c.pose.z) < 8;
  }, id);
};
const orders = (page, list) => page.evaluate(list => {
  for (const [group, target] of list) window.__proto.order(group, { type: 'atacar', target });
}, list);
const screenshot = (page, name) => out && page.screenshot({ path: join(out, `${name}.jpg`), type: 'jpeg', quality: 80 });

function performanceSample(page) {
  return page.evaluate(async () => {
    const { info } = window.__proto;
    const frames = [];
    for (let i = 0; i < 31; i++) frames.push(await new Promise(resolve => requestAnimationFrame(resolve)));
    const intervals = frames.slice(1).map((t, i) => t - frames[i]).sort((a, b) => a - b);
    const canvas = document.getElementById('view');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return { medianMs: intervals[14], p95Ms: intervals[28], samples: intervals.length, ...info(),
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null };
  });
}

try {
  const wide = { width: 1280, height: 720 };
  const baseline = await withPage(wide, false, async page => {
    await prepare(page);
    await tick(page, 8);
    await tick(page, 6);
    await page.evaluate(() => window.__proto.signal());
    await orders(page, plan);
    await tick(page, 20);
    await page.evaluate(() => window.__proto.order('javalis', { type: 'retirar' }));
    await tick(page, 2);
    await tick(page, 600);
    return battleState(page);
  });
  console.log('OK baseline M1.2 without experimental controls');

  const metrics = await withPage(wide, true, async page => {
    await prepare(page);
    await tick(page, 8);
    await follow(page, 'vanguarda');
    const march = await snapshot(page);
    await tick(page, 6);
    await page.waitForFunction(x => window.__proto.cameraExperiment.pose.x > x + 4, march.pose.x);
    assert.equal((await snapshot(page)).targetId, 'vanguarda');
    console.log('OK following the Roman column on the move');
    await page.keyboard.press('Escape');
    await strategic(page);

    await page.keyboard.press('1');
    const aim = { x: wide.width / 2, y: wide.height * 0.55 };
    assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y).id, aim), 'view');
    const savedYaw = await page.evaluate(() => window.__proto.view.camera.yaw);
    await page.mouse.move(aim.x, aim.y);
    await page.mouse.down({ button: 'middle' });
    await page.keyboard.press('c');
    await page.mouse.up({ button: 'middle' });
    await near(page);
    await page.locator('#hint').waitFor({ state: 'hidden' });
    const before = await battleState(page);
    const eye = await snapshot(page);
    await page.mouse.move(aim.x, aim.y);
    await page.mouse.down();
    await page.mouse.move(aim.x + 46, aim.y - 24, { steps: 3 });
    await page.mouse.up();
    await page.waitForFunction(p => {
      const { pose } = window.__proto.cameraExperiment;
      return Math.abs(Math.sin(pose.yaw - p.yaw)) > 0.1 && Math.abs(pose.pitch - p.pitch) > 0.04;
    }, eye.pose);
    await page.mouse.move(aim.x, aim.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(aim.x + 34, aim.y + 12, { steps: 3 });
    await page.mouse.up({ button: 'right' });
    await page.mouse.wheel(0, -140);
    await page.waitForFunction(p => {
      const { pose, clearance, mode } = window.__proto.cameraExperiment;
      return mode === 'immersive' && clearance >= 1.1 && Math.hypot(pose.x - p.x, pose.z - p.z) > 1;
    }, eye.pose);
    await page.keyboard.press('f');
    assert.equal(await page.evaluate(() => window.__proto.ui.speed), 2);
    assert.equal(await page.evaluate(() => window.__proto.ui.selected), 'lobos');
    assert.deepEqual(await battleState(page), before, 'camera drag, wheel and speed do not issue orders while paused');
    console.log('OK immersive canvas gestures and F leave tactics intact');
    await page.keyboard.press('Escape');
    await strategic(page);
    await page.mouse.move(aim.x + 15, aim.y);
    assert.equal(await page.evaluate(() => window.__proto.view.camera.yaw), savedYaw, 'no stale strategic drag after switching views');

    await page.evaluate(() => window.__proto.signal());
    // A real strategic canvas click attacks vélites once the overview projection is restored.
    const target = await page.evaluate(() => {
      const { view, ui } = window.__proto;
      const foe = ui.session.battle.groups.find(g => g.id === 'velites');
      return view.project(foe.x, foe.y);
    });
    await page.mouse.click(target.x, target.y);
    const firstOrder = (await battleState(page)).log.at(-1);
    assert.deepEqual({ group: firstOrder.group, type: firstOrder.type, target: firstOrder.target },
      { group: 'lobos', type: 'atacar', target: 'velites' });
    await orders(page, plan.slice(1));
    await tick(page, 20);
    assert.ok((await battleState(page)).groups.find(g => g.id === 'javalis').engaged);
    await page.evaluate(() => {
      const { view, ui } = window.__proto;
      const groups = ui.session.battle.groups;
      Object.assign(view.camera, { tx: 39, ty: 60, dist: 55 });
      // Settle the visual positions and hit flashes after fast-forwarding the paused simulation.
      for (let i = 0; i < 8; i++) view.sync(groups, 0.1, { selected: ui.selected, lookup: id => groups.find(g => g.id === id) });
    });
    await page.locator('#banner:not(.show)').waitFor();
    const measurementTick = (await battleState(page)).tick;
    await screenshot(page, '01-strategic');
    const overview = await performanceSample(page);
    await follow(page, 'javalis');
    await screenshot(page, '02-following');
    const closeUp = await performanceSample(page);
    await page.keyboard.press('Escape');
    await strategic(page);
    await page.keyboard.press('2');
    await page.keyboard.press('c');
    await near(page);
    await screenshot(page, '03-immersive');
    const immersive = await performanceSample(page);
    await follow(page, 'javalis');
    assert.equal((await battleState(page)).tick, measurementTick);

    await page.evaluate(() => window.__proto.order('javalis', { type: 'retirar' }));
    const beforeRetreat = await snapshot(page);
    await tick(page, 2);
    await page.waitForFunction(p => {
      const { pose, targetId } = window.__proto.cameraExperiment;
      return targetId === 'javalis' && Math.hypot(pose.x - p.x, pose.z - p.z) > 1;
    }, beforeRetreat.pose);
    assert.equal((await battleState(page)).groups.find(g => g.id === 'javalis').order.type, 'retirar');
    await tick(page, 600);
    await strategic(page);
    assert.deepEqual(await battleState(page), baseline);
    return { browser: browser.version(), viewport: wide, seed, tick: measurementTick, outcome: baseline.over,
      strategic: overview, following: closeUp, immersive };
  });
  console.log('OK marching, melee, retreat, terrain clearance, orders and identical battle replay');

  await withPage({ width: 640, height: 480 }, true, async page => {
    await page.locator('#lang').selectOption('pt-PT');
    const panel = page.locator('#camera-experiment');
    await panel.getByRole('button', { name: 'Imersiva' }).click();
    await near(page);
    const box = await panel.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 640 && box.y + box.height < 480);
    await page.keyboard.press('Escape');
    await strategic(page);
    assert.equal(await panel.getByRole('button', { name: 'Estratégica' }).getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('1');
    await page.keyboard.press('g');
    await near(page);
    assert.equal((await snapshot(page)).targetId, 'lobos');
    await page.evaluate(() => {
      const p = window.__proto;
      p.start();
      window.cameraTestSession = p.ui.session;
    });
    await page.keyboard.press('Escape');
    await strategic(page);
    const before = (await battleState(page)).tick;
    await page.keyboard.press('c');
    await near(page);
    await page.waitForFunction(before => window.__proto.ui.session === window.cameraTestSession
      && window.__proto.ui.session.battle.tick > before, before);
    await page.keyboard.press('Escape');
    await strategic(page);
  }, 'reduce');
  console.log('OK 640×480, pt-PT, reduced motion and switching during a live battle');
  if (out) await writeFile(join(out, 'measurement.json'), JSON.stringify(metrics, null, 2) + '\n');
  console.log(JSON.stringify(metrics));
} finally { await close(); }
