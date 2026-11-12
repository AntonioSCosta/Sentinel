// Ponte mapa -> batalha 3D: o que a batalha põe em campo e o que devolve ao fluxo. Módulo puro (sem DOM nem Three.js).
import { makeRng } from './rng.js';
import { ALLY_CAP, ENEMY_CAP } from './battles.js';

/** Tipos de batalha que já têm cena 3D; os outros continuam no modal provisório. */
export const BRIDGED = ['emboscada', 'campo-aberto'];
export const isBridged = spec => !!spec && BRIDGED.includes(spec.type);

const COL_GAP = 3.2, FILE = 1.1;          // emboscada: coluna em duas filas na estrada, como a patrulha do capítulo
const RANK_W = 10, RANK_GAP = 2.2, LINE_GAP = 1.9;   // campo aberto: fileiras de até 10, frente a frente

const count = v => Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;

/**
 * Quem entra em campo e onde, em coordenadas locais da força inimiga: `along` = para a frente da marcha/da linha
 * (metros, ≤ 0 = atrás da cabeça), `side` = para o lado (metros). O jogo converte-as para o mundo.
 * @param {{type:string, seed:number, allies:number, enemies:{legio:number, velites:number, centurion:boolean}}} spec
 * @returns {{type:string, allies:number, enemies:{kind:'legio'|'velite'|'centurion', along:number, side:number}[], shift:number, gap:number}}
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
  const field = spec.type === 'campo-aberto';
  if (cent) enemies.push({ kind: 'centurion', along: field ? 2.4 : 2.6, side: 0 });
  kinds.forEach((kind, i) => {
    const j = () => rng.range(-.25, .25);
    if (field) {
      const rank = Math.floor(i / RANK_W), inRank = Math.min(RANK_W, n - rank * RANK_W), c = i % RANK_W;
      enemies.push({ kind, along: -rank * RANK_GAP + j(), side: (c - (inRank - 1) / 2) * LINE_GAP + j() });
    } else enemies.push({ kind, along: -Math.floor(i / 2) * COL_GAP + j(), side: (i % 2 ? FILE : -FILE) + j() * .6 });
  });
  return {
    type: spec.type, allies: Math.min(ALLY_CAP, count(spec.allies)), enemies,
    shift: rng.range(-6, 6),                  // a coluna (ou a linha) não começa sempre no mesmo metro
    gap: field ? rng.range(42, 48) : 0,       // campo aberto: metros entre Viriato e a frente romana
  };
}

/**
 * Resultado de uma batalha 3D para Flow.finishBattle. A morte de Viriato conta como um homem perdido;
 * abandonar a batalha é uma derrota que conta como a morte dele.
 * @returns {{won:boolean, retreated:false, alliesLost:number, enemiesKilled:number}}
 */
export function tallyResult({ alliesDead = 0, playerDead = false, enemies = 0, enemiesDead = 0, abandoned = false } = {}) {
  const fell = count(alliesDead), killed = count(enemiesDead);
  const out = playerDead || abandoned;
  return { won: !out && killed >= count(enemies), retreated: false, alliesLost: fell + (out ? 1 : 0), enemiesKilled: killed };
}
