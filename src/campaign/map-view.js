// Vista do mapa estratégico: enquadramento, conversão de coordenadas, seleção e desenho.
// Módulo puro: sem DOM nem Three.js; o desenho só usa a API mínima de um contexto Canvas 2D.
import { dateLabel, season } from './clock.js';

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
  for (const s of view.world.settlements) consider(s, { type: 'settlement', id: s.id }, r + (s.kind === 'serra' ? 4 : 8));
  for (const p of state.patrols || []) consider(p, { type: 'patrol', id: p.id }, r);
  if (state.praetor) consider(state.praetor, { type: 'praetor', id: state.praetor.id }, r + 3);
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

/** Vetílio: comandante montado, de manto vermelho e elmo de crista, com dois legionários de escolta. */
function drawPraetor(ctx, x, y) {
  const horse = '#6b4a2a', horseDark = '#3f2a16';
  ctx.save();
  ctx.lineWidth = 1.3;

  // sombra
  ctx.fillStyle = 'rgba(40,20,10,.18)';
  ctx.beginPath(); ctx.arc(x, y + 10, 10, 0, TAU); ctx.fill();

  // escolta
  for (const side of [-1, 1]) {
    const ex = x + side * 15;
    ctx.strokeStyle = ROMAN_DARK;
    ctx.fillStyle = '#a8322a';
    ctx.beginPath(); ctx.arc(ex, y + 1.5, 2.2, 0, TAU); ctx.fill(); ctx.stroke();
    path(ctx, [[ex, y + 3.4], [ex, y + 7.5],
      [ex, y + 7.5], [ex - 2, y + 10.5],
      [ex, y + 7.5], [ex + 2, y + 10.5]]);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(ex - side * 2.4, y + 5, 2.4, 0, TAU); ctx.fill(); ctx.stroke();
    path(ctx, [[ex + side * 2.2, y + 9], [ex + side * 2.2, y - 5]]);
    ctx.stroke();
  }

  // cavalo: corpo, pescoço, cabeça, orelhas, patas e cauda
  ctx.strokeStyle = horseDark; ctx.fillStyle = horse;
  path(ctx, [[x - 9, y + 7], [x - 8, y + 1], [x + 4, y], [x + 8, y + 4], [x + 7, y + 8], [x - 7, y + 8]], true);
  ctx.fill(); ctx.stroke();
  path(ctx, [[x + 5, y + 2], [x + 9, y - 4], [x + 12, y - 3], [x + 11, y + 0]], true);
  ctx.fill(); ctx.stroke();
  path(ctx, [[x + 9.6, y - 4.6], [x + 10.4, y - 6.6], [x + 11.4, y - 4.4]]);
  ctx.stroke();
  path(ctx, [[x - 6, y + 8], [x - 7, y + 12], [x + 6, y + 8], [x + 7, y + 12]]);
  ctx.stroke();
  path(ctx, [[x - 9, y + 2], [x - 12, y + 5], [x - 11, y + 8]]);
  ctx.stroke();

  // manto vermelho
  ctx.fillStyle = ROMAN; ctx.strokeStyle = ROMAN_DARK;
  path(ctx, [[x - 1, y - 3], [x - 8, y + 1], [x - 2, y + 3]], true);
  ctx.fill(); ctx.stroke();

  // tronco e cabeça com elmo de crista
  ctx.fillStyle = '#d8cbb2';
  path(ctx, [[x - 2, y - 5], [x + 2, y - 5], [x + 2, y + 1], [x - 2, y + 1]], true);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#e0b48a';
  ctx.beginPath(); ctx.arc(x, y - 8, 2.8, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.fillStyle = ROMAN;
  path(ctx, [[x - 3.4, y - 8.4], [x - 1, y - 14], [x + 1.4, y - 13.4], [x + 3.4, y - 8.2]], true);
  ctx.fill(); ctx.stroke();

  // rédeas
  ctx.strokeStyle = horseDark;
  path(ctx, [[x + 2, y - 4], [x + 9, y - 3]]);
  ctx.stroke();
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

/**
 * Desenha o mapa completo.
 * `fx` (opcional) anima o desenho sem mexer no estado: { party, facing, step, hover, trail, selected, reach }.
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

  // povoações
  for (const s of world.settlements) {
    const q = toScreen(view, s);
    const burnt = !!(state.villages && state.villages[s.id] && state.villages[s.id].burnt) || !!state.posts?.[s.id]?.taken;
    const isSel = fx.selected === s.id, isHover = !!hover && hover.id === s.id;
    if (isSel || isHover) {
      ctx.save();
      ctx.strokeStyle = isSel ? GOLD : 'rgba(240,180,50,.6)';
      ctx.lineWidth = isSel ? 2 : 1.4;
      ctx.beginPath(); ctx.arc(q.x, q.y + 2, 17, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    icon(ctx, s.kind, q.x, q.y, burnt);
    ctx.fillStyle = burnt ? '#5a4a3a' : INK;
    ctx.font = '11px serif';
    ctx.textAlign = 'center';
    ctx.fillText(s.name, q.x, q.y + 22);
    ctx.restore();
  }

  // patrulhas romanas
  for (const p of state.patrols || []) drawPatrol(ctx, p, toScreen(view, p));

  // pretor: comandante montado com escolta
  if (state.praetor) {
    const q = toScreen(view, state.praetor);
    drawPraetor(ctx, q.x, q.y);
    ctx.save();
    ctx.fillStyle = ROMAN_DARK;
    ctx.font = 'bold 11px serif';
    ctx.textAlign = 'center';
    ctx.fillText(state.praetor.name || 'Pretor', q.x, q.y - 18);
    ctx.restore();
  }

  // Viriato e o seu nome
  drawParty(ctx, pq.x, pq.y, fx.facing || 1, fx.step || 0);
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

  // data e estação
  ctx.save();
  ctx.fillStyle = INK;
  ctx.font = '11px serif';
  ctx.textAlign = 'left';
  ctx.fillText(dateLabel(state.day), 10, 18);
  ctx.fillText(season(state.day), 10, 32);
  ctx.restore();

  ctx.setLineDash([]);   // invariante: o último dash é sempre vazio
}
