// O Diário da campanha: o que aconteceu de marcante, dia a dia, gravado com a campanha (PR 5).
// Guarda os eventos tal como a simulação os devolve (tipo e dados, sem texto: o texto faz-se ao mostrar, para se poder
// localizar). Não decide nada nem muda o estado da campanha. Módulo puro (sem DOM nem Three.js).
import { COMMUNITY_IDS } from './communities.js';

export const JOURNAL_MAX = 300;

/** Os tipos de evento que contam para a história, e a categoria de cada um. */
const CATEGORY = {
  recrutou: 'decisao', ajuda: 'decisao', 'tributo-pago': 'decisao', 'tributo-recusado': 'decisao',
  'tributo-exigido': 'roma', castigo: 'roma', 'castigo-fim': 'roma', ocupada: 'roma', 'ocupada-fim': 'roma', 'comunidade-queimada': 'roma',
  'aldeia-queimada': 'roma', denuncia: 'roma', 'roma-atencao': 'roma', doutrina: 'roma', cacadores: 'roma',
  postura: 'postura', 'aldeia-fome': 'postura', 'aldeia-fome-fim': 'postura',
  vitoria: 'bando', derrota: 'bando', capitao: 'bando', retirada: 'bando', fuga: 'bando', fome: 'bando', acontecimento: 'bando', 'emboscada-tatica': 'bando',
  colheita: 'vale', 'comunidade-abandonada': 'vale',
};
export const categoryOf = type => CATEGORY[type] ?? null;

/** A postura de cada comunidade agora: { ribeira: 'receosa', … }. */
export function postureSnapshot(state) {
  const out = {};
  for (const id of COMMUNITY_IDS) if (state.communities?.[id]) out[id] = state.communities[id].posture;
  return out;
}

/** Uma entrada { type: 'postura', id, community, from, to } por comunidade cuja postura é diferente em `to` do que era em `from` (dois postureSnapshot). */
export function postureDiff(from, to, state) {
  const out = [];
  for (const id of COMMUNITY_IDS) {
    const c = state.communities?.[id];
    if (c && from?.[id] && to?.[id] && from[id] !== to[id]) out.push({ type: 'postura', id: c.settlement, community: id, from: from[id], to: to[id] });
  }
  return out;
}

/** As mudanças de postura desde `before` até ao estado atual. */
export const postureChanges = (before, state) => postureDiff(before, postureSnapshot(state), state);

/**
 * Os eventos do fim do dia que são a mesma ocorrência de algo que já se passou durante o dia: a comunidade que arde porque
 * o pretor queimou a aldeia nesse dia (a simulação só a regista ao fechar o dia) e a postura que isso muda. Pertencem ao
 * dia da queima, não ao seguinte. Devolve { back, stay }.
 */
export function splitSameOccurrence(lateEvents) {
  const burnt = new Set(lateEvents.filter(e => e.type === 'comunidade-queimada' && e.by === 'pretor').map(e => e.id));
  const back = [], stay = [];
  for (const e of lateEvents) (burnt.has(e.id) && (e.type === 'comunidade-queimada' || e.type === 'postura') ? back : stay).push(e);
  return { back, stay };
}

/**
 * Acrescenta ao diário os eventos que contam; mantém só os últimos JOURNAL_MAX. Numa entrada, `day` é SEMPRE o dia em
 * que o acontecimento se deu. Se o próprio evento trouxer um `day` com outro sentido (hoje só `tributo-exigido`, onde é
 * o dia em que o prazo acaba), guarda-se como `dueDay`.
 */
export function record(journal, day, events) {
  for (const ev of events || []) {
    if (!ev || !categoryOf(ev.type)) continue;
    const { day: own, ...rest } = ev;
    journal.push(own === undefined ? { ...rest, day } : { ...rest, day, dueDay: own });
  }
  if (journal.length > JOURNAL_MAX) journal.splice(0, journal.length - JOURNAL_MAX);
  return journal;
}

/** Um diário gravado é utilizável? (se não for, carrega-se a campanha com o diário vazio) */
export const validJournal = j => Array.isArray(j) && j.length <= JOURNAL_MAX
  && j.every(e => !!e && typeof e === 'object' && !Array.isArray(e) && Number.isFinite(e.day) && typeof e.type === 'string');
