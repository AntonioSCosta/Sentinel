// As cinco comunidades do primeiro vale: identidade, estado, postura e motivos (GDD v2, «As cinco aldeias»).
// Módulo puro (sem DOM nem Three.js). Os nomes são inventados; os números são propostas a afinar com `npm run balance`.
// Cada comunidade está ligada a um lugar do mundo gerado (state.world), escolhido de forma determinística à volta do início.

export const COMMUNITY_IDS = ['ribeira', 'penedo', 'souto', 'vau', 'fonte'];

/** Comida por família e por estação, e armas por estação, de cada ofício. */
export const OFFICES = {
  lavradores: { label: 'lavradores', yield: { primavera: 0.8, verão: 2.0, outono: 1.0 }, arms: 0 },
  pastores: { label: 'pastores e guerreiros', yield: { primavera: 1.0, verão: 0.8, outono: 1.0 }, arms: 0 },
  serra: { label: 'pastores de cabras; castanha e bolota', yield: { primavera: 0.6, verão: 0.6, outono: 1.6 }, arms: 0 },
  barqueiros: { label: 'barqueiros e pescadores', yield: { primavera: 0.8, verão: 0.8, outono: 0.8 }, arms: 0 },
  ferreiros: { label: 'ferreiros que trabalham para a guarnição', yield: { primavera: 0.4, verão: 0.4, outono: 0.4 }, arms: 4 },
};

/**
 * Inclinações dos chefes. fearGain / trustGain multiplicam só as subidas; refusal e avenge multiplicam o efeito de
 * recusar um pedido e de vingar a aldeia; foodGive, a comida dada por pedido (usados pelos PR seguintes).
 */
export const TRAITS = {
  prudente: { label: 'prudente', fearGain: 1.5 },
  orgulhoso: { label: 'orgulhoso', refusal: 2, avenge: 2 },
  generoso: { label: 'generosa', foodGive: 1.5 },
  desconfiado: { label: 'desconfiado', trustGain: 0.5 },
  devedor: { label: 'devedor a Roma', paysTribute: true },
};

/** Identidade fixa (não se grava: vem daqui pela chave da comunidade). */
export const IDENTITY = {
  ribeira: { name: 'Aldeia da Ribeira', kind: 'aldeia', place: 'no fundo do vale, à beira da estrada e do rio', office: 'lavradores',
    chief: { name: 'Camalo', trait: 'prudente' }, role: 'Celeiro do vale: a maior colheita, mas à vista da estrada e do tributo.',
    families: 70, youthRate: 0.5, trust: 30, fear: 55 },
  penedo: { name: 'Castro do Penedo', kind: 'castro', place: 'no alto, muralhado', office: 'pastores',
    chief: { name: 'Tângino', trait: 'orgulhoso' }, role: 'Reserva de guerreiros: mais jovens do que as outras, e um chefe que não esquece uma ofensa.',
    families: 40, youthRate: 0.7, trust: 40, fear: 30 },
  souto: { name: 'Aldeia do Souto', kind: 'aldeia', place: 'na serra, entre castanheiros', office: 'serra',
    chief: { name: 'Búcia', trait: 'generoso' }, role: 'Refúgio e olhos da serra: esconde o bando e manda notícias depressa.',
    families: 30, youthRate: 0.5, trust: 55, fear: 25 },
  vau: { name: 'Aldeia do Vau', kind: 'aldeia', place: 'no único vau do rio fora da ponte romana', office: 'barqueiros',
    chief: { name: 'Arco', trait: 'desconfiado' }, role: 'Guarda o vau: quem a tem atravessa o rio sem passar pela estrada.',
    families: 25, youthRate: 0.5, trust: 50, fear: 30 },
  fonte: { name: 'Aldeia da Fonte', kind: 'aldeia', place: 'à sombra do posto romano', office: 'ferreiros',
    chief: { name: 'Cauno', trait: 'devedor' }, role: 'Forja do vale: a única que faz armas, e denuncia o bando enquanto tiver medo.',
    families: 45, youthRate: 0.5, trust: 15, fear: 60 },
};

/** Do pior para o melhor; `min` é a margem confiança − medo a partir da qual se entra no degrau. */
export const POSTURES = [
  { id: 'colabora', label: 'colabora com Roma', min: -Infinity },
  { id: 'receosa', label: 'receosa', min: -39 },
  { id: 'neutra', label: 'neutra', min: -14 },
  { id: 'amiga', label: 'amiga', min: 15 },
  { id: 'comprometida', label: 'comprometida', min: 40 },
];
export const HYSTERESIS = 5;         // margem extra para mudar de degrau: a postura não salta de um lado para o outro
export const MOTIVE_MIN = 5;         // mudanças mais pequenas não criam motivo
export const MAX_MOTIVES = 8;
export const START_FOOD = 0.6;       // reservas iniciais por família
export const SITUATIONS = ['livre', 'tributada', 'castigada', 'ocupada', 'queimada', 'abandonada'];

const clamp = v => Math.min(100, Math.max(0, v));
const idx = id => POSTURES.findIndex(p => p.id === id);

/** confiança − medo */
export const margin = c => c.trust - c.fear;

/** Postura de uma margem; com a postura anterior, só muda de degrau passada a histerese. */
export function postureFor(m, prev = null) {
  let i = POSTURES.length - 1;
  while (i > 0 && m < POSTURES[i].min) i--;
  const p = prev == null ? -1 : idx(prev);
  if (p < 0 || i === p) return POSTURES[i].id;
  let k = p;
  if (i < p) while (k > i && m < POSTURES[k].min - HYSTERESIS) k--;          // a descer: só sai do degrau a 5 abaixo do limiar
  else while (k < i && m >= POSTURES[k + 1].min + HYSTERESIS) k++;           // a subir: só entra no degrau 5 acima do limiar
  return POSTURES[k].id;
}

