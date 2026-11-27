// Controlador de fluxo da campanha: mapa -> batalha -> mapa -> fim, com gravação.
// Módulo puro (sem DOM nem Three.js); `storage` é qualquer objeto com getItem/setItem/removeItem.
import { makeRng } from './rng.js';
import { YEAR_DAYS } from './clock.js';
import { newCampaign, serialize, deserialize, foodPerDay } from './state.js';
import { makePraetor } from './praetor.js';
import { stepDay, ownEffect, inReach } from './simulation.js';
import { ensureCaptains, afterDay, afterBattle, afterTribute, awayOf, chooseCard, setActive, answerCrisis, answerDeserter, recruitCaptain } from './captains.js';
import { battleSpec, BATTLE_TYPES, applyResult, applyPatrolResult, withdrawFrom, ALLY_CAP } from './battles.js';
import { dueScheduled, rollEvent } from './events.js';
import { ensureIntel, forgetForce, rememberForce, intelView } from './intel.js';
import { ensureCommunities, communityAt } from './communities.js';
import { payTribute, refuseTribute } from './rome.js';
import { postureSnapshot, postureChanges, postureDiff, splitSameOccurrence, record, validJournal } from './journal.js';
import { createPatrolEncounter, PATROL_ENGINE, patrolCasualties, patrolOf, preparePatrol, restorePatrol } from './tactical-patrol.js';

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

/**
 * Uma cópia do estado como o jogador o conhece: das forças romanas ficam só as que ele vê hoje (posição certa); as outras
 * — patrulhas por descobrir, o pretor fora de vista, avistamentos de dias atrás — não existem na cópia.
 */
function asSeen(state) {
  const copy = structuredClone(state);
  const seen = new Set(intelView(state).forces.filter(f => f.status === 'confirmada').map(f => f.id));
  copy.patrols = (copy.patrols || []).filter(p => seen.has(String(p.id)));
  if (copy.praetor && !seen.has(String(copy.praetor.id ?? 'pretor'))) copy.praetor = null;
  return copy;
}

