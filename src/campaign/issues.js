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
import { SEEN_RANGE } from './rome.js';
import { placeName, ISSUE, RECENT_TITLE, INTERRUPT, FORCE_WHO } from './strings.js';

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
export function buildIssues(state, journal = [], { dismissed = new Set() } = {}) {
  if (!state.communities) return [];
  const out = [], day = state.day;
  const name = id => placeName(state, id) ?? '';
  // decisões: o tributo pendente
  const due = COMMUNITY_IDS.map(id => state.communities[id]).filter(c => c.situation === 'tributada' && c.due && day < c.due.day);
  for (const c of due.sort((a, b) => a.due.day - b.due.day || COMMUNITY_IDS.indexOf(a.id) - COMMUNITY_IDS.indexOf(b.id))) {
    out.push({ key: `tributo:${c.id}:${c.due.day}`, kind: 'decisao', type: 'tributo', title: ISSUE.tributeTitle(name(c.settlement)), place: c.settlement, community: c.id,
      deadline: c.due.day - day, consequence: ISSUE.tributeIgnored(name(c.settlement)), detail: ISSUE.tributeWhat(c.due.food, c.food),
      actions: [{ id: 'pagar', label: ISSUE.pay(c.due.food) }, { id: 'recusar', label: ISSUE.refuse }] });
  }
  // atenção, agora
  const fd = foodDays(state);
  if (fd < LOW_FOOD_DAYS) out.push({ key: 'comida', kind: 'atencao', type: 'comida', title: ISSUE.foodTitle(fd), place: null, community: null, deadline: null,
    consequence: ISSUE.foodIgnored, detail: null, actions: [{ id: 'castro', label: ISSUE.foodAction }] });
  const forces = freshForces(state);
  for (const f of forces) for (const id of COMMUNITY_IDS) {
    const c = state.communities[id], p = placeOf(state, c);
    if (!p || !alive(c) || dist(f, p) > NEAR) continue;
    const seen = f.kind === 'pretor' ? ISSUE.threatPraetor : dist(f, p) <= SEEN_RANGE ? ISSUE.threatSeen : null;
    out.push({ key: `ameaca:${f.id}:${id}`, kind: 'atencao', type: 'ameaca', title: ISSUE.threatTitle(FORCE_WHO[f.kind] ?? FORCE_WHO.patrulha, name(c.settlement)),
      place: c.settlement, community: id, deadline: null, consequence: seen, detail: null, force: f.id, actions: [{ id: 'ver', label: ISSUE.see }] });
  }
  for (const f of forces) {
    if (f.age > 0 || dist(f, state.party) > NEAR) continue;
    const road = f.kind !== 'pretor' && nearRoad(state.world, state.party);
    out.push({ key: `patrulha:${f.id}`, kind: 'atencao', type: 'patrulha', title: ISSUE.patrolTitle(FORCE_WHO[f.kind] ?? FORCE_WHO.patrulha), place: null, community: null,
      deadline: null, consequence: null, detail: null, force: f.id, at: { x: f.x, y: f.y },
      actions: [...(road ? [{ id: 'emboscar', label: ISSUE.ambush }] : []), { id: 'ver', label: ISSUE.see }] });
  }
  // acontecimentos recentes (do Diário)
  const recent = [];
  for (const e of journal) {
    if (!RECENT_TYPES.has(e.type) || day - e.day >= RECENT_DAYS || e.day > day) continue;
    const key = `j:${e.day}:${e.type}:${e.id ?? ''}`;
    if (dismissed.has(key)) continue;
    const community = e.community ?? (e.id ? communityAtPlace(state, e.id) : null);
    recent.push({ key, kind: 'atencao', type: e.type, title: RECENT_TITLE[e.type](name(e.id), e), place: e.id ?? null, community, deadline: null,
      consequence: null, detail: null, day: e.day, actions: [] });
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
  const out = [], name = id => placeName(state, id) ?? '';
  for (const ev of events) {
    if (ev.type === 'tributo-exigido') out.push({ type: 'pedido', text: INTERRUPT.pedido(name(ev.id)), place: ev.id });
    else if (ev.type === 'postura') out.push({ type: 'postura', text: INTERRUPT.postura(name(ev.id), ev), place: ev.id });
    else if (ev.type === 'colheita') out.push({ type: 'colheita', text: INTERRUPT.colheita(ev) });
  }
  const fd = foodDays(state), low = fd < LOW_FOOD_DAYS;
  if (low && !memory.lowFood) out.push({ type: 'comida', text: INTERRUPT.comida(fd) });
  memory.lowFood = low;
  const friends = state.communities ? COMMUNITY_IDS.map(id => state.communities[id]).filter(c => alive(c) && (c.posture === 'amiga' || c.posture === 'comprometida')) : [];
  const was = new Set(memory.near || []), near = [];
  for (const f of intelView(state).forces) {
    if (f.age > 0) continue;
    let where = null;
    if (dist(f, state.party) <= NEAR) where = 'do bando';
    else for (const c of friends) { const p = placeOf(state, c); if (p && dist(f, p) <= NEAR) { where = `de ${name(c.settlement)}`; break; } }
    if (!where) continue;
    near.push(f.id);
    if (!was.has(f.id)) out.push({ type: 'forca', text: INTERRUPT.forca(FORCE_WHO[f.kind] ?? FORCE_WHO.patrulha, where), at: { x: f.x, y: f.y } });
  }
  memory.near = near;
  if (battle) out.push({ type: 'batalha', text: INTERRUPT.batalha });
  return out;
}
