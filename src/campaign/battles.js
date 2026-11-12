// Encontro -> especificação de batalha -> consequências na campanha. Módulo puro (sem DOM nem Three.js).
import { spend, checkRuin } from './state.js';

export const ALLY_CAP = 25;
export const ENEMY_CAP = 30;
export const BATTLE_TYPES = ['emboscada', 'campo-aberto', 'defesa-aldeia', 'assalto-coluna', 'retirada', 'decisiva', 'historica'];

const FOE_MEN = { patrulha: 6, comboio: 8, pretor: 60, posto: 12 };
const LOOT = {
  emboscada: { food: 6, arms: 3 }, 'assalto-coluna': { food: 20, arms: 6 }, 'campo-aberto': { food: 4, arms: 2 }, 'defesa-aldeia': { food: 4, arms: 2 },
  decisiva: { food: 10, arms: 5 }, historica: { food: 8, arms: 4 },
};
const DEFEAT = { food: 3, fame: 5 }, RETREAT = { food: 5, fame: 3 };
const VILLAGE_FAME = 3;
const ESCAPED_FAME = 2;   // assalto a coluna: os carros fugiram todos com a escolta viva   // defesa de aldeia: a mais na vitória, a menos quando arde

function typeOf(enc) {
  if (enc.kind === 'pretor') return { type: 'decisiva', site: 'campo' };
  if (enc.kind === 'defesa') return { type: 'defesa-aldeia', site: 'castro' };
  if (enc.kind === 'posto') return { type: 'historica', site: 'castro', chapter: 'acampamento' };
  if (enc.waiting) return { type: enc.kind === 'comboio' ? 'assalto-coluna' : 'emboscada', site: 'estrada' };
  return { type: 'campo-aberto', site: 'campo' };
}

export function battleSpec(enc, state, rng) {
  const { type, site, chapter } = typeOf(enc);
  const total = enc.foe?.men ?? FOE_MEN[enc.foe?.kind] ?? FOE_MEN[enc.kind] ?? 6;
  const shown = Math.min(total, ENEMY_CAP);
  const velites = Math.round(shown * 0.25);
  const spec = {
    type, seed: rng.int(1, 2 ** 31 - 1), site,
    allies: Math.min(state.men, ALLY_CAP), realMen: state.men,
    enemies: { legio: shown - velites, velites, centurion: type === 'decisiva' || type === 'historica' },
    bonus: { allies: Math.max(0, state.men - ALLY_CAP), enemies: Math.max(0, total - ENEMY_CAP) },
  };
  if (chapter) spec.chapter = chapter;
  if (enc.villageId !== undefined) spec.villageId = enc.villageId;
  if (enc.foe?.id !== undefined) spec.foeId = enc.foe.id;
  return spec;
}

/** Saque de uma vitória; no assalto a coluna vai do de campo aberto (nenhum carro) ao cheio (todos os carros). */
function lootOf(spec, result) {
  const loot = LOOT[spec.type] || { food: 0, arms: 0 };
  if (spec.type !== 'assalto-coluna') return loot;
  const { cartsCaptured: c, cartsTotal: t } = result;
  const frac = Number.isFinite(c) && Number.isFinite(t) && t > 0 ? Math.min(1, Math.max(0, c / t)) : 1;
  const min = LOOT['campo-aberto'];
  return { food: Math.round(min.food + (loot.food - min.food) * frac), arms: Math.round(min.arms + (loot.arms - min.arms) * frac) };
}

export function applyResult(state, spec, result) {
  if (state.over) return [];
  const raw = Number.isFinite(result.alliesLost) ? Math.max(0, result.alliesLost) : 0;
  const scaled = Math.round(raw * spec.realMen / Math.max(1, spec.allies));
  const lost = Math.min(state.men, scaled);
  spend(state, { men: lost });
  const events = [];
  if (result.retreated) {
    spend(state, RETREAT);
    events.push({ type: 'retirada', lost });
  } else if (result.escaped) {
    spend(state, { fame: ESCAPED_FAME });
    events.push({ type: 'fuga', lost });
  } else if (result.won) {
    const loot = lootOf(spec, result);
    const fame = spec.type === 'decisiva' ? 15 : spec.type === 'defesa-aldeia' ? 5 + VILLAGE_FAME : 5;
    state.food += loot.food; state.arms += loot.arms; state.fame += fame;
    if (spec.foeId !== undefined) state.patrols = state.patrols.filter(p => p.id !== spec.foeId);
    events.push({ type: 'vitoria', lost, food: loot.food, arms: loot.arms, fame });
    if (spec.type === 'decisiva') { state.over = 'vitoria'; events.push({ type: 'ano-vencido' }); }
  } else {
    spend(state, DEFEAT);
    events.push({ type: 'derrota', lost });
  }
  if (!result.won && spec.type === 'defesa-aldeia' && state.villages[spec.villageId]) {   // ninguém a defendeu: arde
    state.villages[spec.villageId].burnt = true;
    spend(state, { fame: VILLAGE_FAME });
    events.push({ type: 'aldeia-queimada', id: spec.villageId });
  }
  state.cooldown = 2;
  if (checkRuin(state)) events.push({ type: 'ruina' });
  return events;
}
