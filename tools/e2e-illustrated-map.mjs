import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { startBrowser } from './e2e-lib.mjs';

const evidence = process.argv[2];
if (evidence) await mkdir(evidence, { recursive: true });
const { url, browser, close } = await startBrowser({ entry: 'index.html?map=illustrated&seed=1234' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'pt-PT' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('viriato.campaign', 'existing-save'));
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.campaign.active, null, {timeout: 60000});
  const canvas = page.locator('#mapcv');
  const picture = async name => {
    if (evidence) await page.screenshot({ path: join(evidence, name + '.jpg'), quality: 90 });
  };
  const camera = () => page.evaluate(() => {
    const { scale, ox, oy } = window.__game.campaign.view();
    return { scale, ox, oy };
  });
  const village = () => page.evaluate(() => {
    const c = window.__game.campaign, state = c.flow.state, v = c.view();
    const id = state.communities.ribeira.settlement, p = state.world.settlements.find(s => s.id === id);
    const r = document.getElementById('mapcv').getBoundingClientRect();
    return { x: r.left + v.ox + p.x * v.scale, y: r.top + v.oy + p.y * v.scale };
  });
  const initial = await camera();
  await picture('vale');
  const deterministic = await page.evaluate(async () => {
    const { landscape, loadBrushes } = await import('/src/campaign/illustrated/landscape.js');
    const { world, seed } = window.__game.campaign.flow.state, art = await loadBrushes();
    const first = landscape(seed, world, art);
    const digest = async canvas => {
      const bitmap = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bitmap.data))).join(',');
    };
    const a = await digest(first);
    return first === landscape(seed, world, art) &&
      a === await digest(landscape(seed, structuredClone(world), art)) &&
      a !== await digest(landscape(seed + 1, structuredClone(world), art));
  });
  assert.ok(deterministic, 'same seed reproduces pixels and live world reuses its canvas');
  const start = await village();
  await page.mouse.move(start.x, start.y);
  await page.mouse.wheel(0, -480);
  await page.waitForFunction(s => window.__game.campaign.view().scale > 2.1 * s, initial.scale);
  await page.waitForTimeout(450);
  const anchored = await village();
  assert.ok(Math.hypot(anchored.x - start.x, anchored.y - start.y) < 1.5, 'zoom keeps cursor anchored');
  const b = await canvas.boundingBox();
  const dx = 94, dy = 58;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, {steps: 8});
  await page.mouse.up();
  const shifted = await village();
  assert.ok(Math.hypot(shifted.x - anchored.x - dx, shifted.y - anchored.y - dy) < 2);
  assert.equal(await page.evaluate(() => window.__game.campaign.dest), null, 'drag issues no order');
  await page.mouse.move(shifted.x, shifted.y);
  await page.locator('#mtip:not(.hidden)').waitFor();
  const name = await page.locator('#mtip b').textContent();
  await page.mouse.click(shifted.x, shifted.y);
  assert.equal(await page.locator('#mctx h3').textContent(), name, 'same village hovered and picked');
  await page.mouse.move(2, 4);
  await picture('ribeira');
  await canvas.focus();
  await page.keyboard.press('Home');
  assert.deepEqual(await camera(), initial);
  await page.evaluate(() => window.__game.campaign.select(null));

  // Count frame intervals while driving the real controls. March samples only
  // cover the interpolation of a real one-day order (not the following idle time).
  async function measure(mode) {
    return page.evaluate(async mode => {
      const c = window.__game.campaign, cv = document.getElementById('mapcv');
      const box = cv.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
      const times = [];
      const frames = mode === 'march' ? 12 : 120;
      const runs = mode === 'march' ? 3 : 1;
      for (let run = 0; run < runs; run++) {
        if (mode === 'march') {
          const before = { ...c.flow.state.party };
          c.order({kind:'marchar', to:{x:before.x + (run % 2 ? -170 : 170), y:before.y}});
          if (Math.hypot(c.flow.state.party.x-before.x, c.flow.state.party.y-before.y) < 1)
            throw new Error('Expected an animated march');
        }
        let last = await new Promise(requestAnimationFrame);
        for (let i = 0; i < frames; i++) {
          if (mode === 'pan') cv.dispatchEvent(new PointerEvent('pointermove', {
            pointerId:1, clientX:x + Math.sin(i / 20) * 75, clientY:y + Math.cos(i / 24) * 55,
          }));
          if (mode === 'zoom') cv.dispatchEvent(new WheelEvent('wheel', {
            cancelable:true, clientX:x, clientY:y, deltaY:i % 60 < 30 ? -8 : 8,
          }));
          const next = await new Promise(requestAnimationFrame);
          times.push(next - last); last = next;
        }
      }
      const fps = 1000 * times.length / times.reduce((a, b) => a + b, 0);
      times.sort((a,b) => a-b);
      return { mode, frames:times.length, fps:+fps.toFixed(1), p95ms:+times[Math.ceil(times.length*.95)-1].toFixed(1) };
    }, mode);
  }
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  console.log(await measure('pan'));
  await page.mouse.up();
  console.log(await measure('zoom'));
  await canvas.focus();
  await page.keyboard.press('Home');
  console.log(await measure('march'));
  assert.equal(await page.evaluate(() => localStorage.getItem('viriato.campaign')), 'existing-save');
  for (const scenario of ['rumor', 'old-sighting', 'community']) {
    await page.goto(url + '&scenario=' + scenario);
    await page.waitForFunction(() => window.__game?.campaign.active, null, {timeout: 60000});
    const facts = await page.evaluate(async () => {
      const { intelView } = await import('/src/campaign/intel.js');
      const { hitTest, toScreen } = await import('/src/campaign/map-view.js');
      const c = window.__game.campaign, state = c.flow.state, intel = intelView(state);
      const force = intel.forces[0], q = toScreen(c.view(), state.patrols[0]);
      const hidden = hitTest(c.view(), state, q.x, q.y)?.type !== 'patrol';
      return { day:state.day, hidden, visible:intel.forces.length, old:force?.age ?? 0,
        rumor:intel.zones.some(z => z.src === 'rumor'), burnt:state.communities.souto.situation === 'queimada' };
    });
    assert.equal(facts.day, 9);
    assert.ok(facts.hidden);
    if (scenario === 'rumor') assert.ok(facts.rumor && facts.visible === 0);
    if (scenario === 'old-sighting') assert.equal(facts.old, 2);
    if (scenario === 'community') assert.ok(facts.burnt);
    await picture(scenario);
  }
  assert.deepEqual(errors, []);
  console.log('OK — pixels, cache, cursor anchor, drag, hover, selection, Home, march and save isolation');
} finally {
  await close();
}
