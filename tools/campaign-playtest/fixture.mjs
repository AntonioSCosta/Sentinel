import { createFlow, STORAGE_KEY } from '../../src/campaign/flow.js';
import { inReach } from '../../src/campaign/simulation.js';
import { LANGUAGE_KEY } from '../../src/i18n/index.js';

export const PLAYTEST_SEED = 20;
export const ROAD_INDEX = 4;
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function memoryStorage(raw = null) {
  const data = new Map(raw === null ? [] : [[STORAGE_KEY, raw]]);
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}

/** Generate a v1 checkpoint by marching from a new campaign to the closest castro. */
export function makeCheckpoint(seed = PLAYTEST_SEED) {
  const storage = memoryStorage();
  const flow = createFlow({ seed, storage });
  const { party, world } = flow.state;
  const castro = world.settlements.filter(s => s.kind === 'castro')
    .reduce((nearest, s) => distance(party, s) < distance(party, nearest) ? s : nearest);
  const orders = [];
  while (!inReach(flow.state.party, castro) && flow.phase === 'mapa' && flow.state.day < 6) {
    const order = { kind: 'marchar', to: { x: castro.x, y: castro.y } };
    if (flow.order(order).refused) break;
    orders.push(order);
  }
  if (flow.phase !== 'mapa' || !inReach(flow.state.party, castro)) return null;
  return { flow, storage, castro, orders, raw: storage.getItem(STORAGE_KEY) };
}

/** Existing campaigns, including unreadable saves, belong to the player. */
export function seedEmptySlot(storage, locale) {
  if (locale !== 'en' && locale !== 'pt-PT') throw new TypeError('Unsupported playtest language');
  if (storage.getItem(STORAGE_KEY) !== null) return false;
  const checkpoint = makeCheckpoint();
  if (!checkpoint) throw new Error('Campaign playtest checkpoint unavailable');
  storage.setItem(LANGUAGE_KEY, locale);
  storage.setItem(STORAGE_KEY, checkpoint.raw);
  return true;
}
