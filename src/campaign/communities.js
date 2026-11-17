// As cinco comunidades do primeiro vale: identidade, estado, postura e motivos (GDD v2, «As cinco aldeias»).
// Módulo puro (sem DOM nem Three.js). Os nomes são inventados; os números são propostas a afinar com `npm run balance`.
//
// LIGAÇÃO PROVISÓRIA AO MUNDO: cada comunidade aponta (`settlement`) para um lugar do mundo gerado (state.world), escolhido
// de forma determinística (`assignSettlements`). É só um suporte para ter um ponto no mapa até haver o vale desenhado à mão
// (fase posterior). NÃO garante que o terreno real corresponda a `IDENTITY[id].place` («à beira da estrada», «à sombra do
// posto»…): essas descrições são texto de ambiente. O que é garantido, e validado ao carregar, é só: o lugar existe,
// ninguém o partilha, e o Penedo é um castro e as outras aldeias. Código dos PR seguintes só pode depender disso — nunca
// de distâncias, estrada, rio ou posto romano junto de uma comunidade.
//
// Estado de uma comunidade (state.communities[id]) — o que cada campo significa e quem lhe mexe:
//   families  famílias que a aldeia tem agora (inteiro ≥ 0). Desce quando Roma a queima ou ela é abandonada (rome.js, que as
//             passa para a aldeia mais amiga: é a única maneira de subirem). Base da produção e do limite de jovens.
//   away      homens desta aldeia que estão no bando (inteiro, 0 ≤ away ≤ families, e a soma das cinco ≤ state.men). Sobe ao
//             recrutar (simulation.js); desce com as baixas, atribuídas à aldeia de origem (`loseMen`, usada por `spend`, a fome
//             e os acontecimentos). Os homens do bando sem aldeia (o bando inicial, voluntários dos castros) contam como `sem`
//             em `bandOrigins`. `youth` e `production` descontam-no.
//   food      reservas da aldeia, na mesma unidade da comida do bando (número ≥ 0). Sobem com a colheita no fim de cada estação
//             (harvest.js); descem por tributo, pedidos ao bando e castigos (PR 4 e 5). Os aldeões não gastam reservas por dia:
//             a produção é já o que sobra. A reserva de inverno é uma unidade por família (`winterReserve`).
//   hungry    (opcional) a aldeia passa fome: de setembro em diante, reservas abaixo da reserva de inverno. Soma −15 à margem
//             (`margin`). Só harvest.js o põe e tira; ausente = false (gravações antigas).
//   situation o que Roma lhe fez e dura enquanto durar o estado: um de SITUATIONS. 'livre' é o normal. Quem a muda é Roma
//             (rome.js); a postura (confiança/medo) não a altera nem depende só dela. O que cada uma muda: castigada, metade da
//             produção (`production`); ocupada, não dá homens (`recruitLimit`); queimada e abandonada, nada (0 famílias).
//   until     dia (número) em que a `situation` atual acaba por si; null se não tem fim marcado (ou está 'livre'). Só tem
//             sentido com situation ≠ 'livre'; o fim da situação é decidido por quem a aplicou, não pelo relógio sozinho.
//   due       pedido pendente de Roma à aldeia: { food, day } = comida a entregar até ao dia `day`; null se não há. É o tributo
//             que rome.js exige (situation 'tributada') e que o PR 5 mostra como «assunto pendente». Pagá-lo ou recusá-lo limpa-o.

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
/**
 * O que cada postura deixa levar por visita (GDD v2, tabela «A postura»): `over: n` = até 1/n dos jovens disponíveis
 * (arredondado para baixo, mas nunca menos de 1 se houver algum: uma aldeia pequena e leal não fica inútil); `volunteers: n` = só n voluntários, sem percentagem; sem regra = não dá homens.
 * A fama NÃO entra: o GDD não a define como limite de recrutamento (só as armas, a postura e os jovens).
 */
export const RECRUIT_RULE = { comprometida: { over: 3 }, amiga: { over: 4 }, neutra: { volunteers: 3 }, receosa: {}, colabora: {} };
export const LEVY_FREE = 6;          // levar jovens acima de 1/6 dos que a aldeia tem em idade de combate custa confiança…
export const LEVY_TRUST = -2;        // …−2 por homem acima desse sexto (motivo «Levaste-nos os filhos»)
export const DEATH_TRUST = -3;       // −3 de confiança por cada homem da aldeia que morre em batalha («O filho de … não voltou»)
export const START_FOOD = 0.6;       // reservas iniciais por família
export const SITUATIONS = ['livre', 'tributada', 'castigada', 'ocupada', 'queimada', 'abandonada'];

const clamp = v => Math.min(100, Math.max(0, v));
const idx = id => POSTURES.findIndex(p => p.id === id);

/** Ponto de observação para `npm run balance`: se `diag.loss` for um array, cada perda de homens é lá registada. */
export const diag = { loss: null };

