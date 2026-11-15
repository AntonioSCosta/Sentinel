import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/campaign/rng.js';
import { generateWorld } from '../src/campaign/worldgen.js';
import {
  ensureDoctrine, patternOf, sectorOf, observe, tickDoctrine, isActive, pressure, spottedAmbush,
  escortBonus, nextSpawnGap, COUNTERS, HALF_LIFE, SECTORS, FIRST_SPAWN, HUNT_DAYS,
} from '../src/campaign/doctrine.js';

const world = generateWorld(3);
const base = () => ({ day: 20, fame: 20, men: 14, world, party: { x: world.start.x, y: world.start.y }, patrols: [], villages: {} });
const spec = (type, where = { x: world.road[2].x, y: world.road[2].y }) => ({ type, where });
const rng = (s = 1) => makeRng(s);
const days = (s, n) => { const ev = []; for (let i = 0; i < n; i++) { ev.push(...tickDoctrine(s)); s.day++; } return ev; };

test('ensureDoctrine cria o estado em campanhas antigas sem o apagar quando já existe', () => {
  const s = base();
  const d = ensureDoctrine(s);
  assert.deepEqual(Object.keys(d.mem).sort(), ['campo', 'coluna', 'defesa', 'emboscada']);
  assert.equal(d.sectors.length, SECTORS);
  d.mem.emboscada = 2;
  assert.equal(ensureDoctrine(s).mem.emboscada, 2);
});

test('patternOf: o que Roma regista de cada combate', () => {
  assert.equal(patternOf(spec('emboscada')), 'emboscada');
  assert.equal(patternOf(spec('assalto-coluna')), 'coluna');
  assert.equal(patternOf(spec('campo-aberto')), 'campo');
  assert.equal(patternOf(spec('defesa-aldeia')), 'defesa');
  assert.equal(patternOf(spec('decisiva')), null);
  assert.equal(patternOf(spec('historica')), null);
  assert.equal(patternOf(null), null);
});

test('sectorOf: troço da estrada mais próximo, de 0 a SECTORS-1, nas pontas e no meio', () => {
  const r = world.road;
  assert.equal(sectorOf(world, r[0]), 0);
  assert.equal(sectorOf(world, r[r.length - 1]), SECTORS - 1);
  const mid = sectorOf(world, r[r.length >> 1]);
  assert.ok(mid > 0 && mid < SECTORS - 1);
});

test('observe soma o padrão, o troço e a atividade, e guarda onde foi visto', () => {
  const s = base();
  observe(s, spec('emboscada'));
  observe(s, spec('emboscada'));
  const d = s.doctrine;
  assert.equal(d.mem.emboscada, 2);
  assert.equal(d.sectors[sectorOf(world, world.road[2])], 2);
  assert.ok(d.activity > 0);
  assert.deepEqual(d.lastSeen, { x: world.road[2].x, y: world.road[2].y, day: 20 });
  observe(s, spec('decisiva'));   // sem padrão: não conta para as contramedidas
  assert.equal(d.mem.emboscada, 2);
});

test('a memória decai para metade em HALF_LIFE dias', () => {
  const s = base(); observe(s, spec('assalto-coluna'));
  const m0 = s.doctrine.mem.coluna;
  days(s, HALF_LIFE);
  assert.ok(Math.abs(s.doctrine.mem.coluna - m0 / 2) < 1e-6);
});

test('batedores: ligam-se no limiar, dão um relato uma vez e desligam-se abaixo do limiar de saída', () => {
  const s = base(), C = COUNTERS.batedores;
  for (let i = 0; i < Math.ceil(C.on); i++) observe(s, spec('emboscada'));
  const ev = days(s, 1);
  assert.ok(isActive(s, 'batedores'));
  assert.deepEqual(ev.filter(e => e.id === 'batedores'), [{ type: 'doutrina', id: 'batedores', on: true }]);
  assert.equal(days(s, 1).filter(e => e.id === 'batedores').length, 0);   // não repete o relato
  // decai até abaixo de off: desliga e relata
  let off = null;
  for (let i = 0; i < 400 && !off; i++) off = days(s, 1).find(e => e.id === 'batedores' && !e.on);
  assert.ok(off);
  assert.ok(!isActive(s, 'batedores'));
  assert.ok(s.doctrine.mem.emboscada < C.off);
});

test('histerese: entre off e on uma contramedida ativa mantém-se', () => {
  const s = base(), C = COUNTERS.escolta;
  ensureDoctrine(s).mem.coluna = C.on; days(s, 1);
  assert.ok(isActive(s, 'escolta'));
  s.doctrine.mem.coluna = (C.on + C.off) / 2; days(s, 1);
  assert.ok(isActive(s, 'escolta'));
});

