// Roma e as situações das aldeias do vale: atenção, tributo, castigo, ocupação, queima e abandono (GDD v2, «Estados e situações»
// e «Reação inicial de Roma»). Módulo puro (sem DOM nem Three.js); o estado vive em state.rome (criado na primeira utilização)
// e nos campos `situation`, `until` e `due` de cada comunidade. Os números são propostas a afinar com `npm run balance`.
//
// Escada de uma aldeia: livre → (tributada) → castigada → ocupada, e queimada pelo pretor ou por um castigo máximo. Quem
// castiga uma aldeia já castigada põe-lhe guarnição (ocupada) e, com a atenção a 75 ou mais, queima-a (as aldeias; o castro
// do Penedo, muralhado, fica ocupado). Queimada e abandonada não têm saída neste primeiro vale.
//
// Fora deste PR (ficam para o PR 5 e seguintes): as ordens do jogador para pagar ou recusar o tributo (aqui são as funções
// `payTribute` e `refuseTribute`), os cobradores como forças no mapa (e a atenção +15 ao matá-los), a guarnição como força
// que se derrota (aqui, `liberate`), esconder parte do tributo, os vizinhos a menos de um dia de marcha que sentem metade, a
// população (+5%/−10%) e a entrada do pretor e a pressão das contramedidas a lerem a atenção. Deixam-se assim para não
// mexer no equilíbrio da campanha; o pretor continua a entrar como em praetor.js.
//
// CONTRATO DO TRIBUTO PARA O PR 5 (ordens e «assuntos pendentes»). A interface liga-se só a `payTribute` e `refuseTribute`;
// não repete regras. Tudo o que decide o tributo está aqui.
//   Estado     uma aldeia deve tributo quando situation === 'tributada' e `due = { food, day }` (comida devida; `day` é o
//              primeiro dia em que já é tarde). Fora disso, ou com state.day >= due.day, as duas funções devolvem [] e não
//              mexem em nada; o vencimento em due.day é só de romeDay (`lapseTribute`, interna).
//   Prazo      `levyTribute` marca day = hoje + TRIBUTE.days (10). A ordem pode ser dada com state.day < due.day, ou seja,
//              nos 10 dias em que a aldeia está tributada. Quando o dia avança para due.day (romeDay) e o pedido continua,
//              fez-se `refuseTribute`: castigo e atenção +10. Dar a ordem nesse dia já é tarde: devolve [].
//   Pagar      `payTribute(state, id)` → [{ type: 'tributo-pago', id, food, auto: false }]: tira EXATAMENTE `due.food` às
//              reservas, −5 de confiança, a aldeia fica livre e `due` null. Roma não repara. Sem comida para tudo não há
//              pagamento parcial: devolve [{ type: 'tributo-sem-comida', id, food, have }], não muda nada e o prazo
//              continua. É uma ordem recusada: não gasta o dia (como `sem-armas`).
//   Recusar    `refuseTribute(state, id)` → [roma-atencao?, castigo { why: 'tributo' }]: atenção +10, castigo (medo +25,
//              metade da produção, 20 dias) e `due` null já hoje. O prazo antigo deixa de contar (sem segunda punição).
//   Pagam sozinhas a Fonte (chefe devedor) e as aldeias receosas ou colaboradoras: `tributo-pago` com auto: true, já
//   na entrada da estação; nunca ficam tributadas, logo não há ordem a dar.
//   Outras saídas que limpam `due`: castigo por apoio (`punish`), ocupação, queima e abandono. A aldeia deixa de dever.
//   Eventos que a interface pode mostrar: tributo-exigido { id, food, day }, tributo-pago, tributo-sem-comida, castigo,
//   roma-atencao { from, to }, castigo-fim.
//
// «À vista de Roma» é uma medida do mundo gerado: há uma força romana (patrulha, caçadores ou pretor) a menos de SEEN_RANGE
// do lugar da aldeia. Não supõe nada do terreno à volta (ver a ligação provisória em communities.js).
import {
  COMMUNITY_IDS, IDENTITY, TRAITS, CASTIGO_PRODUCTION, shift, margin, addMotive, winterReserve,
} from './communities.js';
import { season } from './clock.js';
import { ensureDoctrine } from './doctrine.js';

