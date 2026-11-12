// Controlador de fluxo da campanha: mapa -> batalha -> mapa -> fim, com gravação.
// Módulo puro (sem DOM nem Three.js); `storage` é qualquer objeto com getItem/setItem/removeItem.
import { makeRng } from './rng.js';
import { YEAR_DAYS } from './clock.js';
import { newCampaign, serialize, deserialize } from './state.js';
import { makePraetor } from './praetor.js';
import { stepDay } from './simulation.js';
import { battleSpec, applyResult, ALLY_CAP } from './battles.js';
import { dueScheduled, rollEvent } from './events.js';

export const STORAGE_KEY = 'viriato.campaign';
const PHASES = ['mapa', 'batalha', 'fim'];
const WIN_MEN = 10, WIN_FAME = 30;

const dayRng = state => makeRng((state.seed + state.day * 7919) % 2 ** 31);

function scheduledSpec(entry, state, rng) {
  return {
    type: 'historica', chapter: entry.chapter, seed: rng.int(1, 2 ** 31 - 1), site: 'castro',
    allies: Math.min(state.men, ALLY_CAP), enemies: { legio: 6, velites: 2, centurion: false },
    bonus: { allies: 0, enemies: 0 }, realMen: state.men, foeId: null,
  };
}

function build(state, storage, phase, battle) {
  const flow = {
    state, phase, battle, storage,
    get rng() { return dayRng(state); },
    save() {
      if (!storage || typeof storage.setItem !== 'function') return;
      storage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, phase: flow.phase, battle: flow.battle, state: JSON.parse(serialize(state)) }));
    },
    order(o) {
      if (flow.phase !== 'mapa') return { events: [], battle: null, refused: true };
      const rng = dayRng(state);
      const due = dueScheduled(state);
      if (due) {
        state.done.push(due.id);
        flow.battle = scheduledSpec(due, state, rng);
        flow.phase = 'batalha';
        flow.save();
        return { events: [], battle: flow.battle };
      }
      const { events, encounter } = stepDay(state, o ?? {}, rng);
      const ev = rollEvent(state, rng);
      if (ev) events.push({ type: 'acontecimento', ...ev });
      if (encounter && !state.over) { flow.battle = battleSpec(encounter, state, rng); flow.phase = 'batalha'; }
      else yearEnd();
      if (state.over && flow.phase !== 'batalha') flow.phase = 'fim';
      flow.save();
      return { events, battle: flow.battle };
    },
    finishBattle(result) {
      if (flow.phase !== 'batalha') return { events: [], refused: true };
      const events = applyResult(state, flow.battle, result ?? {});
      flow.battle = null;
      yearEnd();
      flow.phase = state.over ? 'fim' : 'mapa';
      flow.save();
      return { events };
    },
  };
  function yearEnd() {
    if (!state.over && state.day >= YEAR_DAYS) state.over = state.men >= WIN_MEN && state.fame >= WIN_FAME ? 'vitoria' : 'derrota';
  }
  return flow;
}

export function createFlow({ storage, seed } = {}) {
  const s = seed ?? Date.now() % 2 ** 31;
  const state = newCampaign(s);
  state.praetor = makePraetor('vetilio', dayRng(state), state.world);
  const flow = build(state, storage, 'mapa', null);
  flow.save();
  return flow;
}

export function loadFlow(storage) {
  let parsed;
  try { parsed = JSON.parse(storage?.getItem?.(STORAGE_KEY) ?? ''); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || parsed.v !== 1 || !PHASES.includes(parsed.phase)) return null;
  const state = deserialize(JSON.stringify(parsed.state));
  if (!state) return null;
  const battle = parsed.battle && typeof parsed.battle === 'object' ? parsed.battle : null;
  if (parsed.phase === 'batalha' && !battle) return null;
  return build(state, storage, state.over ? 'fim' : parsed.phase, parsed.phase === 'batalha' ? battle : null);
}

export function clearSave(storage) { storage?.removeItem?.(STORAGE_KEY); }
