import test from 'node:test';
import assert from 'node:assert/strict';
import { makeView, toScreen, toWorld, hitTest, drawMap, layoutMapLabels } from '../src/campaign/map-view.js';
import { newCampaign } from '../src/campaign/state.js';
import { placeName, MAP_TITLE } from '../src/campaign/strings.js';

/** Põe à vista do jogador as forças do estado (como se o bando as visse hoje): a vista só desenha o que ele sabe. */
function sighted(s) {
  s.intel = { known: {}, reports: [], n: 0 };
  for (const f of s.patrols || []) s.intel.known[f.id] = { kind: f.kind, x: f.x, y: f.y, day: s.day };
  if (s.praetor) s.intel.known[s.praetor.id] = { kind: 'pretor', x: s.praetor.x, y: s.praetor.y, day: s.day, name: s.praetor.name };
  return s;
}

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
  sighted(s);
  const pp = toScreen(v, s.patrols[0]);
  assert.deepEqual(hitTest(v, s, pp.x + 1, pp.y), { type: 'patrol', id: 'p1' });
  const pr = toScreen(v, s.praetor);
  assert.deepEqual(hitTest(v, s, pr.x, pr.y + 1), { type: 'praetor', id: 'pr' });
  // far from everything
  const far = { x: -500, y: -500 };
  assert.equal(hitTest(v, s, far.x, far.y), null);
});

