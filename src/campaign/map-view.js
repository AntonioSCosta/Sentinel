// Vista do mapa estratégico: enquadramento, conversão de coordenadas, seleção e desenho.
// Módulo puro: sem DOM nem Three.js; o desenho só usa a API mínima de um contexto Canvas 2D.
import { intelView } from './intel.js';   // as forças romanas vêm sempre daqui (o que o jogador sabe), nunca do estado real
import { COMMUNITY_IDS } from './communities.js';
import { placeName, MAP_TITLE, MAP_SUBTITLE } from './strings.js';
import { SECTORS } from './doctrine.js';

const MARGIN = 12;
const TAU = Math.PI * 2;

const INK = '#2f2213';
const INK_DARK = '#120e0c';
const PAPER = '#e3d3a8';
const GOLD = '#f2b632';
const GOLD_DARK = '#6b4500';
const ROMAN = '#c0211a';
const ROMAN_DARK = '#3a0805';

/** Escala uniforme que cabe o mundo inteiro em width×height, centrado. */
export function makeView(world, width, height) {
  const availW = Math.max(1, width - 2 * MARGIN), availH = Math.max(1, height - 2 * MARGIN);
  const scale = Math.min(availW / world.w, availH / world.h);
  return { scale, ox: (width - world.w * scale) / 2, oy: (height - world.h * scale) / 2, width, height, world };
}

export const toScreen = (view, p) => ({ x: view.ox + p.x * view.scale, y: view.oy + p.y * view.scale });
export const toWorld = (view, s) => ({ x: (s.x - view.ox) / view.scale, y: (s.y - view.oy) / view.scale });

/** Elemento mais próximo do ponto de ecrã; null se nenhum. As povoações têm um raio maior (o boneco é largo). */
export function hitTest(view, state, sx, sy, r = 14) {
  let best = null, bestD = Infinity;
  const consider = (p, hit, rad) => {
    const q = toScreen(view, p), d = Math.hypot(q.x - sx, q.y - sy);
    if (d <= rad && d < bestD) { bestD = d; best = hit; }
  };
  const valley = valleyIds(state);
  for (const s of view.world.settlements) consider(s, { type: 'settlement', id: s.id }, r + (valley.has(s.id) ? 16 : s.kind === 'serra' ? 4 : 8));
  for (const f of intelView(state).forces) consider(f, { type: f.kind === 'pretor' ? 'praetor' : 'patrol', id: f.id }, f.kind === 'pretor' ? r + 3 : r);
  return best;
}

/** Caminho poligonal: um moveTo e os lineTo seguintes. */
function path(ctx, pts, close = false) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  if (close) ctx.closePath();
}

// --- figuras ---
// Todas usam a mesma geometria com ou sem queimar/tomar: só mudam as cores.
// A versão destruída acrescenta UMA risca (um lineTo + um stroke a mais),
// invariante de que os testes dependem.

function drawVillage(ctx, x, y, burnt) {
  const wall = burnt ? '#3a332c' : '#8a6a3e';
  const roof = burnt ? '#241d18' : '#8c3f24';
  const ink = burnt ? INK_DARK : INK;
  const smoke = burnt ? 'rgba(52,46,40,.5)' : 'rgba(246,242,232,.8)';
  const skin = burnt ? '#2a241f' : '#c9a06a';

  ctx.lineWidth = 1.2;
  ctx.strokeStyle = ink;

  // casa principal: corpo, telhado de empena, porta e janela
  ctx.fillStyle = wall;
  path(ctx, [[x - 7, y + 8], [x - 7, y + 1], [x + 3, y + 1], [x + 3, y + 8]], true);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = roof;
  path(ctx, [[x - 9, y + 1], [x - 2, y - 6], [x + 5, y + 1]], true);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = ink;
  ctx.fillRect(x - 4.6, y + 4, 2.6, 4);
  ctx.fillRect(x + 0.2, y + 3, 1.8, 1.8);

  // casa pequena ao lado
  ctx.fillStyle = wall;
  path(ctx, [[x + 4, y + 8], [x + 4, y + 4], [x + 11, y + 4], [x + 11, y + 8]], true);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = roof;
  path(ctx, [[x + 3, y + 4], [x + 7.5, y + 0.5], [x + 12, y + 4]], true);
  ctx.fill(); ctx.stroke();

  // chaminé e fumo
  ctx.strokeStyle = ink;
  path(ctx, [[x + 1.2, y - 4.6], [x + 1.2, y - 8]]);
  ctx.stroke();
  ctx.strokeStyle = smoke;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath(); ctx.arc(x + 1.2 + i * 1.7, y - 10 - i * 2.4, 1.3 + i * 0.5, 0, TAU); ctx.stroke();
  }

  // aldeão à porta
  ctx.strokeStyle = ink;
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(x + 13.5, y + 3.2, 1.6, 0, TAU); ctx.fill(); ctx.stroke();
  path(ctx, [[x + 13.5, y + 4.8], [x + 13.5, y + 7.4], [x + 12.2, y + 9.2],
    [x + 13.5, y + 7.4], [x + 14.8, y + 9.2], [x + 13.5, y + 5.6],
    [x + 12, y + 6.6], [x + 13.5, y + 5.6], [x + 15, y + 6.6]]);
  ctx.stroke();
}

