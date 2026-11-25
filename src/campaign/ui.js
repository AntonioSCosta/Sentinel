import { createI18n } from '../i18n/index.js';
import { mapDate, mapForceName, mapPlaceName } from '../i18n/map-text.js';
import { createCampaignMapView } from '../campaign-map-3d/campaign-view.js';
// Ecrã da campanha: liga o HUD e o mapa ao Flow.
import { makeView, drawMap, hitTest, toWorld, toScreen, agoLabel } from './map-view.js';
import { intelView, estimateMen, SCOUTS, RECON_RANGE, RECON_RADIUS } from './intel.js';
import { createFlow, loadFlow, clearSave, STORAGE_KEY, WIN_MEN, WIN_FAME } from './flow.js';
import { openTacticalArena } from './tactical-arena.js';
import { campaignDateParts, dateLabel, season, daysLeft, YEAR_DAYS } from './clock.js';
import { entryFor, CHRONICLE, SOURCE_LABELS, isUnlocked } from './chronicle.js';
import { isBridged, isStory } from './bridge.js';
import { START, foodPerDay } from './state.js';
import { MARCH_SPEED, REACH, ARRIVAL, marchDays as marchDaysTo, inReach, nearRoad } from './simulation.js';
import { TRIBUTE, PUNISH } from './rome.js';
import { placeName, communityOf, POSTURE_LABEL, SITUATION_LABEL, POSTURE_HINT, SITUATION_HINT, communityLine, chiefLine, officeLine, daysText, UI, ACTION_NO, EFFECT, DIARY, ROME_BAND } from './strings.js';
import { buildIssues, detectInterruptions, foodDays, interruptionText, LOW_FOOD_DAYS } from './issues.js';
import { dueScheduled } from './events.js';
import { SPEEDS, DAY_MS, loadSpeed, saveSpeed, standingOrder } from './pace.js';
import { categoryOf } from './journal.js';
import { youth, topMotives, IDENTITY, COMMUNITY_IDS } from './communities.js';
import { winterReserve } from './harvest.js';
import { drawLegend } from './map-view.js';

/** Relatos de Roma (doctrine.js): o que muda quando uma contramedida entra e quando sai. */
const DOCTRINE_TEXT = {
  batedores: ['Relato: as patrulhas romanas trazem agora batedores a cavalo à frente. Emboscar patrulhas deixou de resultar.', 'Relato: as patrulhas deixaram de levar batedores.'],
  escolta: ['Relato: as colunas de abastecimento saem agora com escolta reforçada.', 'Relato: as colunas voltaram à escolta habitual.'],
  forca: ['Relato: as patrulhas romanas andam agora em força.', 'Relato: as patrulhas voltaram ao número habitual.'],
  guarnicao: ['Relato: Roma guarneceu o troço da estrada onde mais atacaste.', 'Relato: a guarnição deixou a estrada.'],
  cacadores: ['Relato: Roma decidiu caçar o bando.', 'Relato: Roma deixou de te caçar, por agora.'],
};

const BAR_TOP = 52, BAR_BOTTOM = 64; // alturas das barras HTML (px) que o canvas deixa livres
const LOG_LINES = 3;
const portuguese = createI18n();
const RELIABILITY = { certa: 'visto pelos teus', boa: 'fiável', fraca: 'pouco fiável' };
const KIND_NAMES = { aldeia: 'Aldeia', castro: 'Castro', posto: 'Posto romano', serra: 'Serra' };
/** Episódios históricos: título e uma linha sóbria; o que é invenção diz-se (ver a Crónica). */
/** As linhas do painel «Objetivo»; os números e as fontes de comida/recrutas seguem as regras reais (simulation.js, battles.js). */
export function goalLines(s) {
  return [
    `Objetivo: aguentar um ano de guerra (${YEAR_DAYS} dias) contra Roma.`,
    `Vitória: derrotar o pretor romano na batalha decisiva, ou chegar ao fim do ano com ${WIN_MEN}+ homens e ${WIN_FAME}+ de fama.`,
    `Derrota: ficar sem homens ou sem fama, ou acabar o ano abaixo desses mínimos.`,
    `Homens: o teu bando; comem ${foodPerDay(s.men)} de comida por dia e, sem comida, morrem. Comida: pede ajuda nos castros e obtém mantimentos como saque nas vitórias em combate. Armas: vêm do saque e gastam-se a recrutar nas aldeias. Fama: sobe com vitórias, desce com derrotas e recuos. Recrutas: cada aldeia dá o que a confiança permite, enquanto tiver jovens e tu armas.`,
    'Primeiros dias: clica numa das cinco aldeias do vale para ver o que pode dar: recruta numa aldeia, pede ajuda (comida) num castro, manda batedores (Reconhecer) e lê os Relatos no Diário antes de aceitar combate.',
  ];
}

export const EPISODES = Object.fromEntries(['cativos', 'acampamento'].map(chapter => [chapter,
  ['title', 'brief'].map(field => portuguese.t(`map.issuesCopy.episode.${chapter}.${field}`))]));
/** Estado de um lugar, para o painel e a lista: «queimada», «tomado», «já atacado» ou nada. */
function placeState(s, state) {
  if (s.kind === 'aldeia' && state.villages?.[s.id]?.burnt) return 'queimada';
  if (s.kind === 'posto' && state.posts && s.id in state.posts) return state.posts[s.id].taken ? 'tomado' : 'já atacado';
  return '';
}
/** «Aldeia do Vale — aldeia, 3 dias»: dias de marcha do bando até lá. */
export function placeLabel(s, state) {
  const days = inReach(state.party, s) ? 0 : marchDaysTo(state.world, state.party, s);
  const st = placeState(s, state);
  return `${placeName(state, s.id)} — ${s.kind}${st ? ' ' + st : ''}, ${days ? `${days} ${days === 1 ? 'dia' : 'dias'}` : 'aqui'}`;
}

const KEEP_DAY = 'O dia não passa.';
const days = n => `${n} ${n === 1 ? 'dia' : 'dias'}`;
/** Porque é que uma ordem foi recusada (simulation.applyOrder). */
const INVALID = {
  longe: place => `${place ?? 'Esse lugar'} fica longe: marcha até lá primeiro.`,
  queimada: place => `${place ?? 'A aldeia'} foi queimada: já não há quem recrute.`,
  destino: () => 'A marcha não tem destino válido.',
  desconhecido: () => 'Essa ordem não se pode dar aqui.',
};

