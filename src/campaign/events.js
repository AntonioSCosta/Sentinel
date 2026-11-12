// Acontecimentos da campanha: um capítulo agendado e um baralho de eventos verosímeis.
// Módulo puro (sem DOM nem Three.js).

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

export const DECK = [
  { id: 'enviado', kind: 'verosimil', apply(s) {
    s.men += 3;
    return 'Um mensageiro das aldeias traz três voluntários para o teu bando.';
  } },
  { id: 'seca', kind: 'verosimil', apply(s) {
    s.food -= Math.min(s.food, 12);
    return 'A seca e os ratos estragam parte das provisões.';
  } },
  { id: 'traidor', kind: 'verosimil', apply(s) {
    s.arms -= Math.min(s.arms, 4);
    if (s.men > 1) s.men -= 1;
    return 'Um traidor foge de noite e leva armas consigo.';
  } },
  { id: 'pastores', kind: 'verosimil', apply(s) {
    s.food += 10;
    return 'Pastores da serra oferecem queijo e carne seca.';
  } },
];

/** Cerca de um acontecimento por 10 dias; nunca o mesmo id duas vezes seguidas. */
export function rollEvent(state, rng) {
  if (state.over || !rng.chance(EVENT_CHANCE)) return null;
  const pool = DECK.filter(e => e.id !== state.lastEvent);
  const e = rng.pick(pool.length ? pool : DECK);
  const text = e.apply(state);
  state.lastEvent = e.id;
  return { id: e.id, text };
}
