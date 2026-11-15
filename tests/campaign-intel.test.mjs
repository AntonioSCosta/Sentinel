// Informação e reconhecimento: o que o jogador sabe das forças romanas (src/campaign/intel.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newCampaign, serialize, deserialize } from '../src/campaign/state.js';
import { stepDay } from '../src/campaign/simulation.js';
import { makeRng } from '../src/campaign/rng.js';
import { createFlow, loadFlow, STORAGE_KEY } from '../src/campaign/flow.js';
import { ensureIntel, updateIntel, intelView, validIntel, forgetForce, SIGHT, FORGET, REPORT_DAYS, RECON_RANGE, RECON_RADIUS, SCOUTS } from '../src/campaign/intel.js';
import { makeView, toScreen, hitTest, drawMap } from '../src/campaign/map-view.js';
import { eventText } from '../src/campaign/ui.js';

const rng = () => makeRng(7);
/** Campanha sem pretor nem colunas a sair, com o bando num sítio fixo: só existe o que o teste lá puser. */
const quiet = () => {
  const s = newCampaign(3);
  s.food = 1e6; s.praetor = null; s.patrols = []; s.party = { x: 500, y: 350 };
  for (const v of Object.values(s.villages)) v.burnt = true;   // sem aldeias a mandar relatos
  s.world.settlements = s.world.settlements.filter(x => x.kind !== 'castro');
  s.doctrine = { mem: { emboscada: 0, coluna: 0, campo: 0, defesa: 0 }, sectors: [0, 0, 0, 0], activity: 0, active: {}, garrison: null, lastSeen: null, nextSpawn: 1e9, hunterAt: -999, off: true };
  return s;
};
const hunter = (x, y, id = 'c1') => ({ id, kind: 'cacadores', hunt: true, x, y, men: 10, target: { x, y }, left: 99 });   // fica parado no alvo
const force = (s, id) => intelView(s).forces.find(f => f.id === id);
const ACAMPAR = { kind: 'acampar' };

function recorder() {
  const calls = [];
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, ...a]); }), set: (t, k, v) => { t[k] = v; return true; } });
  return { ctx, calls };
}
const drawnNear = (calls, q, r = 25) => calls.some(c => c.slice(1).some((v, i, a) => typeof v === 'number' && typeof a[i + 1] === 'number' && Math.hypot(v - q.x, a[i + 1] - q.y) <= r));

test('1. uma força à vista do bando aparece como confirmada, com a posição e o dia', () => {
  const s = quiet(); s.patrols = [hunter(500 + SIGHT - 5, 350)];
  updateIntel(s);
  const f = force(s, 'c1');
  assert.equal(f.status, 'confirmada');
  assert.equal(f.age, 0);
  assert.deepEqual([f.x, f.y, f.kind, f.men], [500 + SIGHT - 5, 350, 'cacadores', 10]);
});

test('2. deixa de se ver: passa a estimada, na última posição conhecida, sem seguir a posição real', () => {
  const s = quiet(); s.patrols = [hunter(600, 350)];
  updateIntel(s);
  s.patrols[0].x = 900; s.patrols[0].y = 100; s.day += 2;   // foi-se embora, para fora da vista
  updateIntel(s);
  const f = force(s, 'c1');
  assert.equal(f.status, 'estimada');
  assert.equal(f.age, 2);
  assert.deepEqual([f.x, f.y], [600, 350]);
  assert.ok(f.r > 0, 'zona de incerteza');
  assert.equal(JSON.stringify(intelView(s)).includes('900'), false);
  s.day += FORGET; updateIntel(s);
  assert.equal(force(s, 'c1'), undefined, 'um avistamento velho de mais sai do mapa');
});

test('3. um relato antigo não se apresenta como informação atual', () => {
  const s = quiet(); const it = ensureIntel(s);
  it.reports.push({ id: 1, kind: 'comboio', x: 200, y: 200, r: 50, seen: s.day, got: s.day, rel: 'boa', src: 'aldeia', fid: 'x' });
  let v = intelView(s);
  assert.equal(v.reports[0].age, 0); assert.equal(v.zones.length, 1);
  assert.equal(v.forces.length, 0, 'um relato nunca é uma força confirmada');
  s.day += REPORT_DAYS + 1; v = intelView(s);
  assert.equal(v.reports[0].old, true);
  assert.equal(v.reports[0].age, REPORT_DAYS + 1);
  assert.equal(v.zones.length, 0, 'já não se desenha no mapa');
  assert.match(eventText({ type: 'relato', id: 1 }, s) ?? '', /comboio/);
});

