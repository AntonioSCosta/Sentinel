// Geração do mundo da campanha a partir de uma semente. Módulo puro (sem DOM nem Three.js).
// Os nomes são descritivos e genéricos, inventados: NÃO são topónimos históricos.
import { makeRng } from './rng.js';

export const MIN_GAP = 45;
const W = 1000, H = 700, INSET = 40;
const COUNTS = { aldeia: 12, castro: 3, serra: 5 };

const NOMES = {
  aldeia: ['do Vale', 'da Ribeira', 'do Souto', 'da Fonte', 'do Carvalhal', 'do Lameiro', 'da Azinheira', 'do Outeiro',
    'da Várzea', 'do Pinhal', 'da Lagoa', 'do Moinho', 'da Barroca', 'do Salgueiral'],
  castro: ['do Penedo', 'da Cabeça', 'do Alto', 'da Pedra Alta', 'do Cerro'],
  serra: ['da Neve', 'do Vento', 'da Águia', 'do Lobo', 'da Névoa', 'do Pico'],
  posto: ['da Estrada Velha', 'da Passagem', 'do Marco'],
};
const PREFIXO = { aldeia: 'Aldeia', castro: 'Castro', serra: 'Serra', posto: 'Posto' };

function makeRoad(rng) {
  const road = [{ x: 0, y: rng.range(250, 450) }];
  let y = road[0].y;
  for (let x = 50; x < W; x += 50) {
    y = Math.max(130, Math.min(H - 130, y + rng.range(-70, 70)));
    road.push({ x: x + rng.range(-12, 12), y });
  }
  road.push({ x: W, y: Math.max(130, Math.min(H - 130, y + rng.range(-70, 70))) });
  return road;
}

function roadY(road, x) {
  for (let i = 1; i < road.length; i++) {
    if (x <= road[i].x) {
      const a = road[i - 1], b = road[i];
      return a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
    }
  }
  return road[road.length - 1].y;
}

function shuffled(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = rng.int(0, i); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function attempt(rng) {
  const road = makeRoad(rng);
  const pts = [];
  const free = (x, y) => pts.every(p => Math.hypot(p.x - x, p.y - y) >= MIN_GAP);
  // Postos sobre a estrada, perto das pontas mas dentro da margem.
  for (const x of [rng.range(INSET, INSET + 40), rng.range(W - INSET - 40, W - INSET)]) {
    pts.push({ kind: 'posto', x, y: roadY(road, x) });
  }
  const resto = { ...COUNTS };
  // Cadeia de aldeias junto à estrada (elos < 160) para garantir que o mundo se liga de ponta a ponta.
  const ELOS = 6, x0 = pts[0].x, x1 = pts[1].x;
  for (let i = 1; i < ELOS; i++) {
    const x = x0 + ((x1 - x0) * i) / ELOS + rng.range(-12, 12);
    const y = Math.max(INSET, Math.min(H - INSET, roadY(road, x) + rng.range(-35, 35)));
    if (!free(x, y)) return null;
    pts.push({ kind: 'aldeia', x, y });
    resto.aldeia--;
  }
  const plano = [];
  for (const k of Object.keys(resto)) for (let i = 0; i < resto[k]; i++) plano.push(k);
  for (const kind of shuffled(rng, plano)) {
    let ok = false;
    // Cada nova povoação nasce a menos de 150 de outra já existente.
    for (let t = 0; t < 200 && !ok; t++) {
      const x = rng.range(INSET, W - INSET), y = rng.range(INSET, H - INSET);
      if (free(x, y) && pts.some(p => Math.hypot(p.x - x, p.y - y) <= 150)) { pts.push({ kind, x, y }); ok = true; }
    }
    if (!ok) return null;
  }
  const postos = pts.filter(p => p.kind === 'posto');
  const candidatas = pts.filter(p => p.kind === 'serra' && postos.every(q => Math.hypot(p.x - q.x, p.y - q.y) >= 150));
  if (!candidatas.length) return null;
  const start = rng.pick(candidatas);
  const nomes = {};
  for (const k of Object.keys(NOMES)) nomes[k] = shuffled(rng, NOMES[k]);
  const n = {};
  const settlements = pts.map((p, i) => {
    n[p.kind] = (n[p.kind] || 0) + 1;
    return { id: `${p.kind}-${n[p.kind]}`, kind: p.kind, x: p.x, y: p.y, name: `${PREFIXO[p.kind]} ${nomes[p.kind].pop()}` };
  });
  return { w: W, h: H, settlements, road, start: { x: start.x, y: start.y } };
}

/** @param {number} seed */
export function generateWorld(seed) {
  const rng = makeRng(seed);
  for (let i = 0; i < 1000; i++) {
    const w = attempt(rng);
    if (w && isConnected(w)) return w;
  }
  throw new Error(`worldgen: sem mundo válido para a semente ${seed}`);
}

export function isConnected(world, maxLink = 160) {
  const s = world.settlements;
  if (!s.length) return true;
  const seen = new Set([0]);
  const stack = [0];
  while (stack.length) {
    const a = s[stack.pop()];
    for (let j = 0; j < s.length; j++) {
      if (!seen.has(j) && Math.hypot(a.x - s[j].x, a.y - s[j].y) <= maxLink) { seen.add(j); stack.push(j); }
    }
  }
  return seen.size === s.length;
}
