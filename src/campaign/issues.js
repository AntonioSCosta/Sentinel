// A coluna de assuntos e as interrupções do tempo (PR 5). Só LÊ o estado da campanha e o que o jogador sabe (intelView):
// não cria prazos nem consequências; os que mostra vêm das regras (rome.js, simulation.js). Módulo puro (sem DOM).
//
// Três graus, para não fazer de cada evento uma tarefa:
//   decisao   espera uma resposta do jogador e tem prazo (hoje só o tributo de Roma: o único pedido que existe);
//   atencao   merece ser visto: comida baixa, forças romanas conhecidas perto, castigos, mudanças de postura, colheita;
//   o resto vai só para o Diário (journal.js).
import { foodPerDay } from './state.js';
import { intelView } from './intel.js';
import { MARCH_SPEED, nearRoad } from './simulation.js';
import { COMMUNITY_IDS } from './communities.js';
import { PUNISH, SEEN_RANGE } from './rome.js';
import { placeName } from './strings.js';
import { ARCHETYPES, RULES } from './captains-data.js';
import { desertionMen } from './captains.js';
import { createI18n } from '../i18n/index.js';
import { mapPlaceName } from '../i18n/map-text.js';

const portuguese = createI18n();
const copy = (i18n, key, params) => i18n.t(`map.issuesCopy.${key}`, params);
const placeLabel = (i18n, state, id) => mapPlaceName(i18n, placeName(state, id) ?? '', state.world.settlements.find(p => p.id === id)?.kind);
const forceLabel = (i18n, kind) => i18n.t(`map.force.${['patrulha', 'comboio', 'cacadores', 'pretor'].includes(kind) ? kind : 'unknown'}`);
const postureLabel = (i18n, posture) => copy(i18n, `posture.${posture}`);
const recentKey = (day, type, id) => `j:${day}:${type}:${id ?? ''}`;

export const LOW_FOOD_DAYS = 5;   // comida para menos de cinco dias: aviso discreto (não interrompe)
export const RECENT_DAYS = 5;     // um acontecimento fica estes dias na coluna (depois só no Diário)
export const NEAR = MARCH_SPEED;  // «a menos de um dia»: um dia de marcha do bando

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const alive = c => c.families > 0 && c.situation !== 'queimada' && c.situation !== 'abandonada';
const placeOf = (state, c) => state.world.settlements.find(s => s.id === c.settlement);

/** Dias de comida do bando ao ritmo de hoje (inteiros). */
export const foodDays = state => Math.floor(state.food / foodPerDay(state.men));

const RECENT_TYPES = new Set(['castigo', 'ocupada', 'comunidade-queimada', 'comunidade-abandonada', 'postura', 'colheita', 'denuncia']);
const communityAtPlace = (state, id) => COMMUNITY_IDS.find(k => state.communities?.[k]?.settlement === id) ?? null;

/** Forças que o jogador conhece de hoje ou de ontem (as mais velhas são só zonas de dúvida no mapa). */
const freshForces = state => intelView(state).forces.filter(f => f.age <= 1);

/**
 * A fila de assuntos: decisões primeiro (por prazo), depois o que merece atenção agora, depois os acontecimentos recentes
 * (do mais novo para o mais velho). `dismissed` é um Set de chaves que o jogador já dispensou (só acontecimentos).
 * Cada assunto: { key, kind, type, title, place, community, deadline, consequence, detail, actions: [{ id, label }] }.
 */
