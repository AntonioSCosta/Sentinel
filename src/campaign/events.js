// Acontecimentos da campanha: um capítulo agendado e um baralho de eventos verosímeis.
// Módulo puro (sem DOM nem Three.js).
import { loseMen } from './communities.js';

export const CATIVOS_FROM = 10;
export const CATIVOS_TO = 20;
export const EVENT_CHANCE = 0.1;

/** Capítulos agendados (uma vez só; o fluxo põe o id em state.done ao lançar a batalha). */
export const SCHEDULED = [
  { id: 'cativos', chapter: 'cativos',
    when: s => !s.over && s.day >= CATIVOS_FROM && s.day <= CATIVOS_TO && !s.done.includes('cativos') },
];

/** Primeira entrada agendada em vigor, ou null. Não altera o estado. */
export const dueScheduled = state => SCHEDULED.find(e => e.when(state)) ?? null;

/** O texto de cada carta está nos catálogos (map.deck.<id>): a interface traduz pelo id. */
export const DECK = [
  { id: 'enviado', kind: 'verosimil', apply(s) {
    s.men += 3;
  } },
  { id: 'seca', kind: 'verosimil', apply(s) {
    s.food -= Math.min(s.food, 12);
  } },
  { id: 'traidor', kind: 'verosimil', apply(s) {
    s.arms -= Math.min(s.arms, 4);
    if (s.men > 1) loseMen(s, 1);   // o traidor é de uma aldeia: sai da conta dela
  } },
  { id: 'pastores', kind: 'verosimil', apply(s) {
    s.food += 10;
  } },
];

/** Cerca de um acontecimento por 10 dias; nunca o mesmo id duas vezes seguidas. */
export function rollEvent(state, rng) {
  if (state.over || !rng.chance(EVENT_CHANCE)) return null;
  const pool = DECK.filter(e => e.id !== state.lastEvent);
  const e = rng.pick(pool.length ? pool : DECK);
  e.apply(state);
  state.lastEvent = e.id;
  state.seen = state.seen || [];   // para a Crónica; criado só quando preciso
  if (!state.seen.includes(e.id)) state.seen.push(e.id);
  return { id: e.id };
}