test('3b. um relato que ainda vem a caminho não se mostra antes de chegar', () => {
  const s = quiet(); ensureIntel(s).reports.push({ id: 1, kind: 'patrulha', x: 200, y: 200, r: 50, seen: s.day, got: s.day + 2, rel: 'boa', src: 'aldeia' });
  assert.equal(intelView(s).reports.length, 0);
  s.day += 2;
  const ev = updateIntel(s);
  assert.deepEqual(ev.filter(e => e.type === 'relato'), [{ type: 'relato', id: 1 }]);
  assert.equal(intelView(s).reports[0].age, 2);
});

test('4. forças nunca observadas não aparecem em lado nenhum', () => {
  const s = quiet(); s.patrols = [hunter(900, 100), { id: 'p1', kind: 'patrulha', x: 50, y: 600, i: 1, dir: 1, men: 6 }];
  s.praetor = { id: 'vetilio', name: 'Caio Vetílio', x: 950, y: 650, men: 60, speed: 22, traits: { pursuit: 0, scorch: .5 }, rest: 99 };
  s.intel = { known: {}, reports: [], n: 0 };
  for (let d = 0; d < 40; d++) { s.day++; updateIntel(s); }
  const v = intelView(s);
  assert.deepEqual(v.forces, []);
  // sem aldeias por perto, o mais que pode haver é um rumor: zona larga, pouco fiável, nunca a posição exata
  for (const z of v.zones) {
    assert.equal(z.rel, 'fraca'); assert.ok(z.r >= 100);
    assert.equal(s.patrols.concat(s.praetor).some(f => f.x === z.x && f.y === z.y), false);
  }
});

test('5. reconhecer confirma o que há na zona e atualiza posições antigas', () => {
  const s = quiet(); const far = { x: 500 + RECON_RANGE - 10, y: 350 };
  s.patrols = [hunter(far.x + 20, far.y)];
  ensureIntel(s).known.c1 = { kind: 'cacadores', x: 100, y: 100, men: 10, day: s.day - 3 };   // avistamento antigo, noutro sítio
  const day = s.day, r = stepDay(s, { kind: 'reconhecer', to: far }, rng());
  assert.notEqual(r.refused, true);
  assert.equal(s.day, day + 1, 'gasta o dia');
  const f = force(s, 'c1');
  assert.equal(f.status, 'confirmada');
  assert.deepEqual([f.x, f.y], [far.x + 20, far.y]);
  const ev = r.events.find(e => e.type === 'reconhecimento');
  assert.deepEqual(ev.found, ['cacadores']);
  assert.match(eventText(ev, s), /caçadores/);
  assert.equal(intelView(s).reports[0].src, 'batedores');
});

test('6. uma zona sem forças dá um relatório válido («parece livre») e limpa o que lá se julgava estar', () => {
  const s = quiet();
  ensureIntel(s).known.velho = { kind: 'patrulha', x: 700, y: 350, men: 6, day: s.day - 2 };   // a 200 do bando: fora da vista
  const r = stepDay(s, { kind: 'reconhecer', to: { x: 700, y: 350 } }, rng());
  const ev = r.events.find(e => e.type === 'reconhecimento');
  assert.deepEqual(ev.found, []);
  assert.match(eventText(ev, s), /parece livre/);
  assert.equal(force(s, 'velho'), undefined);
  const rep = intelView(s).reports[0];
  assert.equal(rep.kind, 'livre'); assert.equal(rep.r, RECON_RADIUS);
  assert.ok(validIntel(s.intel));
});