test('drawMap writes names (as comunidades com o seu nome) and the map title, balances save/restore, resets dash', () => {
  const s = newCampaign(3);
  s.day = 40;
  const v = makeView(s.world, 800, 600), c = fakeCtx();
  drawMap(c, v, s);
  const texts = c.calls.filter(x => x[0] === 'fillText').map(x => x[1]);
  for (const st of s.world.settlements) assert.ok(texts.includes(placeName(s, st.id)), st.name);
  assert.ok(texts.includes(MAP_TITLE), 'a data saiu do mapa: está na barra de cima');
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
  sighted(s);
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
  sighted(s);
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

// --- etiquetas: colocação sem sobreposições ---
// Tabela de larguras própria do teste (serifa) e 10% mais larga que o texto real:
// o que passar aqui passa também com a medida verdadeira do canvas.
const CHAR_W = {
  ' ': .25, a: .44, b: .5, c: .44, d: .5, e: .44, f: .33, g: .5, h: .5, i: .28, j: .28, k: .5, l: .28,
  m: .78, n: .5, o: .5, p: .5, q: .5, r: .33, s: .39, t: .28, u: .5, v: .5, w: .72, x: .5, y: .5, z: .44,
  A: .72, B: .67, C: .67, D: .72, E: .61, F: .56, G: .72, H: .72, I: .33, J: .39, K: .72, L: .61,
  M: .89, N: .72, O: .72, P: .56, Q: .72, R: .67, S: .56, T: .61, U: .72, V: .72, W: .94, X: .72, Y: .72, Z: .61,
  'ã': .5, 'á': .44, 'é': .44, 'í': .28, 'ó': .5, 'ú': .5, 'ç': .44, 'â': .44, 'ê': .44, 'ô': .5, 'à': .44,
};
const conservative = text => [...text].reduce((sum, ch) => sum + (CHAR_W[ch] ?? .5) * 11, 0) * 1.1;
const rectOf = p => ({ x: p.x - p.w / 2, y: p.baseline - p.h, w: p.w, h: p.h });
const boxesHit = (a, b, gap = 1) =>
  a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;

test('layoutMapLabels: nomes reais ficam no canvas, não se sobrepõem e evitam ícones e placas', () => {
  const sizes = [[640, 480], [800, 600], [1024, 768], [1280, 720], [1366, 768], [1920, 1080], [2560, 1440]];
  for (const seed of [1, 2, 3, 4, 5, 7, 9, 12, 42, 147]) {
    const s = newCampaign(seed);
    s.praetor = { id: 'pr', name: 'Vetílio', x: 520, y: 340, men: 40 };
    s.patrols = [{ id: 'p1', kind: 'ronda', x: 300, y: 400 }, { id: 'p2', kind: 'comboio', x: 700, y: 300 }];
    sighted(s);
    for (const [w, h] of sizes) {
      const v = makeView(s.world, w, h);
      const { placed } = layoutMapLabels(v, s, conservative);
      const tag = `${seed}/${w}x${h}`;
      // todos os nomes, inteiros e uma só vez
      assert.equal(placed.length, s.world.settlements.length, tag);
      assert.deepEqual(placed.map(p => p.id).sort(), s.world.settlements.map(x => x.id).sort(), tag);
      for (const p of placed) assert.ok(s.world.settlements.some(x => x.id === p.id && placeName(s, x.id) === p.name), tag);   // as comunidades com o seu nome (PR 5)
      // nenhum nome sai do canvas
      for (const p of placed) {
        const r = rectOf(p);
        assert.ok(r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= w + 1e-9 && r.y + r.h <= h + 1e-9, `${tag}: ${p.name} fora`);
      }
      // nenhum par de nomes se sobrepõe
      for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++)
        assert.ok(!boxesHit(rectOf(placed[i]), rectOf(placed[j])), `${tag}: ${placed[i].name} <> ${placed[j].name}`);
      // nenhum nome cobre um ícone, a placa do pretor, a de Viriato ou a data
      const obstacles = [];
      for (const st of s.world.settlements) { const q = toScreen(v, st); obstacles.push({ x: q.x - 14, y: q.y - 12, w: 28, h: 22 }); }
      const pq = toScreen(v, s.party);
      obstacles.push({ x: pq.x - 9, y: pq.y - 16, w: 18, h: 26 }, { x: pq.x - 26, y: pq.y - 32, w: 52, h: 14 }, { x: 6, y: 4, w: 80, h: 32 });
      const pr = toScreen(v, s.praetor), pw = Math.max(42, s.praetor.name.length * 5.9 + 10);
      obstacles.push({ x: pr.x - 7, y: pr.y - 19, w: 14, h: 28 }, { x: pr.x - pw / 2, y: pr.y - 33, w: pw, h: 14 });
      for (const p of placed) for (const o of obstacles)
        assert.ok(!boxesHit(rectOf(p), o), `${tag}: ${p.name} cobre um ícone ou uma placa`);
      // nestas resoluções o algoritmo nunca teve de recorrer ao último recurso
      assert.equal(placed.filter(p => p.fallback).length, 0, tag);
    }
  }
});

test('há etiquetas deslocadas quando os nomes colidiriam na posição por omissão', () => {
  const s = newCampaign(2), v = makeView(s.world, 640, 480);
  const { placed } = layoutMapLabels(v, s, conservative);
  assert.ok(placed.filter(p => p.moved).length >= 2, 'a 640×480 vários nomes têm de sair do sítio');
  assert.ok(placed.some(p => p.dist > 34), 'algum nome tem de ir para um anel exterior');
});

test('drawMap desenha cada nome na posição calculada e todo o texto fica no canvas', () => {
  const s = newCampaign(7);
  s.praetor = { id: 'pr', name: 'Vetílio', x: 520, y: 340 };
  s.patrols = [{ id: 'p1', kind: 'ronda', x: 300, y: 400 }];
  sighted(s);
  const v = makeView(s.world, 800, 600);
  const c = fakeCtx();
  c.measureText = text => ({ width: conservative(text) });
  drawMap(c, v, s);
  const { placed } = layoutMapLabels(v, s, conservative);
  const texts = c.calls.filter(x => x[0] === 'fillText');
  for (const p of placed) {
    const call = texts.find(x => x[1] === p.name);
    assert.ok(call, p.name);
    assert.ok(near(call[2], p.x) && near(call[3], p.baseline), `${p.name} desenhado fora do layout`);
  }
  for (const call of texts) assert.ok(call[2] >= 0 && call[2] <= 800 && call[3] >= 0 && call[3] <= 600, `${call[1]} fora do canvas`);
  assert.equal(count(c, 'save'), count(c, 'restore'));
});

test('layoutMapLabels sobrevive a tamanhos degenerados', () => {
  const s = newCampaign(3);
  for (const [w, h] of [[1, 1], [0, 0], [300, 2000], [3000, 400]]) {
    const v = makeView(s.world, w, h);
    const { placed } = layoutMapLabels(v, s, conservative);
    assert.equal(placed.length, s.world.settlements.length);
    for (const p of placed) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.baseline), `${w}x${h}`);
  }
});