export const CASTIGO_PRODUCTION = 0.5;   // uma aldeia castigada por Roma produz metade (rome.js)

/** Notícias que cada postura manda ao bando: `delay` dias de atraso (null = o do mensageiro) e a `chance` de dar notícia (GDD v2, «A postura»). Receosa e colabora não dão. */
export const NEWS_RULE = { comprometida: { delay: 0, chance: 1 }, amiga: { delay: 1, chance: 1 }, neutra: { delay: null, chance: 0.5 }, receosa: null, colabora: null };

/** Reserva de inverno: uma unidade de comida por família. */
export const winterReserve = c => c.families;

/** Como é que esta comunidade dá notícias ao bando: { delay, chance } ou null se não dá (ocupada, queimada, abandonada, ou postura que não dá). */
export function newsFrom(c) {
  if (c.situation === 'ocupada' || c.situation === 'queimada' || c.situation === 'abandonada') return null;
  const r = NEWS_RULE[c.posture];
  return r ? { ...r } : null;
}

export const HUNGER_MARGIN = 15;     // uma aldeia com fome soma −15 à margem (harvest.js): passa para o lado de quem lhe der de comer

/** confiança − medo, e −HUNGER_MARGIN enquanto a aldeia passa fome (`hungry`, posto por harvest.js). */
export const margin = c => c.trust - c.fear - (c.hungry ? HUNGER_MARGIN : 0);

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

/** Jovens em idade de combate que a aldeia tem (os que estão no bando incluídos). */
export const youthCap = c => Math.floor(c.families * IDENTITY[c.id].youthRate);

/** Jovens que a aldeia ainda pode dar (os que já estão no bando contam como dados). */
export const youth = c => Math.max(0, youthCap(c) - c.away);

/**
 * Comida e armas que a aldeia produz numa estação. Os que partem fazem falta (GDD v2): a produção desce METADE da
 * proporção de jovens que estão fora (`away / youthCap`), ou seja, com todos os jovens fora produz metade.
 */
export function production(c, season) {
  const o = OFFICES[IDENTITY[c.id].office], cap = youthCap(c);
  const hands = 1 - 0.5 * (cap > 0 ? Math.min(1, c.away / cap) : 0);
  const punished = c.situation === 'castigada' ? CASTIGO_PRODUCTION : 1;
  return { food: Math.round(c.families * (o.yield[season] ?? 0) * hands * punished), arms: c.families > 0 ? Math.round(o.arms * hands * punished) : 0 };
}

/**
 * O que a aldeia deixa levar agora: { limit, byPosture, avail, arms, why }. `limit` é o mínimo da regra da postura
 * (RECRUIT_RULE, sobre os jovens disponíveis), dos jovens e das armas. Se for 0, `why` diz porquê:
 * 'postura' (não dá homens), 'jovens' (não sobram jovens para a regra), 'sem-armas', 'ocupada' (guarnição romana) ou
 * 'destruida' (queimada ou abandonada). A fama não conta.
 */
export function recruitLimit(c, arms) {
  if (c.situation === 'queimada' || c.situation === 'abandonada') return { limit: 0, byPosture: 0, avail: 0, arms, why: 'destruida' };
  if (c.situation === 'ocupada') return { limit: 0, byPosture: 0, avail: youth(c), arms, why: 'ocupada' };
  const avail = youth(c), r = RECRUIT_RULE[c.posture] ?? {};
  const byPosture = r.volunteers != null ? Math.min(r.volunteers, avail) : r.over ? (avail > 0 ? Math.max(1, Math.floor(avail / r.over)) : 0) : 0;
  const limit = Math.max(0, Math.min(byPosture, avail, arms));
  const why = limit > 0 ? null : (r.volunteers == null && !r.over) ? 'postura' : byPosture <= 0 ? 'jovens' : 'sem-armas';
  return { limit, byPosture, avail, arms, why };
}

/**
 * A aldeia dá `n` jovens ao bando: sobe `away` e custa confiança (−2 por homem acima de 1/6 dos jovens da aldeia, contando
 * os que já lá estão). Não mexe em homens nem armas do bando (isso é de quem recruta). Devolve a mudança de postura ou null.
 */
export function levy(c, n, day) {
  const free = Math.floor(youthCap(c) / LEVY_FREE), over = Math.max(0, c.away + n - Math.max(free, c.away));
  c.away += n;
  return over > 0 ? shift(c, { trust: LEVY_TRUST * over }, { key: 'jovens-levados', text: 'Levaste-nos os filhos' }, day) : null;
}

/** A comunidade que ocupa o lugar `settlementId` do mundo, se houver. */
export const communityAt = (state, settlementId) => COMMUNITY_IDS.map(id => state.communities?.[id]).find(c => c && c.settlement === settlementId);

/**
 * De onde vêm os homens do bando: { <comunidade>: homens, …, sem: homens }. `sem` são os que não vieram de nenhuma
 * aldeia (o bando com que se começa e os voluntários dos castros). Só aparecem as comunidades com homens no bando.
 */