/** O que sobe a atenção de Roma e quanto. */
export const ATTENTION_GAIN = { cobradores: 15, patrulha: 10, tributo: 10, denuncia: 5 };
/** Faixas da atenção (0–100): o que Roma faz em cada uma. */
export const BANDS = [{ id: 'rotina', min: 0 }, { id: 'vigilancia', min: 25 }, { id: 'castigo', min: 50 }, { id: 'pretor', min: 75 }];
export const ATTENTION_DECAY_DAYS = 2;   // a atenção desce um ponto de dois em dois dias
export const PUNISH_MIN = 50, MAX_PUNISH_MIN = 75;   // a partir daqui Roma castiga por si; a partir do segundo, castiga também as já castigadas
export const PUNISH_GAP = 10;            // dias entre dois castigos escolhidos por Roma
export const TRIBUTE = { share: 0.3, days: 10, trust: -5 };   // 30% do excedente, dez dias para pagar, −5 de confiança a quem o paga por tua ordem
export const PUNISH = { fear: 25, days: 20, production: CASTIGO_PRODUCTION };
export const OCCUPATION_FEAR = 2;        // medo por dia numa aldeia ocupada
export const LIBERATE_FEAR = -10;        // expulsar a guarnição: romanos derrotados à vista
export const BURN_LOSS = 0.4;            // famílias que morrem ou são levadas quando a aldeia arde
export const ABANDON_BELOW = 10;         // menos famílias do que isto: a aldeia é abandonada
export const SUSPECT_DAYS = 30;          // Roma desconfia de quem ajudou o bando nos últimos 30 dias
export const SEEN_RANGE = 30;            // uma força romana a esta distância do lugar vê quem ajuda o bando
export const DENOUNCE_RANGE = 25, DENOUNCE_GAP = 10;   // a colaboradora denuncia o bando a esta distância, e de dez em dez dias, no máximo

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const isDead = c => c.situation === 'queimada' || c.situation === 'abandonada';
const communities = state => COMMUNITY_IDS.map(id => state.communities[id]);
const placeOf = (state, c) => state.world.settlements.find(s => s.id === c.settlement);

/** Atenção, castigo seguinte, suspeitas e denúncias; criado na primeira vez (campanhas antigas não o têm). */
export function ensureRome(state) {
  if (!state.rome) state.rome = { attention: 0, nextPunish: 0, suspects: {}, denounced: {} };
  return state.rome;
}

const num = x => typeof x === 'number' && Number.isFinite(x);
const dayMap = o => !!o && typeof o === 'object' && !Array.isArray(o) && Object.entries(o).every(([k, v]) => COMMUNITY_IDS.includes(k) && num(v));
/** Um `rome` gravado é utilizável? (deserialize recusa a gravação se não for.) */
export const validRome = r => !!r && typeof r === 'object' && num(r.attention) && r.attention >= 0 && r.attention <= 100
  && num(r.nextPunish) && dayMap(r.suspects) && dayMap(r.denounced);

export const bandOf = a => BANDS.reduce((id, b) => (a >= b.min ? b.id : id), BANDS[0].id);

/** Sobe a atenção pela causa `kind` (ATTENTION_GAIN). Devolve { from, to } se mudou de faixa, senão null. */
export function raiseAttention(state, kind) {
  const n = ATTENTION_GAIN[kind];
  if (n === undefined) throw new Error(`atenção: causa desconhecida «${kind}»`);
  const r = ensureRome(state), from = bandOf(r.attention);
  r.attention = Math.min(100, r.attention + n);
  const to = bandOf(r.attention);
  return from === to ? null : { from, to };
}

/** Como raiseAttention, mas acrescenta o evento `roma-atencao` quando a faixa muda. */
function gain(state, kind, events) {
  const ch = raiseAttention(state, kind);
  if (ch) events.push({ type: 'roma-atencao', ...ch });
}

/** A comunidade mais amiga (maior margem) que ainda existe, a não ser `exceptId`; empate pela ordem do vale. */
function friendliest(state, exceptId) {
  let best = null;
  for (const c of communities(state)) if (c.id !== exceptId && !isDead(c) && (!best || margin(c) > margin(best))) best = c;
  return best;
}

/** Roma desconfia desta aldeia? (ajudou o bando há pouco) */
const suspect = (state, id) => state.day - (state.rome?.suspects?.[id] ?? -Infinity) <= SUSPECT_DAYS;