export function buildIssues(state, journal = [], { dismissed = new Set(), i18n = portuguese } = {}) {
  if (!state.communities) return [];
  const out = [], day = state.day;
  const name = id => placeLabel(i18n, state, id);
  const t = (key, params) => copy(i18n, key, params);
  // decisões: o tributo pendente
  const due = COMMUNITY_IDS.map(id => state.communities[id]).filter(c => c.situation === 'tributada' && c.due && day < c.due.day);
  for (const c of due.sort((a, b) => a.due.day - b.due.day || COMMUNITY_IDS.indexOf(a.id) - COMMUNITY_IDS.indexOf(b.id))) {
    out.push({ key: `tributo:${c.id}:${c.due.day}`, kind: 'decisao', type: 'tributo', title: t('tributeTitle', { name: name(c.settlement) }), place: c.settlement, community: c.id,
      deadline: c.due.day - day, consequence: t('tributeIgnored', { name: name(c.settlement), fear: PUNISH.fear, duration: i18n.t('map.days', { count: PUNISH.days }) }),
      detail: t('tributeWhat', { food: c.due.food, have: c.food }),
      actions: [{ id: 'pagar', label: t('pay') }, { id: 'recusar', label: t('refuse') }] });
  }
  out.push(...captainIssues(state, i18n));
  // atenção, agora
  const fd = foodDays(state);
  if (fd < LOW_FOOD_DAYS) out.push({ key: 'comida', kind: 'atencao', type: 'comida', title: t(fd <= 0 ? 'noFood' : 'foodTitle', { duration: i18n.t('map.days', { count: fd }) }), place: null, community: null, deadline: null,
    consequence: t('foodIgnored'), detail: null, actions: [{ id: 'castro', label: t('foodAction') }] });
  const forces = freshForces(state);
  for (const f of forces) for (const id of COMMUNITY_IDS) {
    const c = state.communities[id], p = placeOf(state, c);
    if (!p || !alive(c) || dist(f, p) > NEAR) continue;
    const seen = f.kind === 'pretor' ? t('threatPraetor') : dist(f, p) <= SEEN_RANGE ? t('threatSeen') : null;
    out.push({ key: `ameaca:${f.id}:${id}`, kind: 'atencao', type: 'ameaca', title: t('threatTitle', { who: forceLabel(i18n, f.kind), name: name(c.settlement) }),
      place: c.settlement, community: id, deadline: null, consequence: seen, detail: null, force: f.id, actions: [{ id: 'ver', label: t('see') }] });
  }
  for (const f of forces) {
    if (f.age > 0 || dist(f, state.party) > NEAR) continue;
    const road = f.kind !== 'pretor' && nearRoad(state.world, state.party);
    out.push({ key: `patrulha:${f.id}`, kind: 'atencao', type: 'patrulha', title: t('patrolTitle', { who: forceLabel(i18n, f.kind) }), place: null, community: null,
      deadline: null, consequence: null, detail: null, force: f.id, at: { x: f.x, y: f.y },
      actions: [...(road ? [{ id: 'emboscar', label: t('ambush') }] : []), { id: 'ver', label: t('see') }] });
  }
  // acontecimentos recentes (do Diário)
  const recent = [];
  for (const e of journal) {
    if (!RECENT_TYPES.has(e.type) || day - e.day >= RECENT_DAYS || e.day > day) continue;
    const key = recentKey(e.day, e.type, e.id);
    if (dismissed.has(key)) continue;
    const community = e.community ?? (e.id ? communityAtPlace(state, e.id) : null);
    const params = { name: name(e.id) };
    if (e.type === 'postura') params.posture = postureLabel(i18n, e.to);
    if (e.type === 'colheita') Object.assign(params, { season: i18n.t(`map.season.${e.season}`), total: e.total });
    recent.push({ key, kind: 'atencao', type: e.type, title: t(`recent.${e.type}`, params), place: e.id ?? null, community, deadline: null,
      consequence: null, detail: null, day: e.day, event: e, actions: [] });
  }
  out.push(...recent.reverse());
  return out;
}

/**
 * As decisões dos capitães (captains.js): a crise de lealdade e o desertor romano têm prazo; a evolução espera pelo jogador.
 * Cada uma traz `captain` (o id) e as ações que a interface oferece no painel de decisão.
 */