function build(state, storage, phase, battle, journal = [], savedRaw = null, tactical = null, m3 = null) {
  ensureIntel(state);   // campanha nova ou gravação antiga: o jogador começa a saber o que tem à vista
  ensureCommunities(state);   // gravação v1 de antes das comunidades: ganha-as no estado inicial
  ensureCaptains(state);      // campanha nova ou gravação de antes dos capitães: dois, sorteados só pela semente
  /** Corre `fn` (que mexe no estado) e acrescenta aos eventos as mudanças de postura; regista tudo no Diário do dia. */
  const chronicle = (fn, day = () => state.day) => {
    const before = postureSnapshot(state), out = fn();
    out.events.push(...postureChanges(before, state));
    record(flow.journal, day(), out.events);
    return out;
  };
  function write({ state, phase, battle, tactical, journal }, meta = m3) {
    if (typeof storage?.setItem !== 'function') return false;
    try {
      const encoded = tactical ? { engine: PATROL_ENGINE, spec: battle, request: tactical } : battle;
      const data = { v: 1, phase, battle: encoded, state: JSON.parse(serialize(state)), journal };
      if (meta) data.m3 = meta;
      const next = JSON.stringify(data);
      if (storage.getItem && (storage.getItem(STORAGE_KEY) ?? null) !== savedRaw) return false;
      storage.setItem(STORAGE_KEY, next);
      savedRaw = next;
      return true;
    } catch { return false; }
  }
  const flow = {
    state, phase, battle, journal, tactical,
    save() { return write(flow); },
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
      let mid = null;   // as posturas na viragem do dia: o que mudou até aqui foi a ordem; o que muda depois, o fim do dia
      const { events, encounter, refused, dayBreak = events.length } = stepDay(state, o ?? {}, rng, s => { mid = postureSnapshot(s); });
      if (refused) return { events, battle: null, refused: true };   // nada mudou: nem dia, nem acontecimentos, nem save
      const ev = rollEvent(state, rng);
      if (ev) events.push({ type: 'acontecimento', ...ev });
      if (!state.over) events.push(...afterDay(state, events));   // capitães: lealdade, forja, crises, desertor (sorteios próprios)
      const end = postureSnapshot(state), ordered = postureDiff(before, mid ?? end, state), closing = mid ? postureDiff(mid, end, state) : [];
      const late = events.slice(dayBreak).concat(closing), { back, stay } = splitSameOccurrence(late);
      record(flow.journal, state.day - 1, events.slice(0, dayBreak).concat(ordered, back));   // a ordem, a marcha, o pretor, a postura que a ordem mudou: o dia que acabou
      record(flow.journal, state.day, stay);                                                  // a colheita, Roma, os relatos, o acontecimento: o dia novo
      events.push(...ordered, ...closing);
      if (encounter && !state.over) {
        const spec = flow.battle = battleSpec(encounter, state, rng);
        flow.phase = 'batalha';
        if (patrolOf(state, spec)) {
          const campaignId = m3?.campaignId ?? Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4))).join('-');
          const next = { ...m3, campaignId, revision: (m3?.revision ?? 0) + 1 };
          const request = createPatrolEncounter(state, spec, next);
          if (request) { m3 = next; flow.tactical = request; }
        }
      } else yearEnd();
      if (state.over && flow.phase !== 'batalha') flow.phase = 'fim';
      flow.save();
      return { events, battle: flow.battle };
    },
    /** Recusar o combate pendente (battles.withdrawFrom). Recusado sem mexer em nada quando não se pode. */
    withdraw() {
      if (flow.phase !== 'batalha' || flow.tactical) return { events: [], refused: true };
      let events = null;
      chronicle(() => {
        if ((events = withdrawFrom(state, flow.battle))) events.push(...afterBattle(state, flow.battle, events));
        return { events: events || [] };
      });
      if (!events) return { events: [], refused: true };
      flow.battle = null;
      yearEnd();
      flow.phase = state.over ? 'fim' : 'mapa';
      flow.save();
      return { events };
    },
    finishBattle(result) {
      if (flow.phase !== 'batalha' || flow.tactical) return { events: [], refused: true };
      const battle = flow.battle;
      const away = awayOf(state);
      const { events } = chronicle(() => {
        const ev = applyResult(state, battle, result ?? {});
        ev.push(...afterBattle(state, battle, ev, { awayBefore: away }));
        return { events: ev };
      });
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
    prepareTactical(request, placement) {
      if (flow.phase !== 'batalha' || !request || request !== flow.tactical) return null;
      const tactical = preparePatrol(request, placement);
      if (!tactical || !write({ ...flow, tactical })) return null;
      flow.tactical = tactical;
      return tactical;
    },
    finishTactical(result) {
      const request = flow.tactical;
      if (flow.phase !== 'batalha' || !request || m3.lastResolved === request.encounterId) return { events: [], refused: true };
      const casualties = patrolCasualties(state, flow.battle, request, result);
      if (!casualties) return { events: [], refused: true };
      const { world, ...mutable } = state;
      const next = { ...structuredClone(mutable), world };
      const journal = [...flow.journal];
      const before = postureSnapshot(next);
      const away = awayOf(next);
      const events = applyPatrolResult(next, flow.battle, casualties);
      events.push(...afterBattle(next, flow.battle, events, { awayBefore: away }));
      if (casualties.romanSurvivors > 0) rememberForce(next, flow.battle.foeId);
      else forgetForce(next, flow.battle.foeId);
      events.push(...postureChanges(before, next));
      record(journal, next.day, events);
      yearEnd(next);
      const phase = next.over ? 'fim' : 'mapa';
      const meta = { ...m3, lastResolved: request.encounterId };
      if (!write({ state: next, phase, battle: null, tactical: null, journal }, meta)) return { events: [], refused: true };
      Object.assign(state, next);
      Object.assign(flow, { phase, battle: null, tactical: null, journal });
      m3 = meta;
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
    else afterTribute(state);   // o Saqueador não gosta de ver a comida ir para Roma
    flow.save();
    return { events: r.events, refused: false };
  }
  /** Uma ordem aos capitães (captains.js): não gasta o dia, regista-se no Diário e grava. { ok, why, events }. */
  function captainOrder(fn) {
    if (flow.phase !== 'mapa') return { ok: false, why: 'fase', events: [] };
    let r;
    chronicle(() => { r = fn(); return { events: r.events }; });
    if (r.ok) flow.save();
    return r;
  }
  flow.chooseCard = (id, card) => captainOrder(() => chooseCard(state, id, card));
  flow.setCaptainActive = (id, on) => captainOrder(() => setActive(state, id, on));
  flow.answerCrisis = (id, answer) => captainOrder(() => answerCrisis(state, id, answer));
  flow.answerDeserter = accept => captainOrder(() => answerDeserter(state, accept));
  /** Recruta o capitão da comunidade que vive em `settlementId` (é preciso lá estar). */
  flow.recruitCaptain = settlementId => captainOrder(() => {
    const c = communityAt(state, settlementId), s = state.world.settlements.find(x => x.id === settlementId);
    return c && s ? recruitCaptain(state, c.id, { inReach: inReach(state.party, s) }) : { ok: false, why: 'nenhum', events: [] };
  });
  flow.payTribute = id => tribute('pagar', id);
  flow.refuseTribute = id => tribute('recusar', id);
  /**
   * O que uma ordem daria hoje, só com o que o jogador sabe, sem mexer em nada. Pela mesma ordem de prioridade de
   * flow.order: fora do mapa nada se cumpre; com um capítulo agendado devido (dueScheduled) a ordem não se cumpre e
   * começa esse capítulo; só então o efeito da própria ordem.
   *
   * Três coisas, e só estas: (1) o efeito da própria ordem, que é certo (homens, armas, comida, confiança, a batalha de
   * um ataque); (2) as consequências de forças romanas que o jogador vê hoje (asSeen: castigo à aldeia que ajuda); (3) o
   * resto — patrulhas por descobrir, o pretor fora de vista, encontros, sorteios, o fim do dia de Roma — fica de fora: a
   * interface diz apenas que há riscos que ainda não se conhecem. Nunca corre a simulação do dia (stepDay).
   * { executes, refused, events, state, encounter, scheduled, battle, upkeep }: `state` é uma cópia «como o jogador a
   * conhece»; `events` vazio quando a ordem não se cumpre; `upkeep` é a comida que o bando come no dia.
   */
  flow.preview = o => {
    const copy = asSeen(state), rng = dayRng(copy);
    const none = { executes: false, refused: false, events: [], state: copy, encounter: null, scheduled: null, battle: null, upkeep: 0 };
    if (flow.phase !== 'mapa') return { ...none, refused: true };
    const due = dueScheduled(copy);
    if (due) return { ...none, scheduled: { id: due.id, chapter: due.chapter }, battle: scheduledSpec(due, copy, rng) };
    const r = ownEffect(copy, o ?? {});
    if (r.refused) return { ...none, refused: true, events: r.events };
    const battle = r.encounter && !copy.over ? battleSpec(r.encounter, copy, rng) : null;
    return { ...none, executes: true, events: r.events, encounter: r.encounter ?? null, battle, upkeep: foodPerDay(copy.men) };
  };
  /** O que pagar ou recusar o tributo daria, sem mexer em nada: { events, state }. */
  flow.previewTribute = (kind, id) => {
    const copy = structuredClone(state);
    return { events: kind === 'pagar' ? payTribute(copy, id) : refuseTribute(copy, id), state: copy };
  };
  function yearEnd(target = state) {
    if (!target.over && target.day >= YEAR_DAYS) target.over = target.men >= WIN_MEN && target.fame >= WIN_FAME ? 'vitoria' : 'derrota';
  }
  return flow;
}