/** Jovens que a aldeia ainda pode dar (os que já estão no bando contam como dados). */
export const youth = c => Math.max(0, Math.floor(c.families * IDENTITY[c.id].youthRate) - c.away);

/** Comida e armas que a aldeia produz numa estação. */
export function production(c, season) {
  const o = OFFICES[IDENTITY[c.id].office];
  return { food: Math.round(c.families * (o.yield[season] ?? 0)), arms: o.arms };
}

/** Uma comunidade no seu estado inicial, ligada ao lugar `settlement` do mundo. */
export function makeCommunity(id, settlement) {
  const I = IDENTITY[id];
  return { id, settlement, families: I.families, away: 0, food: Math.round(I.families * START_FOOD),
    trust: I.trust, fear: I.fear, motives: [], situation: 'livre', until: null, due: null, posture: postureFor(I.trust - I.fear) };
}

/**
 * Muda confiança e medo de `c` (já com a inclinação do chefe), guarda um motivo se a margem mudou MOTIVE_MIN ou mais
 * e atualiza a postura. Devolve { from, to } quando a postura muda; senão null.
 */
export function shift(c, { trust = 0, fear = 0 }, motive, day) {
  const t = TRAITS[IDENTITY[c.id].chief.trait];
  const dT = trust > 0 ? trust * (t.trustGain ?? 1) : trust, dF = fear > 0 ? fear * (t.fearGain ?? 1) : fear;
  const t0 = c.trust, f0 = c.fear;
  c.trust = clamp(Math.round(c.trust + dT)); c.fear = clamp(Math.round(c.fear + dF));
  const v = (c.trust - t0) - (c.fear - f0);
  if (Math.abs(v) >= MOTIVE_MIN) {
    c.motives.push({ key: motive.key, text: motive.text, v, day });
    if (c.motives.length > MAX_MOTIVES) c.motives.splice(0, c.motives.length - MAX_MOTIVES);
  }
  const from = c.posture, to = postureFor(margin(c), from);
  c.posture = to;
  return from === to ? null : { from, to };
}

/** Os `n` motivos que mais pesam (|v|); em empate, os mais recentes primeiro. */
export const topMotives = (c, n = 3) => [...c.motives].sort((a, b) => Math.abs(b.v) - Math.abs(a.v) || b.day - a.day).slice(0, n);

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
const roadDist = (world, p) => { let d = Infinity; for (let i = 1; i < (world.road?.length ?? 0); i++) d = Math.min(d, segDist(p, world.road[i - 1], world.road[i])); return d; };

/**
 * Escolhe os lugares do vale: o castro mais perto do início é o Penedo; das quatro aldeias mais perto do início,
 * a mais perto de um posto romano é a Fonte, a mais perto da estrada é a Ribeira, a mais perto do início é o Souto
 * (está na serra de onde o bando parte) e a que sobra é o Vau. Determinístico: só depende do mundo.
 */
export function assignSettlements(world) {
  const start = world.start, by = f => (a, b) => f(a) - f(b) || (a.id < b.id ? -1 : 1);
  const postos = world.settlements.filter(s => s.kind === 'posto');
  const castro = world.settlements.filter(s => s.kind === 'castro').sort(by(s => dist(s, start)))[0];
  const near = world.settlements.filter(s => s.kind === 'aldeia').sort(by(s => dist(s, start))).slice(0, 4);
  const take = f => near.splice(near.indexOf([...near].sort(by(f))[0]), 1)[0].id;
  const fonte = take(s => Math.min(...postos.map(p => dist(s, p))));
  const ribeira = take(s => roadDist(world, s));
  const souto = take(s => dist(s, start));
  return { ribeira, penedo: castro.id, souto, vau: near[0].id, fonte };
}

export function newCommunities(world) {
  const at = assignSettlements(world), out = {};
  for (const id of COMMUNITY_IDS) out[id] = makeCommunity(id, at[id]);
  return out;
}

/** Cria state.communities se faltar (campanha nova ou gravação v1 de antes das comunidades). */
export function ensureCommunities(state) {
  if (!state.communities) state.communities = newCommunities(state.world);
  return state.communities;
}

const num = x => typeof x === 'number' && Number.isFinite(x);
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const validMotive = m => isObj(m) && typeof m.key === 'string' && typeof m.text === 'string' && num(m.v) && num(m.day);

/** As comunidades gravadas são utilizáveis? (deserialize recusa a gravação se não forem.) */
export function validCommunities(o) {
  if (!isObj(o)) return false;
  return COMMUNITY_IDS.every(id => {
    const c = o[id];
    return isObj(c) && c.id === id && typeof c.settlement === 'string'
      && num(c.families) && c.families >= 0 && num(c.away) && c.away >= 0 && num(c.food) && c.food >= 0
      && num(c.trust) && c.trust >= 0 && c.trust <= 100 && num(c.fear) && c.fear >= 0 && c.fear <= 100
      && Array.isArray(c.motives) && c.motives.length <= MAX_MOTIVES && c.motives.every(validMotive)
      && SITUATIONS.includes(c.situation) && (c.until === null || num(c.until))
      && (c.due === null || (isObj(c.due) && num(c.due.food) && c.due.food >= 0 && num(c.due.day)))
      && idx(c.posture) >= 0;
  });
}