test('grelha de último recurso: ecrãs de proporção extrema ficam sem sobreposições', () => {
  // 300×2000 e 3000×400 esgotam os anéis radiais à volta dos ícones; a grelha tem de encontrar
  // um sítio livre em vez de aceitar uma sobreposição. Sem isto, 22 nomes empilham-se.
  for (const seed of [3, 42]) {
    const s = newCampaign(seed);
    s.praetor = { id: 'pr', name: 'Vetílio', x: 520, y: 340 };
    s.patrols = [{ id: 'p1', kind: 'ronda', x: 300, y: 400 }];
    sighted(s);
    for (const [w, h] of [[300, 2000], [3000, 400], [200, 2000], [1000, 200]]) {
      const v = makeView(s.world, w, h);
      const { placed } = layoutMapLabels(v, s, conservative);
      const tag = `${seed}/${w}x${h}`;
      assert.equal(placed.length, s.world.settlements.length, tag);
      for (const p of placed) {
        const r = rectOf(p);
        assert.ok(r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= w + 1e-9 && r.y + r.h <= h + 1e-9, `${tag}: ${p.name} fora`);
      }
      for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++)
        assert.ok(!boxesHit(rectOf(placed[i]), rectOf(placed[j])), `${tag}: ${placed[i].name} <> ${placed[j].name}`);
      assert.equal(placed.filter(p => p.fallback).length, 0, `${tag}: houve recurso ao último sítio`);
    }
  }
});

// --- PR 5: o vale ---
import { POSTURE_FLAG, valleyIds } from '../src/campaign/map-view.js';
import { COMMUNITY_IDS } from '../src/campaign/communities.js';

test('vale: cada postura tem uma bandeira de forma e cor próprias (não só a cor)', () => {
  const shapes = Object.values(POSTURE_FLAG).map(f => f.shape), colors = Object.values(POSTURE_FLAG).map(f => f.color);
  assert.deepEqual(Object.keys(POSTURE_FLAG), ['comprometida', 'amiga', 'neutra', 'receosa', 'colabora']);
  assert.equal(new Set(shapes).size, 5); assert.equal(new Set(colors).size, 5);
});

test('vale: desenha todas as posturas e situações sem rebentar, com o «!» dos assuntos e o destaque', () => {
  const s = newCampaign(3), v = makeView(s.world, 900, 600);
  const postures = Object.keys(POSTURE_FLAG), sits = ['livre', 'tributada', 'castigada', 'ocupada', 'queimada', 'abandonada'];
  for (let i = 0; i < sits.length; i++) {
    COMMUNITY_IDS.forEach((id, k) => { s.communities[id].posture = postures[(i + k) % 5]; s.communities[id].situation = sits[(i + k) % sits.length]; });
    const issues = { [s.communities.souto.settlement]: 'decisao', [s.communities.vau.settlement]: 'atencao' };
    const c = fakeCtx();
    assert.doesNotThrow(() => drawMap(c, v, s, { issues, flash: { [s.communities.ribeira.settlement]: 0.5 }, route: { to: { x: 500, y: 300 }, label: '2 dias' } }));
    assert.equal(count(c, 'save'), count(c, 'restore'));
    assert.equal(c.calls.filter(x => x[0] === 'fillText' && x[1] === '!').length, 2);
    assert.ok(c.calls.some(x => x[0] === 'fillText' && x[1] === '2 dias'));
  }
});

test('vale: a figura de cada comunidade está no seu lugar funcional (o clique nela seleciona esse lugar)', () => {
  for (const seed of [1, 3, 42]) {
    const s = newCampaign(seed);
    for (const [w, h] of [[1066, 664], [980, 696], [724, 484], [844, 274]]) {
      const v = makeView(s.world, w, h);
      for (const id of COMMUNITY_IDS) {
        const p = s.world.settlements.find(x => x.id === s.communities[id].settlement), q = toScreen(v, p);
        assert.deepEqual(hitTest(v, s, q.x, q.y), { type: 'settlement', id: p.id }, `${seed} ${w}x${h} ${id}`);
      }
    }
    assert.equal(valleyIds(s).size, 5);
  }
});
