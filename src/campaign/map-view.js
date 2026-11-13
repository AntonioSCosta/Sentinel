// Vista do mapa estratégico: enquadramento, conversão de coordenadas, seleção e desenho.
// Módulo puro: sem DOM nem Three.js; o desenho só usa a API mínima de um contexto Canvas 2D.
import { dateLabel, season } from './clock.js';

const MARGIN = 12;

/** Escala uniforme que cabe o mundo inteiro em width×height, centrado. */
export function makeView(world, width, height) {
  const availW = Math.max(1, width - 2 * MARGIN), availH = Math.max(1, height - 2 * MARGIN);
  const scale = Math.min(availW / world.w, availH / world.h);
  return { scale, ox: (width - world.w * scale) / 2, oy: (height - world.h * scale) / 2, width, height, world };
}

export const toScreen = (view, p) => ({ x: view.ox + p.x * view.scale, y: view.oy + p.y * view.scale });
export const toWorld = (view, s) => ({ x: (s.x - view.ox) / view.scale, y: (s.y - view.oy) / view.scale });

/** Elemento mais próximo (a menos de r px) do ponto de ecrã; null se nenhum. */
export function hitTest(view, state, sx, sy, r = 14) {
  let best = null, bestD = r;
  const consider = (p, hit) => {
    const q = toScreen(view, p), d = Math.hypot(q.x - sx, q.y - sy);
    if (d <= bestD) { bestD = d; best = hit; }
  };
  for (const s of view.world.settlements) consider(s, { type: 'settlement', id: s.id });
  for (const p of state.patrols || []) consider(p, { type: 'patrol', id: p.id });
  if (state.praetor) consider(state.praetor, { type: 'praetor', id: state.praetor.id });
  return best;
}

// Pequena figura desenhada a tinta para cada tipo de marcador. Centrada em (x,y),
// ~15 px de altura. A versão queimada/tomada muda só as cores e acrescenta UMA
// risca (um lineTo + um stroke a mais) — invariante de que os testes dependem.
function icon(ctx, kind, x, y, burnt) {
  const ink = burnt ? '#120e0c' : '#3b2a14';
  const fill = burnt ? '#2b2420' : (kind === 'serra' ? '#8a8478' : '#7a5a34');
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = ink;
  ctx.fillStyle = fill;

  if (kind === 'castro') {
    // castro: montículo amuralhado com ameias
    ctx.beginPath();
    ctx.moveTo(x - 10, y + 7); ctx.lineTo(x - 7, y - 1); ctx.lineTo(x + 7, y - 1); ctx.lineTo(x + 10, y + 7); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 7, y - 1); ctx.lineTo(x - 7, y - 4); ctx.lineTo(x - 3, y - 4); ctx.lineTo(x - 3, y - 1);
    ctx.lineTo(x + 1, y - 1); ctx.lineTo(x + 1, y - 4); ctx.lineTo(x + 5, y - 4); ctx.lineTo(x + 5, y - 1);
    ctx.stroke();
  } else if (kind === 'serra') {
    // serra: silhueta de dois picos com aresta
    ctx.beginPath();
    ctx.moveTo(x - 12, y + 7); ctx.lineTo(x - 4, y - 8); ctx.lineTo(x + 1, y - 1); ctx.lineTo(x + 6, y - 9); ctx.lineTo(x + 13, y + 7); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 6, y - 9); ctx.lineTo(x + 2, y + 2); ctx.stroke();
  } else if (kind === 'posto') {
    // posto romano: tenda com flâmula vermelha num mastro
    ctx.beginPath();
    ctx.moveTo(x - 8, y + 7); ctx.lineTo(x, y - 3); ctx.lineTo(x + 8, y + 7); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 2, y + 7); ctx.lineTo(x, y + 1); ctx.lineTo(x + 2, y + 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y - 3); ctx.lineTo(x, y - 11); ctx.stroke();
    ctx.fillStyle = burnt ? '#5a1510' : '#a3302a';
    ctx.beginPath(); ctx.moveTo(x, y - 11); ctx.lineTo(x + 7, y - 9); ctx.lineTo(x, y - 6); ctx.closePath();
    ctx.fill(); ctx.stroke();
  } else {
    // aldeia: casinha (corpo + telhado de empena + porta)
    ctx.beginPath();
    ctx.moveTo(x - 6, y + 7); ctx.lineTo(x - 6, y); ctx.lineTo(x + 6, y); ctx.lineTo(x + 6, y + 7); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 8, y); ctx.lineTo(x, y - 8); ctx.lineTo(x + 8, y); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = ink;
    ctx.fillRect(x - 1.5, y + 2, 3, 5);
  }

  if (burnt) {
    // destruída: risca a tinta escura (uma só — ver invariante acima)
    ctx.strokeStyle = '#120e0c';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 10, y + 8); ctx.lineTo(x + 10, y - 8); ctx.stroke();
  }
}