test('guarnição: o mesmo troço repetido, seja emboscada ou coluna', () => {
  const s = base();
  for (let i = 0; i < Math.ceil(COUNTERS.guarnicao.on); i++) observe(s, spec(i % 2 ? 'emboscada' : 'assalto-coluna'));
  days(s, 1);
  assert.ok(isActive(s, 'guarnicao'));
  assert.equal(s.doctrine.garrison, sectorOf(world, world.road[2]));
});

test('off: a memória regista mas nenhuma contramedida se liga (controlo do npm run balance)', () => {
  const s = base(); ensureDoctrine(s).off = true;
  for (let i = 0; i < 20; i++) { observe(s, spec('emboscada')); observe(s, spec('assalto-coluna')); }
  s.fame = 500;
  const ev = days(s, 3);
  assert.equal(ev.filter(e => e.type === 'doutrina').length, 0);
  for (const id of Object.keys(COUNTERS)) assert.ok(!isActive(s, id), id);
});

test('spottedAmbush: batedores descobrem a emboscada a patrulhas, não a colunas; a guarnição descobre tudo no seu troço', () => {
  const s = base(), d = ensureDoctrine(s);
  const pat = { kind: 'patrulha' }, col = { kind: 'comboio' };
  s.party = { x: world.road[2].x, y: world.road[2].y };
  assert.equal(spottedAmbush(s, pat), null);
  d.active.batedores = true;
  assert.equal(spottedAmbush(s, pat), 'batedores');
  assert.equal(spottedAmbush(s, col), null);
  d.active.batedores = false; d.active.guarnicao = true; d.garrison = sectorOf(world, s.party);
  assert.equal(spottedAmbush(s, col), 'guarnicao');
  d.garrison = (d.garrison + 2) % SECTORS;
  assert.equal(spottedAmbush(s, col), null);
});

test('pressão: sobe com a fama e com a atividade recente, e é finita', () => {
  const a = base(), b = base(); b.fame = 120;
  assert.ok(pressure(b) > pressure(a));
  observe(a, spec('emboscada'));
  assert.ok(pressure(a) > pressure(base()));
  const c = base(); c.fame = NaN;
  assert.ok(Number.isFinite(pressure(c)));
});

test('escortBonus: escolta e força somam homens às colunas e patrulhas; a pressão soma a ambas', () => {
  const s = base(), d = ensureDoctrine(s);
  s.fame = 0;
  assert.equal(escortBonus(s, 'patrulha'), 0);
  assert.equal(escortBonus(s, 'comboio'), 0);
  d.active.escolta = true; d.active.forca = true;
  assert.equal(escortBonus(s, 'comboio'), COUNTERS.escolta.men);
  assert.equal(escortBonus(s, 'patrulha'), COUNTERS.forca.men);
  s.fame = 300;
  assert.ok(escortBonus(s, 'patrulha') > COUNTERS.forca.men);
  assert.ok(escortBonus(s, 'patrulha') <= COUNTERS.forca.men + 6);
});

test('nextSpawnGap: entre limites, determinista por semente, e mais curto com mais pressão', () => {
  const calm = base(); calm.fame = 0;
  const hot = base(); hot.fame = 200;
  const gaps = (s, seed) => { const r = rng(seed); return Array.from({ length: 200 }, () => nextSpawnGap(s, r)); };
  const g0 = gaps(calm, 4), g1 = gaps(hot, 4);
  assert.deepEqual(gaps(calm, 4), g0);
  for (const g of [...g0, ...g1]) assert.ok(Number.isInteger(g) && g >= 3 && g <= 10, String(g));
  assert.ok(new Set(g0).size >= 3, 'varia');
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(mean(g1) < mean(g0) - 1);
  assert.ok(FIRST_SPAWN >= 6);
});

test('caçadores: com muita pressão saem do posto atrás do último sítio onde o bando foi visto', () => {
  const s = base(); s.fame = 400;
  observe(s, spec('emboscada', { x: 500, y: 300 }));
  const ev = days(s, 1);
  assert.ok(isActive(s, 'cacadores'));
  const h = s.patrols.find(p => p.kind === 'cacadores');
  assert.ok(h, 'saiu uma coluna de caçadores');
  assert.deepEqual({ x: h.target.x, y: h.target.y }, { x: 500, y: 300 });
  assert.ok(ev.some(e => e.type === 'cacadores'));
  assert.ok(h.men > 0 && Number.isFinite(h.men));
  days(s, 1);   // uma só coluna de cada vez
  assert.equal(s.patrols.filter(p => p.kind === 'cacadores').length, 1);
  assert.ok(HUNT_DAYS > 0);
});
