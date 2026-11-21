// Regras de combate da batalha tática: geometria dos grupos e multiplicadores de dano. Funções puras.
import { ROLES, TUNING } from './data.js';

/** Distância entre dois pontos {x, y}. */
export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

/** Direção de a para b, em radianos (0 = +x, π/2 = +y). */
export const bearing = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);

/** Ângulo reduzido a ]-π, π]. */
export function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Raio ocupado por um grupo com `men` homens. */
export const radius = men => TUNING.spacing * Math.sqrt(Math.max(1, men)) / 2;

/** Distância entre centros a que dois grupos estão em corpo a corpo. */
export const contactDistance = (a, b) => radius(a.men) + radius(b.men) + TUNING.reach;

/** Estão em corpo a corpo? */
export const inContact = (a, b) => dist(a, b) <= contactDistance(a, b);

/** O grupo está desordenado (surpreendido ou em debandada)? */
export const disordered = g => g.disorderT > 0 || g.state === 'debandada';

/**
 * De que lado `from` atinge `target`: 'frente', 'flanco' ou 'costas', pela frente do alvo (`target.facing`).
 */
export function sideOf(target, from) {
  const off = Math.abs(wrap(bearing(target, from) - target.facing));
  if (off <= TUNING.frontArc) return 'frente';
  return off >= TUNING.rearArc ? 'costas' : 'flanco';
}

/** Multiplicador de dano recebido por `target`, atingido a partir de `from` (corpo a corpo ou à distância). */
export function takenMult(target, from, ranged) {
  const role = ROLES[target.role], side = sideOf(target, from);
  let m = side === 'flanco' ? TUNING.flankMult : side === 'costas' ? TUNING.rearMult : 1;
  if (target.state === 'debandada') m *= TUNING.routed.taken;
  else if (target.disorderT > 0) m *= TUNING.disorder.taken;
  else if (side === 'frente') m *= ranged ? role.missileFront : role.shieldFront;   // só em ordem e pela frente
  return m;
}

/** Multiplicador de dano causado por `g` corpo a corpo (carga e desordem). */
export function dealtMult(g) {
  let m = g.chargeT > 0 ? TUNING.charge.mult : 1;
  if (disordered(g)) m *= TUNING.disorder.dealt;
  return m;
}

/** Fração de mortos que quebra o grupo, conforme o lado e a ordem em que está. */
export const routThreshold = g => TUNING.rout[g.side][g.disorderT > 0 ? 'disordered' : 'formed'];

/** Dano corpo a corpo de `g` em `target` num passo de `dt` segundos, antes da variação aleatória. */
export const meleeDamage = (g, target, dt) => g.men * ROLES[g.role].melee * dt * dealtMult(g) * takenMult(target, g, false);

/** Dano de uma salva de `g` em `target`, com `cover` ∈ [0, 1] no sítio do alvo, antes da variação aleatória. */
export function volleyDamage(g, target, cover = 0) {
  const r = ROLES[g.role].ranged;
  const c = Math.min(1, Math.max(0, cover));
  return g.men * r.damage * takenMult(target, g, true) * (1 - c * TUNING.coverMissile);
}