/** Desenha o mapa completo. */
export function drawMap(ctx, view, state) {
  const { world } = view;
  ctx.save();
  ctx.fillStyle = '#e3d3a8';
  ctx.fillRect(0, 0, view.width, view.height);
  ctx.restore();

  // estrada
  if (world.road && world.road.length > 1) {
    ctx.save();
    ctx.strokeStyle = '#8b6b3e';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    world.road.forEach((p, i) => {
      const q = toScreen(view, p);
      if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // povoações
  for (const s of world.settlements) {
    const q = toScreen(view, s);
    const burnt = !!(state.villages && state.villages[s.id] && state.villages[s.id].burnt) || !!state.posts?.[s.id]?.taken;   // posto tomado: riscado
    ctx.save();
    icon(ctx, s.kind, q.x, q.y, burnt);
    ctx.fillStyle = burnt ? '#4a3f38' : '#3b2a14';
    ctx.font = '11px serif';
    ctx.textAlign = 'center';
    ctx.fillText(s.name, q.x, q.y + 20);
    ctx.restore();
  }

  // patrulhas
  for (const p of state.patrols || []) {
    const q = toScreen(view, p);
    ctx.save();
    ctx.fillStyle = '#b3261e';
    ctx.strokeStyle = '#4a0f0b';
    ctx.lineWidth = 1;
    if (p.kind === 'comboio') {
      // comboio: carroça com duas rodas
      ctx.beginPath();
      ctx.moveTo(q.x - 5, q.y - 1); ctx.lineTo(q.x + 5, q.y - 1); ctx.lineTo(q.x + 5, q.y + 2); ctx.lineTo(q.x - 5, q.y + 2); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(q.x - 3, q.y + 4, 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(q.x + 3, q.y + 4, 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else {
      // ronda: soldado em marcha com lança
      ctx.beginPath(); ctx.arc(q.x, q.y - 4, 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(q.x, q.y - 2); ctx.lineTo(q.x, q.y + 3);
      ctx.moveTo(q.x, q.y + 3); ctx.lineTo(q.x - 3, q.y + 7);
      ctx.moveTo(q.x, q.y + 3); ctx.lineTo(q.x + 3, q.y + 7);
      ctx.moveTo(q.x - 3, q.y); ctx.lineTo(q.x + 2, q.y);
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(q.x + 4, q.y - 7); ctx.lineTo(q.x + 4, q.y + 6); ctx.stroke();
    }
    ctx.restore();
  }

  // pretor: figura romana com elmo de crista (o maior marcador inimigo)
  if (state.praetor) {
    const q = toScreen(view, state.praetor);
    ctx.save();
    ctx.fillStyle = '#c0211a';
    ctx.strokeStyle = '#3a0805';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(q.x - 6, q.y + 9); ctx.lineTo(q.x - 4, q.y + 1); ctx.lineTo(q.x + 4, q.y + 1); ctx.lineTo(q.x + 6, q.y + 9); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(q.x, q.y - 2, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(q.x - 5, q.y - 5); ctx.lineTo(q.x, q.y - 11); ctx.lineTo(q.x + 5, q.y - 5); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#7a1510';
    ctx.font = '11px serif';
    ctx.textAlign = 'center';
    ctx.fillText(state.praetor.name || 'Pretor', q.x, q.y - 15);
    ctx.restore();
  }

  // grupo do jogador: guerreiro lusitano (lança, escudo redondo), ouro
  {
    const q = toScreen(view, state.party);
    ctx.save();
    ctx.fillStyle = '#ffc928';
    ctx.strokeStyle = '#4a3200';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(q.x - 5, q.y + 9); ctx.lineTo(q.x + 6, q.y - 10); ctx.stroke();
    ctx.beginPath(); ctx.arc(q.x, q.y - 6, 2.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(q.x, q.y - 3); ctx.lineTo(q.x, q.y + 3);
    ctx.moveTo(q.x, q.y + 3); ctx.lineTo(q.x - 3, q.y + 8);
    ctx.moveTo(q.x, q.y + 3); ctx.lineTo(q.x + 3, q.y + 8);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(q.x - 3, q.y + 1, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#4a3200';
    ctx.font = '11px serif';
    ctx.textAlign = 'center';
    ctx.fillText('Viriato', q.x, q.y - 13);
    ctx.restore();
  }

  // data e estação
  ctx.save();
  ctx.fillStyle = '#3b2a14';
  ctx.font = '11px serif';
  ctx.textAlign = 'left';
  ctx.fillText(dateLabel(state.day), 10, 18);
  ctx.fillText(season(state.day), 10, 32);
  ctx.restore();
}