// ——— tributo ———

/** O tributo que a aldeia deve agora: 30% do que passa da reserva de inverno (0 se não chegar a 1). */
export const tributeFor = c => { const n = Math.round(TRIBUTE.share * Math.max(0, c.food - winterReserve(c))); return n >= 1 ? n : 0; };

/**
 * Início de estação: Roma exige tributo à Ribeira, à Fonte e às aldeias de que desconfia. A Fonte (chefe devedor) e as
 * aldeias receosas ou colaboradoras pagam sozinhas, sem custo de confiança; as outras ficam tributadas, com TRIBUTE.days.
 * Quem já está castigada, ocupada, queimada ou abandonada não é tributada. Sem excedente não há tributo.
 */
export function levyTribute(state) {
  const events = [];
  for (const id of COMMUNITY_IDS) {
    const c = state.communities[id];
    if (c.situation !== 'livre' || !(id === 'ribeira' || id === 'fonte' || suspect(state, id))) continue;
    const food = tributeFor(c);
    if (!food) continue;
    if (TRAITS[IDENTITY[id].chief.trait].paysTribute || c.posture === 'receosa' || c.posture === 'colabora') {
      c.food -= food;
      events.push({ type: 'tributo-pago', id: c.settlement, food, auto: true });
    } else {
      c.situation = 'tributada'; c.due = { food, day: state.day + TRIBUTE.days };
      events.push({ type: 'tributo-exigido', id: c.settlement, food, day: c.due.day });
    }
  }
  return events;
}

/** A aldeia está tributada e com o pedido pendente? (as duas ordens do jogador só valem então) */
const owes = c => !!c && c.situation === 'tributada' && !!c.due;

/**
 * O bando manda pagar o tributo: custa EXATAMENTE a comida devida e TRIBUTE.trust de confiança; Roma não repara. Não há
 * pagamento parcial: com menos reservas do que o devido não se paga nada, o estado não muda, o pedido e o prazo ficam, e
 * devolve-se `tributo-sem-comida` ({ food: devido, have: reservas }). Sem pedido pendente devolve [].
 */
export function payTribute(state, id) {
  const c = state.communities?.[id];
  if (!inTime(state, c)) return [];
  const { food } = c.due;
  if (c.food < food) return [{ type: 'tributo-sem-comida', id: c.settlement, food, have: c.food }];
  c.food -= food; c.due = null; c.situation = 'livre';
  shift(c, { trust: TRIBUTE.trust }, { key: 'tributo', text: 'Pagaram o tributo por tua ordem' }, state.day);
  return [{ type: 'tributo-pago', id: c.settlement, food, auto: false }];
}

/** A ordem do jogador ainda vale: só com state.day < due.day (em due.day o prazo já acabou: ver `lapseTribute`). */
const inTime = (state, c) => owes(c) && state.day < c.due.day;

/**
 * O prazo acabou sem pagar (chamada só por romeDay, em due.day): `due` limpa, atenção +10 e castigo. É a única resolução
 * do vencimento; a ordem voluntária `refuseTribute` passa pelo mesmo caminho, mas só dentro do prazo.
 */
function lapseTribute(state, c) {
  c.due = null;
  const events = [];
  gain(state, 'tributo', events);
  events.push(...punish(state, c.id, 'tributo'));
  return events;
}

/** O jogador recusa pagar, antes do prazo: o mesmo que deixá-lo passar, já hoje. Fora do prazo ou sem pedido devolve [] e não mexe em nada. */
export function refuseTribute(state, id) {
  const c = state.communities?.[id];
  return inTime(state, c) ? lapseTribute(state, c) : [];
}

// ——— castigo, ocupação, queima, abandono ———

const CASTIGO_MOTIVE = {
  tributo: 'Roma castigou-nos por não pagar o tributo',
  apoio: 'Roma castigou-nos por ajudar o bando',
  suspeita: 'Roma castigou-nos por desconfiar de nós',
};

/**
 * Roma castiga a aldeia: medo +25, metade da produção durante 20 dias. `why`: 'tributo', 'apoio' ou 'suspeita'.
 * Quem já está castigada é reincidente: com atenção ≥ 75 arde (castigo máximo; o castro fica ocupado), senão fica ocupada.
 * Não há nada a fazer a uma aldeia ocupada, queimada ou abandonada. Devolve os eventos.
 */
