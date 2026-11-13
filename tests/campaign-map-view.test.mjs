import test from 'node:test';
import assert from 'node:assert/strict';
import { makeView, toScreen, toWorld, hitTest, drawMap } from '../src/campaign/map-view.js';
import { newCampaign } from '../src/campaign/state.js';
import { dateLabel } from '../src/campaign/clock.js';

const SIZES = [[1000, 700], [1920, 1080], [3000, 400], [300, 2000], [640, 480], [1, 1], [0, 0]];
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

function fakeCtx() {
  const calls = [];
  const ctx = { calls };
  for (const m of ['save', 'restore', 'fillRect', 'beginPath', 'arc', 'moveTo', 'lineTo', 'closePath', 'stroke', 'fill', 'fillText', 'setLineDash'])
    ctx[m] = (...a) => { calls.push([m, ...a]); };
  return ctx;
}
const count = (c, m) => c.calls.filter(x => x[0] === m).length;

test('toWorld inverts toScreen for every size; degenerate sizes stay finite', () => {
  const s = newCampaign(3);
  for (const [w, h] of SIZES) {
    const v = makeView(s.world, w, h);
    for (const p of [{ x: 0, y: 0 }, { x: 1000, y: 700 }, { x: 123.4, y: 456.7 }]) {
      const sc = toScreen(v, p);
      assert.ok(Number.isFinite(sc.x) && Number.isFinite(sc.y));
      const b = toWorld(v, sc);
      assert.ok(near(b.x, p.x) && near(b.y, p.y), `${w}x${h}`);
    }
  }
});

test('whole world fits inside the canvas, centred, proportion kept', () => {
  const s = newCampaign(3);
  for (const [w, h] of SIZES) {
    const v = makeView(s.world, w, h);
    const a = toScreen(v, { x: 0, y: 0 }), b = toScreen(v, { x: s.world.w, y: s.world.h });
    if (w >= 25 && h >= 25) {
      assert.ok(a.x >= -1e-9 && a.y >= -1e-9 && b.x <= w + 1e-9 && b.y <= h + 1e-9, `${w}x${h}`);
      assert.ok(near((b.x - a.x) / s.world.w, (b.y - a.y) / s.world.h));
      assert.ok(near(a.x, w - b.x) && near(a.y, h - b.y));
    }
    assert.ok(v.scale > 0 && v.width === w && v.height === h && v.world === s.world);
  }
});

test('hitTest finds settlement, patrol, praetor; nearest wins; null outside', () => {
  const s = newCampaign(3);
  const v = makeView(s.world, 1000, 700);
  const st = s.world.settlements[0];
  const p = toScreen(v, st);
  assert.deepEqual(hitTest(v, s, p.x + 3, p.y - 3), { type: 'settlement', id: st.id });
  s.patrols = [{ id: 'p1', kind: 'ronda', x: st.x + 5, y: st.y }];
  s.praetor = { id: 'pr', x: st.x + 40, y: st.y, name: 'Galba' };
  const pp = toScreen(v, s.patrols[0]);
  assert.deepEqual(hitTest(v, s, pp.x + 1, pp.y), { type: 'patrol', id: 'p1' });
  const pr = toScreen(v, s.praetor);
  assert.deepEqual(hitTest(v, s, pr.x, pr.y + 1), { type: 'praetor', id: 'pr' });
  // far from everything
  const far = { x: -500, y: -500 };
  assert.equal(hitTest(v, s, far.x, far.y), null);
});

test('drawMap writes names and date, balances save/restore, resets dash', () => {
  const s = newCampaign(3);
  s.day = 40;
  const v = makeView(s.world, 800, 600), c = fakeCtx();
  drawMap(c, v, s);
  const texts = c.calls.filter(x => x[0] === 'fillText').map(x => x[1]);
  for (const st of s.world.settlements) assert.ok(texts.includes(st.name), st.name);
  assert.ok(texts.includes(dateLabel(40)));
  assert.ok(texts.includes('Viriato'));
  assert.ok(count(c, 'save') > 0);
  assert.equal(count(c, 'save'), count(c, 'restore'));
  const dashes = c.calls.filter(x => x[0] === 'setLineDash');
  assert.deepEqual(dashes[0][1], [8, 6]);
  assert.deepEqual(dashes[dashes.length - 1][1], []);
  assert.equal(c.calls.find(x => x[0] === 'fillRect')[3] >= 600, true);
});

test('drawMap tolerates no praetor, patrols, and draws them when present', () => {
  const s = newCampaign(3);
  const v = makeView(s.world, 800, 600);
  s.praetor = null; s.patrols = [];
  assert.doesNotThrow(() => drawMap(fakeCtx(), v, s));
  s.praetor = { id: 'pr', x: 100, y: 100, name: 'Galba' };
  s.patrols = [{ id: 'a', kind: 'ronda', x: 50, y: 50 }, { id: 'b', kind: 'comboio', x: 60, y: 60 }];
  const c = fakeCtx();
  drawMap(c, v, s);
  assert.ok(c.calls.some(x => x[0] === 'fillText' && x[1] === 'Galba'));
  assert.equal(count(c, 'save'), count(c, 'restore'));
});

test('burnt village is drawn with an extra strike-through', () => {
  const s = newCampaign(3);
  const v = makeView(s.world, 800, 600);
  const c1 = fakeCtx(); drawMap(c1, v, s);
  const id = Object.keys(s.villages)[0];
  s.villages[id].burnt = true;
  const c2 = fakeCtx(); drawMap(c2, v, s);
  assert.equal(count(c2, 'lineTo'), count(c1, 'lineTo') + 1);
  assert.equal(count(c2, 'stroke'), count(c1, 'stroke') + 1);
});

test('desenha uma figura para cada tipo de povoação, com e sem queimar, sem rebentar', () => {
  const s = newCampaign(3), v = makeView(s.world, 800, 600);
  const kinds = new Set(s.world.settlements.map(x => x.kind));
  assert.ok(kinds.size >= 2, 'o mundo deve ter vários tipos de marcador');
  // queima/toma tudo o que for queimável e volta a desenhar
  for (const id of Object.keys(s.villages)) s.villages[id].burnt = true;
  s.posts = {};
  for (const p of s.world.settlements) if (p.kind === 'posto') s.posts[p.id] = { taken: true };
  s.praetor = { id: 'pr', x: 100, y: 100, name: 'Vetílio' };
  s.patrols = [{ id: 'a', kind: 'ronda', x: 50, y: 50 }, { id: 'b', kind: 'comboio', x: 60, y: 60 }];
  const c = fakeCtx();
  assert.doesNotThrow(() => drawMap(c, v, s));
  assert.equal(count(c, 'save'), count(c, 'restore'));
});

test('posto tomado: riscado como uma aldeia queimada', () => {
  const s = newCampaign(3), v = makeView(s.world, 800, 600), p = s.world.settlements.find(x => x.kind === 'posto');
  const c1 = fakeCtx(); drawMap(c1, v, s);
  s.posts = { [p.id]: { taken: false } };
  const c2 = fakeCtx(); drawMap(c2, v, s);
  assert.equal(count(c2, 'lineTo'), count(c1, 'lineTo'));   // atacado e não tomado: igual
  s.posts[p.id].taken = true;
  const c3 = fakeCtx(); drawMap(c3, v, s);
  assert.equal(count(c3, 'lineTo'), count(c1, 'lineTo') + 1);
});
