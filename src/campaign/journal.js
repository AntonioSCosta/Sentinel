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
  vitoria: 'bando', derrota: 'bando', retirada: 'bando', fuga: 'bando', fome: 'bando', acontecimento: 'bando',
  colheita: 'vale', 'comunidade-abandonada': 'vale',
};
export const categoryOf = type => CATEGORY[type] ?? null;

/** A postura de cada comunidade agora: { ribeira: 'receosa', … }. */
export function postureSnapshot(state) {
  const out = {};
  for (const id of COMMUNITY_IDS) if (state.communities?.[id]) out[id] = state.communities[id].posture;
  return out;
}

/** Uma entrada { type: 'postura', id, community, from, to } por comunidade cuja postura mudou desde `before`. */
export function postureChanges(before, state) {
  const out = [];
  for (const id of COMMUNITY_IDS) {
    const c = state.communities?.[id];
    if (c && before?.[id] && before[id] !== c.posture) out.push({ type: 'postura', id: c.settlement, community: id, from: before[id], to: c.posture });
  }
  return out;
}

/** Acrescenta ao diário os eventos que contam, com o dia; mantém só os últimos JOURNAL_MAX. */
export function record(journal, day, events) {
  for (const ev of events || []) if (ev && categoryOf(ev.type)) journal.push({ day, ...ev });
  if (journal.length > JOURNAL_MAX) journal.splice(0, journal.length - JOURNAL_MAX);
  return journal;
}

/** Um diário gravado é utilizável? (se não for, carrega-se a campanha com o diário vazio) */
export const validJournal = j => Array.isArray(j) && j.length <= JOURNAL_MAX
  && j.every(e => !!e && typeof e === 'object' && !Array.isArray(e) && Number.isFinite(e.day) && typeof e.type === 'string');