export function punish(state, id, why) {
  const c = state.communities?.[id];
  if (!c || isDead(c) || c.situation === 'ocupada') return [];
  if (c.situation === 'castigada') {
    return (state.rome?.attention ?? 0) >= MAX_PUNISH_MIN && IDENTITY[id].kind === 'aldeia' ? burn(state, id, 'castigo') : occupy(state, id);
  }
  c.situation = 'castigada'; c.until = state.day + PUNISH.days; c.due = null;
  const ch = shift(c, { fear: PUNISH.fear }, { key: 'castigo', text: CASTIGO_MOTIVE[why] ?? CASTIGO_MOTIVE.suspeita }, state.day);
  return [{ type: 'castigo', id: c.settlement, why, ...(ch ?? {}) }];
}

/** Roma põe guarnição: medo +2 por dia (romeDay) e a aldeia não dá homens. Só acaba com `liberate`. */
function occupy(state, id) {
  const c = state.communities[id];
  c.situation = 'ocupada'; c.until = null; c.due = null;
  addMotive(c, 'ocupada', 'A guarnição romana pesa na aldeia (+2 de medo por dia)', -OCCUPATION_FEAR, state.day);
  return [{ type: 'ocupada', id: c.settlement }];
}

/** O bando derrota a guarnição: a aldeia volta a ser livre e perde 10 de medo. */
export function liberate(state, id) {
  const c = state.communities?.[id];
  if (!c || c.situation !== 'ocupada') return [];
  c.situation = 'livre';
  shift(c, { fear: LIBERATE_FEAR }, { key: 'guarnicao-vencida', text: 'O bando expulsou a guarnição' }, state.day);
  return [{ type: 'ocupada-fim', id: c.settlement }];
}

/**
 * Quantos de `n` homens do bando cabem como «de» `c`: o que falta para away = famílias (invariante away ≤ families). Chamar
 * DEPOIS de somar as famílias que chegam. O que não cabe fica no bando sem origem (`bandOrigins().sem`): os homens
 * (state.men) nunca se perdem por isto, só deixam de ter aldeia a quem custar o luto.
 */
const room = (c, n) => Math.max(0, Math.min(n, c.families - c.away));

/**
 * A aldeia arde (`by`: 'pretor' ou 'castigo'): perde BURN_LOSS das famílias e as reservas; os sobreviventes e os homens do
 * bando que vinham dela (todos os que couberem, ver `room`) vão para a vizinha mais amiga; se não houver nenhuma, os
 * sobreviventes perdem-se e os homens ficam no bando sem origem. Fica sem
 * famílias e marca o lugar como queimado no mapa (state.villages), de onde o pretor e a informação a tiram.
 */
export function burn(state, id, by) {
  const c = state.communities?.[id];
  if (!c || c.situation === 'queimada') return [];
  const lost = Math.round(c.families * BURN_LOSS), survivors = c.families - lost;
  const to = c.families > 0 ? friendliest(state, id) : null;
  if (to) { to.families += survivors; to.away += room(to, c.away); }
  Object.assign(c, { families: 0, away: 0, food: 0, hungry: false, situation: 'queimada', until: null, due: null });
  addMotive(c, 'queimada', 'A aldeia foi queimada', 0, state.day);
  if (state.villages?.[c.settlement]) state.villages[c.settlement].burnt = true;
  return [{ type: 'comunidade-queimada', id: c.settlement, lost, to: to ? to.settlement : null, by }];
}

/** A aldeia com menos de ABANDON_BELOW famílias é abandonada: as famílias, os homens do bando e as reservas vão para a mais amiga. */
export function abandon(state, id) {
  const c = state.communities?.[id];
  if (!c || isDead(c)) return [];
  const to = c.families > 0 ? friendliest(state, id) : null;
  if (to) { to.families += c.families; to.away += room(to, c.away); to.food += c.food; }
  Object.assign(c, { families: 0, away: 0, food: 0, hungry: false, situation: 'abandonada', until: null, due: null });
  addMotive(c, 'abandonada', 'A aldeia ficou deserta', 0, state.day);
  return [{ type: 'comunidade-abandonada', id: c.settlement, to: to ? to.settlement : null }];
}

