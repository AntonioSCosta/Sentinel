// Controlador de fluxo da campanha: mapa -> batalha -> mapa -> fim, com gravação.
// Módulo puro (sem DOM nem Three.js); `storage` é qualquer objeto com getItem/setItem/removeItem.
import { makeRng } from './rng.js';
import { YEAR_DAYS } from './clock.js';
import { newCampaign, serialize, deserialize } from './state.js';
import { makePraetor } from './praetor.js';
import { stepDay } from './simulation.js';
import { battleSpec, BATTLE_TYPES, applyResult, withdrawFrom, ALLY_CAP } from './battles.js';
import { dueScheduled, rollEvent } from './events.js';
import { ensureIntel, forgetForce, rememberForce } from './intel.js';
import { ensureCommunities } from './communities.js';
import { payTribute, refuseTribute } from './rome.js';
import { postureSnapshot, postureChanges, record, validJournal } from './journal.js';

export const STORAGE_KEY = 'viriato.campaign';
const PHASES = ['mapa', 'batalha', 'fim'];
export const WIN_MEN = 10, WIN_FAME = 30;

const dayRng = state => makeRng((state.seed + state.day * 7919) % 2 ** 31);

function scheduledSpec(entry, state, rng) {
  return {
    type: 'historica', chapter: entry.chapter, seed: rng.int(1, 2 ** 31 - 1), site: 'castro',
    allies: Math.min(state.men, ALLY_CAP), enemies: { legio: 6, velites: 2, centurion: false },
    bonus: { allies: 0, enemies: 0 }, realMen: state.men, foeId: null,
  };
}

