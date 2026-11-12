// Ponte mapa -> batalha 3D: o que a batalha põe em campo e o que devolve ao fluxo. Módulo puro (sem DOM nem Three.js).
import { makeRng } from './rng.js';
import { ALLY_CAP, ENEMY_CAP } from './battles.js';

/** Tipos de batalha que já têm cena 3D; os outros continuam no modal provisório. */
export const BRIDGED = ['emboscada', 'campo-aberto', 'defesa-aldeia', 'assalto-coluna'];
export const isBridged = spec => !!spec && BRIDGED.includes(spec.type);

const COL_GAP = 3.2, FILE = 1.1;          // emboscada: coluna em duas filas na estrada, como a patrulha do capítulo
const CART_GAP = 4.6;                    // assalto a coluna: metros a mais entre as filas onde vai um carro
const RANK_W = 10, RANK_GAP = 2.2, LINE_GAP = 1.9;   // campo aberto: fileiras de até 10, frente a frente

const count = v => Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;

/**
 * Quem entra em campo e onde, em coordenadas locais da força inimiga: `along` = para a frente da marcha/da linha
 * (metros, ≤ 0 = atrás da cabeça), `side` = para o lado (metros). O jogo converte-as para o mundo.
 * @param {{type:string, seed:number, allies:number, enemies:{legio:number, velites:number, centurion:boolean}}} spec
 * `carts` (só no assalto a coluna) são os carros, no eixo da estrada.
 * @returns {{type:string, allies:number, enemies:{kind:'legio'|'velite'|'centurion', along:number, side:number}[], carts:{along:number}[], shift:number, gap:number}}
 */
export function spawnPlan(spec) {
  const rng = makeRng(count(spec.seed) || 1);
  const cent = !!spec.enemies?.centurion;
  let legio = count(spec.enemies?.legio), vel = count(spec.enemies?.velites);
  const room = ENEMY_CAP - (cent ? 1 : 0);
  while (legio + vel > room) { if (legio >= vel && legio > 0) legio--; else vel--; }   // o excedente é bónus, não figuras
  const n = legio + vel, kinds = [];
  // vélites espalhados pela coluna, não todos ao fundo
  for (let i = 0; i < n; i++) kinds.push(Math.floor((i + 1) * vel / n) > Math.floor(i * vel / n) ? 'velite' : 'legio');
  const enemies = [];
  const field = spec.type === 'campo-aberto', convoy = spec.type === 'assalto-coluna';
  // coluna de abastecimento: os carros vão no meio da escolta, um a cada `per` filas
  const rows = Math.ceil(n / 2), nCarts = convoy && n ? (n >= 8 ? 3 : 2) : 0, per = Math.max(1, Math.ceil(rows / (nCarts + 1)));
  const rowAlong = r => -r * COL_GAP - (nCarts ? Math.floor(r / per) * CART_GAP : 0);
  if (cent) enemies.push({ kind: 'centurion', along: field ? 2.4 : 2.6, side: 0 });
  kinds.forEach((kind, i) => {
    const j = () => rng.range(-.25, .25);
    if (field) {
      const rank = Math.floor(i / RANK_W), inRank = Math.min(RANK_W, n - rank * RANK_W), c = i % RANK_W;
      enemies.push({ kind, along: -rank * RANK_GAP + j(), side: (c - (inRank - 1) / 2) * LINE_GAP + j() });
    } else enemies.push({ kind, along: rowAlong(Math.floor(i / 2)) + j(), side: (i % 2 ? FILE : -FILE) + j() * .6 });
  });
  const carts = [];
  for (let k = 0; k < nCarts; k++) { const r = (k + 1) * per - 1; carts.push({ along: (rowAlong(r) + rowAlong(r + 1)) / 2 }); }
  return {
    type: spec.type, allies: Math.min(ALLY_CAP, count(spec.allies)), enemies, carts,
    shift: rng.range(-6, 6),                  // a coluna (ou a linha) não começa sempre no mesmo metro
    gap: field ? rng.range(42, 48) : 0,       // campo aberto: metros entre Viriato e a frente romana
  };
}

/**
 * Resultado de uma batalha 3D para Flow.finishBattle. A morte de Viriato conta como um homem perdido;
 * abandonar a batalha é uma derrota que conta como a morte dele. No assalto a coluna, `carts` diz quantos carros
 * ficaram nas tuas mãos, e `escaped` que a coluna se foi toda com a escolta viva (sem vitória nem derrota).
 * @returns {{won:boolean, retreated:false, escaped?:true, alliesLost:number, enemiesKilled:number, cartsCaptured?:number, cartsTotal?:number}}
 */
export function tallyResult({ alliesDead = 0, playerDead = false, enemies = 0, enemiesDead = 0, abandoned = false, escaped = false, carts = null } = {}) {
  const fell = count(alliesDead), killed = count(enemiesDead);
  const out = playerDead || abandoned, fled = escaped && !out;
  const r = { won: !out && !fled && killed >= count(enemies), retreated: false };
  if (fled) r.escaped = true;
  Object.assign(r, { alliesLost: fell + (out ? 1 : 0), enemiesKilled: killed });
  if (carts) Object.assign(r, { cartsCaptured: count(carts.captured), cartsTotal: count(carts.total) });
  return r;
}