/** Aldeias que o pretor ou uma batalha queimaram no mapa (state.villages) e que a comunidade ainda não sabe. */
export function syncBurnt(state, by = 'pretor') {
  const events = [];
  if (!state.communities) return events;
  for (const c of communities(state)) if (state.villages?.[c.settlement]?.burnt && c.situation !== 'queimada') events.push(...burn(state, c.id, by));
  return events;
}

// ——— o apoio do bando ———

/** Há uma força romana (patrulha, caçadores ou pretor) a menos de SEEN_RANGE do lugar da aldeia? */
function romansSee(state, c) {
  const p = placeOf(state, c);
  return !!p && [state.praetor, ...(state.patrols ?? [])].some(f => f && Number.isFinite(f.x) && Number.isFinite(f.y) && dist(f, p) <= SEEN_RANGE);
}

/**
 * Reação de Roma ao apoio do bando (`what`: 'homens' ou 'comida'): a aldeia fica suspeita; se Roma a vê, é castigada logo
 * (e, se já o estava, ocupada ou queimada: ver `punish`). Devolve os eventos.
 */
export function noteSupport(state, id, what) {
  const c = state.communities?.[id];
  if (!c || isDead(c)) return [];
  ensureRome(state).suspects[id] = state.day;
  return romansSee(state, c) ? punish(state, id, 'apoio') : [];
}

// ——— o dia ———

/** A mais suspeita das aldeias que Roma pode castigar agora: as que ajudaram o bando primeiro, depois as mais amigas. */
function pickSuspect(state, allowPunished) {
  let best = null, score = -Infinity;
  for (const c of communities(state)) {
    if (isDead(c) || c.situation === 'ocupada' || (c.situation === 'castigada' && !allowPunished)) continue;
    const s = (suspect(state, c.id) ? 1000 + state.rome.suspects[c.id] : 0) + margin(c);
    if (s > score) { score = s; best = c; }
  }
  return best;
}

/**
 * Chamada por closeDay (harvest.js) depois de o dia avançar e de a colheita entrar. Por ordem: a atenção desce; as aldeias
 * queimadas no mapa passam a queimadas; os castigos acabam; a ocupação dá medo; começa a estação (tributo) e os prazos
 * esgotam-se; as colaboradoras denunciam; Roma castiga a mais suspeita (atenção ≥ 50); as aldeias pequenas são abandonadas.
 * Sem comunidades (estado parcial) não faz nada.
 */
export function romeDay(state, prevDay) {
  if (!state.communities) return [];
  const r = ensureRome(state), day = state.day, events = [];
  if (day % ATTENTION_DECAY_DAYS === 0) r.attention = Math.max(0, r.attention - 1);
  events.push(...syncBurnt(state));
  for (const c of communities(state)) {
    if (c.situation === 'castigada' && c.until !== null && day >= c.until) {
      c.situation = 'livre'; c.until = null;
      events.push({ type: 'castigo-fim', id: c.settlement });
    }
    if (c.situation === 'ocupada') shift(c, { fear: OCCUPATION_FEAR }, { key: 'ocupada', text: 'A guarnição romana pesa na aldeia' }, day);
  }
  if (season(prevDay) !== season(day)) events.push(...levyTribute(state));
  for (const c of communities(state)) if (owes(c) && day >= c.due.day) events.push(...lapseTribute(state, c));
  for (const c of communities(state)) {
    if (c.posture !== 'colabora' || isDead(c)) continue;
    const p = placeOf(state, c);
    if (!p || dist(p, state.party) > DENOUNCE_RANGE || day - (r.denounced[c.id] ?? -Infinity) < DENOUNCE_GAP) continue;
    r.denounced[c.id] = day;
    ensureDoctrine(state).lastSeen = { x: state.party.x, y: state.party.y, day };   // Roma fica a saber onde o bando está
    gain(state, 'denuncia', events);
    events.push({ type: 'denuncia', id: c.settlement });
  }
  if (r.attention >= PUNISH_MIN && day >= r.nextPunish) {
    const c = pickSuspect(state, r.attention >= MAX_PUNISH_MIN);
    if (c) { events.push(...punish(state, c.id, 'suspeita')); r.nextPunish = day + PUNISH_GAP; }
  }
  for (const c of communities(state)) if (!isDead(c) && c.families < ABANDON_BELOW) events.push(...abandon(state, c.id));
  return events;
}