const UM = { patrulha: 'uma patrulha', comboio: 'um comboio', cacadores: 'uma coluna de caçadores', pretor: 'o exército do pretor' };
const FORCE_NAMES = { patrulha: 'Patrulha romana', comboio: 'Comboio romano', cacadores: 'Caçadores romanos' };
const um = kind => UM[kind] || 'uma força romana';
/** «de» com o artigo contraído: «do exército», «de uma patrulha». */
const de = t => (t.startsWith('o ') ? `do ${t.slice(2)}` : t.startsWith('a ') ? `da ${t.slice(2)}` : `de ${t}`);
const list = xs => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} e ${xs.at(-1)}` : xs[0] || '');
/** Uma estimativa de efetivos: «6 homens», «uns 15 homens» (estimateMen já arredondou). */
const menText = n => (n > 7 ? `uns ${n} homens` : `${n} ${n === 1 ? 'homem' : 'homens'}`);
/** «a menos de um dia de marcha», «a cerca de 2 dias». */
const farText = d => (d <= MARCH_SPEED ? 'a menos de um dia de marcha' : `a cerca de ${days(Math.round(d / MARCH_SPEED))} de marcha`);

/** Um relato por extenso: quem o traz, o que viu e com que certeza. Nunca diz mais do que o relato sabe. */
export function reportText(r, state) {
  const place = id => placeName(state, id);
  const nearest = () => placeName(state, state.world.settlements.reduce((a, b) => (Math.hypot(b.x - r.x, b.y - r.y) < Math.hypot(a.x - r.x, a.y - r.y) ? b : a)).id);
  switch (r.src) {
    case 'aldeia': return `Relato de ${place(r.place) ?? 'uma aldeia'}: viram ${um(r.kind)} por perto${r.men ? `, ${menText(r.men)}` : ''}${r.dir ? `, a seguir para ${r.dir}` : ''}.`;
    case 'rumor': return `Rumor: fala-se ${de(um(r.kind))} para os lados de ${nearest()}. Nada de certo.`;
    case 'fumo': return `Fumo sobre ${place(r.place) ?? 'uma aldeia'}: o pretor esteve lá.`;
    case 'inicio': return `Sabe-se que ${r.name || 'o pretor'} junta o exército em ${nearest()}.`;
    case 'batedores': return r.found?.length
      ? `Batedores: ${list(r.found.map((k, i) => `${um(k)}${r.sizes?.[i] ? ` (${menText(r.sizes[i])})` : ''}${r.dirs?.[i] ? ` a seguir para ${r.dirs[i]}` : ''}`))} na zona de ${nearest()}.`
      : `Batedores: a zona de ${nearest()} parece livre.`;
    default: return 'Relato sem origem certa.';
  }
}

const WAIT_TEXT = {
  estrada: 'Esperas na estrada: ninguém passou.',
  longe: 'Esperas longe da estrada: daqui não se embosca ninguém.',
  esconder: 'O bando fica escondido; ninguém deu por vós.',
};
/** A linha do diário de um dia de espera: o que se vê (só o que o jogador sabe), o risco e a comida gasta. */
function waitText(ev, state, dayEvents) {
  const fresh = new Set(dayEvents.filter(e => e.type === 'avistamento').map(e => e.id));   // já têm a sua linha
  const v = intelView(state), p = state.party;
  const seen = v.forces.filter(f => f.status === 'confirmada' && !fresh.has(f.id));
  const near = v.forces.find(f => f.kind === 'pretor' && f.status === 'estimada' && Math.hypot(f.x - p.x, f.y - p.y) <= 2 * MARCH_SPEED);
  return [WAIT_TEXT[ev.order === 'esconder' ? 'esconder' : ev.road ? 'estrada' : 'longe'],
    seen.length ? `À vista: ${list(seen.map(f => `${um(f.kind)}${f.dir ? ` (para ${f.dir})` : ''}`))}.` : '',
    near ? `O pretor foi visto ${agoLabel(near.age)} a menos de dois dias daqui.` : '',
    ev.food > 0 ? `Comida: −${ev.food}.` : ''].filter(Boolean).join(' ');
}

/** Porque é que uma aldeia não dá homens (evento `recrutar-recusado`). */
const RECRUIT_NO = {
  postura: 'não confiam em ti o bastante para te darem homens',
  jovens: 'já não há jovens para dar ao bando',
  'sem-comunidade': 'é uma aldeia pequena, fora do vale: não tem quem dar ao bando',
  ocupada: 'tem guarnição romana e não pode dar homens às claras',
  destruida: 'já não tem quem dar ao bando',
};

const CASTIGO_WHY = { tributo: 'não pagou o tributo', apoio: 'viu-a ajudar-te', suspeita: 'desconfia dela' };
const ATENCAO_TEXT = { rotina: 'volta à rotina', vigilancia: 'passa a vigiar o vale: mais patrulhas e escoltas maiores', castigo: 'vai castigar quem te ajuda', pretor: 'o pretor vai entrar no vale com a coluna' };

/** Uma frase curta (pt-PT) por evento devolvido por flow.order()/finishBattle(); `dayEvents` são os outros eventos do mesmo dia. */
export function eventText(ev, state, dayEvents = []) {
  const name = id => placeName(state, id) ?? 'o povoado';
  switch (ev.type) {
    case 'recrutou': return ev.men ? `${name(ev.id)}: ${ev.men} homens juntam-se a ti.` : `${name(ev.id)}: ninguém tem armas para dar.`;
    case 'recrutar-recusado': return `${name(ev.id)}: ${RECRUIT_NO[ev.why] ?? 'não dão homens ao bando'}. ${KEEP_DAY}`;
    case 'sem-armas': return `Não tens armas para equipar recrutas. ${KEEP_DAY}`;
    case 'posto-atacado': return `${name(ev.id)}: este posto já foi atacado, e só se ataca uma vez. ${KEEP_DAY}`;
    case 'ajuda': return `${name(ev.id)} dá-te ${ev.food} de comida${ev.men ? ` e ${ev.men} homens` : ''}.`;
    case 'ajuda-recusada': return `${name(ev.id)}: ainda não podem dar mais ajuda${ev.days ? `; volta daqui a ${days(ev.days)}` : ''}. ${KEEP_DAY}`;
    case 'colheita': return `Fim da ${ev.season}: a colheita enche as reservas do vale (+${ev.total}).`;
    case 'aldeia-fome': return `${name(ev.id)}: as reservas não chegam ao inverno. Com fome, ${ev.to === ev.from ? `continua ${ev.to}` : `passa a ${ev.to}`}: quem lhe der de comer ganha-a.`;
    case 'aldeia-fome-fim': return `${name(ev.id)}: já tem comida para o inverno e volta a sentir-se ${ev.to}.`;
    case 'fome': return `Fome no bando: morrem ${ev.mortos}.`;
    case 'derrota': return ev.lost !== undefined ? `Derrota: perdes ${ev.lost} homens.` : 'O bando está arruinado.';
    case 'vitoria': return `Vitória: perdes ${ev.lost}, ganhas ${ev.food} de comida, ${ev.arms} armas e ${ev.fame} de fama.`;
    case 'retirada': if (ev.withdrew) return `Recusas o combate e recuas para ${name(ev.serraId)}; ${ev.lost ? `a retaguarda perde ${ev.lost} ${ev.lost === 1 ? 'homem' : 'homens'}` : 'a retaguarda escapa inteira'}.`;
      return ev.serraId ? `O bando recua para ${name(ev.serraId)}; perdes ${ev.lost} homens.` : `Recuas, perdendo ${ev.lost} homens.`;
    case 'espera': return waitText(ev, state, dayEvents);
    case 'avistamento': {
      const who = ev.kind === 'pretor' ? `o exército de ${ev.name || 'o pretor'}` : um(ev.kind);
      return `Avistas ${who} a ${ev.bearing}, ${farText(ev.far)}${ev.men ? `: ${menText(ev.men)}` : ''}${ev.dir ? `, a seguir para ${ev.dir}` : ''}.`;
    }
    case 'fuga': return `A coluna escapou-se com a carga${ev.lost ? `; perdes ${ev.lost} homens` : ''}.`;
    case 'ano-vencido': return 'O exército do pretor foi desfeito.';
    case 'ruina': return 'O bando desfez-se.';
    case 'aldeia-queimada': return `${name(ev.id)} foi queimada pelos romanos.`;
    case 'postura': return `${name(ev.id)} está agora ${POSTURE_LABEL[ev.to]?.toLowerCase() ?? ev.to} (era ${POSTURE_LABEL[ev.from]?.toLowerCase() ?? ev.from}).`;
    case 'tributo-recusado': return `Recusaste o tributo de ${name(ev.id)}.`;
    case 'tributo-exigido': return `Roma exige tributo a ${name(ev.id)}: ${ev.food} de comida em ${TRIBUTE.days} dias.`;
    case 'tributo-sem-comida': return `${name(ev.id)}: não há comida para pagar o tributo (${ev.food} devidos, ${ev.have} nas reservas). Não se paga em parte e o prazo continua. ${KEEP_DAY}`;
    case 'tributo-pago': return ev.auto ? `${name(ev.id)} paga o tributo a Roma (${ev.food} de comida).` : `${name(ev.id)} entrega o tributo a Roma por tua ordem (−${ev.food} de comida).`;
    case 'castigo': return `Roma castigou ${name(ev.id)}: ${CASTIGO_WHY[ev.why] ?? 'desconfia dela'}. Mais medo e metade da produção durante ${PUNISH.days} dias.`;
    case 'castigo-fim': return `${name(ev.id)} refez-se do castigo de Roma.`;
    case 'ocupada': return `Roma pôs guarnição em ${name(ev.id)}: não dá homens e o medo cresce todos os dias.`;
    case 'ocupada-fim': return `A guarnição de ${name(ev.id)} foi expulsa.`;
    case 'comunidade-queimada': return `${name(ev.id)} foi queimada: ${ev.lost} famílias perdem-se${ev.to ? `; as outras refugiam-se em ${name(ev.to)}` : ''}.`;
    case 'comunidade-abandonada': return `${name(ev.id)} ficou deserta${ev.to ? `: as famílias foram para ${name(ev.to)}` : ''}.`;
    case 'denuncia': return `${name(ev.id)} denunciou o teu bando a Roma, que sabe agora onde estás.`;
    case 'roma-atencao': return `Roma presta-te mais atenção: ${ATENCAO_TEXT[ev.to] ?? ''}.`;
    case 'acontecimento': return ev.text;
    case 'doutrina': return DOCTRINE_TEXT[ev.id]?.[ev.on ? 0 : 1] || '';
    case 'emboscada-descoberta': return ev.why === 'guarnicao' ? 'A guarnição da estrada descobriu a emboscada: a luta é em campo aberto.' : 'Os batedores romanos descobriram a emboscada: a luta é em campo aberto.';
    case 'cacadores': return `Uma coluna de caçadores (${ev.men} homens) saiu do posto atrás do sítio onde foste visto.`;
    case 'relato': { const r = (state.intel?.reports || []).find(x => x.id === ev.id); return r ? reportText(r, state) : null; }
    case 'reconhecimento': return ev.found.length ? `Os batedores voltam: viram ${list(ev.found.map(um))}.` : 'Os batedores voltam: a zona parece livre.';
    case 'reconhecer-recusado': return `${ev.why === 'homens' ? `Precisas de pelo menos ${SCOUTS + 1} homens para mandar ${SCOUTS} batedores.` : 'É longe de mais para os batedores irem e voltarem num dia.'} ${KEEP_DAY}`;
    case 'ordem-invalida': {
      const why = ev.why === 'destino' && ev.order === 'reconhecer'
        ? 'O reconhecimento não tem destino válido.'
        : INVALID[ev.why]?.(ev.id === undefined ? null : name(ev.id));
      return `${why ?? 'Não podes fazer isso daqui: aproxima-te primeiro.'} ${KEEP_DAY}`;
    }
    default: return null;
  }
}

/**
 * O texto do painel de batalha: quem é a força, quantos são, porque se luta e o que está em jogo.
 * Só usa a especificação da batalha (o inimigo está à frente do bando: os números são os que se veem).
 */
export function battleBrief(b, state, i18n = portuguese) {
  const t = (key, params) => i18n.t(`map.issuesCopy.${key}`, params);
  const name = id => mapPlaceName(i18n, placeName(state, id), state.world.settlements.find(p => p.id === id)?.kind);
  const mine = b.allies + (b.bonus?.allies || 0), theirs = b.enemies.legio + b.enemies.velites + (b.bonus?.enemies || 0) + (b.enemies.centurion && !b.commander ? 1 : 0);
  const chief = b.commander || state.praetor?.name || i18n.t('map.praetorTitle');
  const who = b.foeKind === 'pretor' ? t('battlePraetor', { chief })
    : b.foeKind === 'posto' ? t('battlePost') : b.foeKind === 'patrulha' ? t('battlePatrol') : mapForceName(i18n, { kind: b.foeKind });
  const context = ['emboscada', 'descoberta', 'fora-estrada', 'encontro', 'cacadores', 'ataque'].includes(b.context) ? t(`battleContext.${b.context}`) : '';
  const why = b.type === 'defesa-aldeia' ? t('battleDefend', { who, name: name(b.villageId) ?? t('battleVillage') })
    : b.type === 'decisiva' ? t('battleDecisive', { chief })
    : b.type === 'assalto-coluna' ? t('battleConvoy') : [t('battleForce', { who }), context].filter(Boolean).join(' ');
  const out = b.withdraw?.possible
    ? [t('battleRetreat', { place: name(b.withdraw.serraId) ?? t('battleHills') }),
      b.withdraw.lost ? t('battleRetreatLoss', { men: i18n.t('map.forceMen', { count: b.withdraw.lost }) }) : '',
      b.type === 'defesa-aldeia' ? t('battleRetreatVillage') : ''].filter(Boolean).join(' ')
    : b.withdraw?.why === 'sem-serra' ? t('battleNoRetreat') : '';
  return [why, t('battleNumbers', { allies: mine, enemies: theirs }),
    b.bonus?.allies > 0 ? t('battleAllyReserve', { men: b.realMen }) : '',
    b.bonus?.enemies > 0 ? t('battleEnemyReserve') : '', out].filter(Boolean).join(' ');
}

/**
 * @param {{document, window, storage, onClose?: () => void, startBattle?: (spec) => boolean}} o
 * `startBattle(spec)` arranca a batalha 3D (emboscada, campo aberto) e devolve true se o fez; o ecrã do mapa fica
 * suspenso até o jogo chamar `battleDone(result, line)`.
 */
/**
 * @param {{document, window, storage, onClose?: () => void, startBattle?: (spec) => boolean}} o
 * `startBattle(spec)` arranca a batalha 3D (emboscada, campo aberto) e devolve true se o fez; o ecrã do mapa fica
 * suspenso até o jogo chamar `battleDone(result, line)`.
 *
 * O ecrã do vale (PR 5): barra de cima (data, tempo, bando), o mapa, a coluna de assuntos à direita (que dá lugar ao
 * painel da povoação escolhida) e a barra de baixo (Ir, Emboscar, Esconder, Reconhecer, Diário). O tempo corre por
 * dias inteiros da simulação (flow.order); a interface só escolhe quando dar o passo seguinte. Nada aqui decide regras:
 * o que uma ação daria vem de flow.preview / flow.previewTribute, os assuntos de issues.js.
 */
export function createCampaignUI({ document: doc, window: win, storage, onClose = () => {}, startBattle = () => false, legacyMapForTests = false, i18n = createI18n() }) {
  const $ = id => doc.getElementById(id);
  const el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = text; return e; };
  let flow = null, view = null, active = false, selected = null, logDirty = true;
  let tacticalArena = null, tacticalNotice = null;
  let anim = null, shown = null, facing = 1, walk = 0, rafId = 0, hover = null, paintPending = false;
  let mode = null, reconClick = null, focus = null;   // mode: null | 'ir' | 'reconhecer'
  let dest = null, stance = null;                     // a ordem permanente do bando quando o tempo corre
  let speed = loadSpeed(storage), running = false, timer = 0;
  let memory = {}, interrupt = [], dismissed = new Set(), flash = {}, flashT = 0, logTimer = 0;
  const LOG_MS = 9000;
  const trail = [];
  const log = [];
  const now = () => (win.performance && win.performance.now ? win.performance.now() : Date.now());
  const reduceMotion = () => !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const ctx2d = () => $('mapcv').getContext('2d');
  const stage = $('campaign-map-3d');
  let showMapDetails = false, communitiesKey = '';
  stage.classList.toggle('hidden', legacyMapForTests);
  $('mapcv').classList.toggle('hidden', !legacyMapForTests);
  const map3d = legacyMapForTests ? null : createCampaignMapView(stage, {
    window: win, i18n,
    onPick: (hit, event) => mapAction(hit, pointAt(hit), event),
    onHover: hit => updateHover(hit, pointAt(hit)),
    onError: () => { pause(); },
  });
  const name = id => placeName(flow.state, id) ?? '';
  const displayName = id => mapPlaceName(i18n, name(id), settlement(id)?.kind);
  const mapActions = new Set(['ir', 'reconhecer', 'recrutar', 'pedir-ajuda', 'atacar']);
  const placeDescription = (place, community) => community ? tMap(`community.${community.id}`)
    : KIND_NAMES[place.kind] ? tMap(`kind.${place.kind}`) : place.kind;
  const tMap = (key, params) => i18n.t(`map.${key}`, params);
  const tIssue = (key, params) => tMap(`issuesCopy.${key}`, params);
  const eventMessage = (ev, events) => ev.type === 'emboscada-tatica'
    ? tMap(`tactical.outcome.${ev.outcome}`, ev) : eventText(ev, flow.state, events);
  const duration = count => tMap('days', { count });
  const settlement = id => flow.state.world.settlements.find(x => x.id === id);
  const communityAt = id => { const k = communityOf(flow.state, id); return k ? flow.state.communities[k] : null; };
  /** Dias até estar no lugar: 0 se já se pode agir nele (REACH); senão os dias reais da marcha (simulation.marchDays). */
  const marchDays = p => (inReach(flow.state.party, p) ? 0 : marchDaysTo(flow.state.world, flow.state.party, p));
  const narrow = () => (win.innerWidth || 1200) <= 900 || (win.innerHeight || 800) <= 480;

  function resize() {
    if (map3d) return;
    const cv = $('mapcv'), dpr = win.devicePixelRatio || 1;
    const r = cv.getBoundingClientRect();
    const w = Math.round(r.width || win.innerWidth || 800), h = Math.round(r.height || (win.innerHeight || 600) - 104);
    cv.width = Math.max(1, Math.round(w * dpr)); cv.height = Math.max(1, Math.round(h * dpr));
    view = makeView(flow.state.world, w, h);
    return dpr;
  }

  // --- o mapa ---
  function issueMarks() {
    const out = {};
    for (const i of currentIssues()) if (i.place && (i.kind === 'decisao' || !out[i.place])) out[i.place] = i.kind;
    return out;
  }
  function route() {
    if (!dest) return null;
    const days = marchDays(dest), food = days * foodPerDay(flow.state.men);
    return { to: dest, label: tMap('route', { duration: duration(days), food }) };
  }
  function paint() {
    if (!active || !flow) return;
    const scouting = mode === 'reconhecer' && flow.phase === 'mapa' ? { range: RECON_RANGE, radius: RECON_RADIUS, ok: !!hover && inRecon(hover) } : null;
    const fl = {}, t = now();
    for (const [id, t0] of Object.entries(flash)) { const k = 1 - (t - t0) / 1600; if (k > 0) fl[id] = k; else delete flash[id]; }
    const fx = { party: shown || flow.state.party, logicalParty: flow.state.party, facing, step: walk, selected, hover, trail, reach: REACH,
      focus, recon: scouting, issues: issueMarks(), flash: fl, route: route(), showMapDetails };
    if (map3d) {
      if (flow.phase === 'mapa' || flow.tactical) map3d.paint(flow.state, fx);
      else map3d.suspend();
      return;
    }
    const ctx = view && ctx2d();
    if (!ctx) return;
    const dpr = win.devicePixelRatio || 1;
    ctx.setTransform?.(dpr, 0, 0, dpr, 0, 0);
    drawMap(ctx, view, flow.state, fx);
    if (Object.keys(fl).length && !flashT && typeof win.requestAnimationFrame === 'function' && !reduceMotion()) flashT = win.requestAnimationFrame(() => { flashT = 0; paint(); });
  }
  /** Redesenha no máximo uma vez por frame (o rato pode disparar dezenas de eventos por segundo). */
  function schedulePaint() {
    if (paintPending) return;
    if (typeof win.requestAnimationFrame !== 'function') { paint(); return; }
    paintPending = true;
    win.requestAnimationFrame(() => { paintPending = false; paint(); });
  }
  /** Segue a party: quando o estado salta (um dia de marcha, uma retirada), mostra a marcha em vez do salto. */
  function syncParty() {
    const p = flow.state.party;
    if (!shown) { shown = { x: p.x, y: p.y }; return; }
    const d = Math.hypot(p.x - shown.x, p.y - shown.y);
    if (d < 0.5) { shown.x = p.x; shown.y = p.y; return; }
    if (anim && Math.hypot(anim.to.x - p.x, anim.to.y - p.y) < 0.5) return;
    startMarch(p, d);
  }
  function startMarch(to, d) {
    const from = { x: shown.x, y: shown.y };
    facing = to.x >= from.x ? 1 : -1;
    trail.push(from);
    if (trail.length > 6) trail.shift();
    if (reduceMotion() || typeof win.requestAnimationFrame !== 'function') { shown = { x: to.x, y: to.y }; return; }
    const dur = Math.max(120, Math.min(running ? DAY_MS / speed * 0.9 : 900, (d / MARCH_SPEED) * 300));
    anim = { from, to: { x: to.x, y: to.y }, t0: now(), dur };
    if (rafId) win.cancelAnimationFrame?.(rafId);
    rafId = win.requestAnimationFrame(frame);
  }
  function frame() {
    rafId = 0;
    if (!active || !anim) { anim = null; return; }
    const t = Math.min(1, (now() - anim.t0) / anim.dur);
    const e = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
    shown = { x: anim.from.x + (anim.to.x - anim.from.x) * e, y: anim.from.y + (anim.to.y - anim.from.y) * e };
    walk = t * Math.PI * 5;
    if (map3d) map3d.pose({ party: shown }); else paint();
    if (t < 1) { rafId = win.requestAnimationFrame(frame); return; }
    shown = { x: anim.to.x, y: anim.to.y }; anim = null; walk = 0;
    if (map3d) map3d.pose({ party: shown }); else paint();
  }
  function stopMarch() { if (rafId) win.cancelAnimationFrame?.(rafId); rafId = 0; anim = null; walk = 0; }

  // --- barra de cima ---
  function renderTop() {
    const s = flow.state;
    $('m-date').textContent = mapDate(i18n, campaignDateParts(s.day));
    $('m-season').textContent = tMap(`season.${season(s.day)}`);
    $('m-left').textContent = tMap('remaining', { duration: duration(daysLeft(s.day)) });
    $('m-men').textContent = i18n.number(s.men); $('m-arms').textContent = i18n.number(s.arms);
    $('m-fame').textContent = tMap('fameProgress', { fame: s.fame, target: WIN_FAME });
    $('m-fame-box').title = tMap('fameGoal', { men: WIN_MEN, fame: WIN_FAME });
    const fd = foodDays(s);
    $('m-food').textContent = duration(fd);
    $('m-food-raw').textContent = `(${i18n.number(s.food)})`;
    $('m-food-box').title = tMap('foodTip', { food: s.food, daily: foodPerDay(s.men) });
    $('m-food-box').classList.toggle('low', fd < LOW_FOOD_DAYS);
    $('m-pause').setAttribute('aria-pressed', running ? 'false' : 'true');
    for (const b of $('m-time').querySelectorAll('[data-speed]')) b.setAttribute('aria-pressed', running && Number(b.dataset.speed) === speed ? 'true' : 'false');
    $('m-time').dataset.state = running ? 'run' : 'pause';
    const n = currentIssues().filter(i => i.kind === 'decisao').length;
    $('m-side-toggle').textContent = n ? tMap('countIssues', { name: tMap('issues'), count: n }) : tMap('issues');
  }

  function renderMapAccess() {
    const names = COMMUNITY_IDS.flatMap(id => {
      const place = flow.state.communities[id]?.settlement;
      return place ? [[place, displayName(place)]] : [];
    });
    const placeholder = tMap('communitiesSelect');
    const key = JSON.stringify([placeholder, names]);
    if (key === communitiesKey) return;
    communitiesKey = key;
    const options = [['', placeholder], ...names].map(([value, title]) => {
      const option = el('option', null, title);
      option.value = value;
      return option;
    });
    $('m-community').replaceChildren(...options);
  }

  // --- barra de baixo: ordem permanente do bando ---
  function renderStatus() {
    $('m-go').setAttribute('aria-pressed', mode === 'ir' || !!dest ? 'true' : 'false');
    $('m-ambush').setAttribute('aria-pressed', stance === 'esperar' ? 'true' : 'false');
    $('m-hide').setAttribute('aria-pressed', stance === 'esconder' ? 'true' : 'false');
    $('m-recon').setAttribute('aria-pressed', mode === 'reconhecer' ? 'true' : 'false');
    let message = tMap('idle');
    if (mode === 'ir') message = tMap('goPick');
    else if (mode === 'reconhecer') message = tMap('reconMode', { scouts: SCOUTS });
    else if (dest) {
      const days = marchDays(dest);
      message = tMap('going', { name: destName(), duration: duration(days), food: days * foodPerDay(flow.state.men) });
    } else if (stance === 'esperar') message = tMap(nearRoadNow() ? 'waiting' : 'waitingFar');
    else if (stance === 'esconder') message = tMap('hiding');
    $('m-status').textContent = message;
  }
  const destName = (point = dest) => {
    const place = flow.state.world.settlements.find(x => Math.hypot(x.x - point.x, x.y - point.y) < 1);
    return place ? displayName(place.id) : tMap('markedPoint');
  };
  const nearRoadNow = () => nearRoad(flow.state.world, flow.state.party);

  function setDest(p) { dest = p ? { x: p.x, y: p.y } : null; if (dest) stance = null; mode = null; if (dest) play(); else render(); }
  function setStance(st) { stance = stance === st ? null : st; if (stance) dest = null; mode = null; if (stance) play(); else render(); }
  function setMode(m) { mode = mode === m ? null : m; if (mode) pause(); render(); }

  // --- tempo ---
  function play(n) {
    if (!active || !flow || flow.phase !== 'mapa' || decisionOverlay || map3d?.failed) { render(); return; }
    if (n) { speed = n; saveSpeed(storage, n); }
    interrupt = []; tributeNotice = null; running = true; schedule(); render();
  }
  // O tempo não corre com o separador escondido (ninguém está a ver): pára, e fica parado ao voltar (a velocidade guarda-se).
  // Um só ouvinte, registado quando a interface é criada.
  doc.addEventListener('visibilitychange', () => { if (doc.hidden && running) pause(); });
  function pause() { running = false; if (timer) win.clearTimeout?.(timer); timer = 0; if (active && flow) render(); }
  function schedule() { if (timer) win.clearTimeout?.(timer); timer = running ? win.setTimeout?.(tick, DAY_MS / speed) ?? 0 : 0; }
  /** Um dia com o tempo a correr: a ordem permanente do bando, e pára se houver motivo (issues.detectInterruptions). */
  function tick() {
    timer = 0;
    if (!running || !active || !flow || flow.phase !== 'mapa') { running = false; render(); return; }
    step(standingOrder({ dest, stance }));
    if (running) schedule();
  }
  /** Dá um dia com a ordem `o` e trata do que veio: chegada, interrupções, batalha. Devolve o resultado do fluxo. */
  function step(o) {
    const r = order(o);
    if (!r) return r;
    if (dest && !r.refused && Math.hypot(flow.state.party.x - dest.x, flow.state.party.y - dest.y) < ARRIVAL) { const arrived = dest; log.push(() => tMap('arrived', { name: destName(arrived) })); logDirty = true; dest = null; }
    if (r.refused && o.kind === 'marchar') dest = null;
    const reasons = r.refused ? [] : detectInterruptions({ state: flow.state, events: r.events, memory, battle: r.battle });
    if (reasons.length || flow.phase !== 'mapa') { interrupt = reasons.filter(x => x.type !== 'batalha'); tributeNotice = null; running = false; if (timer) win.clearTimeout?.(timer); timer = 0; }
    else if (running) schedule();   // uma ordem dada a meio de um dia reinicia o relógio: o dia seguinte vem um dia inteiro depois, não o que faltava
    render();
    return r;
  }

  // --- registo curto (confirmações) ---
  let lastSaid = null, repeat = 1;
  function say(events) {
    for (const ev of events || []) {
      const t = eventMessage(ev, events);
      if (!t) continue;
      if (ev.id && ['postura', 'castigo', 'ocupada', 'comunidade-queimada', 'comunidade-abandonada', 'tributo-pago', 'castigo-fim', 'ocupada-fim'].includes(ev.type)) flash[ev.id] = now();
      // The state strip or decision panel presents these events. The journal retains every event.
      if (['postura', 'colheita', 'tributo-exigido', 'tributo-pago', 'tributo-recusado'].includes(ev.type)) continue;
      if (t === lastSaid && log.length) { repeat += 1; log[log.length - 1] = `${t} (${repeat}.º dia)`; }
      else { lastSaid = t; repeat = 1; log.push(ev.type === 'emboscada-tatica' ? () => eventMessage(ev) : t); }
      logDirty = true;
    }
    if (log.length > 40) log.splice(0, log.length - 40);
  }

  /** Executa uma ordem da simulação (um dia). Mantém a povoação escolhida: o painel atualiza-se. */
  function order(o) {
    if (!flow || flow.phase !== 'mapa') return null;
    if (o.kind !== 'reconhecer' && mode === 'reconhecer') mode = null;
    const r = flow.order(o);
    say(r.events);
    hover = null; focus = null;
    render();
    return r;
  }

  // --- coluna de assuntos ---
  let issuesCache = null, issuesKey = '';
  function currentIssues() {
    const k = `${i18n.locale}:${flow.state.day}:${flow.journal.length}:${dismissed.size}:${flow.state.food}:${flow.state.men}:${JSON.stringify(flow.state.intel?.known ?? {}).length}:${flow.state.party.x}:${flow.state.party.y}:${COMMUNITY_KEYS()}`;
    if (k !== issuesKey) { issuesKey = k; issuesCache = buildIssues(flow.state, flow.journal, { dismissed, i18n }); }
    return issuesCache;
  }
  const COMMUNITY_KEYS = () => Object.values(flow.state.communities).map(c => `${c.situation}${c.due?.day ?? ''}${c.food}`).join('|');
  function sideOpen() { return !$('mside').classList.contains('closed'); }
  function setSide(on) {
    $('mside').classList.toggle('closed', !on);
    $('m-side-toggle').setAttribute('aria-expanded', on ? 'true' : 'false');
    if (map3d) schedulePaint();
  }
  function renderIssues() {
    const box = $('missues'), list = $('missues-list'), panel = !!(selected && flow.phase === 'mapa');
    box.classList.toggle('hidden', panel);
    const covered = i => interrupt.some(x => {
      if (x.type !== i.type) return false;
      if (x.type === 'comida') return true;
      if (!i.event || i.day < flow.state.day - 1) return false;
      if (x.type === 'postura') return x.place === i.place && x.event.from === i.event.from && x.event.to === i.event.to;
      return x.type === 'colheita' && x.event.season === i.event.season && x.event.total === i.event.total;
    });
    const items = currentIssues().filter(i => !covered(i));
    const key = `${issuesKey}:${items.map(i => i.key).join('|')}`;
    if (list.dataset.key === key) return;
    list.dataset.key = key;
    const keep = list.contains(doc.activeElement) ? doc.activeElement.dataset.issue : null;
    list.textContent = '';
    if (!items.length) { list.append(el('li', 'none', tMap('noIssues'))); return; }
    for (const i of items) list.append(issueCard(i));
    if (keep) list.querySelector(`[data-issue="${CSS_ESC(keep)}"]`)?.focus?.();
  }
  const CSS_ESC = s => String(s).replace(/["\\]/g, '\\$&');
  function issueCard(i) {
    const li = el('li', `issue ${i.kind} t-${i.type}`);
    li.dataset.type = i.type;
    const head = el('button', 'head'); head.type = 'button'; head.dataset.issue = i.key;
    head.append(el('span', 'tag', tIssue(i.kind === 'decisao' ? 'decision' : 'attention')), el('span', 'title', i.title));
    head.addEventListener('click', () => locate(i));
    li.append(head);
    const meta = [];
    if (i.place && i.kind !== 'decisao') meta.push(displayName(i.place));
    if (i.deadline != null) meta.push(tIssue('deadline', { duration: duration(i.deadline) }));
    if (i.day !== undefined && i.day !== flow.state.day) meta.push(tIssue('ago', { duration: duration(flow.state.day - i.day) }));
    if (meta.length) li.append(el('p', 'meta', meta.join(' · ')));
    const acts = el('div', 'acts');
    if (i.kind === 'decisao') acts.append(reviewButton(i));
    else if (i.consequence) li.append(el('p', 'cons', i.consequence));
    for (const a of i.kind === 'decisao' ? [] : i.actions) {
      const b = el('button', '', a.label); b.type = 'button'; b.dataset.act = a.id;
      b.addEventListener('click', () => issueAction(i, a.id));
      acts.append(b);
    }
    if (i.key.startsWith('j:')) { const x = el('button', 'dismiss', '×'); x.type = 'button'; x.setAttribute('aria-label', tIssue('dismiss', { title: i.title })); x.addEventListener('click', () => { dismissed.add(i.key); render(); }); acts.append(x); }
    if (acts.children.length) li.append(acts);
    return li;
  }
  function locate(i) {
    if (i.place) { pick(i.place); return; }
    if (i.at) { focus = { x: i.at.x, y: i.at.y, r: 0 }; schedulePaint(); }
  }
  function issueAction(i, id) {
    if (!active || flow.phase !== 'mapa' || decisionOverlay) return;
    if (id === 'emboscar') { setStance('esperar'); return; }
    if (id === 'castro') {
      const castros = flow.state.world.settlements.filter(s => s.kind === 'castro');
      const p = flow.state.party, best = castros.reduce((a, b) => (Math.hypot(b.x - p.x, b.y - p.y) < Math.hypot(a.x - p.x, a.y - p.y) ? b : a), castros[0]);
      if (best) pick(best.id);
      return;
    }
    locate(i);
  }

  // The map owns presentation state only. Pending tribute and chapters remain in the campaign flow.
  let tributeKey = null, tributeNotice = null, tributeContent = '', stripContent = '';
  let decisionOverlay = null, decisionOpener = null;
  const deferredTributes = new Set();
  const pendingTributes = () => currentIssues().filter(i => i.kind === 'decisao');
  const nextTribute = () => pendingTributes().find(i => !deferredTributes.has(i.key));

  function reviewButton(issue) {
    const button = el('button', '', tIssue('review'));
    button.type = 'button'; button.dataset.act = 'ver-decisao'; button.setAttribute('aria-haspopup', 'dialog');
    button.addEventListener('click', () => openTribute(issue.key));
    return button;
  }
  function openTribute(key) {
    if (!active || flow.phase !== 'mapa' || decisionOverlay || !pendingTributes().some(i => i.key === key)) return;
    tributeKey = key; render();
  }
  function deferTribute() {
    if (decisionOverlay !== $('mtribute')) return;
    deferredTributes.add(tributeKey);
    tributeKey = null; render();
  }
  function applyTribute(key, action) {
    if (!active || flow.phase !== 'mapa' || decisionOverlay !== $('mtribute') || tributeKey !== key) return;
    const issue = pendingTributes().find(i => i.key === key);
    if (!issue) { render(); return; }
    const result = action === 'pagar' ? flow.payTribute(issue.community) : flow.refuseTribute(issue.community);
    if (result.refused) { render(); return; }
    const paid = result.events.find(e => e.type === 'tributo-pago');
    tributeNotice = { action, place: issue.place, food: paid?.food };
    interrupt = interrupt.filter(reason => reason.type !== 'pedido' || reason.place !== issue.place);
    tributeKey = null;
    say(result.events.filter(e => e.type !== 'castigo' || e.id !== issue.place));
    render();
  }
  function renderTribute() {
    const panel = $('mtribute');
    const pending = flow.phase === 'mapa' ? pendingTributes() : [];
    const issue = pending.find(i => i.key === tributeKey)
      ?? (!running && !diaryOpen() && !cronOpen() ? pending.find(i => !deferredTributes.has(i.key)) : null);
    tributeKey = issue?.key ?? null;
    panel.classList.toggle('hidden', !issue);
    if (!issue) { tributeContent = ''; delete panel.dataset.issue; return; }
    const changed = panel.dataset.issue !== issue.key;
    panel.dataset.issue = issue.key;
    const community = flow.state.communities[issue.community];
    const attention = flow.state.rome?.attention ?? 0;
    const signature = `${i18n.locale}:${issue.key}:${issue.deadline}:${community.due.food}:${community.food}:${community.trust}:${community.fear}:${attention}:${running}`;
    if (signature === tributeContent) return;
    tributeContent = signature;
    $('mtribute-title').textContent = issue.title;
    $('mtribute-deadline').textContent = `${tIssue('decision')} · ${tIssue('deadline', { duration: duration(issue.deadline) })}`;
    $('mtribute-detail').textContent = issue.detail;
    $('mtribute-time').textContent = tIssue(running ? 'running' : 'paused');
    $('mtribute-consequence').textContent = issue.consequence;
    const options = $('mtribute-options'), had = options.contains(doc.activeElement) ? doc.activeElement.dataset.act : null;
    options.replaceChildren();
    for (const action of issue.actions) {
      const preview = flow.previewTribute(action.id, issue.community);
      const next = preview.state.communities[issue.community];
      const unavailable = preview.events.find(e => e.type === 'tributo-sem-comida');
      if (unavailable) {
        options.append(el('p', 'brief', tIssue('payUnavailable', unavailable)));
        continue;
      }
      const effect = action.id === 'pagar'
        ? tIssue('payEffect', { food: community.due.food, from: community.trust, to: next.trust })
        : tIssue('refuseEffect', { from: community.fear, to: next.fear, duration: duration(PUNISH.days),
          attentionFrom: attention, attentionTo: preview.state.rome?.attention ?? 0 });
      const button = el('button', 'decision-choice', action.label);
      button.type = 'button'; button.dataset.act = action.id;
      button.append(el('small', '', effect));
      button.addEventListener('click', () => applyTribute(issue.key, action.id));
      options.append(button);
    }
    if (changed && decisionOverlay === panel) options.querySelector('button')?.focus();
    else if (had) options.querySelector(`[data-act="${had}"]`)?.focus();
  }
  function renderStateStrip() {
    const mapPhase = flow.phase === 'mapa' && !tributeKey;
    const pending = mapPhase ? pendingTributes() : [];
    const scheduled = mapPhase && dueScheduled(flow.state);
    const reasons = mapPhase ? interrupt.filter(reason => reason.type !== 'pedido' || pending.some(i => i.place === reason.place)) : [];
    const notice = mapPhase && tributeNotice;
    const stopped = !running && !!(reasons.length || notice || pending.length || scheduled);
    const heading = stopped ? tMap('timeStopped') : pending.length ? tIssue('remaining', { count: pending.length })
      : scheduled ? tIssue('chapter') : notice ? tIssue('decision') : '';
    const lines = reasons.map(reason => interruptionText(reason, flow.state, i18n));
    if (notice) lines.push(tIssue(notice.action === 'pagar' ? 'paid' : 'refused', { ...notice, name: displayName(notice.place) }));
    if (scheduled) lines.push(tIssue('nextOrder', { chapter: tIssue(`episode.${scheduled.chapter}.title`) }));
    if (stopped && pending.length && !reasons.some(x => x.type === 'pedido')) lines.push(tIssue('remaining', { count: pending.length }));
    $('m-int').classList.toggle('hidden', !(heading || lines.length));
    $('m-review').classList.toggle('hidden', !pending.length);
    $('m-int-go').classList.toggle('hidden', !stopped || map3d?.failed === true);
    const hint = stopped && !map3d?.failed ? tIssue('resumeHint') : '';
    const key = JSON.stringify([i18n.locale, heading, lines, hint, reasons]);
    if (stripContent === key) return;
    stripContent = key;
    $('m-int-title').textContent = heading;
    $('m-int-hint').textContent = hint;
    const ul = $('m-int-list'); ul.replaceChildren();
    for (const [index, text] of lines.entries()) {
      const reason = reasons[index];
      const li = el('li', '', text);
      if (reason?.place || reason?.at || reason?.type === 'comida') {
        const label = reason.type === 'comida' ? tIssue('foodAction') : text;
        const button = el('button', 'link', label); button.type = 'button';
        if (reason.type === 'comida') li.append(' ', button); else li.replaceChildren(button);
        button.addEventListener('click', () => issueAction(reason, reason.type === 'comida' ? 'castro' : 'ver'));
      }
      ul.append(li);
    }
  }
  const dialogControls = panel => [...panel.querySelectorAll('button:not([disabled]), select:not([disabled])')]
    .filter(control => !control.closest('.hidden'));
  function syncDecisionOverlay(panel) {
    if (decisionOverlay === panel) {
      if (panel && !panel.contains(doc.activeElement)) dialogControls(panel)[0]?.focus();
      return;
    }
    if (panel && !decisionOverlay) decisionOpener = doc.activeElement;
    decisionOverlay = panel;
    for (const child of $('map').children) child.toggleAttribute('inert', !!panel && child !== panel);
    if (panel) { dialogControls(panel)[0]?.focus(); return; }
    const fallback = ['m-review', 'm-int-go', 'm-pause'].map($).find(button => !button.closest('.hidden'));
    (decisionOpener?.isConnected && decisionOpener !== doc.body && !decisionOpener.closest('.hidden') ? decisionOpener : fallback)?.focus();
    decisionOpener = null;
  }

  // --- painel da povoação escolhida ---
  function pick(id) {
    if (!active || !flow || flow.phase !== 'mapa') return;
    selected = id; if (narrow()) setSide(true);
    render();
    $('mctx').querySelector('h3')?.focus?.();
  }
  function unpick() { selected = null; render(); $('missues-list').querySelector('button')?.focus?.(); }
  const level = v => (v >= 60 ? 'alta' : v >= 35 ? 'média' : 'baixa');
  function trend(c, key) {
    const recent = c.motives.filter(m => flow.state.day - m.day <= 15);
    if (!recent.length) return UI.panel.steady;
    const v = recent.reduce((n, m) => n + m.v, 0);   // margem: + confiança ou − medo
    return v > 0 ? (key === 'trust' ? UI.panel.trendUp : UI.panel.trendDown) : v < 0 ? (key === 'trust' ? UI.panel.trendDown : UI.panel.trendUp) : UI.panel.steady;
  }
  let ctxKey = '';
  function renderContext() {
    const box = $('mctx');
    const s = selected && flow.phase === 'mapa' ? settlement(selected) : null;
    box.classList.toggle('hidden', !s);
    if (!s) { ctxKey = ''; return; }
    const st = flow.state, c = communityAt(s.id);
    const k = `${i18n.locale}:${s.id}:${st.day}:${st.men}:${st.arms}:${st.food}:${st.party.x}:${st.party.y}:${c ? JSON.stringify(c) : ''}:${flow.journal.length}`;
    if (k === ctxKey) return;
    ctxKey = k;
    const had = box.contains(doc.activeElement) ? doc.activeElement.dataset.act : null;
    box.textContent = '';
    const top = el('div', 'ctx-top');
    const back = el('button', 'back', tMap('backIssues')); back.type = 'button'; back.addEventListener('click', unpick);
    top.append(back); box.append(top);
    const h = el('h3', null, displayName(s.id)); h.tabIndex = -1; box.append(h);
    if (c) {
      box.append(el('p', 'sub', placeDescription(s, c)));
      const chips = el('div', 'chips');
      const pc = el('span', `chip p-${c.posture}`, POSTURE_LABEL[c.posture]); pc.title = POSTURE_HINT[c.posture]; chips.append(pc);
      const tributeStatus = c.situation === 'tributada' ? tIssue('tributeStatus') : null;
      const sc = el('span', `chip s-${c.situation}`, tributeStatus ?? SITUATION_LABEL[c.situation]);
      if (!tributeStatus && SITUATION_HINT[c.situation]) sc.title = SITUATION_HINT[c.situation];
      chips.append(sc);
      if (c.hungry) chips.append(el('span', 'chip warn', 'Fome'));
      box.append(chips);
      const line = tributeStatus ? null : communityLine(c); if (line) box.append(el('p', 'line', line));
      const dl = el('dl', 'facts');
      const fact = (t, v) => dl.append(el('dt', null, t), el('dd', null, v));
      fact(UI.panel.chief, chiefLine(c.id));
      fact(UI.panel.families, String(c.families));
      fact(UI.panel.youth, String(youth(c)));
      fact(UI.panel.band, String(c.away));
      fact(UI.panel.food, `${Math.round(c.food)} (${UI.panel.winter(winterReserve(c))})`);
      fact(UI.panel.trust, `${level(c.trust)} · ${trend(c, 'trust')}`);
      fact(UI.panel.fear, `${level(c.fear)} · ${trend(c, 'fear')}`);
      box.append(dl);
      box.append(el('h4', null, UI.panel.motives));
      const mot = topMotives(c, 3);
      if (!mot.length) box.append(el('p', 'dim', UI.panel.noMotives));
      else { const ul = el('ul', 'motives'); for (const m of mot) { const li = el('li', m.v > 0 ? 'up' : m.v < 0 ? 'down' : ''); li.append(el('span', 'sign', m.v > 0 ? '▲' : m.v < 0 ? '▼' : '•'), el('span', null, `${m.text} `), el('small', null, m.day === st.day ? 'hoje' : agoLabel(st.day - m.day))); ul.append(li); } box.append(ul); }
    } else {
      box.append(el('p', 'sub', placeDescription(s)));
      const ps = placeState(s, st);
      if (ps) box.append(el('p', 'line', ps === 'tomado' ? UI.panel.taken : ps === 'queimada' ? UI.panel.burnt : UI.panel.attacked));
    }
    box.append(el('h4', 'map-actions-heading', tMap('panelActions')));
    const acts = el('div', 'actions'); box.append(acts);
    const decision = pendingTributes().find(i => i.place === s.id);
    if (decision) {
      const row = el('div', 'act');
      row.append(reviewButton(decision)); acts.append(row);
    }
    for (const a of actionsFor(s, c)) acts.append(actionRow(a));
    if (c) { box.append(el('p', 'later', UI.panel.later)); }
    if (flow.phase === 'mapa') box.append(el('p', 'risk dim', tMap('panelRisk')));   // sempre o mesmo texto: não diz se há ou não algo escondido
    if (had) box.querySelector(`[data-act="${CSS_ESC(had)}"]`)?.focus?.();
  }
  /** As ações que existem para este lugar, cada uma com o que daria (pré-visualização) ou porque não se pode. */
  function actionsFor(s, c) {
    const out = [], here = marchDays(s) === 0;
    const pv = o => flow.preview(o);
    const refusedText = (ev, days) => {
      if (!ev) return ACTION_NO.outro;
      if (ev.type === 'ordem-invalida') return ev.why === 'longe' ? ACTION_NO.longe(days) : ev.why === 'queimada' ? ACTION_NO.destruida : ACTION_NO.outro;
      if (ev.type === 'recrutar-recusado') return ev.why === 'postura' ? ACTION_NO.postura(ev.posture) : (ACTION_NO[ev.why] ?? ACTION_NO.outro);
      if (ev.type === 'sem-armas') return ACTION_NO['sem-armas'];
      if (ev.type === 'ajuda-recusada') return ACTION_NO['ajuda-recusada'](ev.days ?? 1);
      if (ev.type === 'posto-atacado') return ACTION_NO['posto-atacado'];
      if (ev.type === 'reconhecer-recusado') return ev.why === 'homens' ? ACTION_NO['recon-homens'] : ACTION_NO['recon-longe'];
      return ACTION_NO.outro;
    };
    const effects = (r, cid) => {
      const lines = [];
      const rec = r.events.find(e => e.type === 'recrutou'), aj = r.events.find(e => e.type === 'ajuda');
      if (rec) lines.push(EFFECT.men(rec.men));
      if (aj) { lines.push(EFFECT.food(aj.food)); if (aj.men) lines.push(`+${aj.men} homens`); }
      if (cid) { const d = r.state.communities[cid].trust - flow.state.communities[cid].trust; if (d) lines.push(EFFECT.trust(d)); }
      if (r.events.some(e => e.type === 'castigo' && e.id === s.id)) lines.push(EFFECT.punished);
      if (r.encounter) lines.push(EFFECT.battle);
      if (cid) { const to = r.state.communities[cid].posture; if (to !== flow.state.communities[cid].posture) lines.push(EFFECT.posture(POSTURE_LABEL[to].toLowerCase())); }
      if (r.upkeep) lines.push(EFFECT.upkeep(r.upkeep));
      lines.push(EFFECT.day);
      return lines.join(' · ');
    };
    const add = (id, label, o) => {
      const r = pv(o), days = marchDays(s);
      if (r.scheduled) { out.push({ id, label, info: tIssue('nextOrder', { chapter: tIssue(`episode.${r.scheduled.chapter}.title`) }), run: () => step(o) }); return; }   // flow.order lança o capítulo e não cumpre a ordem
      out.push(r.refused ? { id, label, why: refusedText(r.events[0], days), run: null } : { id, label, info: effects(r, c?.id), run: () => step(o) });
    };
    if (s.kind === 'aldeia' || (c && s.kind === 'castro')) add('recrutar', UI.panel.recruit, { kind: 'recrutar', id: s.id });
    if (s.kind === 'castro') add('pedir-ajuda', UI.panel.help, { kind: 'pedir-ajuda', id: s.id });
    if (s.kind === 'posto' && !placeState(s, flow.state)) add('atacar', UI.panel.attack, { kind: 'atacar', id: s.id });
    if (!here) { const d = marchDays(s); out.push({ id: 'ir', label: UI.panel.goHere, info: tMap('route', { duration: duration(d), food: d * foodPerDay(flow.state.men) }), run: () => setDest(s) }); }
    add('reconhecer', UI.panel.reconHere, { kind: 'reconhecer', to: { x: s.x, y: s.y } });
    return out;
  }
  function actionRow(a) {
    const row = el('div', `act${a.run ? '' : ' off'}`);
    const b = el('button', null, mapActions.has(a.id) ? tMap(`action.${a.id}`) : a.label); b.type = 'button'; b.dataset.act = a.id;
    const small = el('small', null, a.run ? a.info : a.why); small.id = `mctx-${a.id}-info`;
    b.setAttribute('aria-describedby', small.id);
    if (a.run) b.addEventListener('click', () => { if (active && flow.phase === 'mapa') a.run(); });
    else b.disabled = true;
    row.append(b, small);
    return row;
  }

  // --- dica ao passar o rato numa comunidade ---
  function renderTip() {
    const tip = $('mtip'), c = hover?.id ? communityAt(hover.id) : null;
    const dd = c ? marchDays(settlement(hover.id)) : 0;
    if (map3d || !c || mode || !view) { tip.classList.add('hidden'); return; }
    const q = toScreen(view, settlement(hover.id)), cv = $('mapcv').getBoundingClientRect(), mr = $('map').getBoundingClientRect();
    tip.textContent = '';
    tip.append(el('b', null, name(c.settlement)), el('span', null, `${chiefLine(c.id)} · ${POSTURE_LABEL[c.posture]}${c.situation !== 'livre' ? ` · ${SITUATION_LABEL[c.situation]}` : ''}`), el('em', null, communityLine(c)), el('small', null, dd ? `${daysText(dd)} de marcha · −${dd * foodPerDay(flow.state.men)} comida` : 'O bando está aqui.'));
    tip.classList.remove('hidden');
    const x = Math.min(cv.left - mr.left + q.x + 30, cv.right - mr.left - 250), y = Math.max(cv.top - mr.top + 4, cv.top - mr.top + q.y - 30);
    tip.style.left = `${Math.max(4, x)}px`; tip.style.top = `${y}px`;
  }

  function renderLog() {
    const ul = $('mlog');
    ul.replaceChildren(...log.slice(-LOG_LINES).map(line => el('li', null, typeof line === 'function' ? line() : line)));
  }

  // --- render ---
  function render() {
    if (!active || !flow) return;
    resize(); syncParty(); paint();
    renderTop(); renderMapAccess(); renderStatus();
    if (logDirty) {   // confirmação curta: as últimas linhas, que se apagam sozinhas (o Diário guarda a história)
      logDirty = false;
      const ul = $('mlog'); ul.classList.remove('faded');
      renderLog();
      if (logTimer) win.clearTimeout?.(logTimer);
      logTimer = win.setTimeout?.(() => { logTimer = 0; $('mlog').classList.add('faded'); }, LOG_MS) ?? 0;
    }
    renderBattle(); renderEnd(); renderTribute(); renderStateStrip(); renderIssues(); renderContext(); renderTip();
    syncDecisionOverlay(flow.phase === 'batalha' ? $('mbattle') : tributeKey ? $('mtribute') : null);
    if (diaryOpen()) renderDiary();
    const busy = flow.phase !== 'mapa' || map3d?.failed === true;
    for (const b of $('map').querySelectorAll('#mbot [data-act], #m-time [data-speed], #m-pause')) b.disabled = busy;
    if (busy && running) pause();
  }

  // --- reconhecimento ---
  const inRecon = p => Math.hypot(p.x - flow.state.party.x, p.y - flow.state.party.y) <= RECON_RANGE;
  const sameReconClick = event => event && reconClick && event.timeStamp >= reconClick.t && event.timeStamp - reconClick.t < 600 &&
    Math.hypot(event.clientX - reconClick.x, event.clientY - reconClick.y) <= 8;

  // --- Diário ---
  let diaryTab = 'campanha', diaryOpener = null, archive = false;
  const diaryOpen = () => !$('mdiary').classList.contains('hidden');
  function openDiary(tab) {
    if (!active || !flow || decisionOverlay) return;
    diaryOpener = doc.activeElement; if (tab) diaryTab = tab;
    $('mdiary').classList.remove('hidden'); pause();
    $('mdiary-tabs').querySelector('[aria-selected="true"]')?.focus?.();
  }
  function closeDiary() { if (!diaryOpen()) return; $('mdiary').classList.add('hidden'); diaryOpener?.focus?.(); diaryOpener = null; }
  function renderDiary() {
    for (const b of $('mdiary-tabs').querySelectorAll('[role="tab"]')) { const on = b.dataset.tab === diaryTab; b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; }
    const body = $('mdiary-body'); body.textContent = ''; body.setAttribute('aria-labelledby', `mdiary-tab-${diaryTab}`);
    ({ campanha: diaryCampaign, comunidades: diaryCommunities, historia: diaryHistory, relatos: diaryReports, lugares: diaryPlaces })[diaryTab]?.(body);
  }
  function diaryCampaign(body) {
    const s = flow.state;
    body.append(el('p', 'status', `Agora: ${s.men} homens (mín. ${WIN_MEN}) · ${s.fame} de fama (mín. ${WIN_FAME}) · faltam ${daysLeft(s.day)} dias`));
    const band = [...flow.journal].reverse().find(e => e.type === 'roma-atencao')?.to ?? 'rotina';
    body.append(el('p', 'status', `${DIARY.fame(s.fame)} · ${DIARY.rome(band)}`));
    const ul = el('ul', 'goal'); for (const t of goalLines(s)) ul.append(el('li', null, t)); body.append(ul);
    body.append(el('h4', null, 'Legenda do mapa'));
    const lg = el('ul', 'legend');
    const item = (kind, v, label, hint) => {
      const li = el('li'), cv = doc.createElement('canvas'); cv.width = 44; cv.height = 30; cv.setAttribute('aria-hidden', 'true');
      const cx = cv.getContext?.('2d'); if (cx) drawLegend(cx, kind, v, 22, 18);
      li.append(cv, el('b', null, label), el('span', null, hint || '')); lg.append(li);
    };
    for (const p of Object.keys(POSTURE_LABEL)) item('postura', p, POSTURE_LABEL[p], POSTURE_HINT[p]);
    for (const x of Object.keys(SITUATION_LABEL)) if (x !== 'livre') item('situacao', x, SITUATION_LABEL[x], SITUATION_HINT[x]);
    body.append(lg);
  }
  function diaryCommunities(body) {
    const ul = el('ul', 'communities');
    for (const c of Object.values(flow.state.communities)) {
      const li = el('li'), b = el('button', 'link', name(c.settlement)); b.type = 'button';
      b.addEventListener('click', () => { closeDiary(); pick(c.settlement); });
      li.append(b, el('span', `chip p-${c.posture}`, POSTURE_LABEL[c.posture]));
      if (c.situation !== 'livre') li.append(el('span', `chip s-${c.situation}`, SITUATION_LABEL[c.situation]));
      li.append(el('p', 'dim', `${DIARY.people(c.families, c.away)} · ${chiefLine(c.id)}`));
      const m = topMotives(c, 1)[0]; if (m) li.append(el('p', null, `${m.v > 0 ? '▲' : m.v < 0 ? '▼' : '•'} ${m.text}`));
      ul.append(li);
    }
    body.append(ul);
  }
  function diaryHistory(body) {
    if (!flow.journal.length) { body.append(el('p', 'dim', DIARY.empty)); return; }
    const ul = el('ul', 'history');
    let day = null;
    for (const e of [...flow.journal].reverse()) {
      if (e.day !== day) { day = e.day; ul.append(el('li', 'day', `${DIARY.dayHead(e.day)} · ${dateLabel(e.day)}`)); }
      const t = eventMessage(e); if (!t) continue;
      const li = el('li', `cat-${categoryOf(e.type)}`); li.append(el('span', 'chip', DIARY.cats[categoryOf(e.type)] ?? ''), el('span', null, ` ${t}`)); ul.append(li);
    }
    body.append(ul);
  }
  function diaryReports(body) {
    const v = intelView(flow.state), reports = archive ? v.archive : v.recent;
    const tb = el('button', 'arch', archive ? '← Relatos recentes' : `Arquivo (${v.archive.length} antigos)`); tb.type = 'button'; tb.disabled = !archive && !v.archive.length;
    tb.addEventListener('click', () => { archive = !archive; renderDiary(); });
    const ul = el('ul', 'reports');
    if (!reports.length) ul.append(el('li', 'dim', archive ? 'Sem relatos antigos.' : 'Sem relatos recentes. Manda batedores ou espera por notícias das aldeias.'));
    for (const r of reports) {
      const li = el('li'), b = el('button', `link${r.old ? ' old' : ''}`); b.type = 'button'; b.dataset.report = r.id;
      b.append(doc.createTextNode(reportText(r, flow.state)), el('small', null, `${r.age ? agoLabel(r.age) : 'hoje'} · ${r.old ? 'antigo' : RELIABILITY[r.rel] || ''}`));
      b.addEventListener('click', () => { focus = { x: r.x, y: r.y, r: r.r }; closeDiary(); schedulePaint(); });
      li.append(b); ul.append(li);
    }
    body.append(ul, tb, el('p', 'dim', 'No mapa: figura nítida, à vista hoje; esbatida, vista há dias; círculo com «?», relato (pontilhado largo: rumor).'));
  }
  function diaryPlaces(body) {
    const s = flow.state, d = x => Math.hypot(x.x - s.party.x, x.y - s.party.y), ul = el('ul', 'places');
    for (const p of [...s.world.settlements].sort((a, b) => d(a) - d(b))) {
      const li = el('li'), b = el('button', 'link', placeLabel(p, s)); b.type = 'button'; b.dataset.place = p.id;
      b.addEventListener('click', () => { closeDiary(); pick(p.id); });
      li.append(b); ul.append(li);
    }
    body.append(ul);
  }

  // --- rato e teclado no mapa ---
  function mapPoint(e) { const r = $('mapcv').getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; }
  function pointAt(hit) {
    if (!hit || !flow) return null;
    if (hit.type === 'terrain') return hit;
    if (hit.type === 'settlement') return settlement(hit.id);
    return intelView(flow.state).forces.find(force => force.id === hit.id);
  }

  function mapAction(hit, at, event) {
    if (!active || flow.phase !== 'mapa' || decisionOverlay || !at) return;
    if (mode === 'reconhecer') {
      reconClick = event ? { t: event.timeStamp, x: event.clientX, y: event.clientY } : null;
      mode = null;
      step({ kind: 'reconhecer', to: { x: at.x, y: at.y } });
      return;
    }
    if (sameReconClick(event)) return;
    if (mode === 'ir') { setDest(hit?.type === 'settlement' ? settlement(hit.id) : at); return; }
    if (hit?.type === 'settlement') { pick(hit.id); return; }
    if (hit && hit.type !== 'terrain') {
      const force = intelView(flow.state).forces.find(f => f.id === hit.id);
      if (force) { focus = { x: force.x, y: force.y, r: force.r || 0 }; schedulePaint(); }
      return;
    }
    if (Math.hypot(at.x - flow.state.party.x, at.y - flow.state.party.y) >= 2) setDest(at);
  }

  function mapClick(e) {
    if (!active || flow.phase !== 'mapa') return;
    const { sx, sy } = mapPoint(e);
    const hit = hitTest(view, flow.state, sx, sy);
    mapAction(hit, toWorld(view, { x: sx, y: sy }), e);
  }
  if (legacyMapForTests) $('mapcv').addEventListener('click', mapClick);
  function hoverLabel(hit, at) {
    const s = flow.state;
    const days = inReach(s.party, at) ? 0 : marchDaysTo(s.world, s.party, at);
    if (mode === 'reconhecer') return inRecon(at) ? tMap('reconHover', { scouts: SCOUTS }) : tMap('reconFar');
    const when = days ? tMap('route', { duration: duration(days), food: days * foodPerDay(s.men) }) : tMap('here');
    if (hit?.type === 'settlement') return tMap('placePreview', { name: displayName(hit.id), when });
    if (hit && hit.type !== 'terrain') {
      const force = intelView(s).forces.find(x => x.id === hit.id);
      if (!force) return when;
      let title = force.kind === 'pretor'
        ? tMap('namedPraetor', { name: force.name || tMap('praetorTitle') })
        : mapForceName(i18n, force);
      if (force.kind !== 'pretor' && force.men) title = tMap('forceSize', {
        name: title, men: tMap('forceMen', { count: estimateMen(force.men) }),
      });
      if (force.kind !== 'pretor' && force.dir) title = tMap('forceDirection', { name: title, direction: tMap(`directions.${force.dir}`) });
      return force.status === 'confirmada' ? tMap('confirmed', { name: title })
        : tMap('estimated', { name: title, duration: duration(force.age) });
    }
    return when;
  }
  function updateHover(hit, at) {
    if (!active || !flow || flow.phase !== 'mapa') return;
    const tipShown = !map3d && hit?.type === 'settlement' && !mode && !!communityAt(hit.id);
    const next = at ? { x: at.x, y: at.y, id: hit?.type === 'settlement' ? hit.id : null, hit, label: tipShown ? null : hoverLabel(hit, at) } : null;
    if (!next && !hover) return;
    hover = next;
    renderTip(); schedulePaint();
  }
  function pointerMove(e) {
    if (!active || !flow || flow.phase !== 'mapa' || !view) return;
    const { sx, sy } = mapPoint(e), hit = hitTest(view, flow.state, sx, sy);
    const at = hit?.type === 'settlement' ? settlement(hit.id) : toWorld(view, { x: sx, y: sy });
    $('mapcv').style.cursor = hit ? 'pointer' : 'crosshair';
    updateHover(hit, at);
  }
  if (legacyMapForTests) {
    $('mapcv').addEventListener('mousemove', pointerMove);
    $('mapcv').addEventListener('mouseleave', () => {
      $('mapcv').style.cursor = 'crosshair';
      updateHover(null, null);
    });
  }

  // --- botões ---
  $('m-go').addEventListener('click', () => { if (!active || flow?.phase !== 'mapa') return; if (dest && mode !== 'ir') { setDest(null); return; } setMode('ir'); });
  $('m-ambush').addEventListener('click', () => { if (active && flow?.phase === 'mapa') setStance('esperar'); });
  $('m-hide').addEventListener('click', () => { if (active && flow?.phase === 'mapa') setStance('esconder'); });
  $('m-recon').addEventListener('click', () => { if (active && flow?.phase === 'mapa') setMode('reconhecer'); });
  $('m-diary').addEventListener('click', () => (diaryOpen() ? closeDiary() : openDiary()));
  $('mdiary-close').addEventListener('click', closeDiary);
  for (const b of $('mdiary-tabs').querySelectorAll('[role="tab"]')) b.addEventListener('click', () => { diaryTab = b.dataset.tab; archive = false; renderDiary(); b.focus(); });
  $('mdiary-tabs').addEventListener('keydown', e => {
    const tabs = [...$('mdiary-tabs').querySelectorAll('[role="tab"]')], i = tabs.findIndex(t => t.dataset.tab === diaryTab);
    const j = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
    if (j < 0) return; e.preventDefault(); diaryTab = tabs[j].dataset.tab; renderDiary(); tabs[j].focus();
  });
  $('m-pause').addEventListener('click', () => { if (active && flow?.phase === 'mapa') pause(); });
  for (const b of $('m-time').querySelectorAll('[data-speed]')) b.addEventListener('click', () => { if (active && flow?.phase === 'mapa') play(Number(b.dataset.speed)); });
  $('m-int-go').addEventListener('click', () => { play(); if (running) $('m-pause').focus(); });
  $('m-review').addEventListener('click', () => {
    const issue = nextTribute() ?? pendingTributes()[0];
    if (issue) openTribute(issue.key);
  });
  $('mtribute-later').addEventListener('click', deferTribute);
  $('m-side-toggle').addEventListener('click', () => setSide(!sideOpen()));
  $('m-map-details').addEventListener('click', () => {
    if (!active || flow?.phase !== 'mapa' || decisionOverlay) return;
    showMapDetails = !showMapDetails;
    $('m-map-details').setAttribute('aria-pressed', String(showMapDetails));
    schedulePaint();
  });
  $('m-community').addEventListener('change', event => {
    const select = event.currentTarget;
    if (!decisionOverlay && select.value) pick(select.value);
    select.value = '';
  });

  /** Só para testes (__game): termina a batalha pendente com um resultado já pronto. Nunca é mostrado ao jogador. */
  function simulateBattle(result) {
    if (!flow || flow.phase !== 'batalha') return null;
    const r = flow.finishBattle(result); say(r.events); render(); return r;
  }
  function renderBattle() {
    const m = $('mbattle'), on = flow.phase === 'batalha';
    m.classList.toggle('hidden', !on);
    if (!on) return;
    const b = flow.battle, ep = isStory(b) && EPISODES[b.chapter];
    const tactical = flow.tactical;
    m.querySelector('.kicker').textContent = tactical ? tMap('tactical.kicker') : tIssue(ep && !b.foeId ? 'chapter' : 'battle');
    $('mb-type').textContent = tactical ? tMap('tactical.title') : ep ? tIssue(`episode.${b.chapter}.title`) : tIssue(`battleTitle.${b.type}`);
    $('mb-fight').textContent = tactical ? tMap('tactical.fight') : tIssue('fight');
    $('mb-fight').disabled = !!tacticalArena;
    $('mb-withdraw').textContent = tIssue('withdraw');
    $('mb-withdraw').classList.toggle('hidden', !!tactical || !!ep || !b.withdraw?.possible);
    if (tactical) {
      const [band, patrol] = tactical.sources;
      const deployed = { lusitanos: 0, romanos: 0 };
      for (const group of tactical.groups) deployed[group.side] += group.men;
      $('mb-info').textContent = tacticalNotice ? tMap(`tactical.${tacticalNotice}`) : tMap('tactical.brief', {
        enemy: patrol.atStart, allies: band.atStart, romanDeployed: deployed.romanos, alliedDeployed: deployed.lusitanos,
      });
      return;
    }
    if (ep) { $('mb-info').textContent = tIssue(`episode.${b.chapter}.brief`); return; }
    $('mb-info').textContent = battleBrief(b, flow.state, i18n);
  }
  function renderEnd() {
    const e = $('mend'), on = flow.phase === 'fim';
    e.classList.toggle('hidden', !on);
    if (!on) { delete e.dataset.shown; return; }
    const s = flow.state, won = s.over === 'vitoria', yearOut = s.day >= YEAR_DAYS, pretor = s.praetor?.name || 'o pretor';
    const decisive = won && !!s.decisivaWon;
    $('mend-title').textContent = decisive && !yearOut ? 'A campanha de 147 a.C.' : won || yearOut ? 'Fim do ano de 147 a.C.' : 'O bando desfez-se';
    $('mend-result').textContent = won ? 'Vitória' : 'Derrota';
    $('mend-text').textContent = won ? (decisive ? `O exército de ${pretor} foi desfeito em campo.`
      : s.men >= START.men ? 'Viriato chegou ao fim do ano com o bando inteiro. Roma não o venceu.' : 'Viriato chegou ao fim do ano. Roma não o venceu.')
      : yearOut ? `O inverno chegou sem ${s.men < WIN_MEN ? (s.fame < WIN_FAME ? 'homens nem fama bastantes' : 'homens bastantes') : 'fama bastante'} para manter a guerra.`
      : s.men <= 0 ? 'Não restam homens para combater.' : 'Sem fama, as aldeias deixaram de dar homens e comida.';
    const vals = { days: Math.min(s.day, YEAR_DAYS), men: s.men, burnt: Object.values(s.villages).filter(v => v.burnt).length, kills: s.kills || 0, battles: s.battles || 0 };
    for (const [k, v] of Object.entries(vals)) e.querySelector(`[data-k="${k}"]`).textContent = v;
    const chron = $('mend-chron'); chron.textContent = '';
    if (decisive) {
      const ent = entryFor('vetilio'), line = ent.text.split(/(?<=\.)\s+/).find(x => x.includes('Periochae')) || ent.title;
      const c = doc.createElement('cite'); c.textContent = ent.citation;
      chron.append(line, c);
    } else if (!won) chron.textContent = 'Os montes ficaram em silêncio.';
    if (!e.dataset.shown) { e.dataset.shown = '1'; $('mend-new').focus?.(); }
  }
  function launchTactical() {
    if (tacticalArena) return;
    if (!flow.save()) { tacticalNotice = 'saveFailed'; renderBattle(); return; }
    const encounterFlow = flow;
    let request = flow.tactical;
    const withWrite = fn => win.navigator?.locks ? win.navigator.locks.request(STORAGE_KEY, fn) : fn();
    const isCurrent = () => tacticalArena === arena && flow === encounterFlow;
    const returnToMap = (notice, events = []) => {
      if (!isCurrent()) return;
      arena.dispose(); tacticalArena = null;
      tacticalNotice = notice;
      active = true; $('map').classList.remove('hidden');
      say(events); render();
      $(notice || flow.tactical ? 'mb-fight' : 'm-diary')?.focus();
    };
    tacticalNotice = 'loading';
    const arena = openTacticalArena({ document: doc, window: win, i18n, request,
      onReady: suspend,
      onPrepare: async placement => {
        const prepared = await withWrite(() => isCurrent() && flow.prepareTactical(request, placement));
        if (prepared) request = prepared;
        return !!prepared;
      },
      onFinish: async result => {
        const resolved = await withWrite(() => isCurrent() && flow.finishTactical(result));
        if (!resolved || resolved.refused) return false;
        returnToMap(null, resolved.events);
        return true;
      },
      onExit: returnToMap,
    });
    tacticalArena = arena;
    renderBattle();
  }
  $('mb-fight').addEventListener('click', () => {
    if (!active || flow?.phase !== 'batalha') return;
    if (flow.tactical) { launchTactical(); return; }
    if (isBridged(flow.battle) && startBattle(flow.battle)) return;
    log.push('Não há como travar esta batalha; o bando evita-a.'); logDirty = true;
    simulateBattle({ won: false, retreated: true, alliesLost: 0, enemiesKilled: 0 });
  });
  $('mb-withdraw')?.addEventListener('click', () => {
    if (!active || flow?.phase !== 'batalha') return;
    const r = flow.withdraw();
    if (r.refused) return;
    say(r.events); render();
  });
  function suspend() { pause(); map3d?.suspend(); stopMarch(); hover = null; active = false; $('map').classList.add('hidden'); }
  function battleDone(result, line) {
    let r = { events: [] };
    if (flow && flow.phase === 'batalha') r = flow.finishBattle(result);
    if (line) { log.push(line); logDirty = true; }
    say(r.events);
    active = true; $('map').classList.remove('hidden'); render();
    return r;
  }

  // --- Crónica (as fontes antigas), aberta a partir do Diário ou do fim ---
  let cronOpener = null;
  const cronOpen = () => !$('mcron').classList.contains('hidden');
  function renderChronicle() {
    const ul = $('mcron-list'); ul.textContent = '';
    for (const [id, e] of Object.entries(CHRONICLE)) {
      const li = doc.createElement('li'); li.dataset.entry = id; li.tabIndex = 0;
      const h = doc.createElement('h3'); h.id = 'mcron-h-' + id; h.textContent = e.title; li.append(h);
      li.setAttribute('aria-labelledby', h.id);
      if (!isUnlocked(id, flow?.state)) {
        li.classList.add('locked');
        const p = doc.createElement('p'); p.className = 'lk'; p.id = 'mcron-l-' + id; p.textContent = 'Ainda não vivido'; li.append(p);
        li.setAttribute('aria-describedby', p.id);
      } else {
        const chip = doc.createElement('span'); chip.className = 'chip'; chip.id = 'mcron-s-' + id; chip.textContent = SOURCE_LABELS[e.source]; li.append(chip);
        const p = doc.createElement('p'); p.className = 'txt'; p.id = 'mcron-t-' + id; p.textContent = e.text; li.append(p);
        const desc = [chip.id, p.id];
        if (e.citation) { const c = doc.createElement('p'); c.className = 'cit'; c.id = 'mcron-c-' + id; c.textContent = e.citation; li.append(c); desc.push(c.id); }
        li.setAttribute('aria-describedby', desc.join(' '));
      }
      ul.append(li);
    }
  }
  function openChronicle(opener) {
    if (!flow || cronOpen()) return;
    cronOpener = opener || doc.activeElement;
    $('mcron').classList.remove('hidden');
    pause(); renderChronicle();
    $('mcron-list').scrollTop = 0;
    $('mcron-list').firstElementChild?.focus?.();
  }
  function closeChronicle() {
    if (!cronOpen()) return;
    $('mcron').classList.add('hidden');
    cronOpener?.focus?.(); cronOpener = null;
  }
  $('m-cronica').addEventListener('click', () => { if (active && flow) openChronicle($('m-cronica')); });
  $('mend-cronica').addEventListener('click', () => { if (active && flow?.phase === 'fim') openChronicle($('mend-cronica')); });
  $('mcron-close').addEventListener('click', closeChronicle);
  $('mcron').addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const items = [...$('mcron').querySelectorAll('[data-entry], button')], first = items[0], last = items[items.length - 1];
    if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  $('mcron-list').addEventListener('keydown', e => {
    const li = e.target.closest?.('[data-entry]'); if (!li) return;
    const to = e.key === 'ArrowDown' ? li.nextElementSibling : e.key === 'ArrowUp' ? li.previousElementSibling
      : e.key === 'Home' ? li.parentElement.firstElementChild : e.key === 'End' ? li.parentElement.lastElementChild : null;
    if (to) { e.preventDefault(); to.focus(); }
  });
  $('mdiary').addEventListener('keydown', e => {   // Tab não sai do Diário
    if (e.key !== 'Tab') return;
    const items = [...$('mdiary').querySelectorAll('button:not([disabled]), [tabindex="0"]')].filter(x => x.offsetParent !== null || x.getClientRects?.().length), first = items[0], last = items[items.length - 1];
    if (!first) return;
    if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  $('mend-new').addEventListener('click', () => { try { clearSave(storage); } catch { /* ignorado */ } open(createFlow({ storage })); });
  $('mend-menu').addEventListener('click', close);
  win.addEventListener('resize', render);
  const typing = e => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? '');
  win.addEventListener('keydown', e => {
    if (!active || !flow || decisionOverlay || cronOpen() || diaryOpen() || typing(e)) return;
    // Espaço pausa e retoma em todo o mapa; num botão qualquer carrega nele, salvo nos do tempo (aí também alterna)
    if (e.code === 'Space' && flow.phase === 'mapa' && (e.target?.tagName !== 'BUTTON' || e.target.closest?.('#m-time'))) { e.preventDefault(); if (running) pause(); else play(); return; }
    if (flow.phase !== 'mapa') return;
    // setas: um dia de marcha para norte/sul/este/oeste como destino (o mapa também se joga sem rato)
    const dir = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.code];
    if (!dir || e.target?.closest?.('#mside, #mtop, #mbot')) return;
    e.preventDefault();
    const p = flow.state.party;
    setDest({ x: p.x + dir[0] * MARCH_SPEED, y: p.y + dir[1] * MARCH_SPEED });
  });
  win.addEventListener('keydown', e => {
    if (!active || !decisionOverlay || tacticalArena) return;
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopImmediatePropagation();
      if (decisionOverlay === $('mtribute')) deferTribute();
    } else if (e.key === 'Tab') {
      const controls = dialogControls(decisionOverlay), first = controls[0], last = controls.at(-1);
      const current = doc.activeElement;
      if (!controls.includes(current) || (e.shiftKey ? current === first : current === last)) {
        e.preventDefault();
        (e.shiftKey ? last : first)?.focus();
      }
    }
  }, true);
  win.addEventListener('keydown', e => {
    if (!active || decisionOverlay || e.code !== 'Escape') return;
    if (cronOpen()) { closeChronicle(); return; }
    if (diaryOpen()) { closeDiary(); return; }
    if (mode) { mode = null; render(); return; }
    if (selected) { unpick(); return; }
    if (narrow() && sideOpen()) { setSide(false); return; }
    close();
  });

  function open(f) {
    tacticalArena?.dispose(); tacticalArena = null; tacticalNotice = null;
    pause();
    syncDecisionOverlay(null); tributeKey = null; tributeNotice = null; tributeContent = ''; deferredTributes.clear();
    reconClick = null;
    flow = f; active = true; selected = null; log.length = 0; logDirty = true; lastSaid = null; repeat = 1;
    stopMarch(); shown = null; hover = null; facing = 1; trail.length = 0; mode = null; dest = null; stance = null;
    memory = {}; interrupt = []; dismissed = new Set(); flash = {}; focus = null; issuesKey = ''; ctxKey = '';
    detectInterruptions({ state: flow.state, events: [], memory });   // o que já se sabe ao abrir não interrompe
    $('mcron').classList.add('hidden'); cronOpener = null; $('mdiary').classList.add('hidden'); setSide(!narrow());
    const welcome = flow.state.day ? 'continued' : 'welcome';
    log.push(() => tMap(welcome, { men: WIN_MEN, fame: WIN_FAME }));
    if (!flow.state.day) {
      const initial = flow.state.intel?.reports?.find(r => r.src === 'inicio' && r.got <= flow.state.day);
      if (initial) log.push(reportText(initial, flow.state));
    }
    $('map').classList.remove('hidden');
    render();
  }
  function close() {
    if (!active) return;
    tacticalArena?.dispose(); tacticalArena = null; tacticalNotice = null;
    pause(); map3d?.suspend(); stopMarch(); hover = null;
    $('mcron').classList.add('hidden'); cronOpener = null; $('mdiary').classList.add('hidden');
    syncDecisionOverlay(null);
    active = false; $('map').classList.add('hidden');
    onClose();
  }
  i18n.subscribe(() => {
    map3d?.localize();
    if (!active || !flow) return;
    if (hover) hover.label = hoverLabel(hover.hit, hover);
    render();
    renderLog();
  });
  return {
    open, close, render, order, openChronicle, closeChronicle, openDiary, closeDiary, simulateBattle, suspend, battleDone,
    select: id => { if (id) pick(id); else { selected = null; render(); } }, view: () => view,
    /** O tempo: pause(), play(n?) com n em SPEEDS, e o estado. step() dá um dia com a ordem permanente (testes). */
    pause, play, step: () => step(standingOrder({ dest, stance })), get running() { return running; }, get speed() { return speed; },
    get dest() { return dest; }, get stance() { return stance; }, get interrupt() { return interrupt.slice(); },
    get flow() { return flow; }, get active() { return active; }, mapMetrics: () => map3d?.metrics(),
    hasSave: () => !!loadFlow(storage),
    saveState: () => { const f = loadFlow(storage); return f ? (f.phase === 'fim' ? 'fim' : 'meio') : null; },
    savedState: () => loadFlow(storage)?.state ?? null,
    resume: () => { const f = loadFlow(storage); if (f) open(f); return !!f; },
    fresh: seed => { open(createFlow({ storage, seed })); return flow; },
  };
}