export function createFlow({ storage, seed } = {}) {
  const s = seed ?? Date.now() % 2 ** 31;
  const state = newCampaign(s);
  state.praetor = makePraetor('vetilio', dayRng(state), state.world);
  let savedRaw = null;
  try { savedRaw = storage?.getItem?.(STORAGE_KEY) ?? null; } catch { /* Storage can be disabled. */ }
  const flow = build(state, storage, 'mapa', null, [], savedRaw);
  flow.save();
  return flow;
}

export function loadFlow(storage) {
  let parsed, savedRaw;
  try { savedRaw = storage?.getItem?.(STORAGE_KEY); parsed = JSON.parse(savedRaw ?? ''); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || parsed.v !== 1 || !PHASES.includes(parsed.phase)) return null;
  const state = deserialize(JSON.stringify(parsed.state));
  if (!state) return null;
  if (parsed.phase === 'fim' && !state.over) return null;
  const m3 = parsed.m3 ?? null;
  if (m3 && (typeof m3.campaignId !== 'string' || !m3.campaignId.trim() || !Number.isSafeInteger(m3.revision) || m3.revision < 1
    || (m3.lastResolved !== undefined && typeof m3.lastResolved !== 'string'))) return null;
  let battle = parsed.phase === 'batalha' ? parsed.battle : null;
  let tactical = null;
  if (parsed.phase === 'batalha') {
    if (battle?.engine === PATROL_ENGINE) {
      if (!m3 || state.over || m3.lastResolved === battle.request?.encounterId) return null;
      tactical = restorePatrol(state, battle.spec, m3, battle.request);
      if (!tactical) return null;
      battle = battle.spec;
    }
    const b = battle, fin = Number.isFinite;
    if (!b || typeof b !== 'object' || !BATTLE_TYPES.includes(b.type) || !fin(b.realMen) || !fin(b.allies)
      || !b.enemies || typeof b.enemies !== 'object') return null;
  }
  return build(state, storage, state.over ? 'fim' : parsed.phase, battle, validJournal(parsed.journal) ? parsed.journal : [], savedRaw, tactical, m3);
}

export function clearSave(storage) { storage?.removeItem?.(STORAGE_KEY); }