function drawCastro(ctx, x, y, burnt) {
  const mound = burnt ? '#3a332c' : '#9c7b4a';
  const stone = burnt ? '#4a463f' : '#8f887a';
  const roof = burnt ? '#241d18' : '#7a4a24';
  const ink = burnt ? INK_DARK : INK;

  ctx.lineWidth = 1.2;
  ctx.strokeStyle = ink;

  // montículo amuralhado
  ctx.fillStyle = mound;
  path(ctx, [[x - 11, y + 8], [x - 7, y + 1], [x + 7, y + 1], [x + 11, y + 8]], true);
  ctx.fill(); ctx.stroke();

  // paliçada de estacas
  ctx.lineWidth = 1.1;
  for (let i = 0; i < 6; i++) {
    const bx = x - 8 + i * 3.2;
    path(ctx, [[bx, y + 1], [bx, y - 3.4]]);
    ctx.stroke();
  }
  path(ctx, [[x - 8.2, y - 2.4], [x + 8.2, y - 2.4]]);
  ctx.stroke();

  // casa redonda do castro
  ctx.lineWidth = 1.2;
  ctx.fillStyle = roof;
  ctx.beginPath(); ctx.arc(x, y + 4.2, 3.6, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = stone;
  path(ctx, [[x - 3.6, y + 4.2], [x + 3.6, y + 4.2], [x + 3.6, y + 8], [x - 3.6, y + 8]], true);
  ctx.fill(); ctx.stroke();

  // bandeira do castro
  ctx.strokeStyle = ink;
  path(ctx, [[x + 8.4, y + 1], [x + 8.4, y - 8]]);
  ctx.stroke();
  ctx.fillStyle = burnt ? '#4a423a' : '#3f6b3a';
  path(ctx, [[x + 8.4, y - 8], [x + 13, y - 6.6], [x + 8.4, y - 5]], true);
  ctx.fill(); ctx.stroke();
}

function drawSerra(ctx, x, y, burnt) {
  const rock = burnt ? '#4a463f' : '#9a9384';
  const snow = burnt ? '#6b665c' : '#f2eee4';
  const ink = burnt ? INK_DARK : INK;

  ctx.lineWidth = 1.2;
  ctx.strokeStyle = ink;

  // cordilheira: dois picos e um contraforte
  ctx.fillStyle = rock;
  path(ctx, [[x - 14, y + 8], [x - 6, y - 4], [x - 2, y + 1], [x + 3, y - 7], [x + 9, y + 2], [x + 14, y + 8]], true);
  ctx.fill(); ctx.stroke();

  // neves eternas
  ctx.fillStyle = snow;
  path(ctx, [[x - 6, y - 4], [x - 4.4, y - 0.8], [x - 7.6, y - 0.8]], true); ctx.fill(); ctx.stroke();
  path(ctx, [[x + 3, y - 7], [x + 4.6, y - 3.6], [x + 1.4, y - 3.6]], true); ctx.fill(); ctx.stroke();

  // aresta
  ctx.strokeStyle = ink;
  path(ctx, [[x - 2, y + 1], [x - 0.5, y + 4.5], [x + 1, y + 2.5]]);
  ctx.stroke();
}

function drawPosto(ctx, x, y, burnt) {
  const tent = burnt ? '#3a332c' : '#c8b48c';
  const banner = burnt ? '#5a1510' : '#a3302a';
  const ink = burnt ? INK_DARK : INK;

  ctx.lineWidth = 1.2;
  ctx.strokeStyle = ink;

  // recinto de madeira
  ctx.fillStyle = burnt ? '#2b2420' : '#8a6a3e';
  path(ctx, [[x - 9, y + 8], [x - 9, y + 2], [x + 9, y + 2], [x + 9, y + 8]], true);
  ctx.fill(); ctx.stroke();

  // tenda e abertura
  ctx.fillStyle = tent;
  path(ctx, [[x - 6, y + 7], [x, y - 1], [x + 6, y + 7]], true);
  ctx.fill(); ctx.stroke();
  path(ctx, [[x - 2, y + 7], [x, y + 3], [x + 2, y + 7]]);
  ctx.stroke();

  // vexilo com flâmula
  ctx.strokeStyle = ink;
  path(ctx, [[x, y - 1], [x, y - 12]]);
  ctx.stroke();
  ctx.fillStyle = banner;
  path(ctx, [[x, y - 12], [x + 7.5, y - 10.4], [x, y - 7.6]], true);
  ctx.fill(); ctx.stroke();

  // escudos da guarnição
  ctx.fillStyle = burnt ? '#4a3f38' : '#b3261e';
  ctx.beginPath(); ctx.arc(x - 7.4, y + 5, 1.9, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(x + 7.4, y + 5, 1.9, 0, TAU); ctx.fill(); ctx.stroke();
}

function icon(ctx, kind, x, y, burnt) {
  if (kind === 'castro') drawCastro(ctx, x, y, burnt);
  else if (kind === 'serra') drawSerra(ctx, x, y, burnt);
  else if (kind === 'posto') drawPosto(ctx, x, y, burnt);
  else drawVillage(ctx, x, y, burnt);

  if (burnt) {
    // destruída: uma só risca a tinta escura (ver invariante acima)
    ctx.strokeStyle = INK_DARK;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 10, y + 8); ctx.lineTo(x + 10, y - 8); ctx.stroke();
  }
}

// --- o vale (PR 5): as cinco comunidades, as suas bandeiras e o que Roma lhes fez ---
// Cada comunidade tem a figura do seu ofício (IDENTITY.office) por cima do símbolo do tipo de lugar: a forma diz quem é,
// a bandeira diz a postura (forma E cor), a marca à esquerda diz a situação romana. Só caminhos, arcos e texto: o
// contexto falso dos testes não tem translate nem curvas.

/** Tamanho das figuras das comunidades em relação às outras povoações. */
export const COMMUNITY_SCALE = 1.35;
/**
 * Desenha `fn(x, y)` à escala `k` à volta de (x, y). Num canvas a sério usa translate/scale; num contexto sem eles (os
 * testes) desenha à escala 1, com as mesmas chamadas de caminho.
 */
function scaled(ctx, x, y, k, fn) {
  if (typeof ctx.translate !== 'function' || typeof ctx.scale !== 'function') { fn(x, y); return; }
  ctx.save(); ctx.translate(x, y); ctx.scale(k, k); fn(0, 0); ctx.restore();
}

/** Hachuras de monte à volta de uma serra, à maneira dos mapas antigos. */
function drawHachures(ctx, x, y) {
  ctx.save();
  ctx.strokeStyle = 'rgba(90,70,40,.32)'; ctx.lineWidth = 1;
  for (let k = 0; k < 14; k++) {
    const a = Math.PI * (1.05 + k / 13 * 0.9) , r0 = 17, r1 = 23 + (k % 2) * 3;
    path(ctx, [[x + Math.cos(a) * r0, y + 4 - Math.sin(a) * r0 * 0.55], [x + Math.cos(a) * r1, y + 4 - Math.sin(a) * r1 * 0.55]]); ctx.stroke();
  }
  ctx.restore();
}

/** Rosa-dos-ventos pequena, num canto. */
function drawCompass(ctx, x, y) {
  ctx.save();
  ctx.strokeStyle = 'rgba(47,34,19,.6)'; ctx.fillStyle = 'rgba(47,34,19,.55)'; ctx.lineWidth = 1;
  path(ctx, [[x, y - 16], [x + 3.5, y - 3.5], [x, y], [x - 3.5, y - 3.5]], true); ctx.fill(); ctx.stroke();
  path(ctx, [[x, y + 16], [x + 3.5, y + 3.5], [x, y], [x - 3.5, y + 3.5]], true); ctx.stroke();
  path(ctx, [[x - 16, y], [x - 3.5, y - 3.5], [x, y], [x - 3.5, y + 3.5]], true); ctx.stroke();
  path(ctx, [[x + 16, y], [x + 3.5, y - 3.5], [x, y], [x + 3.5, y + 3.5]], true); ctx.stroke();
  ctx.font = 'bold 10px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('N', x, y - 19);
  ctx.restore();
}

/** Lugares (ids do mundo) das comunidades do vale. */
export const valleyIds = state => new Set(COMMUNITY_IDS.map(id => state.communities?.[id]?.settlement).filter(Boolean));
const communityAtPlace = (state, sid) => COMMUNITY_IDS.map(id => state.communities?.[id]).find(c => c && c.settlement === sid) ?? null;

/** Bandeira de postura num mastro à direita da figura. Formas diferentes para não depender só da cor. */
export const POSTURE_FLAG = {
  comprometida: { color: '#d9a62a', shape: 'rabo' },      // flâmula de duas pontas, dourada
  amiga: { color: '#4f7a3a', shape: 'flamula' },          // flâmula triangular, verde
  neutra: { color: '#b6ab92', shape: 'quadrado' },        // pano quadrado, pardo
  receosa: { color: '#7d8796', shape: 'meia-haste' },     // flâmula a meia haste, cinzenta
  colabora: { color: ROMAN, shape: 'romano' },            // pano romano com franja, vermelho
};
function drawFlag(ctx, x, y, posture) {
  const f = POSTURE_FLAG[posture];
  if (!f) return;
  const px = x + 15, top = y - 17;
  ctx.save();
  ctx.lineWidth = 1.4; ctx.strokeStyle = INK;
  path(ctx, [[px, y + 7], [px, top]]); ctx.stroke();
  ctx.fillStyle = f.color; ctx.lineWidth = 1;
  if (f.shape === 'rabo') path(ctx, [[px, top], [px + 11, top + 1], [px + 7, top + 4], [px + 11, top + 7], [px, top + 8]], true);
  else if (f.shape === 'flamula') path(ctx, [[px, top], [px + 11, top + 4], [px, top + 8]], true);
  else if (f.shape === 'quadrado') path(ctx, [[px, top], [px + 9, top], [px + 9, top + 7], [px, top + 7]], true);
  else if (f.shape === 'meia-haste') path(ctx, [[px, top + 8], [px + 8, top + 12], [px, top + 15]], true);
  else path(ctx, [[px, top + 1], [px + 9, top + 1], [px + 9, top + 9], [px, top + 9]], true);
  ctx.fill(); ctx.stroke();
  if (f.shape === 'romano') { ctx.strokeStyle = GOLD; path(ctx, [[px, top + 8], [px + 9, top + 8]]); ctx.stroke(); }
  ctx.restore();
}

/** Marca da situação romana, num disco de pergaminho à esquerda e por baixo da figura. */
function drawSituation(ctx, x, y, situation) {
  if (!situation || situation === 'livre') return;
  const cx = x - 16, cy = y + 9;
  ctx.save();
  ctx.lineWidth = 1.2;
  ctx.fillStyle = '#f1e6c4'; ctx.strokeStyle = ROMAN_DARK;
  ctx.beginPath(); ctx.arc(cx, cy, 6.6, 0, TAU); ctx.fill(); ctx.stroke();
  if (situation === 'tributada') {   // denário: moeda com o rebordo
    ctx.fillStyle = GOLD; ctx.strokeStyle = GOLD_DARK;
    ctx.beginPath(); ctx.arc(cx, cy, 4, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 2, 0, TAU); ctx.stroke();
  } else if (situation === 'castigada') {   // varas cruzadas
    ctx.strokeStyle = ROMAN; ctx.lineWidth = 1.8;
    path(ctx, [[cx - 3.6, cy - 3.6], [cx + 3.6, cy + 3.6]]); ctx.stroke();
    path(ctx, [[cx + 3.6, cy - 3.6], [cx - 3.6, cy + 3.6]]); ctx.stroke();
  } else if (situation === 'ocupada') {   // estandarte romano
    ctx.strokeStyle = ROMAN_DARK; path(ctx, [[cx, cy + 4.5], [cx, cy - 4.5]]); ctx.stroke();
    ctx.fillStyle = ROMAN; path(ctx, [[cx - 3, cy - 4], [cx + 3, cy - 4], [cx + 3, cy + 0.5], [cx - 3, cy + 0.5]], true); ctx.fill(); ctx.stroke();
  } else if (situation === 'queimada') {   // chama
    ctx.fillStyle = '#d0601e'; ctx.strokeStyle = '#5a1e08';
    path(ctx, [[cx, cy - 5], [cx + 3.4, cy + 1], [cx + 1.6, cy + 4], [cx - 1.6, cy + 4], [cx - 3.4, cy + 1]], true); ctx.fill(); ctx.stroke();
    ctx.fillStyle = GOLD; path(ctx, [[cx, cy - 1], [cx + 1.4, cy + 2.6], [cx - 1.4, cy + 2.6]], true); ctx.fill();
  } else {   // abandonada: círculo vazio cortado
    ctx.strokeStyle = INK; ctx.beginPath(); ctx.arc(cx, cy, 3.6, 0, TAU); ctx.stroke();
    path(ctx, [[cx - 4, cy + 4], [cx + 4, cy - 4]]); ctx.stroke();
  }
  ctx.restore();
}

/** Assunto pendente: «!» num balão por cima da figura (cheio = decisão; contorno = acontecimento a ver). */
function drawIssueMark(ctx, x, y, kind) {
  const cy = y - 22;
  ctx.save();
  ctx.lineWidth = 1.4;
  ctx.fillStyle = kind === 'decisao' ? ROMAN : '#f1e6c4'; ctx.strokeStyle = ROMAN_DARK;
  path(ctx, [[x - 6, cy - 6], [x + 6, cy - 6], [x + 6, cy + 4], [x + 2, cy + 4], [x, cy + 7.5], [x - 2, cy + 4], [x - 6, cy + 4]], true);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = kind === 'decisao' ? '#fff3d6' : ROMAN_DARK;
  ctx.font = 'bold 10px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('!', x, cy - 0.6);
  ctx.restore();
}

/** O ofício de cada comunidade, por cima da figura do lugar (aldeia ou castro). */
function drawOffice(ctx, id, x, y, dead) {
  ctx.save();
  ctx.lineWidth = 1.1; ctx.strokeStyle = dead ? INK_DARK : INK;
  if (id === 'ribeira') {   // lavradores: leiras e um molho de trigo
    ctx.strokeStyle = dead ? '#4a3f30' : '#8b6b2e';
    for (let i = 0; i < 4; i++) { path(ctx, [[x - 22 + i * 3, y + 11], [x - 15 + i * 3, y + 3]]); ctx.stroke(); }
    ctx.strokeStyle = dead ? INK_DARK : '#a87e22';
    path(ctx, [[x - 10, y + 10], [x - 12, y + 3]]); ctx.stroke(); path(ctx, [[x - 10, y + 10], [x - 10, y + 2]]); ctx.stroke(); path(ctx, [[x - 10, y + 10], [x - 8, y + 3]]); ctx.stroke();
  } else if (id === 'penedo') {   // castro em altura: monte e segunda muralha
    ctx.fillStyle = dead ? '#3a332c' : '#b39668';
    path(ctx, [[x - 19, y + 12], [x - 9, y - 1], [x + 9, y - 1], [x + 19, y + 12]], true); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = dead ? INK_DARK : '#5b4a33';
    path(ctx, [[x - 15, y + 7], [x + 15, y + 7]]); ctx.stroke();
  } else if (id === 'souto') {   // serra: dois castanheiros
    for (const [ox, r] of [[-15, 4.6], [-10, 3.6]]) {
      ctx.strokeStyle = dead ? INK_DARK : '#4a2f18'; path(ctx, [[x + ox, y + 9], [x + ox, y + 2]]); ctx.stroke();
      ctx.fillStyle = dead ? '#3a332c' : '#4c6b2c'; ctx.strokeStyle = dead ? INK_DARK : '#25381a';
      ctx.beginPath(); ctx.arc(x + ox, y - 1, r, 0, TAU); ctx.fill(); ctx.stroke();
    }
  } else if (id === 'vau') {   // vau: água corrente por baixo e um barco
    ctx.strokeStyle = dead ? '#4a463f' : '#3f6d8c'; ctx.lineWidth = 1.3;
    for (const oy of [12, 15]) { path(ctx, [[x - 18, y + oy], [x - 12, y + oy - 2], [x - 6, y + oy], [x, y + oy - 2], [x + 6, y + oy], [x + 12, y + oy - 2]]); ctx.stroke(); }
    ctx.fillStyle = dead ? '#3a332c' : '#7a5530'; ctx.strokeStyle = INK; ctx.lineWidth = 1;
    path(ctx, [[x - 21, y + 6], [x - 11, y + 6], [x - 13, y + 9], [x - 19, y + 9]], true); ctx.fill(); ctx.stroke();
  } else if (id === 'fonte') {   // ferreiros: bigorna e faúlha
    ctx.fillStyle = dead ? '#3a332c' : '#4a4640';
    path(ctx, [[x - 21, y + 4], [x - 9, y + 4], [x - 11, y + 7], [x - 13, y + 7], [x - 13, y + 10], [x - 17, y + 10], [x - 17, y + 7], [x - 21, y + 6]], true); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = dead ? INK_DARK : '#e07a1e'; path(ctx, [[x - 15, y + 2], [x - 17, y - 2]]); ctx.stroke(); path(ctx, [[x - 13, y + 2], [x - 12, y - 3]]); ctx.stroke();
  }
  ctx.restore();
}

/** O vale: a mancha de terra das cinco comunidades (o casco delas, alargado), por baixo de tudo. */
function drawValley(ctx, view, state) {
  const pts = [...valleyIds(state)].map(id => view.world.settlements.find(s => s.id === id)).filter(Boolean).map(s => toScreen(view, s));
  if (pts.length < 2) return;
  const hull = convexHull(pts), r = Math.max(18, 60 * view.scale);
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = '#c6b584'; ctx.lineWidth = 2 * r + 3;   // borda
  path(ctx, hull.map(q => [q.x, q.y]), true); ctx.stroke();
  ctx.strokeStyle = '#dcd6a6'; ctx.fillStyle = '#dcd6a6'; ctx.lineWidth = 2 * r;   // chão do vale
  path(ctx, hull.map(q => [q.x, q.y]), true); ctx.stroke(); ctx.fill();
  ctx.restore();
}
function convexHull(pts) {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (up.length >= 2 && cross(up.at(-2), up.at(-1), q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/** Troço da estrada guarnecido por Roma (doctrine.garrison), anunciado ao jogador por um relato. */
function drawGarrison(ctx, view, state) {
  const g = state.doctrine?.active?.guarnicao ? state.doctrine.garrison : null, road = view.world.road;
  if (g === null || g === undefined || !road || road.length < 2) return;
  const seg = road.map((p, i) => ({ p, s: Math.min(SECTORS - 1, Math.floor(i * SECTORS / road.length)) })).filter(o => o.s === g).map(o => toScreen(view, o.p));
  if (seg.length < 2) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(160,33,26,.55)'; ctx.lineWidth = 7; ctx.lineCap = 'round';
  path(ctx, seg.map(q => [q.x, q.y])); ctx.stroke();
  ctx.restore();
}

function drawPatrol(ctx, p, q) {
  const x = q.x, y = q.y;
  ctx.save();
  ctx.lineWidth = 1.2;

  if (p.kind === 'comboio') {
    // comboio: carroça com toldo e duas rodas
    ctx.fillStyle = '#a3302a'; ctx.strokeStyle = ROMAN_DARK;
    path(ctx, [[x - 6, y + 1], [x + 6, y + 1], [x + 6, y + 4], [x - 6, y + 4]], true);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#d8cbb2';
    path(ctx, [[x - 5, y + 1], [x - 4, y - 4], [x + 4, y - 4], [x + 5, y + 1]], true);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = ROMAN_DARK;
    ctx.beginPath(); ctx.arc(x - 3.6, y + 5, 2.2, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(x + 3.6, y + 5, 2.2, 0, TAU); ctx.fill(); ctx.stroke();
    // condutor
    ctx.fillStyle = '#a8322a';
    ctx.beginPath(); ctx.arc(x + 6.8, y - 2, 1.7, 0, TAU); ctx.fill(); ctx.stroke();
    path(ctx, [[x + 6.8, y - 0.4], [x + 6.8, y + 2]]);
    ctx.stroke();
  } else {
    // ronda: dois soldados em marcha, com escudo e lança
    for (const [ox, oy] of [[-4, 1], [3, 0]]) {
      ctx.fillStyle = '#a8322a'; ctx.strokeStyle = ROMAN_DARK;
      ctx.beginPath(); ctx.arc(x + ox, y - 4 + oy, 2.1, 0, TAU); ctx.fill(); ctx.stroke();
      path(ctx, [[x + ox, y - 2 + oy], [x + ox, y + 3 + oy],
        [x + ox, y + 3 + oy], [x + ox - 2, y + 7 + oy],
        [x + ox, y + 3 + oy], [x + ox + 2, y + 7 + oy]]);
      ctx.stroke();
      ctx.fillStyle = '#8a1d16';
      ctx.beginPath(); ctx.arc(x + ox - 2.2, y + 0.4 + oy, 2, 0, TAU); ctx.fill(); ctx.stroke();
      path(ctx, [[x + ox + 2.6, y + 6 + oy], [x + ox + 2.6, y - 7 + oy]]);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * O pretor no mapa: um vexilo romano, não um boneco. Um estandarte lê-se à distância,
 * não envelhece mal e diz «Roma» sem precisar de figuras pequenas.
 */
function drawPraetor(ctx, x, y) {
  const wood = '#4a2f18';
  ctx.save();
  ctx.lineWidth = 1.2;

  // sombra do mastro no chão
  ctx.fillStyle = 'rgba(40,20,10,.16)';
  ctx.beginPath(); ctx.arc(x, y + 9, 5.5, 0, TAU); ctx.fill();

  // mastro
  ctx.strokeStyle = wood;
  ctx.lineWidth = 2;
  path(ctx, [[x, y + 8], [x, y - 13]]);
  ctx.stroke();

  // ponta de lança dourada
  ctx.fillStyle = GOLD; ctx.strokeStyle = GOLD_DARK; ctx.lineWidth = 1;
  path(ctx, [[x, y - 19], [x + 2.2, y - 13.4], [x - 2.2, y - 13.4]], true);
  ctx.fill(); ctx.stroke();

  // travessão do vexilo, com pontas de bronze
  ctx.strokeStyle = wood; ctx.lineWidth = 1.6;
  path(ctx, [[x - 7, y - 12], [x + 7, y - 12]]);
  ctx.stroke();
  ctx.fillStyle = GOLD;
  ctx.beginPath(); ctx.arc(x - 7, y - 12, 1.2, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 7, y - 12, 1.2, 0, TAU); ctx.fill();

  // pano do estandarte
  ctx.fillStyle = ROMAN; ctx.strokeStyle = ROMAN_DARK; ctx.lineWidth = 1;
  path(ctx, [[x - 6.5, y - 11.6], [x + 6.5, y - 11.6], [x + 6.5, y - 0.8], [x - 6.5, y - 0.8]], true);
  ctx.fill(); ctx.stroke();

  // franja dourada na bainha
  ctx.strokeStyle = GOLD; ctx.lineWidth = 1.1;
  path(ctx, [[x - 6.5, y - 1.9], [x + 6.5, y - 1.9]]);
  ctx.stroke();

  // SPQR: a marca de Roma, legível a esta escala
  ctx.fillStyle = GOLD;
  ctx.font = 'bold 5.5px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SPQR', x, y - 6.4);

  ctx.restore();
}

/** Viriato: guerreiro lusitano de manto, lança e escudo redondo; as pernas baloiçam com `step`. */
function drawParty(ctx, x, y, facing = 1, step = 0) {
  const swing = Math.sin(step) * 2.4 * facing;
  const bob = Math.abs(Math.cos(step)) * 0.7;

  ctx.save();
  ctx.lineWidth = 1.3;

  // sombra
  ctx.fillStyle = 'rgba(40,30,20,.16)';
  ctx.beginPath(); ctx.arc(x, y + 10, 7.5, 0, TAU); ctx.fill();

  // lança atrás do corpo
  ctx.strokeStyle = GOLD_DARK;
  path(ctx, [[x + 6 * facing, y + 6], [x + 9 * facing, y - 14]]);
  ctx.stroke();
  ctx.fillStyle = '#c9c2b2';
  path(ctx, [[x + 9 * facing, y - 14], [x + 7.6 * facing, y - 10.6], [x + 10.4 * facing, y - 10.6]], true);
  ctx.fill();

  // pernas
  ctx.strokeStyle = INK; ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(x, y + 3 + bob); ctx.lineTo(x - 2 + swing, y + 9);
  ctx.moveTo(x, y + 3 + bob); ctx.lineTo(x + 2 + swing, y + 9);
  ctx.stroke();

  // manto
  ctx.fillStyle = '#7a4a1e';
  path(ctx, [[x - 3 * facing, y - 2 + bob], [x - 9 * facing, y + 6], [x - 1 * facing, y + 4]], true);
  ctx.fill();

  // tronco e braço
  ctx.strokeStyle = INK;
  ctx.fillStyle = GOLD;
  path(ctx, [[x - 2.6, y - 2 + bob], [x + 2.6, y - 2 + bob], [x + 2.2, y + 4], [x - 2.2, y + 4]], true);
  ctx.fill(); ctx.stroke();
  path(ctx, [[x + 1.6 * facing, y - 1 + bob], [x + 5 * facing, y + 2]]);
  ctx.stroke();

  // cabeça e cabelo
  ctx.fillStyle = '#e0b48a';
  ctx.beginPath(); ctx.arc(x, y - 5 + bob, 2.7, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.fillStyle = GOLD_DARK;
  ctx.beginPath(); ctx.arc(x, y - 6.2 + bob, 2.7, Math.PI, TAU); ctx.fill();

  // escudo redondo
  ctx.fillStyle = '#b8862a';
  ctx.beginPath(); ctx.arc(x - 3.6 * facing, y + 1.4 + bob, 3.4, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.fillStyle = GOLD;
  ctx.beginPath(); ctx.arc(x - 3.6 * facing, y + 1.4 + bob, 1.1, 0, TAU); ctx.fill();

  ctx.restore();
}

// --- etiquetas ---
// As etiquetas são colocadas depois de se conhecerem os ícones e as placas: cada nome procura o
// primeiro sítio livre à volta da sua povoação. Assim nenhum nome tapa outro, um ícone ou uma placa.
const LABEL_H = 11;
const LABEL_FONT = '11px serif';
const LABEL_GAP = 2;

// Larguras relativas de uma serifa (em). Só se usam quando o contexto não sabe medir texto
// (contexto falso dos testes, ou um canvas sem measureText); arredondadas por excesso.
const CHAR_EM = {
  ' ': .25, a: .44, b: .5, c: .44, d: .5, e: .44, f: .33, g: .5, h: .5, i: .28, j: .28, k: .5, l: .28,
  m: .78, n: .5, o: .5, p: .5, q: .5, r: .33, s: .39, t: .28, u: .5, v: .5, w: .72, x: .5, y: .5, z: .44,
  A: .72, B: .67, C: .67, D: .72, E: .61, F: .56, G: .72, H: .72, I: .33, J: .39, K: .72, L: .61,
  M: .89, N: .72, O: .72, P: .56, Q: .72, R: .67, S: .56, T: .61, U: .72, V: .72, W: .94, X: .72, Y: .72, Z: .61,
  'ã': .5, 'á': .44, 'é': .44, 'í': .28, 'ó': .5, 'ú': .5, 'ç': .44, 'â': .44, 'ê': .44, 'ô': .5, 'à': .44,
};
const fallbackWidth = (text, size = LABEL_H) => [...text].reduce((sum, ch) => sum + (CHAR_EM[ch] ?? .5) * size, 0);

/** Largura de uma etiqueta: a medida real do contexto quando existe; senão, a tabela conservadora. */
export function labelWidth(ctx, text) {
  if (ctx && typeof ctx.measureText === 'function') {
    const m = ctx.measureText(text);
    if (m && Number.isFinite(m.width) && m.width > 0) return m.width;
  }
  return fallbackWidth(text);
}

const overlaps = (a, b, gap = LABEL_GAP) =>
  a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;

/** Candidatos de posição: abaixo e acima do ícone, depois anéis de 24 a 130 px em volta. */
function labelCandidates(w) {
  const out = [[0, 24], [0, -14], [0, 36], [0, -26]];
  for (const r of [24, 34, 46, 60, 76, 92, 110, 130])
    for (let k = 0; k < 16; k++) {
      const a = k / 16 * TAU;
      out.push([Math.sin(a) * (r + w / 2), -Math.cos(a) * r]);
    }
  return out;
}

/** «há 1 dia», «há 3 dias». */
export const agoLabel = age => `há ${age} ${age === 1 ? 'dia' : 'dias'}`;
const plateWidth = text => Math.max(42, text.length * 5.9 + 10);
/** Placa do pretor: o nome, e a idade do avistamento quando já não está à vista. */
const praetorPlate = f => (f.status === 'confirmada' ? f.name || 'Pretor' : `${f.name || 'Pretor'} · ${agoLabel(f.age)}`);

/** Círculo tracejado a tinta romana: a zona onde uma força pode estar. */
function dashedZone(ctx, x, y, r, fill = false, weak = false) {
  ctx.save();
  ctx.strokeStyle = weak ? 'rgba(160,33,26,.45)' : 'rgba(160,33,26,.6)';
  ctx.lineWidth = 1.2;
  ctx.setLineDash(weak ? [2, 7] : [5, 4]);   // pouco fiável (rumor): pontilhado largo
  ctx.beginPath(); ctx.arc(x, y, Math.max(8, r), 0, TAU);
  if (fill) { ctx.fillStyle = 'rgba(160,33,26,.07)'; ctx.fill(); }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * Notas das zonas e das figuras sem se encavalitarem: cada nota tenta o sítio pedido e, se já houver outra
 * lá, desce uma linha (até duas vezes); se não couber, fica por escrever (o texto completo está na lista).
 */
function noteLayer() {
  const boxes = [];
  const box = (text, x, y) => ({ x: x - text.length * 2.5, y: y - 10, w: text.length * 5, h: 12 });
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  return (ctx, text, x, y) => {
    for (const dy of [0, 12, 24]) {
      const b = box(text, x, y + dy);
      if (boxes.some(o => hit(o, b))) continue;
      boxes.push(b); note(ctx, text, x, y + dy); return true;
    }
    return false;
  };
}

/** Nota pequena a tinta, por baixo de uma figura ou de uma zona. */
function note(ctx, text, x, y) {
  ctx.save();
  ctx.fillStyle = ROMAN_DARK;
  ctx.font = 'italic 10px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
  ctx.restore();
}

const ZONE_NAMES = { patrulha: 'patrulha', comboio: 'comboio', cacadores: 'caçadores', pretor: 'pretor', livre: 'zona livre', forcas: 'reconhecida' };

/** Caixas que uma etiqueta não pode cobrir: ícones, unidades, placas e a data. */
function labelObstacles(view, state) {
  const obs = [];
  const valley = valleyIds(state);
  for (const s of view.world.settlements) {
    const q = toScreen(view, s);
    if (valley.has(s.id)) obs.push({ x: q.x - 32, y: q.y - 38, w: 68, h: 60 });   // figura, ofício, bandeira, marca e «!» (à escala COMMUNITY_SCALE)
    else obs.push({ x: q.x - 14, y: q.y - 12, w: 28, h: 22 });
  }
  const intel = intelView(state), place = noteLayer();
  for (const z of intel.zones) { const q = toScreen(view, z); obs.push({ x: q.x - 46, y: q.y - (z.place ? 34 : 16), w: 92, h: z.place ? 52 : 34 }); }   // «?» e a nota do relato
  for (const f of intel.forces) {
    const q = toScreen(view, f);
    if (f.kind !== 'pretor') { obs.push({ x: q.x - 11, y: q.y - 8, w: 22, h: 16 }); continue; }
    const w = plateWidth(praetorPlate(f));
    obs.push({ x: q.x - 7, y: q.y - 19, w: 14, h: 28 });          // vexilo
    obs.push({ x: q.x - w / 2, y: q.y - 33, w, h: 14 });          // placa do nome
  }
  // A posição lógica (não a animada) mantém as etiquetas quietas durante a marcha.
  const pq = toScreen(view, state.party);
  obs.push({ x: pq.x - 9, y: pq.y - 16, w: 18, h: 26 });           // Viriato
  obs.push({ x: pq.x - 26, y: pq.y - 32, w: 52, h: 14 });          // placa «Viriato»
  obs.push({ x: 6, y: 4, w: 150, h: 34 });                         // cartela do mapa
  if (view.width > 260 && view.height > 200) obs.push({ x: view.width - 52, y: view.height - 66, w: 44, h: 52 });   // rosa-dos-ventos
  return obs;
}

/**
 * Dispõe as etiquetas das povoações à volta dos respectivos ícones, sem sobreposições nem saídas
 * do canvas. Devolve `{ items, placed }`; `placed` traz a posição final de cada nome.
 * `measure` (opcional) mede o texto; sem ela usa-se a tabela conservadora.
 */
export function layoutMapLabels(view, state, measure = null) {
  const bounds = { w: view.width, h: view.height };
  const valley = valleyIds(state);
  const items = view.world.settlements.map(s => {
    const q = toScreen(view, s), name = placeName(state, s.id) ?? s.name, inValley = valley.has(s.id);
    const measured = measure ? measure(name) : fallbackWidth(name);
    // as comunidades escrevem-se a negrito: reserva-se 10% a mais do que a medida do texto normal
    return { id: s.id, name, valley: inValley, ax: q.x, ay: q.y,
      w: Math.ceil((Number.isFinite(measured) && measured > 0 ? measured : fallbackWidth(name)) * (inValley ? 1.1 : 1)), h: LABEL_H,
      burnt: !!(state.villages && state.villages[s.id] && state.villages[s.id].burnt) || !!state.posts?.[s.id]?.taken };
  });
  const rects = labelObstacles(view, state);
  // As mais restringidas primeiro: muitos vizinhos e perto das bordas têm menos alternativas.
  const score = it => {
    let n = 0;
    for (const o of items) if (o !== it && Math.hypot(o.ax - it.ax, o.ay - it.ay) < 120) n++;
    const edge = Math.min(it.ax, bounds.w - it.ax, it.ay, bounds.h - it.ay);
    return n * 10 + Math.max(0, 60 - edge);
  };
  const order = [...items].sort((a, b) => score(b) - score(a) || String(a.id).localeCompare(String(b.id)));
  const placed = [];
  for (const it of order) {
    const { w, h } = it;
    let found = null;
    for (const [dx, dy] of labelCandidates(w)) {
      const x = it.ax + dx, baseline = it.ay + dy;
      const r = { x: x - w / 2, y: baseline - h, w, h };
      if (r.x < 2 || r.x + w > bounds.w - 2 || r.y < 2 || r.y + h > bounds.h - 2) continue;
      if (rects.some(q => overlaps(r, q))) continue;
      const dist = Math.hypot(dx, dy);
      found = { ...it, x, baseline, dist, moved: dist > 24 };
      rects.push(r); break;
    }
    if (!found) {
      // Os anéis não chegaram (ecrãs muito estreitos ou muito altos): procura em grelha o sítio
      // livre mais próximo do ícone. Só se não houver nenhum é que se aceita uma sobreposição.
      let best = null;
      for (let baseline = h + 2; baseline <= bounds.h - 2; baseline += LABEL_H + LABEL_GAP + 1)
        for (let x = 2 + w / 2; x <= bounds.w - 2 - w / 2; x += 20) {
          const r = { x: x - w / 2, y: baseline - h, w, h };
          if (rects.some(q => overlaps(r, q))) continue;
          const dist = Math.hypot(x - it.ax, baseline - h / 2 - it.ay);
          if (!best || dist < best.dist) best = { x, baseline, dist };
        }
      if (best) found = { ...it, ...best, moved: true, grid: true };
    }
    if (!found) {   // último recurso: fica dentro do canvas, ainda que perto de outra coisa
      const x = Math.min(bounds.w - 2 - w / 2, Math.max(2 + w / 2, it.ax));
      const baseline = Math.min(bounds.h - 2, Math.max(h + 2, it.ay + 24));
      found = { ...it, x, baseline, dist: Math.hypot(x - it.ax, baseline - it.ay), moved: true, fallback: true };
      rects.push({ x: x - w / 2, y: baseline - h, w, h });
    } else if (found.grid) {
      rects.push({ x: found.x - w / 2, y: found.baseline - h, w, h });
    }
    placed.push(found);
  }
  return { items, placed };
}

/**
 * Desenha o mapa completo.
 * `fx` (opcional) anima o desenho sem mexer no estado: { party, facing, step, hover, trail, selected, reach, focus, recon,
 * issues: { <lugar>: 'decisao' | 'atencao' }, flash: { <lugar>: 0..1 } (destaque que se apaga), route: { to, label } }.
 */
export function drawMap(ctx, view, state, fx = {}) {
  const { world } = view;
  const party = fx.party || state.party;
  const hover = fx.hover || null;
  const trail = fx.trail || [];

  // fundo de pergaminho
  ctx.save();
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, view.width, view.height);
  ctx.restore();

  drawValley(ctx, view, state);

  // estrada romana: leito largo e eixo tracejado
  if (world.road && world.road.length > 1) {
    const road = world.road.map(p => toScreen(view, p));
    ctx.save();
    ctx.strokeStyle = '#cdb887';
    ctx.lineWidth = 5;
    ctx.beginPath();
    road.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.stroke();
    ctx.strokeStyle = '#8b6b3e';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    road.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
  drawGarrison(ctx, view, state);

  // rasto das últimas marchas
  if (trail.length > 1) {
    ctx.save();
    ctx.strokeStyle = '#7a5a34';
    ctx.lineWidth = 1.4;
    ctx.globalAlpha = 0.45;
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    trail.forEach((p, i) => {
      const q = toScreen(view, p);
      if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y);
    });
    const head = toScreen(view, party);
    ctx.lineTo(head.x, head.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  const pq = toScreen(view, party);

  // alcance de um dia de marcha
  if (fx.reach) {
    ctx.save();
    ctx.strokeStyle = 'rgba(90,70,40,.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath(); ctx.arc(pq.x, pq.y, Math.max(6, fx.reach * view.scale), 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // rota prevista: do bando ao destino, com os dias e a comida
  if (fx.route?.to && Number.isFinite(fx.route.to.x) && Number.isFinite(fx.route.to.y)) {
    const rq = toScreen(view, fx.route.to);
    ctx.save();
    ctx.strokeStyle = GOLD_DARK; ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.beginPath(); ctx.moveTo(pq.x, pq.y); ctx.lineTo(rq.x, rq.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(rq.x, rq.y, 6, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(rq.x, rq.y, 2, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  // etiquetas: dispõem-se antes do desenho para fugirem aos ícones, às unidades e às placas
  ctx.save();
  ctx.font = LABEL_FONT;
  const { placed: labels } = layoutMapLabels(view, state, text => labelWidth(ctx, text));
  ctx.restore();

  // povoações: as de fora do vale esbatidas, as cinco comunidades com figura, bandeira e marcas
  const valley = valleyIds(state);
  for (const s of world.settlements) {
    const q = toScreen(view, s), c = valley.has(s.id) ? communityAtPlace(state, s.id) : null;
    const burnt = !!(state.villages && state.villages[s.id] && state.villages[s.id].burnt) || !!state.posts?.[s.id]?.taken;
    const isSel = fx.selected === s.id, isHover = !!hover && hover.id === s.id;
    if (isSel || isHover) {
      ctx.save();
      ctx.strokeStyle = isSel ? GOLD : 'rgba(240,180,50,.6)';
      ctx.lineWidth = isSel ? 2.4 : 1.4;
      ctx.beginPath(); ctx.arc(q.x, q.y + 2, c ? 34 : 17, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    if (c && c.situation === 'ocupada') {   // a guarnição cerca a aldeia
      ctx.save(); ctx.strokeStyle = 'rgba(160,33,26,.75)'; ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(q.x, q.y + 2, 30, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
    }
    ctx.save();
    const faded = !c && (s.kind === 'aldeia' || s.kind === 'castro');
    if (faded) ctx.globalAlpha = 0.5;   // fora do vale: existe, mas não compete com as cinco
    const dead = !!c && (c.situation === 'queimada' || c.situation === 'abandonada');
    if (s.kind === 'serra') drawHachures(ctx, q.x, q.y);
    if (c) scaled(ctx, q.x, q.y, COMMUNITY_SCALE, (x, y) => { drawOffice(ctx, c.id, x, y, burnt || dead); icon(ctx, s.kind, x, y, burnt); });
    else icon(ctx, s.kind, q.x, q.y, burnt);
    ctx.globalAlpha = 1;
    ctx.restore();
    if (!c) continue;
    const issue = fx.issues?.[s.id];
    scaled(ctx, q.x, q.y, COMMUNITY_SCALE, (x, y) => {
      if (!dead) drawFlag(ctx, x, y, c.posture);
      drawSituation(ctx, x, y, c.situation);
      if (issue) drawIssueMark(ctx, x, y, issue);
    });
    const fl = fx.flash?.[s.id];
    if (Number.isFinite(fl) && fl > 0) {   // destaque breve de uma mudança (postura, castigo)
      ctx.save(); ctx.strokeStyle = GOLD; ctx.globalAlpha = Math.min(1, fl); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(q.x, q.y + 2, 34 + (1 - fl) * 16, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; ctx.restore();
    }
  }

  // o que o jogador sabe dos romanos (intel.js): relatos como zonas, avistamentos como figuras
  const intel = intelView(state), place = noteLayer();
  for (const z of intel.zones) {
    const q = toScreen(view, z);
    if (z.src === 'batedores') {   // zona reconhecida hoje
      ctx.save(); ctx.strokeStyle = 'rgba(90,70,40,.55)'; ctx.lineWidth = 1.2; ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.arc(q.x, q.y, z.r * view.scale, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
      if (z.kind === 'livre') place(ctx, 'zona livre', q.x, q.y + 4);
      continue;
    }
    dashedZone(ctx, q.x, q.y, z.r * view.scale, true, z.rel === 'fraca');
    ctx.save();
    ctx.fillStyle = 'rgba(160,33,26,.8)';
    ctx.font = `bold ${z.rel === 'fraca' ? 20 : 15}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('?', q.x, q.y - (z.place ? 24 : 4));   // por cima do ícone, quando a zona é uma povoação
    ctx.restore();
    place(ctx, `${ZONE_NAMES[z.kind] || 'romanos'} · ${z.age ? agoLabel(z.age) : 'hoje'}`, q.x, q.y + 14);
  }
  for (const f of intel.forces) {
    const q = toScreen(view, f), old = f.status !== 'confirmada';
    if (old) dashedZone(ctx, q.x, q.y, f.r * view.scale);
    ctx.save();
    if (old) ctx.globalAlpha = 0.4;   // última posição conhecida: figura esbatida
    if (f.kind === 'pretor') drawPraetor(ctx, q.x, q.y); else drawPatrol(ctx, f, q);
    ctx.globalAlpha = 1;
    ctx.restore();
    if (old && f.kind !== 'pretor') place(ctx, agoLabel(f.age), q.x, q.y + 18);
  }
  // destaque do relato escolhido na lista
  if (fx.focus && Number.isFinite(fx.focus.x) && Number.isFinite(fx.focus.y)) {
    const q = toScreen(view, fx.focus);
    ctx.save(); ctx.strokeStyle = GOLD; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(16, (fx.focus.r || 0) * view.scale + 4), 0, TAU); ctx.stroke(); ctx.restore();
  }
  // reconhecimento a preparar: até onde os batedores vão e o que veriam
  if (fx.recon) {
    ctx.save(); ctx.strokeStyle = 'rgba(90,70,40,.5)'; ctx.lineWidth = 1; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.arc(pq.x, pq.y, fx.recon.range * view.scale, 0, TAU); ctx.stroke();
    if (hover && Number.isFinite(hover.x) && fx.recon.ok) { const hq = toScreen(view, hover); ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.arc(hq.x, hq.y, fx.recon.radius * view.scale, 0, TAU); ctx.stroke(); }
    ctx.setLineDash([]); ctx.restore();
  }

  // Viriato
  drawParty(ctx, pq.x, pq.y, fx.facing || 1, fx.step || 0);

  // etiquetas das povoações (com linha-guia quando o nome teve de se afastar do ícone)
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(47,34,19,.45)';
  for (const l of labels) {
    if (!l.moved) continue;
    const cx = l.x, cy = l.baseline - l.h / 2;
    const dx = cx - l.ax, dy = cy - l.ay, d = Math.hypot(dx, dy) || 1;
    const sx = l.ax + dx / d * 9, sy = l.ay + dy / d * 9;
    const bx = Math.min(Math.max(l.ax, l.x - l.w / 2), l.x + l.w / 2);
    const by = Math.min(Math.max(l.ay, l.baseline - l.h), l.baseline);
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(bx, by); ctx.stroke();
  }
  for (const l of labels) {
    ctx.fillStyle = l.burnt ? '#5a4a3a' : l.valley ? INK_DARK : '#6e5f48';
    ctx.font = l.valley ? `bold ${LABEL_FONT}` : `italic ${LABEL_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(l.name, l.x, l.baseline);
  }
  ctx.restore();

  // placas por cima de tudo: o nome do comandante e o de Viriato lêem-se sempre
  for (const f of intel.forces) {
    if (f.kind !== 'pretor') continue;
    const q = toScreen(view, f);
    const name = praetorPlate(f);
    const w = plateWidth(name);
    ctx.save();
    ctx.fillStyle = 'rgba(227,211,168,.86)';
    ctx.fillRect(q.x - w / 2, q.y - 33, w, 14);
    ctx.fillStyle = ROMAN_DARK;
    ctx.font = 'bold 11px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(name, q.x, q.y - 22);
    ctx.restore();
  }

  ctx.save();
  ctx.fillStyle = 'rgba(227,211,168,.86)';
  ctx.fillRect(pq.x - 26, pq.y - 32, 52, 14);
  ctx.fillStyle = GOLD_DARK;
  ctx.font = 'bold 11px serif';
  ctx.textAlign = 'center';
  ctx.fillText('Viriato', pq.x, pq.y - 21);
  ctx.restore();

  // pré-visualização da marcha: linha tracejada, alvo e legenda
  if (hover && Number.isFinite(hover.x) && Number.isFinite(hover.y)) {
    const hq = toScreen(view, hover);
    ctx.save();
    ctx.strokeStyle = '#6a4a1e';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(pq.x, pq.y); ctx.lineTo(hq.x, hq.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(hq.x, hq.y, 4.5, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#6a4a1e';
    ctx.beginPath(); ctx.arc(hq.x, hq.y, 1.4, 0, TAU); ctx.fill();
    if (hover.label) {
      const w = Math.max(42, hover.label.length * 5.9 + 10);
      const ly = Math.max(14, hq.y - 12);
      ctx.fillStyle = 'rgba(20,15,10,.82)';
      ctx.fillRect(hq.x - w / 2, ly - 11, w, 15);
      ctx.fillStyle = '#f4e7c6';
      ctx.font = '11px serif';
      ctx.textAlign = 'center';
      ctx.fillText(hover.label, hq.x, ly);
    }
    ctx.restore();
  }

  // legenda da rota prevista
  if (fx.route?.to && fx.route.label && Number.isFinite(fx.route.to.x)) {
    const rq = toScreen(view, fx.route.to), w = Math.max(42, fx.route.label.length * 5.9 + 10), ly = Math.min(view.height - 4, rq.y + 22);
    ctx.save();
    ctx.fillStyle = 'rgba(227,211,168,.92)'; ctx.fillRect(rq.x - w / 2, ly - 11, w, 15);
    ctx.fillStyle = GOLD_DARK; ctx.font = 'bold 11px serif'; ctx.textAlign = 'center';
    ctx.fillText(fx.route.label, rq.x, ly);
    ctx.restore();
  }

  if (view.width > 260 && view.height > 200) drawCompass(ctx, view.width - 30, view.height - 34);

  // cartela: o nome da terra e o ano (a data do dia está na barra de cima)
  ctx.save();
  ctx.fillStyle = INK;
  ctx.font = 'italic 13px serif';
  ctx.textAlign = 'left';
  ctx.fillText(MAP_TITLE, 12, 20);
  ctx.font = '11px serif';
  ctx.fillStyle = '#6e5f48';
  ctx.fillText(MAP_SUBTITLE, 12, 34);
  ctx.restore();

  ctx.setLineDash([]);   // invariante: o último dash é sempre vazio
}