test('reconhecer recusado (poucos homens, longe, sem destino): não gasta o dia e diz porquê', () => {
  for (const [prep, order, why] of [
    [s => { s.men = SCOUTS; }, { kind: 'reconhecer', to: { x: 520, y: 350 } }, 'homens'],
    [() => {}, { kind: 'reconhecer', to: { x: 500 + RECON_RANGE + 5, y: 350 } }, 'longe'],
  ]) {
    const s = quiet(); prep(s); ensureIntel(s);
    const before = JSON.stringify(s), r = stepDay(s, order, rng());
    assert.equal(r.refused, true);
    assert.equal(r.events[0].why, why);
    assert.match(eventText(r.events[0], s), /O dia não passa\./);
    assert.equal(JSON.stringify(s), before);
  }
  const s = quiet();
  assert.equal(stepDay(s, { kind: 'reconhecer' }, rng()).refused, true);
});

test('7. dados de informação inválidos são rejeitados ao carregar', () => {
  const s = quiet(); s.patrols = [hunter(600, 350)]; updateIntel(s);
  assert.ok(deserialize(serialize(s)), 'os válidos carregam');
  const bad = [
    i => { i.known = []; }, i => { i.known.c1.x = 'a'; }, i => { i.known.c1.day = null; }, i => { delete i.known.c1.kind; },
    i => { i.reports = {}; }, i => { i.reports.push({ id: 1 }); }, i => { i.reports.push({ id: 1, kind: 'x', x: 0, y: 0, r: -1, seen: 0, got: 0, rel: 'boa', src: 'aldeia' }); },
    i => { i.reports.push({ id: 1, kind: 'x', x: 0, y: 0, r: 1, seen: 0, got: 0, rel: 'certíssima', src: 'aldeia' }); }, i => { i.n = 'z'; },
  ];
  for (const f of bad) {
    const o = JSON.parse(serialize(s)); f(o.intel);
    assert.equal(deserialize(JSON.stringify(o)), null, f.toString());
  }
  const o = JSON.parse(serialize(s)); o.intel = null;
  assert.equal(deserialize(JSON.stringify(o)), null);
});

test('8. gravações antigas (sem informação) carregam e ganham a informação à vista', () => {
  const store = new Map(), storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  const f = createFlow({ storage, seed: 5 });
  for (let i = 0; i < 4 && f.phase === 'mapa'; i++) f.order(ACAMPAR);
  const saved = JSON.parse(store.get(STORAGE_KEY));
  delete saved.state.intel;   // como uma gravação de antes desta versão
  saved.state.patrols = [hunter(saved.state.party.x + 40, saved.state.party.y)];
  saved.phase = 'mapa'; saved.battle = null;
  store.set(STORAGE_KEY, JSON.stringify(saved));
  const g = loadFlow(storage);
  assert.ok(g, 'carrega');
  assert.ok(validIntel(g.state.intel));
  assert.equal(force(g.state, 'c1').status, 'confirmada');
});

test('9. a simulação romana usa as posições reais: uma força desconhecida anda e apanha o bando', () => {
  const s = quiet(); s.cooldown = 0;
  const p = { id: 'p1', kind: 'patrulha', x: 50, y: 600, i: 1, dir: 1, men: 6 }; s.patrols = [p];
  const x0 = p.x;
  stepDay(s, ACAMPAR, rng());
  assert.notEqual(s.patrols[0]?.x, x0, 'moveu-se sem o jogador a ver');
  assert.equal(force(s, 'p1'), undefined);
  // um destacamento que o jogador desconhece e que acaba em cima do bando dá encontro na mesma
  const t = quiet(); t.cooldown = 0; t.intel = { known: {}, reports: [], n: 0 };
  t.patrols = [hunter(t.party.x + 10, t.party.y)];
  assert.equal(stepDay(t, ACAMPAR, rng()).encounter?.kind, 'cacadores');
});

