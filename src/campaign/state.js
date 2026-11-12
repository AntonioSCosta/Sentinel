// Estado da campanha: recursos, ruína e gravação. Módulo puro (sem DOM nem Three.js).
import { generateWorld } from './worldgen.js';

/** Tabela inicial de equilíbrio (a Task 18 afina). */
export const START = { men: 14, food: 60, arms: 10, fame: 20 };
export const MEN_PER_FOOD = 5;
export const FAME_PER_RECRUIT = 15;

/** Comida gasta por dia: 1 por cada 5 homens, mínimo 1. */
export const foodPerDay = men => Math.max(1, Math.ceil(men / MEN_PER_FOOD));
/** Recrutas por visita a uma aldeia. */
export const recruitsFrom = fame => Math.floor(fame / FAME_PER_RECRUIT) + 1;

export function newCampaign(seed) {
  const world = generateWorld(seed);
  const villages = {};
  for (const s of world.settlements) if (s.kind === 'aldeia') villages[s.id] = { burnt: false, recruitedDay: -999 };
  return { v: 1, seed, day: 0, ...START, party: { x: world.start.x, y: world.start.y }, world,
    villages, praetor: null, patrols: [], done: [], over: null, cooldown: 0 };
}

/** Subtrai cada campo dado, saturando em 0. */
export function spend(state, cost) {
  for (const k of ['men', 'food', 'arms', 'fame']) if (cost[k] !== undefined) state[k] = Math.max(0, state[k] - cost[k]);
  return state;
}

/** Marca a derrota (homens ou fama a zero). Devolve true só da primeira vez. */
export function checkRuin(state) {
  if (state.over) return false;
  if (state.men <= 0 || state.fame <= 0) { state.over = 'derrota'; return true; }
  return false;
}

export const serialize = state => JSON.stringify(state);

export function deserialize(text) {
  let o;
  try { o = JSON.parse(text); } catch { return null; }
  if (!o || typeof o !== 'object' || Array.isArray(o) || o.v !== 1) return null;
  for (const k of ['day', 'men', 'food', 'arms', 'fame']) if (typeof o[k] !== 'number') return null;
  if (!o.party || typeof o.party !== 'object') return null;
  if (!o.world || typeof o.world !== 'object' || !Array.isArray(o.world.settlements)) return null;
  return o;
}
