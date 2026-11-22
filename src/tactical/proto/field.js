// Protótipo M1 — campo provisório «A curva do ribeiro»: estrada, bosques, outeiro e regras de colocação.
// Desenhado à mão para testar cobertura e posicionamento; o terreno gerado por semente é o T2. Puro (sem DOM nem Three.js).

/** Dimensões em metros. x cresce para este, y para sul. */
export const FIELD = { w: 160, h: 110 };

/** Eixo da estrada, de oeste para este; a coluna romana segue estes pontos. */
export const ROAD = [
  { x: -6, y: 58 }, { x: 28, y: 56 }, { x: 60, y: 49 }, { x: 92, y: 53 }, { x: 122, y: 62 }, { x: 166, y: 60 },
];

/** Bosques (círculos de árvores): escondem e protegem das fundas e dos dardos. */
export const WOODS = [
  { id: 'w1', x: 50, y: 31, r: 10 }, { id: 'w2', x: 82, y: 35, r: 11 }, { id: 'w3', x: 110, y: 42, r: 8 },
  { id: 'w4', x: 70, y: 73, r: 11 }, { id: 'w5', x: 100, y: 79, r: 9 }, { id: 'w6', x: 132, y: 83, r: 8 },
];

/** Outeiros rochosos: escondem e protegem menos do que o mato. */
export const ROCKS = [{ id: 'r1', x: 92, y: 17, r: 7 }];

/** Ribeiro decorativo a sul (não muda as regras no protótipo). */
export const STREAM = [{ x: -6, y: 100 }, { x: 40, y: 96 }, { x: 85, y: 101 }, { x: 125, y: 97 }, { x: 166, y: 102 }];

/** Afinação do campo. */
export const FIELD_TUNING = {
  woodsCover: 1, rockCover: 0.6,   // cobertura no centro (1 = máximo)
  woodsConceal: 1, rockConceal: 0.7,   // quanto esconde (usado pela deteção romana provisória)
  edge: 0.35,                      // fração do raio onde a cobertura cai de cheio para zero
  roadClear: 8,                    // não se coloca ninguém a menos de 8 m do eixo da estrada
  minX: 34, maxX: 152, margin: 5,  // zona de colocação: longe da entrada da coluna e das orlas
};

/** Distância de um ponto ao segmento ab. */
function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Distância de (x, y) ao eixo da estrada. */
export function roadDistance(x, y) {
  let d = Infinity;
  for (let i = 1; i < ROAD.length; i++) d = Math.min(d, segDist({ x, y }, ROAD[i - 1], ROAD[i]));
  return d;
}

/** Valor de uma mancha circular em (x, y): `peak` no miolo, a descer até 0 na orla. */
function patch(list, peak, x, y) {
  let v = 0;
  for (const c of list) {
    const d = Math.hypot(x - c.x, y - c.y), inner = c.r * (1 - FIELD_TUNING.edge);
    if (d <= inner) v = Math.max(v, peak);
    else if (d < c.r) v = Math.max(v, peak * (c.r - d) / (c.r - inner));
  }
  return v;
}

/** Cobertura ∈ [0, 1] em (x, y): reduz o dano das armas de arremesso (a simulação usa-a em `coverAt`). */
export const coverAt = (x, y) => Math.max(patch(WOODS, FIELD_TUNING.woodsCover, x, y), patch(ROCKS, FIELD_TUNING.rockCover, x, y));

/** Ocultação ∈ [0, 1] em (x, y): quanto um grupo parado ali é difícil de ver. */
export const concealAt = (x, y) => Math.max(patch(WOODS, FIELD_TUNING.woodsConceal, x, y), patch(ROCKS, FIELD_TUNING.rockConceal, x, y));

/** Um grupo pode ser colocado em (x, y) na preparação? */
export function canPlace(x, y) {
  const t = FIELD_TUNING;
  return x >= t.minX && x <= t.maxX && y >= t.margin && y <= FIELD.h - t.margin && roadDistance(x, y) >= t.roadClear;
}

/** O ponto mais próximo de (x, y) onde se pode colocar um grupo (procura em anéis de 1 m). */
export function nearestPlaceable(x, y) {
  const t = FIELD_TUNING;
  const cx = Math.min(t.maxX, Math.max(t.minX, x)), cy = Math.min(FIELD.h - t.margin, Math.max(t.margin, y));
  if (canPlace(cx, cy)) return { x: cx, y: cy };
  for (let r = 1; r <= 40; r++) {
    for (let k = 0; k < 24; k++) {
      const a = k / 24 * Math.PI * 2, px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
      if (canPlace(px, py)) return { x: px, y: py };
    }
  }
  return { x: cx, y: t.margin };
}

/** Pontos da estrada ainda à frente de quem está em `x` (para retomar a marcha). */
export const roadAhead = x => ROAD.filter(p => p.x > x + 1);

/** Saídas: os romanos saem pelas pontas da estrada; os lusitanos pelas orlas norte e sul. */
export const EXITS = {
  romanos: [{ x: 0, y: 58 }, { x: FIELD.w, y: 60 }],
  lusitanos: [{ x: 40, y: 0 }, { x: 120, y: 0 }, { x: 40, y: FIELD.h }, { x: 120, y: FIELD.h }],
};

/** A coluna romana: vanguarda e retaguarda de legionários, vélites no meio, em marcha pela estrada. */
export const COLUMN = [
  { id: 'vanguarda', role: 'legionario', men: 5, along: 22 },
  { id: 'velites', role: 'velite', men: 3, along: 12 },
  { id: 'retaguarda', role: 'legionario', men: 5, along: 2 },
];

/** O bando: até quatro grupos. A posição inicial é a orla norte, à vista; o jogador esconde-os. */
export const BAND = [
  { id: 'lobos', role: 'guerreiro', men: 4, x: 52, y: 9 },
  { id: 'javalis', role: 'guerreiro', men: 4, x: 72, y: 9 },
  { id: 'corvos', role: 'guerreiro', men: 3, x: 92, y: 9 },
  { id: 'fundeiros', role: 'fundeiro', men: 4, x: 112, y: 9 },
];

/** Posição na estrada a `along` metros do início do eixo. */
export function roadPoint(along) {
  let left = along;
  for (let i = 1; i < ROAD.length; i++) {
    const a = ROAD[i - 1], b = ROAD[i], len = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= len) return { x: a.x + (b.x - a.x) * left / len, y: a.y + (b.y - a.y) * left / len, facing: Math.atan2(b.y - a.y, b.x - a.x) };
    left -= len;
  }
  const b = ROAD[ROAD.length - 1];
  return { x: b.x, y: b.y, facing: 0 };
}
