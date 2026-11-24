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
import { createI18n } from '../i18n/index.js';
import { mapPlaceName } from '../i18n/map-text.js';

const portuguese = createI18n();
const copy = (i18n, key, params) => i18n.t(`map.issuesCopy.${key}`, params);
const placeLabel = (i18n, state, id) => mapPlaceName(i18n, placeName(state, id) ?? '', state.world.settlements.find(p => p.id === id)?.kind);
const forceLabel = (i18n, kind) => i18n.t(`map.force.${['patrulha', 'comboio', 'cacadores', 'pretor'].includes(kind) ? kind : 'unknown'}`);
const postureLabel = (i18n, posture) => copy(i18n, `posture.${posture}`);
const recentKey = (day, type, id) => `j:${day}:${type}:${id ?? ''}`;

export const LOW_FOOD_DAYS = 5;   // comida para menos de cinco dias: assunto e interrupção
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
 * O que obriga o tempo a parar depois de um dia: um pedido novo (tributo), uma força romana vista hoje a menos de um dia do
 * bando ou de uma aldeia amiga ou comprometida, um encontro que pede batalha, uma mudança de postura, a colheita, e a comida
 * a passar para menos de LOW_FOOD_DAYS dias. Devolve [{ type, text, place? }] (vazio: o tempo continua). Todos os motivos
 * do mesmo dia vêm juntos (uma só interrupção). `memory` (objeto que a interface guarda) evita repetir o mesmo aviso: a
 * mesma força enquanto continua perto, e a comida enquanto continua baixa.
 */
export function detectInterruptions({ state, events = [], memory = {}, battle = null }) {
  const out = [];
  const add = (type, data = {}, location = {}) => {
    const reason = { type, ...data, ...location };
    out.push({ ...reason, text: interruptionText(reason, state, portuguese) });
  };
  for (const ev of events) {
    if (ev.type === 'tributo-exigido') add('pedido', { event: ev }, { place: ev.id });
    else if (ev.type === 'postura') add('postura', { event: ev }, { place: ev.id });
    else if (ev.type === 'colheita') add('colheita', { event: ev });
  }
  const fd = foodDays(state), low = fd < LOW_FOOD_DAYS;
  if (low && !memory.lowFood) add('comida', { foodDays: fd });
  memory.lowFood = low;
  const friends = state.communities ? COMMUNITY_IDS.map(id => state.communities[id]).filter(c => alive(c) && (c.posture === 'amiga' || c.posture === 'comprometida')) : [];
  const was = new Set(memory.near || []), near = [];
  for (const f of intelView(state).forces) {
    if (f.age > 0) continue;
    const byBand = dist(f, state.party) <= NEAR;
    const friend = byBand ? null : friends.find(c => { const p = placeOf(state, c); return p && dist(f, p) <= NEAR; });
    if (!byBand && !friend) continue;
    near.push(f.id);
    if (!was.has(f.id)) add('forca', { force: f.id, kind: f.kind, nearPlace: friend?.settlement }, { at: { x: f.x, y: f.y } });
  }
  memory.near = near;
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
    case 'forca': return t(reason.nearPlace ? 'forceByPlace' : 'forceByBand', { who: forceLabel(i18n, reason.kind), name: name(reason.nearPlace) });
    default: return t('batalha');
  }
}
