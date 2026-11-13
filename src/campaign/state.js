// Estado da campanha: recursos, ruína e gravação. Módulo puro (sem DOM nem Three.js).
import { generateWorld } from './worldgen.js';

/** Tabela de equilíbrio, afinada na Task 18 com `npm run balance` (ver a spec, secção 9). */
export const START = { men: 14, food: 60, arms: 15, fame: 20 };
export const MEN_PER_FOOD = 12;
export const FAME_PER_RECRUIT = 15;

/** Comida gasta por dia: 1 por cada MEN_PER_FOOD homens (arredondado para cima), mínimo 1. */
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

const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const num = x => typeof x === 'number' && Number.isFinite(x);

export function deserialize(text) {
  let o;
  try { o = JSON.parse(text); } catch { return null; }
  if (!isObj(o) || o.v !== 1) return null;
  if (!num(o.day)) return null;
  for (const k of ['men', 'food', 'arms', 'fame']) if (!num(o[k]) || o[k] < 0) return null;
  if (!isObj(o.party) || !num(o.party.x) || !num(o.party.y)) return null;
  if (!isObj(o.villages) || !Array.isArray(o.patrols) || !Array.isArray(o.done)) return null;
  if (o.over !== null && o.over !== 'vitoria' && o.over !== 'derrota') return null;
  for (const k of ['kills', 'battles']) if (k in o && (!num(o[k]) || o[k] < 0)) return null;   // contas do fim do ano (opcionais)
  if (o.praetor != null && (!isObj(o.praetor) || ('rest' in o.praetor && !(num(o.praetor.rest) && o.praetor.rest >= 0 && o.praetor.rest <= 365)))) return null;   // descanso do pretor
  if (o.praetor != null && 'men' in o.praetor && !(num(o.praetor.men) && o.praetor.men >= 0)) return null;
  if ('posts' in o && !(isObj(o.posts) && Object.values(o.posts).every(p => isObj(p) && typeof p.taken === 'boolean'))) return null;   // postos atacados
  if ('seen' in o && !(Array.isArray(o.seen) && o.seen.every(x => typeof x === 'string'))) return null;   // Crónica
  if ('decisivaWon' in o && typeof o.decisivaWon !== 'boolean') return null;
  if (!isObj(o.world) || !isObj(o.world.start) || !Array.isArray(o.world.settlements)) return null;
  if (!o.world.settlements.every(s => isObj(s) && typeof s.id === 'string' && num(s.x) && num(s.y))) return null;
  return o;
}