function captainIssues(state, i18n) {
  const out = [], day = state.day, t = (key, params) => i18n.t(`map.captains.${key}`, params), S = RULES.loyalty.share;
  const base = { place: null, community: null, consequence: null };
  for (const c of state.captains || []) if (c.crisis && day < c.crisis.due) {
    out.push({ ...base, key: `capitao-crise:${c.id}:${c.crisis.due}`, kind: 'decisao', type: 'capitao-crise', captain: c.id,
      title: t('issue.crisis', { name: c.name }), deadline: c.crisis.due - day, detail: t('issue.crisisDetail', { loyalty: c.loyalty }),
      consequence: t(ARCHETYPES[c.archetype].betrays ? 'issue.crisisBetray' : 'issue.crisisDesert', { men: desertionMen(state, c) }),
      actions: [{ id: 'parte', label: t('issue.share', { food: S.food, arms: S.arms }), info: t('issue.shareInfo') },
        { id: 'partir', label: t('issue.letGo'), info: t('issue.letGoInfo') }] });
  }
  const o = state.captainOffer;
  if (o && day < o.due) out.push({ ...base, key: `capitao-desertor:${o.due}`, kind: 'decisao', type: 'capitao-desertor', captain: null,
    title: t('issue.deserter'), deadline: o.due - day, detail: t('issue.deserterDetail', { name: o.captain.name }), consequence: t('issue.deserterGone'),
    actions: [{ id: 'aceitar', label: t('issue.accept'), info: t('issue.acceptInfo') }, { id: 'recusar', label: t('issue.refuse'), info: t('issue.refuseInfo') }] });
  for (const c of state.captains || []) if (c.offer) {
    out.push({ ...base, key: `capitao-evolucao:${c.id}:${c.lastCard}`, kind: 'decisao', type: 'capitao-evolucao', captain: c.id,
      title: t('issue.evolve', { name: c.name }), deadline: null, detail: t(c.offer.why === 'nivel' ? 'issue.evolveLevel' : 'issue.evolveBattle', { name: c.name, level: c.level }),
      actions: c.offer.options.map(id => ({ id, label: t(`trait.${id}`), gain: t(`traitGain.${id}`), cost: t(`traitCost.${id}`) })) });
  }
  return out;
}

/**
 * O que obriga o tempo a parar depois de um dia: só encontros militares e decisões obrigatórias (um pedido de tributo novo,
 * a crise de um capitão ou o desertor, uma batalha). Devolve [{ type, text, place? }] (vazio: o tempo continua); todos os
 * motivos do mesmo dia vêm juntos. Avistamentos, mudanças de postura e colheitas não param o tempo: ficam no mapa, no
 * registo e no Diário. `memory` (objeto que a interface guarda) só rastreia a comida, para os avisos no registo.
 */
export function detectInterruptions({ state, events = [], memory = {}, battle = null }) {
  const out = [];
  const add = (type, data = {}, location = {}) => {
    const reason = { type, ...data, ...location };
    out.push({ ...reason, text: interruptionText(reason, state, portuguese) });
  };
  for (const ev of events) {
    if (ev.type === 'tributo-exigido') add('pedido', { event: ev }, { place: ev.id });
    else if (ev.type === 'capitao' && (ev.what === 'crise' || ev.what === 'desertor')) add('capitao', { event: ev });   // decisões com prazo
  }
  const fd = foodDays(state), low = fd < LOW_FOOD_DAYS;
  // Comida baixa/esgotada é aviso, não uma razão para parar o relógio.
  memory.lowFood = low;
  memory.emptyFood = fd <= 0;
  if (battle) add('batalha');
  return out;
}

/** Translate the original pause reason on demand, even after the language changes. */
export function interruptionText(reason, state, i18n) {
  const t = (key, params) => copy(i18n, `stop.${key}`, params);
  const name = id => placeLabel(i18n, state, id);
  const ev = reason.event;
  switch (reason.type) {
    case 'pedido': return t('pedido', { name: name(reason.place) });
    case 'postura': return t('postura', { name: name(reason.place), to: postureLabel(i18n, ev.to), from: postureLabel(i18n, ev.from) });
    case 'colheita': return t('colheita', { season: i18n.t(`map.season.${ev.season}`), total: ev.total });
    case 'comida': return t(reason.foodDays <= 0 ? 'emptyFood' : 'lowFood', { duration: i18n.t('map.days', { count: reason.foodDays }) });
    case 'capitao': return i18n.t(`map.captains.stop.${ev.what}`, { name: ev.name });
    default: return t('batalha');
  }
}