function build(state, storage, phase, battle, journal = []) {
  ensureIntel(state);   // campanha nova ou gravação antiga: o jogador começa a saber o que tem à vista
  ensureCommunities(state);   // gravação v1 de antes das comunidades: ganha-as no estado inicial
  /** Corre `fn` (que mexe no estado) e acrescenta aos eventos as mudanças de postura; regista tudo no Diário do dia. */
  const chronicle = (fn, day = () => state.day) => {
    const before = postureSnapshot(state), out = fn();
    out.events.push(...postureChanges(before, state));
    record(flow.journal, day(), out.events);
    return out;
  };
  const flow = {
    state, phase, battle, journal,
    save() {
      if (!storage || typeof storage.setItem !== 'function') return;
      try { // gravar é best-effort (quota, modo privado): nunca rebenta o jogo
        storage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, phase: flow.phase, battle: flow.battle, state: JSON.parse(serialize(state)), journal: flow.journal }));
      } catch { /* ignorado */ }
    },
    order(o) {
      if (flow.phase !== 'mapa') return { events: [], battle: null, refused: true };
      const rng = dayRng(state);
      // um capítulo agendado devido consome a ordem sem avançar o dia
      const due = dueScheduled(state);
      if (due) {
        state.done.push(due.id);
        flow.battle = scheduledSpec(due, state, rng);
        flow.phase = 'batalha';
        flow.save();
        return { events: [], battle: flow.battle };
      }
      const before = postureSnapshot(state);
      const { events, encounter, refused, dayBreak = events.length } = stepDay(state, o ?? {}, rng);
      if (refused) return { events, battle: null, refused: true };   // nada mudou: nem dia, nem acontecimentos, nem save
      const ev = rollEvent(state, rng);
      if (ev) events.push({ type: 'acontecimento', ...ev });
      events.push(...postureChanges(before, state));
      record(flow.journal, state.day - 1, events.slice(0, dayBreak));   // a ordem, a marcha, o pretor: o dia que acabou
      record(flow.journal, state.day, events.slice(dayBreak));          // a colheita, Roma, os relatos, o acontecimento: o dia novo
      if (encounter && !state.over) { flow.battle = battleSpec(encounter, state, rng); flow.phase = 'batalha'; }
      else yearEnd();
      if (state.over && flow.phase !== 'batalha') flow.phase = 'fim';
      flow.save();
      return { events, battle: flow.battle };
    },
    /** Recusar o combate pendente (battles.withdrawFrom). Recusado sem mexer em nada quando não se pode. */
    withdraw() {
      if (flow.phase !== 'batalha') return { events: [], refused: true };
      let events = null;
      chronicle(() => ({ events: (events = withdrawFrom(state, flow.battle)) || [] }));
      if (!events) return { events: [], refused: true };
      flow.battle = null;
      yearEnd();
      flow.phase = state.over ? 'fim' : 'mapa';
      flow.save();
      return { events };
    },
    finishBattle(result) {
      if (flow.phase !== 'batalha') return { events: [], refused: true };
      const battle = flow.battle;
      const { events } = chronicle(() => ({ events: applyResult(state, battle, result ?? {}) }));
      if (result?.won && battle?.foeId !== undefined) {
        // Só se esquece uma força que deixou de existir. O pretor derrotado numa defesa de aldeia
        // recua e sobrevive: nesse caso volta a ser visto, com os homens que lhe restam.
        const id = String(battle.foeId);
        const survives = (state.patrols || []).some(p => String(p.id) === id)
          || (battle.type !== 'decisiva' && state.praetor && String(state.praetor.id ?? 'pretor') === id);
        if (survives) rememberForce(state, battle.foeId);
        else forgetForce(state, battle.foeId);
      }
      flow.battle = null;
      yearEnd();
      flow.phase = state.over ? 'fim' : 'mapa';
      flow.save();
      return { events };
    },
  };
  /**
   * O jogador manda pagar ou recusar o tributo da comunidade `id` (rome.js: as regras e o prazo são de lá). Não gasta o dia.
   * { events, refused }: recusado sem mexer em nada fora do mapa, sem pedido pendente, fora do prazo ou sem comida para pagar.
   */
  function tribute(kind, id) {
    if (flow.phase !== 'mapa') return { events: [], refused: true };
    const r = chronicle(() => ({ events: kind === 'pagar' ? payTribute(state, id) : refuseTribute(state, id) }));
    if (!r.events.length || r.events[0].type === 'tributo-sem-comida') return { events: r.events, refused: true };   // nada mudou (rome.js garante-o)
    if (kind === 'recusar') record(flow.journal, state.day, [{ type: 'tributo-recusado', id: state.communities[id].settlement }]);
    flow.save();
    return { events: r.events, refused: false };
  }
  flow.payTribute = id => tribute('pagar', id);
  flow.refuseTribute = id => tribute('recusar', id);
  /**
   * O que uma ordem daria hoje, sem mexer em nada, pela mesma ordem de prioridade de flow.order: fora do mapa nada se
   * cumpre; com um capítulo agendado devido (dueScheduled) a ordem não se cumpre e começa esse capítulo; só então stepDay.
   * { executes, refused, events, state, encounter, scheduled, battle }: `state` é uma cópia; `events` vazio quando a
   * ordem não se cumpre (nada de ganhos ou custos de uma ação que não acontece); `battle` é a batalha que começaria.
   */
  flow.preview = o => {
    const copy = structuredClone(state), rng = dayRng(copy);
    const none = { executes: false, refused: false, events: [], state: copy, encounter: null, scheduled: null, battle: null };
    if (flow.phase !== 'mapa') return { ...none, refused: true };
    const due = dueScheduled(copy);
    if (due) return { ...none, scheduled: { id: due.id, chapter: due.chapter }, battle: scheduledSpec(due, copy, rng) };
    const r = stepDay(copy, o ?? {}, rng);
    if (r.refused) return { ...none, refused: true, events: r.events };
    const ev = rollEvent(copy, rng);   // o mesmo sorteio, pela mesma ordem que flow.order
    if (ev) r.events.push({ type: 'acontecimento', ...ev });
    const battle = r.encounter && !copy.over ? battleSpec(r.encounter, copy, rng) : null;
    return { ...none, executes: true, events: r.events, encounter: r.encounter ?? null, battle };
  };
  /** O que pagar ou recusar o tributo daria, sem mexer em nada: { events, state }. */
  flow.previewTribute = (kind, id) => {
    const copy = structuredClone(state);
    return { events: kind === 'pagar' ? payTribute(copy, id) : refuseTribute(copy, id), state: copy };
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
  if (parsed.phase === 'fim' && !state.over) return null;
  const battle = parsed.phase === 'batalha' ? parsed.battle : null;
  if (parsed.phase === 'batalha') {
    const b = battle, fin = Number.isFinite;
    if (!b || typeof b !== 'object' || !BATTLE_TYPES.includes(b.type) || !fin(b.realMen) || !fin(b.allies)
      || !b.enemies || typeof b.enemies !== 'object') return null;
  }
  return build(state, storage, state.over ? 'fim' : parsed.phase, battle, validJournal(parsed.journal) ? parsed.journal : []);   // um diário estragado não deita a campanha fora
}

export function clearSave(storage) { storage?.removeItem?.(STORAGE_KEY); }