export function bandOrigins(state) {
  const out = {};
  let sum = 0;
  for (const id of COMMUNITY_IDS) { const a = state.communities?.[id]?.away ?? 0; if (a > 0) { out[id] = a; sum += a; } }
  out.sem = Math.max(0, state.men - sum);
  return out;
}

/**
 * Tira `n` homens ao bando e atribui as baixas às origens em proporção ao que cada uma tem no bando (restos para quem
 * tem a maior fração; empate pela ordem do vale e `sem` por último): determinístico, sem sorteio.
 * Baixa `away` das comunidades e devolve só as parcelas não nulas, ex.: { souto: 2, sem: 5 }.
 * Com `grieve` (mortes em batalha) cada aldeia perde DEATH_TRUST de confiança por homem seu que morreu; a fome e o
 * traidor não contam: o GDD só prevê o luto pelos mortos em batalha.
 */
export function loseMen(state, n, { grieve = false } = {}) {
  const w = bandOrigins(state), keys = Object.keys(w).filter(k => w[k] > 0);
  const total = keys.reduce((t, k) => t + w[k], 0);
  const k = Math.min(Math.max(0, Math.floor(Number.isFinite(n) ? n : 0)), total);
  const part = keys.map(key => ({ key, base: Math.floor(k * w[key] / total), frac: (k * w[key]) % total }));
  let rest = k - part.reduce((t, p) => t + p.base, 0);
  for (const p of [...part].sort((a, b) => b.frac - a.frac)) if (rest > 0 && p.frac > 0) { p.base++; rest--; }
  const out = {};
  for (const p of part) {
    if (p.base <= 0) continue;
    out[p.key] = p.base;
    if (p.key === 'sem') continue;
    const c = state.communities[p.key];
    c.away -= p.base;
    if (grieve) shift(c, { trust: DEATH_TRUST * p.base }, { key: 'baixas', text: 'O filho de uma família da aldeia não voltou' }, state.day ?? 0);
  }
  state.men = Math.max(0, state.men - k);
  diag.loss?.push({ day: state.day ?? 0, out, grieve });
  return out;
}

/** Uma comunidade no seu estado inicial, ligada ao lugar `settlement` do mundo. */
export function makeCommunity(id, settlement) {
  const I = IDENTITY[id];
  return { id, settlement, families: I.families, away: 0, food: Math.round(I.families * START_FOOD), hungry: false,
    trust: I.trust, fear: I.fear, motives: [], situation: 'livre', until: null, due: null, posture: postureFor(I.trust - I.fear) };
}

/** Regista um motivo (os últimos MAX_MOTIVES ficam). */
export function addMotive(c, key, text, v, day) {
  c.motives.push({ key, text, v, day });
  if (c.motives.length > MAX_MOTIVES) c.motives.splice(0, c.motives.length - MAX_MOTIVES);
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
  if (Math.abs(v) >= MOTIVE_MIN) addMotive(c, motive.key, motive.text, v, day);
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
 * LIGAÇÃO PROVISÓRIA (ver o cabeçalho): a descrição abaixo é a regra de escolha, não uma garantia sobre o terreno.
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
const int0 = x => Number.isInteger(x) && x >= 0;
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const validMotive = m => isObj(m) && typeof m.key === 'string' && typeof m.text === 'string' && num(m.v) && num(m.day);

/**
 * As comunidades gravadas são utilizáveis? (deserialize recusa a gravação se não forem.)
 * Com `world` (state.world) confere também a ligação ao mundo: o lugar existe, é usado por uma só comunidade e o tipo bate
 * com a identidade (castro para o Penedo, aldeia para as outras). Sem `world` só valida a forma de cada comunidade.
 */
export function validCommunities(o, world) {
  if (!isObj(o)) return false;
  const kinds = world ? new Map(world.settlements.map(s => [s.id, s.kind])) : null;
  const used = new Set();
  return COMMUNITY_IDS.every(id => {
    const c = o[id];
    if (!(isObj(c) && c.id === id && typeof c.settlement === 'string')) return false;
    if (kinds) {
      if (!kinds.has(c.settlement) || used.has(c.settlement) || kinds.get(c.settlement) !== IDENTITY[id].kind) return false;
      used.add(c.settlement);
    }
    return int0(c.families) && int0(c.away) && c.away <= c.families && num(c.food) && c.food >= 0
      && num(c.trust) && c.trust >= 0 && c.trust <= 100 && num(c.fear) && c.fear >= 0 && c.fear <= 100
      && Array.isArray(c.motives) && c.motives.length <= MAX_MOTIVES && c.motives.every(validMotive)
      && (c.hungry === undefined || typeof c.hungry === 'boolean') && SITUATIONS.includes(c.situation) && (c.until === null || num(c.until))
      && (c.due === null || (isObj(c.due) && num(c.due.food) && c.due.food >= 0 && num(c.due.day)))
      && idx(c.posture) >= 0;
  });
}
