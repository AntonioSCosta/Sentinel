// Comida, reservas e estações das aldeias: colheita no fim de cada estação, reserva de inverno e fome (GDD v2, «Produção e
// reservas» e «A postura»). Módulo puro (sem DOM nem Three.js); o bando e o seu consumo diário continuam em simulation.js.
import { season, YEAR_DAYS } from './clock.js';
import { COMMUNITY_IDS, production, margin, postureFor, addMotive, HUNGER_MARGIN } from './communities.js';

export { HUNGER_MARGIN };
/** A fome conta a partir desta estação (1 de setembro): antes disso as reservas ainda têm a colheita do verão por vir. */
export const FIRST_HUNGER_SEASON = 'outono';

/** Reserva de inverno: uma unidade de comida por família. */
export const winterReserve = c => c.families;

/**
 * Comida que a aldeia dá ao bando, pela postura: a comprometida dá o que tem, mesmo abaixo da reserva de inverno; a amiga só
 * o que passa dela; as outras não dão (a neutra só troca por armas, num pedido). Quem pede e o custo em confiança são dos
 * pedidos (PR 5): aqui só o que a aldeia pode dar.
 */
export function givableFood(c) {
  if (c.posture === 'comprometida') return c.food;
  if (c.posture === 'amiga') return Math.max(0, c.food - winterReserve(c));
  return 0;
}

/** A aldeia passa fome nesta estação? Só conta em FIRST_HUNGER_SEASON, e não conta quem já não existe (queimada, abandonada). */
export const isHungry = (c, seasonName) =>
  seasonName === FIRST_HUNGER_SEASON && c.families > 0 && c.situation !== 'queimada' && c.situation !== 'abandonada' && c.food < winterReserve(c);

/** A colheita da `seasonName` que acaba de terminar entra nas reservas (menos os jovens fora; aldeias queimadas ou abandonadas não colhem). */
export function harvest(state, seasonName) {
  const villages = COMMUNITY_IDS.map(id => {
    const c = state.communities[id], dead = c.situation === 'queimada' || c.situation === 'abandonada';
    const food = dead ? 0 : production(c, seasonName).food;
    c.food += food;
    return { id: c.settlement, food };
  });
  return { type: 'colheita', season: seasonName, total: villages.reduce((n, v) => n + v.food, 0), villages };
}

/** Põe ou tira a fome de cada aldeia e recalcula a postura; devolve um evento por aldeia que mudou. */
export function updateHunger(state) {
  const events = [], now = season(state.day);
  for (const id of COMMUNITY_IDS) {
    const c = state.communities[id], want = isHungry(c, now);
    if ((c.hungry ?? false) === want) continue;
    const from = c.posture;
    c.hungry = want;
    c.posture = postureFor(margin(c), from);
    if (want) addMotive(c, 'fome', 'Passam fome: as reservas não chegam ao inverno', -HUNGER_MARGIN, state.day);
    else addMotive(c, 'fome-fim', 'Já têm comida para o inverno', HUNGER_MARGIN, state.day);
    events.push({ type: want ? 'aldeia-fome' : 'aldeia-fome-fim', id: c.settlement, from, to: c.posture });
  }
  return events;
}

/**
 * Chamada por stepDay logo depois de o dia avançar (`prevDay` é o dia que acabou): se uma estação acabou (ou o ano),
 * faz a colheita; depois atualiza a fome. Sem comunidades (estado parcial) não faz nada.
 */
export function closeDay(state, prevDay) {
  if (!state.communities) return [];
  const events = [];
  if (season(prevDay) !== season(state.day) || (prevDay < YEAR_DAYS && state.day >= YEAR_DAYS)) events.push(harvest(state, season(prevDay)));
  events.push(...updateHunger(state));
  return events;
}