test('10. a interface não chega à posição real de forças desconhecidas (desenho, clique e código)', () => {
  const s = quiet(); s.patrols = [hunter(900, 100)];
  s.praetor = { id: 'vetilio', name: 'Caio Vetílio', x: 120, y: 620, men: 60, speed: 22, traits: { pursuit: 0, scorch: .5 }, rest: 99 };
  s.day = 5; s.intel = { known: {}, reports: [], n: 0 };
  updateIntel(s);
  assert.deepEqual(intelView(s).zones, [], 'neste dia não há rumores: o mapa não tem nada romano');
  const v = makeView(s.world, 1000, 700), { ctx, calls } = recorder();
  drawMap(ctx, v, s);
  for (const real of [s.patrols[0], s.praetor]) {
    const q = toScreen(v, real);
    assert.equal(hitTest(v, s, q.x, q.y), null);
    assert.equal(drawnNear(calls, q), false, 'nada desenhado na posição real');
  }
  assert.equal(calls.some(c => c[0] === 'fillText' && /Vetílio/.test(String(c[1]))), false);
  // o mesmo desenho sem as forças reais no estado: a vista só depende do que o jogador sabe
  const t = JSON.parse(JSON.stringify(s)); t.patrols = []; t.praetor = null;
  const b = recorder(); drawMap(b.ctx, v, t);
  assert.deepEqual(b.calls, calls);
  // e o código da apresentação não lê as posições reais
  for (const file of ['map-view.js', 'ui.js']) {
    const src = readFileSync(new URL(`../src/campaign/${file}`, import.meta.url), 'utf8');
    assert.equal(/\.patrols\b/.test(src), false, `${file} não lê state.patrols`);
    assert.deepEqual((src.match(/\.praetor\b(?!\?\.name)/g) || []), [], `${file} só lê o nome do pretor`);
  }
});

test('vencer uma força tira-a do mapa do jogador; a posição antiga não fica como fantasma', () => {
  const s = quiet(); s.patrols = [hunter(600, 350)]; updateIntel(s);
  forgetForce(s, 'c1');
  assert.equal(force(s, 'c1'), undefined);
});

test('relatos de aldeias: zona à volta da aldeia, não a posição da coluna; deterministas; chegam com atraso de longe', () => {
  const run = () => {
    const s = newCampaign(3); s.food = 1e6; s.praetor = null;
    const v = s.world.settlements.filter(x => x.kind === 'aldeia').sort((a, b) => Math.hypot(b.x - s.party.x, b.y - s.party.y) - Math.hypot(a.x - s.party.x, a.y - s.party.y))[0];
    s.patrols = [hunter(v.x + 20, v.y + 5)];
    const got = [];
    for (let d = 0; d < 12; d++) { s.day++; got.push(...updateIntel(s)); }
    return { s, v, got };
  };
  const { s, v, got } = run();
  const reps = s.intel.reports.filter(r => r.src === 'aldeia');
  assert.ok(reps.length >= 1, 'em 12 dias junto a uma aldeia chega pelo menos um relato');
  for (const r of reps) {
    assert.deepEqual([r.x, r.y], [v.x, v.y]);
    assert.ok(r.r > 0); assert.equal(r.kind, 'cacadores'); assert.equal(r.place, v.id);
    assert.ok(r.got >= r.seen);
  }
  assert.ok(reps.some(r => r.got > r.seen), 'a aldeia fica longe: o mensageiro demora');
  assert.ok(got.some(e => e.type === 'relato'));
  assert.equal(force(s, 'c1'), undefined, 'o relato não confirma a força');
  assert.deepEqual(run().s.intel, s.intel, 'mesma semente, mesmos relatos');
});

test('campanha nova: sabe-se onde o pretor junta o exército, mas só como relato', () => {
  const f = createFlow({ seed: 9 }), v = intelView(f.state);
  const r = v.reports.find(x => x.kind === 'pretor');
  assert.ok(r); assert.equal(r.src, 'inicio');
  assert.equal(Math.hypot(r.x - f.state.praetor.x, r.y - f.state.praetor.y) <= r.r, true);
});

test('a informação não mexe na simulação: mesma semente, mesmo estado, com ou sem o módulo a olhar', () => {
  const strip = s => { const o = JSON.parse(JSON.stringify(s)); delete o.intel; return o; };
  const a = newCampaign(11), b = newCampaign(11);
  for (let d = 0; d < 60; d++) {
    stepDay(a, ACAMPAR, makeRng(d + 1));
    stepDay(b, ACAMPAR, makeRng(d + 1)); b.intel = undefined; delete b.intel;   // apaga o que o jogador sabe todos os dias
    if (a.over || b.over) break;
  }
  assert.deepEqual(strip(a), strip(b));
});
