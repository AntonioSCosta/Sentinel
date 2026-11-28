import { createI18n } from '../i18n/index.js';
import { mapDate, mapForceName, mapPlaceName } from '../i18n/map-text.js';
import { createCampaignMapView } from '../campaign-map-3d/campaign-view.js';
// Ecrã da campanha: liga o HUD e o mapa ao Flow.
import { makeView, drawMap, hitTest, toWorld, toScreen, agoLabel } from './map-view.js';
import { intelView, estimateMen, SCOUTS, RECON_RANGE, RECON_RADIUS } from './intel.js';
import { createFlow, loadFlow, clearSave, STORAGE_KEY, WIN_MEN, WIN_FAME } from './flow.js';
import { openTacticalArena } from './tactical-arena.js';
import { campaignDateParts, dateLabel, season, daysLeft, YEAR_DAYS } from './clock.js';
import { chronicleEntries, localizedChronicleEntry } from './chronicle-view.js';
import { isBridged, isStory } from './bridge.js';
import { START, foodPerDay } from './state.js';
import { MARCH_SPEED, REACH, ARRIVAL, marchDays as marchDaysTo, inReach, nearRoad } from './simulation.js';
import { TRIBUTE, PUNISH } from './rome.js';
import { placeName, communityOf, POSTURE_LABEL, SITUATION_LABEL, POSTURE_HINT, SITUATION_HINT, communityLine, chiefLine, officeLine, daysText, UI, ACTION_NO, EFFECT, DIARY, ROME_BAND } from './strings.js';
import { buildIssues, detectInterruptions, foodDays, interruptionText, LOW_FOOD_DAYS } from './issues.js';
import { dueScheduled, DECK } from './events.js';
import { SPEEDS, DAY_MS, loadSpeed, saveSpeed, standingOrder, activityOf, clockRuns } from './pace.js';
import { categoryOf } from './journal.js';
import { youth, topMotives, IDENTITY, COMMUNITY_IDS } from './communities.js';
import { winterReserve } from './harvest.js';
import { drawLegend } from './map-view.js';
import { activeCaptains, captainAt, reconRange, reconRadius } from './captains.js';
import { RULES as CAPTAIN_RULES, TRAITS, SCARS } from './captains-data.js';

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
export function createCampaignUI({ document: doc, window: win, storage, onClose = () => {}, startBattle = () => false, legacyMapForTests = false, illustrated = null, i18n = createI18n() }) {
  const $ = id => doc.getElementById(id);
  const el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = text; return e; };
  let flow = null, view = null, active = false, selected = null, logDirty = true;
  let tacticalArena = null, tacticalNotice = null;
  let anim = null, shown = null, facing = 1, walk = 0, rafId = 0, hover = null, paintPending = false;
  let refineTimer = 0;
  let mode = null, reconClick = null, focus = null;   // mode: null | 'reconhecer' (marchar é o clique simples no mapa)
  let dest = null, stance = null;                     // a ordem permanente do bando quando o tempo corre
  // `running` só se escreve em syncClock (pace.clockRuns); `paused` é a pausa do jogador ou de uma interrupção obrigatória;
  // `holding` é a espera ao relento (Espaço premido com o bando parado); `space` diz o que a pressão atual do Espaço faz.
  let speed = loadSpeed(storage), running = false, timer = 0, paused = false, holding = false, space = null;
  let memory = {}, interrupt = [], dismissed = new Set(), flash = {}, flashT = 0, logTimer = 0;
  const LOG_MS = 9000;
  const trail = [];
  const log = [];
  const now = () => (win.performance && win.performance.now ? win.performance.now() : Date.now());
  const reduceMotion = () => !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const ctx2d = () => $('mapcv').getContext('2d');
  const stage = $('campaign-map-3d');
  let showMapDetails = false, communitiesKey = '';
  const canvasMode = legacyMapForTests || !!illustrated;
  const navigation = illustrated?.navigation($('mapcv'), {
    reducedMotion: reduceMotion, onPick: mapClick,
    onChange(next) { view = next; schedulePaint(); },
    onHover(p) {
      if (!p || !view) { updateHover(null,null); return; }
      canvasHover(p.x,p.y);
    },
  });
  stage.classList.toggle('hidden', canvasMode);
  $('mapcv').classList.toggle('hidden', !canvasMode);
  const map3d = canvasMode ? null : createCampaignMapView(stage, {
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
  const eventMessage = (ev, events) => ev.type === 'emboscada-tatica' ? tMap(`tactical.outcome.${ev.outcome}`, ev)
    : ev.type === 'capitao' ? captainLog(ev)
    : ev.type === 'acontecimento' && DECK.some(e => e.id === ev.id) ? tMap(`deck.${ev.id}`)   // saves antigos trazem também `text` em pt-PT: o id manda
    : ev.type === 'postura' || ev.type === 'colheita' ? interruptionText({ type: ev.type, event: ev, place: ev.id }, flow.state, i18n)   // já não param o tempo: ficam no registo
    : eventText(ev, flow.state, events);
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
    const width = Math.max(1, Math.round(w*dpr)), height = Math.max(1, Math.round(h*dpr));
    if (cv.width !== width) cv.width = width;
    if (cv.height !== height) cv.height = height;
    view = navigation ? navigation.resize(flow.state.world,w,h) : makeView(flow.state.world, w, h);
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
    const scouting = mode === 'reconhecer' && flow.phase === 'mapa' ? { range: reconRange(flow.state, RECON_RANGE), radius: reconRadius(flow.state, RECON_RADIUS), ok: !!hover && inRecon(hover) } : null;
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
    if (illustrated) {
      fx.landscape = illustrated.background(flow.state.seed, flow.state.world);
      fx.symbols = illustrated.symbols;
    }
    drawMap(ctx, view, flow.state, fx);
    if (fx.landscape?.stale) { win.clearTimeout(refineTimer); refineTimer = win.setTimeout(schedulePaint, 130); }   // o zoom ainda mexia: repinta nítido quando assentar
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
    if (map3d) map3d.pose({ party: shown, step: walk }); else paint();
    if (t < 1) { rafId = win.requestAnimationFrame(frame); return; }
    shown = { x: anim.to.x, y: anim.to.y }; anim = null; walk = 0;
    if (map3d) map3d.pose({ party: shown, step: walk }); else paint();
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
    for (const b of $('m-time').querySelectorAll('[data-speed]')) b.setAttribute('aria-pressed', Number(b.dataset.speed) === speed ? 'true' : 'false');   // a velocidade escolhida, a correr ou não
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
    if (illustrated) {
      const hint = tMap('a11y.illustratedCanvas');
      $('mapcv').setAttribute('aria-label', hint);
      $('mapcv').title = hint;
    }
    const options = [['', placeholder], ...names].map(([value, title]) => {
      const option = el('option', null, title);
      option.value = value;
      return option;
    });
    $('m-community').replaceChildren(...options);
  }

  // --- barra de baixo: ordem permanente do bando ---
  function renderStatus() {
    $('m-camp').setAttribute('aria-pressed', stance === 'acampar' ? 'true' : 'false');
    $('m-ambush').setAttribute('aria-pressed', stance === 'esperar' ? 'true' : 'false');
    $('m-hide').setAttribute('aria-pressed', stance === 'esconder' ? 'true' : 'false');
    $('m-recon').setAttribute('aria-pressed', mode === 'reconhecer' ? 'true' : 'false');
    let message = tMap('idle');
    if (mode === 'reconhecer') message = tMap('reconMode', { scouts: SCOUTS });
    else if (dest) {
      const days = marchDays(dest);
      message = tMap('going', { name: destName(), duration: duration(days), food: days * foodPerDay(flow.state.men) });
    } else if (stance === 'esperar') message = tMap(nearRoadNow() ? 'waiting' : 'waitingFar');
    else if (stance === 'esconder') message = tMap('hiding');
    else if (stance === 'acampar') message = tMap('camping');
    else if (holding) message = tMap('holding');
    if (mode !== 'reconhecer' && paused && ordered()) message = tMap('onHold', { status: message });
    $('m-status').textContent = message;
  }
  const destName = (point = dest) => {
    const place = flow.state.world.settlements.find(x => Math.hypot(x.x - point.x, x.y - point.y) < 1);
    return place ? displayName(place.id) : tMap('markedPoint');
  };
  const nearRoadNow = () => nearRoad(flow.state.world, flow.state.party);

  // Uma ordem nova (destino ou postura) põe o tempo a correr; cancelá-la, ou chegar, pára-o (parado, o tempo não passa).
  function setDest(p) { dest = p ? { x: p.x, y: p.y } : null; if (dest) { stance = null; holding = false; resume(); } mode = null; render(); }
  function setStance(st) { stance = stance === st ? null : st; if (stance) { dest = null; holding = false; resume(); } mode = null; render(); }
  function setMode(m) { mode = mode === m ? null : m; render(); }   // a escolher o ponto do reconhecimento o tempo fica suspenso

  // --- tempo: uma só autoridade. Corre se e só se há atividade, sem pausa e sem nada que o suspenda (pace.clockRuns) ---
  const activity = () => activityOf({ dest, stance, holding });
  const ordered = () => !!activityOf({ dest, stance });   // uma ordem em curso (sem contar a espera ao relento)
  // Um painel aberto (Diário, Crónica, decisão, escolha do reconhecimento), a batalha, o mapa 3D falhado ou o separador
  // escondido suspendem o tempo sem apagar a ordem nem a pausa: ao fechar, o relógio volta ao que era.
  const blocked = () => !active || !flow || flow.phase !== 'mapa' || !!decisionOverlay || diaryOpen() || cronOpen() || !!mode
    || map3d?.failed === true || !!doc.hidden;
  /** Arma ou desarma o dia seguinte conforme o estado (`restart`: um dia inteiro a contar de agora). Devolve se mudou. */
  function syncClock(restart = false) {
    if (holding && blocked()) holding = false;   // a espera ao relento não sobrevive a um painel: só volta com nova pressão
    const on = clockRuns({ activity: activity(), paused, blocked: blocked() });
    if (timer && (!on || restart)) { win.clearTimeout?.(timer); timer = 0; }
    if (on && !timer) timer = win.setTimeout?.(tick, DAY_MS / speed) ?? 0;
    const changed = on !== running;
    running = on;
    return changed;
  }
  /** Retoma a ordem em curso (Continuar, Espaço, ❚❚): tira a pausa e a interrupção já vista. */
  function resume() { paused = false; interrupt = []; tributeNotice = null; }
  /** Continuar (e gancho de testes): retoma; `n` também muda a velocidade. Sem ordem em curso, o tempo continua parado. */
  function play(n) { if (n) setSpeed(n); resume(); render(); }
  function pause() { paused = true; holding = false; if (active && flow) render(); else syncClock(); }
  /** Muda e grava a velocidade; se o relógio corria, o dia seguinte conta a partir de agora. Nunca retoma o tempo. */
  function setSpeed(n) {
    if (!SPEEDS.includes(n) || n === speed) { render(); return; }
    speed = n; saveSpeed(storage, n);
    if (running) syncClock(true);
    render();
  }
  // O tempo não corre com o separador escondido (ninguém está a ver): pára, e fica parado ao voltar (a velocidade guarda-se).
  // Perder o foco da janela acaba a espera ao relento (a tecla pode ser largada noutra janela). Ouvintes registados uma vez.
  doc.addEventListener('visibilitychange', () => { if (!doc.hidden) return; space = null; if (running) pause(); else { holding = false; syncClock(); } });
  win.addEventListener('blur', () => { space = null; if (!holding) return; holding = false; if (active && flow) render(); else syncClock(); });
  /** Um dia com o tempo a correr: a ordem permanente do bando, e pára se houver motivo (issues.detectInterruptions). */
  function tick() {
    timer = 0;
    if (!clockRuns({ activity: activity(), paused, blocked: blocked() })) { if (active && flow) render(); else syncClock(); return; }
    step(standingOrder({ dest, stance }));
  }
  /** Dá um dia com a ordem `o` e trata do que veio: chegada, interrupções, batalha. Devolve o resultado do fluxo. */
  function step(o) {
    const r = order(o);
    if (!r) return r;
    if (dest && !r.refused && Math.hypot(flow.state.party.x - dest.x, flow.state.party.y - dest.y) < ARRIVAL) { const arrived = dest; const place = flow.state.world.settlements.some(x => Math.hypot(x.x - arrived.x, x.y - arrived.y) < 1); log.push(() => (place ? tMap('arrived', { name: destName(arrived) }) : tMap('arrivedPoint'))); logDirty = true; dest = null; }
    if (r.refused && o.kind === 'marchar') dest = null;
    const wasLow = memory.lowFood ?? false, wasEmpty = memory.emptyFood ?? false;
    const reasons = r.refused ? [] : detectInterruptions({ state: flow.state, events: r.events, memory, battle: r.battle });
    // B3.1: apenas transições de provisões geram mensagens. Não interrompem a marcha.
    if (!r.refused) {
      const fd = foodDays(flow.state), low = fd < LOW_FOOD_DAYS, empty = fd <= 0;
      if (low && (!wasLow || (empty && !wasEmpty))) {
        const messageKey = empty ? 'noFood' : 'foodTitle';
        log.push({ text: () => tIssue(messageKey, { duration: duration(fd) }), severe: empty });
        logDirty = true;
      }
      memory.lowFood = low;
      memory.emptyFood = empty;
    }
    // Encontro ou decisão obrigatória: pára (a ordem fica, para retomar com Continuar ou Espaço; a espera ao relento acaba).
    if (reasons.length || flow.phase !== 'mapa') { interrupt = reasons.filter(x => x.type !== 'batalha'); tributeNotice = null; paused = true; holding = false; }
    syncClock(true);   // uma ordem dada a meio de um dia reinicia o relógio: o dia seguinte vem um dia inteiro depois, não o que faltava
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
      if (['tributo-exigido', 'tributo-pago', 'tributo-recusado'].includes(ev.type)) continue;
      if (ev.type === 'capitao' && ['evolucao', 'crise', 'desertor', 'acalmou', 'fama'].includes(ev.what)) continue;   // o selo, os assuntos e o topo já o mostram
      if (t === lastSaid && log.length) { repeat += 1; log[log.length - 1] = `${t} (${repeat}.º dia)`; }
      else { lastSaid = t; repeat = 1; log.push(['emboscada-tatica', 'capitao', 'postura', 'colheita'].includes(ev.type) ? () => eventMessage(ev) : t); }
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
    const box = $('missues'), list = $('missues-list'), panel = !!((selected || capSelected) && flow.phase === 'mapa');
    box.classList.toggle('hidden', panel);
    const items = currentIssues();
    const key = `${issuesKey}:${items.map(i => i.key).join('|')}`;
    if (list.dataset.key === key) return;
    list.dataset.key = key;
    const keep = list.contains(doc.activeElement) ? doc.activeElement.dataset.issue : null;
    list.textContent = '';
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
  const pendingTributes = () => currentIssues().filter(i => i.type === 'tributo');
  const nextTribute = () => pendingTributes().find(i => !deferredTributes.has(i.key));

  function reviewButton(issue) {
    const button = el('button', '', tIssue('review'));
    button.type = 'button'; button.dataset.act = 'ver-decisao'; button.setAttribute('aria-haspopup', 'dialog');
    button.addEventListener('click', () => (issue.type === 'tributo' ? openTribute(issue.key) : openCapDecision(issue.key)));
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
    const heading = stopped ? (reasons.length || pending.length ? tIssue('decision') : tIssue('chapter')) : pending.length ? tIssue('remaining', { count: pending.length })
      : scheduled ? tIssue('chapter') : notice ? tIssue('decision') : '';
    const lines = reasons.map(reason => interruptionText(reason, flow.state, i18n));
    if (notice) lines.push(tIssue(notice.action === 'pagar' ? 'paid' : 'refused', { ...notice, name: displayName(notice.place) }));
    if (scheduled) lines.push(tIssue('nextOrder', { chapter: tIssue(`episode.${scheduled.chapter}.title`) }));
    if (stopped && pending.length && !reasons.some(x => x.type === 'pedido')) lines.push(tIssue('remaining', { count: pending.length }));
    $('m-int').classList.toggle('hidden', !(heading || lines.length));
    $('m-review').classList.toggle('hidden', !pending.length);
    $('m-int-go').classList.toggle('hidden', !stopped || map3d?.failed === true);
    const key = JSON.stringify([i18n.locale, heading, lines, reasons]);
    if (stripContent === key) return;
    stripContent = key;
    $('m-int-title').textContent = heading;
    const ul = $('m-int-list'); ul.replaceChildren();
    for (const [index, text] of lines.entries()) {
      const reason = reasons[index];
      const li = el('li', '', text);
      const capIssue = reason?.type === 'capitao' && currentIssues().find(i => i.type === (reason.event.what === 'crise' ? 'capitao-crise' : 'capitao-desertor')
        && (i.captain ?? null) === (reason.event.what === 'crise' ? reason.event.id : null));
      if (capIssue) {
        const button = el('button', 'link', text); button.type = 'button';
        button.addEventListener('click', () => openCapDecision(capIssue.key));
        li.replaceChildren(button);
      } else if (reason?.place || reason?.at || reason?.type === 'comida') {
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
    selected = id; capSelected = null; if (narrow()) setSide(true);
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
    if (c) {   // um capitão da comunidade (captains.captainAt): só se mostra quando o jogador pode fazer algo por isso
      const k = captainAt(flow.state, c.id, { inReach: here });
      if (k.archetype && [null, 'postura', 'longe', 'custo'].includes(k.why)) {
        const label = tCap('recruit', { archetype: tCap(`archetype.${k.archetype}`) });
        out.push(k.why ? { id: 'capitao', label, why: tCap(`recruitNo.${k.why}`), run: null }
          : { id: 'capitao', label, info: tCap('recruitInfo', CAPTAIN_RULES.recruit), run: () => { const r = flow.recruitCaptain(s.id); if (r.ok) say(r.events); render(); } });
      }
    }
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
    ul.replaceChildren(...log.slice(-LOG_LINES).map(line => {
      const content = typeof line === 'function' ? line() : typeof line === 'object' && line !== null
        ? (typeof line.text === 'function' ? line.text() : line.text) : line;
      return el('li', typeof line === 'object' && line !== null && line.severe ? 'warn' : null, content);
    }));
  }

  // --- capitães (captains.js): selos no rodapé, ficha no painel lateral, decisões num painel temporário ---
  const tCap = (key, params) => tMap(`captains.${key}`, params);
  const ROMAN = ['', 'I', 'II', 'III', 'IV'];
  const GLYPH = {   // traço de pena, na cor do bronze: lua, funda, martelo, saco, chama, elmo
    batedor: '<path d="M15.5 3.5a8.5 8.5 0 1 0 5 13.5 6.8 6.8 0 0 1-5-13.5z"/><path d="M8.5 12.5h4"/>',
    fundibulario: '<circle cx="12" cy="16" r="2.6"/><path d="M3.5 5.5c2.6 6.2 14.4 6.2 17 0"/><path d="M12 10.5v2.9"/>',
    ferreiro: '<path d="M10.5 9.5 4 20"/><path d="M8 7.5l3-3.5 6 1.5 2.5 3-2 3.5-4.5-1z"/>',
    saqueador: '<path d="M9.5 4h5l-1.2 3.2c3.4 1 5.7 4.4 5 8.3-.7 4.3-11.9 4.3-12.6 0-.7-3.9 1.6-7.3 5-8.3z"/><path d="M9.8 7.2h4.4"/>',
    incendiario: '<path d="M12 3.2c.8 3.6 5.6 5.4 4.8 10.3a4.9 4.9 0 0 1-9.6 0c0-2.6 1.6-3.7 2-6.2 1 1.6 1.7 2.4 2.7 2.6.4-2.4-.6-4.4.1-6.7z"/>',
    veterano: '<path d="M5.5 15a6.5 6.5 0 0 1 13 0v3.5h-13z"/><path d="M12 8.5V4"/><path d="M8 4.5h8"/><path d="M9 18.5v-3h6v3"/>',
  };
  const TRAIT_GLYPH = {   // o mesmo traço de pena dos selos: escudo, moeda, galinha, folha, trilho, punhal, coruja, torque, mão, garras
    'duro-de-roer': '<path d="M12 3.5 5 6v5.5c0 4.2 3 7.2 7 9 4-1.8 7-4.8 7-9V6z"/><path d="M12 8v8M8.5 11.5h7"/>',
    'olho-no-ouro': '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3.8"/><path d="M12 4.5v3.2"/>',
    'ladrao-de-galinhas': '<path d="M7 14c0-3.5 2-6 5-6 2.5 0 4 1.5 4 3.5 0 1 .6 1.7 1.5 2-1 2.8-3.5 4.5-6.5 4.5C8.5 18 7 16.5 7 14z"/><path d="M13.5 8.5c0-1.5.8-2.5 2-2.5"/><path d="M17.2 11.2l2 .8-2 .8"/>',
    'emboscador-nato': '<path d="M4.5 19C5 10 11 5 19.5 4.5c-.5 8.5-5.5 14.5-15 14.5z"/><path d="M4.5 19 14 9.5"/>',
    'conhecedor-dos-trilhos': '<path d="M4 20c2-4 5-5 8-5s5-3 4-6-4-4-6-2"/><path d="M6 17.5h.01M9.5 15h.01M13 13.5h.01"/>',
    vingativo: '<path d="M12 3 14 12h-4z"/><path d="M12 12v5"/><path d="M8.5 17h7"/><path d="M12 17v3.5"/>',
    'olhos-de-coruja': '<circle cx="8.5" cy="11" r="3.2"/><circle cx="15.5" cy="11" r="3.2"/><path d="M5 6.5 8.5 8M19 6.5 15.5 8M12 14.5l-1 2h2z"/>',
    'querido-do-povo': '<path d="M6 15a6.5 6.5 0 1 1 12 0"/><circle cx="6" cy="15.5" r="1.4"/><circle cx="18" cy="15.5" r="1.4"/><path d="M8.5 19h7"/>',
    'mao-ferida': '<path d="M8.5 20v-5l-2-3c-.5-.9.6-1.8 1.4-1l1.6 1.8V6c0-1.2 1.8-1.2 1.8 0v5.5V5c0-1.2 1.8-1.2 1.8 0v6.5V6c0-1.2 1.8-1.2 1.8 0V15c0 3-1 4-2 5z"/><path d="M7 15.5l9-3"/>',
    'rancor-a-roma': '<path d="M7 4.5l5 15M11 4l4.5 14M15 4.5l3.5 11"/>',
  };
  const svgOf = paths => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
  const cardsOf = c => c.traits.filter(t => TRAITS[t]);   // as cartas: as cicatrizes contam à parte
  /** Uma lista de linhas curtas (a chave guarda uma por linha): «+» benefício, «−» custo; o marcador é só desenho, o leitor de ecrã ouve «Ganho» ou «Custo». */
  function fxList(text, kind) {
    const ul = el('ul', `fx ${kind}`);
    for (const line of String(text).split('\n')) {
      const li = el('li'), mark = el('i', null, kind === 'gain' ? '+' : '−'); mark.setAttribute('aria-hidden', 'true');
      li.append(mark, el('span', 'sr', `${tCap(kind)}: `), line);
      ul.append(li);
    }
    return ul;
  }
  /** O interior de uma carta (traço ou cicatriz), igual na ficha e na escolha ao subir de nível: medalhão, título, raridade, ganho e custo. */
  function cardInner(id) {
    const kind = SCARS[id] ? 'cicatriz' : TRAITS[id].rarity;
    const med = el('span', 'med'); med.innerHTML = svgOf(TRAIT_GLYPH[id] ?? '');
    const head = el('span', 't'); head.append(el('b', null, tCap(`trait.${id}`)), el('small', null, tCap(`rarity.${kind}`)));
    const body = el('span', 'cbody'); body.append(head, fxList(tCap(`traitGain.${id}`), 'gain'), fxList(tCap(`traitCost.${id}`), 'cost'));
    return { kind, nodes: [med, body] };
  }
  let capSelected = null, capKey = null, capsKey = '', capPanelKey = '', capDlgKey = '';
  const capOf = id => flow.state.captains?.find(c => c.id === id) ?? null;
  const ringOf = l => (l <= CAPTAIN_RULES.loyalty.crisis ? '#c8382a' : l < 50 ? '#c07a32' : '#d8b25e');
  const capName = id => tCap(`archetype.${id}`);
  function captainLog(ev) {
    const key = ev.what === 'desertou' && ev.men ? 'desertouMen' : ev.what;
    return tCap(`log.${key}`, { ...ev, archetype: ev.archetype ? capName(ev.archetype) : '', card: ev.card ? tCap(`trait.${ev.card}`) : '',
      scar: ev.scar ? tCap(`trait.${ev.scar}`) : '', fame: ev.fame > 0 ? `+${ev.fame}` : ev.fame });
  }
  function selectCaptain(id) {
    if (!active || !flow || flow.phase !== 'mapa') return;
    capSelected = id;
    if (id) { selected = null; if (narrow()) setSide(true); }
    render();
    if (id) { $('mside').scrollTop = 0; $('mcap').querySelector('h3')?.focus?.({ preventScroll: true }); }   // a ficha abre sempre vista de cima
    else $('m-captains').querySelector('.cap')?.focus?.();
  }
  /** Os selos: um por capitão, com a lealdade no anel, o nível e um ponto quando há uma decisão dele à espera. */
  function renderCaptains() {
    const box = $('m-captains'), list = flow.state.captains || [];
    const key = JSON.stringify([i18n.locale, capSelected, list.map(c => [c.id, c.level, c.loyalty, c.active, !!c.offer, !!c.crisis, c.traits.length])]);
    if (key === capsKey) return;
    capsKey = key;
    const had = box.contains(doc.activeElement) ? doc.activeElement.dataset.cap : null;
    box.textContent = '';
    for (const c of list) {
      const b = el('button', `cap${c.active ? '' : ' reserve'}${c.crisis ? ' crisis' : ''}`); b.type = 'button'; b.dataset.cap = c.id;
      b.style.setProperty('--l', c.loyalty); b.style.setProperty('--ring', ringOf(c.loyalty));
      const status = c.crisis ? tCap('issue.crisis', { name: c.name }) : c.offer ? tCap('pending') : null;
      const head = tCap(c.active ? 'tip' : 'tipReserve', { name: c.name, archetype: capName(c.archetype), level: c.level, loyalty: c.loyalty, cards: cardsOf(c).length, max: CAPTAIN_RULES.cards.maxTraits });
      b.title = [head, status, tCap(`passive.${c.archetype}`).split('\n')[0]].filter(Boolean).join('\n');
      b.setAttribute('aria-label', [head, status].filter(Boolean).join(' · '));
      b.setAttribute('aria-pressed', capSelected === c.id ? 'true' : 'false');
      const face = el('span', 'face'); face.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${GLYPH[c.archetype]}</svg>`;
      b.append(face, el('span', 'lvl', ROMAN[c.level]));
      if (c.offer || c.crisis) b.append(el('span', 'dot'));
      b.addEventListener('click', () => selectCaptain(capSelected === c.id ? null : c.id));
      box.append(b);
    }
    if (had) box.querySelector(`[data-cap="${CSS_ESC(had)}"]`)?.focus?.();
  }
  /** A ficha do capitão escolhido, no lugar dos assuntos: cabeçalho, natureza inata, cartas (e cicatrizes) e o que lhe mexeu na lealdade. */
  function renderCaptain() {
    const box = $('mcap'), c = capSelected && flow.phase === 'mapa' ? capOf(capSelected) : null;
    if (capSelected && !c) capSelected = null;
    box.classList.toggle('hidden', !c);
    if (!c) { capPanelKey = ''; return; }
    const full = !c.active && activeCaptains(flow.state).length >= CAPTAIN_RULES.active;
    const pending = currentIssues().filter(i => i.captain === c.id);
    const key = JSON.stringify([i18n.locale, c, full, flow.state.day, pending.map(i => i.key)]);
    if (key === capPanelKey) return;
    capPanelKey = key;
    box.textContent = '';
    const head = (title, note) => { const h = el('h4', null, title); if (note) h.append(el('span', null, note)); return h; };
    const back = el('button', 'back', tCap('back')); back.type = 'button'; back.addEventListener('click', () => selectCaptain(null));
    const seal = el('span', 'seal'); seal.style.setProperty('--l', c.loyalty); seal.style.setProperty('--ring', ringOf(c.loyalty));
    const face = el('span', 'face'); face.innerHTML = svgOf(GLYPH[c.archetype]);
    seal.append(face, el('span', 'lvl', ROMAN[c.level]));
    const h = el('h3', null, c.name); h.id = 'mcap-name'; h.tabIndex = -1;
    const who = el('div', 'who'); who.append(h, el('p', 'sub', `${capName(c.archetype)} · ${c.active ? tCap('active') : tCap('reserve')}`));
    const top = el('div', 'head'); top.append(seal, who);
    box.append(back, top);
    const meter = (label, fraction, color, value) => {
      const row = el('div', 'meter'), bar = el('span', 'bar'), fill = el('i'); fill.style.width = `${fraction * 100}%`; fill.style.background = color; bar.append(fill);
      row.append(el('span', null, label), bar, el('b', null, value)); return row;
    };
    const next = CAPTAIN_RULES.xp.levels[c.level - 1];
    box.append(meter(tCap('loyaltyLabel'), c.loyalty / 100, ringOf(c.loyalty), c.loyalty),
      meter(tCap('level', { level: ROMAN[c.level] }), next === undefined ? 1 : c.xp / next, '#8a6a42', next === undefined ? tCap('xpMax') : tCap('xpPair', { xp: c.xp, next })));
    for (const i of pending) {
      const row = el('div', 'act'), b = el('button', null, i.type === 'capitao-evolucao' ? tCap('pending') : tCap('resolve'));
      b.type = 'button'; b.setAttribute('aria-haspopup', 'dialog'); b.addEventListener('click', () => openCapDecision(i.key));
      row.append(b, el('small', null, i.title)); box.append(row);
    }
    // a natureza do arquétipo: inata, numa placa, para não se confundir com as cartas que a progressão dá
    const plaque = el('div', 'plaque'), pm = el('span', 'med'), pb = el('span', 'cbody');
    pm.innerHTML = svgOf(GLYPH[c.archetype]);
    pb.append(el('b', null, capName(c.archetype)), fxList(tCap(`passive.${c.archetype}`), 'gain'), fxList(tCap(`costs.${c.archetype}`), 'cost'));
    plaque.append(pm, pb);
    box.append(head(tCap('nature'), tCap('natureNote')), plaque);
    // as cartas (até ao máximo; as ranhuras livres ficam vazias) e, à parte, as cicatrizes
    const cards = cardsOf(c), max = CAPTAIN_RULES.cards.maxTraits, list = el('ul', 'cards');
    for (const id of cards) { const { kind, nodes } = cardInner(id), li = el('li', `ccard ${kind}`); li.append(...nodes); list.append(li); }
    for (let n = cards.length; n < max; n++) { const li = el('li', 'ccard slot', ROMAN[n + 1]); li.setAttribute('aria-label', tCap('slot')); list.append(li); }
    box.append(head(tCap('cards'), tCap('cardsOf', { n: cards.length, max })), list);
    const scars = c.traits.filter(t => SCARS[t]);
    if (scars.length) {
      const sl = el('ul', 'cards');
      for (const id of scars) { const { kind, nodes } = cardInner(id), li = el('li', `ccard ${kind}`); li.append(...nodes); sl.append(li); }
      box.append(head(tCap('scars')), sl);
    }
    if (c.notes?.length) {
      box.append(head(tCap('recent')));
      const ul = el('ul', 'notes');
      for (const n of c.notes) {
        const li = el('li', n.d > 0 ? 'up' : 'down');
        li.append(el('b', null, `${n.d > 0 ? '+' : '−'}${Math.abs(n.d)}`), ` ${tCap(`why.${n.why}`)}`);
        if (n.day !== flow.state.day) li.append(el('span', 'dim', ` · ${tIssue('ago', { duration: duration(flow.state.day - n.day) })}`));
        ul.append(li);
      }
      box.append(ul);
    }
    const row = el('div', 'act'), toggle = el('button', null, c.active ? tCap('toReserve') : tCap('toBand'));
    toggle.type = 'button';
    if (full) { toggle.disabled = true; row.append(toggle, el('small', null, tCap('full'))); }
    else { toggle.addEventListener('click', () => { flow.setCaptainActive(c.id, !c.active); render(); }); row.append(toggle); }
    box.append(row);
  }
  function openCapDecision(key) {
    if (!active || flow.phase !== 'mapa' || decisionOverlay || !currentIssues().some(i => i.key === key)) return;
    capKey = key; render();
  }
  function closeCapDecision() { if (decisionOverlay === $('mcapdlg')) { capKey = null; render(); } }
  const capBlocked = (issue, id) => (issue.type === 'capitao-crise' && id === 'parte'
    && (flow.state.food < CAPTAIN_RULES.loyalty.share.food || flow.state.arms < CAPTAIN_RULES.loyalty.share.arms) ? tCap('issue.noShare')
    : issue.type === 'capitao-desertor' && id === 'aceitar' && flow.state.captains.length >= CAPTAIN_RULES.max ? tCap('issue.full') : null);
  /** O painel temporário: escolher um traço, resolver uma crise de lealdade ou responder ao desertor. */
  function renderCapDialog() {
    const panel = $('mcapdlg'), issue = capKey ? currentIssues().find(i => i.key === capKey) : null;
    if (capKey && !issue) capKey = null;
    panel.classList.toggle('hidden', !issue);
    if (!issue) { capDlgKey = ''; return; }
    const key = JSON.stringify([i18n.locale, issue.key, flow.state.food, flow.state.arms, flow.state.captains.length, running]);
    if (key === capDlgKey) return;
    capDlgKey = key;
    $('mcapdlg-kicker').textContent = issue.deadline == null ? tIssue('decision') : `${tIssue('decision')} · ${tIssue('deadline', { duration: duration(issue.deadline) })}`;
    $('mcapdlg-title').textContent = issue.title;
    $('mcapdlg-detail').textContent = issue.detail ?? '';
    $('mcapdlg-consequence').textContent = issue.consequence ?? '';
    const box = $('mcapdlg-options');
    box.textContent = '';
    for (const a of issue.actions) {
      const b = el('button', 'decision-choice'); b.type = 'button'; b.dataset.act = a.id;
      if (issue.type === 'capitao-evolucao') { const { kind, nodes } = cardInner(a.id); b.classList.add('ccard', kind); b.append(...nodes); }   // a mesma carta da ficha
      else { b.append(el('b', null, a.label)); if (a.info) b.append(el('small', null, a.info)); }
      const why = capBlocked(issue, a.id);
      if (why) { b.disabled = true; b.append(el('small', 'cost', why)); }
      else b.addEventListener('click', () => applyCapDecision(issue, a.id));
      box.append(b);
    }
  }
  function applyCapDecision(issue, id) {
    if (!active || flow.phase !== 'mapa' || decisionOverlay !== $('mcapdlg')) return;
    const r = issue.type === 'capitao-evolucao' ? flow.chooseCard(issue.captain, id)
      : issue.type === 'capitao-crise' ? flow.answerCrisis(issue.captain, id) : flow.answerDeserter(id === 'aceitar');
    if (r.ok) { capKey = null; say(r.events); interrupt = interrupt.filter(x => x.type !== 'capitao' || currentIssues().some(i => i.type.startsWith('capitao-') && i.deadline != null)); }
    render();
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
    renderCaptains(); renderCaptain(); renderCapDialog();
    syncDecisionOverlay(flow.phase === 'batalha' ? $('mbattle') : tributeKey ? $('mtribute') : capKey ? $('mcapdlg') : null);
    if (diaryOpen()) renderDiary();
    const busy = flow.phase !== 'mapa' || map3d?.failed === true;
    for (const b of $('map').querySelectorAll('#mbot [data-act], #m-time [data-speed], #m-pause')) b.disabled = busy;
    if (busy) { paused = true; holding = false; }   // batalha, fim ou mapa falhado: no regresso o tempo está parado e a ordem fica
    if (syncClock()) { renderTop(); renderStatus(); }
  }

  // --- reconhecimento ---
  const inRecon = p => Math.hypot(p.x - flow.state.party.x, p.y - flow.state.party.y) <= reconRange(flow.state, RECON_RANGE);
  const sameReconClick = event => event && reconClick && event.timeStamp >= reconClick.t && event.timeStamp - reconClick.t < 600 &&
    Math.hypot(event.clientX - reconClick.x, event.clientY - reconClick.y) <= 8;

  // --- Diário ---
  let diaryTab = 'campanha', diaryOpener = null, archive = false;
  const diaryOpen = () => !$('mdiary').classList.contains('hidden');
  function openDiary(tab) {
    if (!active || !flow || decisionOverlay) return;
    diaryOpener = doc.activeElement; if (tab) diaryTab = tab;
    $('mdiary').classList.remove('hidden'); render();
    $('mdiary-tabs').querySelector('[aria-selected="true"]')?.focus?.();
  }
  function closeDiary() { if (!diaryOpen()) return; $('mdiary').classList.add('hidden'); diaryOpener?.focus?.(); diaryOpener = null; render(); }
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
    if (hit.type === 'party') return flow.state.party;
    if (hit.type === 'settlement') return settlement(hit.id);
    return intelView(flow.state).forces.find(force => force.id === hit.id);
  }

  /** O bando é também o «parar» da marcha em curso (era o botão «Ir»). Com o reconhecimento armado o clique é do reconhecimento. */
  function stopOrder() {
    if (mode || !dest) return false;
    setDest(null);
    return true;
  }

  function mapAction(hit, at, event) {
    if (!active || flow.phase !== 'mapa' || decisionOverlay || !at) return;
    if (hit?.type === 'party') { stopOrder(); return; }
    if (mode === 'reconhecer') {
      reconClick = event ? { t: event.timeStamp, x: event.clientX, y: event.clientY } : null;
      mode = null;
      step({ kind: 'reconhecer', to: { x: at.x, y: at.y } });
      return;
    }
    if (sameReconClick(event)) return;
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
    const p = toWorld(view, { x: sx, y: sy });
    const onBand = [shown, flow.state.party].some(b => b && Math.hypot(toScreen(view, b).x - sx, toScreen(view, b).y - sy) <= 14);   // o marcador ou o ponto onde chega
    if (onBand && stopOrder()) return;
    if (illustrated && !hit && outsideWorld(p)) return;
    mapAction(hit, illustrated && hit ? pointAt(hit) : p, e);
  }
  if (legacyMapForTests && !navigation) $('mapcv').addEventListener('click', mapClick);
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
    const { sx, sy } = mapPoint(e);
    canvasHover(sx,sy);
  }
  function outsideWorld(p) {
    return p.x < 0 || p.y < 0 || p.x > view.world.w || p.y > view.world.h;
  }
  function canvasHover(sx,sy) {
    if (!active || !flow || flow.phase !== 'mapa' || !view) return;
    const hit = hitTest(view, flow.state, sx, sy);
    const ground = toWorld(view, { x: sx, y: sy });
    if (illustrated && !hit && outsideWorld(ground)) {
      $('mapcv').style.cursor = 'grab'; updateHover(null, null); return;
    }
    const at = illustrated && hit ? pointAt(hit) : hit?.type === 'settlement' ? settlement(hit.id) : ground;
    $('mapcv').style.cursor = hit ? 'pointer' : 'crosshair';
    updateHover(hit, at);
  }
  if (legacyMapForTests && !navigation) {
    $('mapcv').addEventListener('mousemove', pointerMove);
    $('mapcv').addEventListener('mouseleave', () => {
      $('mapcv').style.cursor = 'crosshair';
      updateHover(null, null);
    });
  }

  // --- botões ---
  $('m-ambush').addEventListener('click', () => { if (active && flow?.phase === 'mapa') setStance('esperar'); });
  $('m-hide').addEventListener('click', () => { if (active && flow?.phase === 'mapa') setStance('esconder'); });
  $('m-camp').addEventListener('click', () => { if (active && flow?.phase === 'mapa') setStance('acampar'); });
  $('m-recon').addEventListener('click', () => { if (active && flow?.phase === 'mapa') setMode('reconhecer'); });
  $('m-diary').addEventListener('click', () => (diaryOpen() ? closeDiary() : openDiary()));
  $('mdiary-close').addEventListener('click', closeDiary);
  for (const b of $('mdiary-tabs').querySelectorAll('[role="tab"]')) b.addEventListener('click', () => { diaryTab = b.dataset.tab; archive = false; renderDiary(); b.focus(); });
  $('mdiary-tabs').addEventListener('keydown', e => {
    const tabs = [...$('mdiary-tabs').querySelectorAll('[role="tab"]')], i = tabs.findIndex(t => t.dataset.tab === diaryTab);
    const j = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
    if (j < 0) return; e.preventDefault(); diaryTab = tabs[j].dataset.tab; renderDiary(); tabs[j].focus();
  });
  $('m-pause').addEventListener('click', () => { if (!active || flow?.phase !== 'mapa') return; if (running) pause(); else if (ordered()) play(); });
  for (const b of $('m-time').querySelectorAll('[data-speed]')) b.addEventListener('click', () => { if (active && flow?.phase === 'mapa') setSpeed(Number(b.dataset.speed)); });
  $('m-int-go').addEventListener('click', () => { play(); if (running) $('m-pause').focus(); });
  $('m-review').addEventListener('click', () => {
    const issue = nextTribute() ?? pendingTributes()[0];
    if (issue) openTribute(issue.key);
  });
  $('mtribute-later').addEventListener('click', deferTribute);
  $('mcapdlg-later').addEventListener('click', closeCapDecision);
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
      const ent = localizedChronicleEntry('vetilio', i18n), line = ent.text.split(/(?<=\.)\s+/).find(x => x.includes('Periochae')) || ent.title;
      const c = doc.createElement('cite'); c.textContent = ent.citation;
      chron.append(line, c);
    }
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
  function suspend() { navigation?.stop(); pause(); map3d?.suspend(); stopMarch(); hover = null; active = false; $('map').classList.add('hidden'); }
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
    const ul = $('mcron-list');
    const focused = [...ul.children].indexOf(doc.activeElement), scrollTop = ul.scrollTop;
    ul.textContent = '';
    for (const entry of chronicleEntries(flow?.state, i18n)) {
      const li = doc.createElement('li'); li.tabIndex = 0;
      if (!entry) {
        li.classList.add('locked');
        const p = doc.createElement('p'); p.id = `mcron-locked-${ul.children.length}`; p.textContent = i18n.t('interface.chronicleLocked'); li.append(p);
        li.setAttribute('aria-labelledby', p.id);
      } else {
        const { id, title, sourceLabel, text, citation } = entry;
        li.dataset.entry = id;
        const h = doc.createElement('h3'); h.id = 'mcron-h-' + id; h.textContent = title; li.append(h);
        li.setAttribute('aria-labelledby', h.id);
        const chip = doc.createElement('span'); chip.className = 'chip'; chip.id = 'mcron-s-' + id; chip.textContent = sourceLabel; li.append(chip);
        const p = doc.createElement('p'); p.className = 'txt'; p.id = 'mcron-t-' + id; p.textContent = text; li.append(p);
        const desc = [chip.id, p.id];
        if (citation) { const c = doc.createElement('p'); c.className = 'cit'; c.id = 'mcron-c-' + id; c.textContent = citation; li.append(c); desc.push(c.id); }
        li.setAttribute('aria-describedby', desc.join(' '));
      }
      ul.append(li);
    }
    ul.children[focused]?.focus({ preventScroll: true });
    ul.scrollTop = scrollTop;
  }
  function openChronicle(opener) {
    if (!flow || cronOpen()) return;
    cronOpener = opener || doc.activeElement;
    $('mcron').classList.remove('hidden');
    renderChronicle(); if (active) render(); else syncClock();
    $('mcron-list').scrollTop = 0;
    $('mcron-list').firstElementChild?.focus?.();
  }
  function closeChronicle() {
    if (!cronOpen()) return;
    $('mcron').classList.add('hidden');
    cronOpener?.focus?.(); cronOpener = null;
    if (active) render(); else syncClock();
  }
  $('m-cronica').addEventListener('click', () => { if (active && flow) openChronicle($('m-cronica')); });
  $('mend-cronica').addEventListener('click', () => { if (active && flow?.phase === 'fim') openChronicle($('mend-cronica')); });
  $('mcron-close').addEventListener('click', closeChronicle);
  $('mcron').addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const items = [...$('mcron-list').children, $('mcron-close')], first = items[0], last = items.at(-1);
    if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  $('mcron-list').addEventListener('keydown', e => {
    const li = e.target.closest?.('li'); if (!li) return;
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
    // Espaço contextual (num botão qualquer carrega nele, salvo nos do tempo): com uma ordem em curso pausa ou retoma; com o
    // bando parado, premido, espera ao relento até o largar. Cada pressão decide uma vez o que faz (`space`) e ignora a
    // repetição automática: a mesma pressão nunca pausa a marcha e começa a esperar.
    if (e.code === 'Space' && flow.phase === 'mapa' && (e.target?.tagName !== 'BUTTON' || e.target.closest?.('#m-time'))) {
      e.preventDefault();
      if (e.repeat || space) return;
      if (ordered()) { space = 'toggle'; if (running) paused = true; else resume(); }
      else { space = 'hold'; resume(); holding = true; }
      render(); return;
    }
    if (flow.phase !== 'mapa') return;
    // setas: um dia de marcha para norte/sul/este/oeste como destino (o mapa também se joga sem rato)
    const dir = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.code];
    if (!dir || e.target?.closest?.('#mside, #mtop, #mbot')) return;
    e.preventDefault();
    const p = flow.state.party;
    setDest({ x: p.x + dir[0] * MARCH_SPEED, y: p.y + dir[1] * MARCH_SPEED });
  });
  win.addEventListener('keyup', e => {   // largar o Espaço acaba a espera ao relento (mesmo com um painel ou campo à frente)
    if (e.code !== 'Space') return;
    const was = space; space = null;
    if (was === 'hold' && holding) { holding = false; if (active && flow) render(); else syncClock(); }
  });
  win.addEventListener('keydown', e => {
    if (!active || !decisionOverlay || tacticalArena) return;
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopImmediatePropagation();
      if (decisionOverlay === $('mtribute')) deferTribute();
      else if (decisionOverlay === $('mcapdlg')) closeCapDecision();
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
    if (capSelected) { selectCaptain(null); return; }
    if (selected) { unpick(); return; }
    if (narrow() && sideOpen()) { setSide(false); return; }
    close();
  });

  function open(f) {
    tacticalArena?.dispose(); tacticalArena = null; tacticalNotice = null;
    pause();
    syncDecisionOverlay(null); tributeKey = null; tributeNotice = null; tributeContent = ''; deferredTributes.clear();
    capSelected = null; capKey = null; capsKey = ''; capPanelKey = ''; capDlgKey = '';
    reconClick = null;
    flow = f; active = true; selected = null; log.length = 0; logDirty = true; lastSaid = null; repeat = 1;
    stopMarch(); shown = null; hover = null; facing = 1; trail.length = 0; mode = null; dest = null; stance = null;
    paused = false; holding = false; space = null;   // ao abrir, o bando está parado: o tempo não passa até haver ordem
    memory = {}; interrupt = []; dismissed = new Set(); flash = {}; focus = null; issuesKey = ''; ctxKey = '';
    detectInterruptions({ state: flow.state, events: [], memory });   // o que já se sabe ao abrir não interrompe
    $('mcron').classList.add('hidden'); cronOpener = null; $('mdiary').classList.add('hidden'); setSide(!narrow());
    if (!flow.state.day) log.push(() => tMap('welcome', { men: WIN_MEN, fame: WIN_FAME }));
    if (!flow.state.day) {
      const initial = flow.state.intel?.reports?.find(r => r.src === 'inicio' && r.got <= flow.state.day);
      if (initial) log.push(reportText(initial, flow.state));
    }
    $('map').classList.remove('hidden');
    render();
  }
  function close() {
    navigation?.stop();
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
    if (cronOpen()) renderChronicle();
  });
  return {
    open, close, render, order, openChronicle, closeChronicle, openDiary, closeDiary, simulateBattle, suspend, battleDone,
    select: id => { if (id) pick(id); else { selected = null; render(); } }, view: () => view,
    /** O tempo: pause(), play(n?) com n em SPEEDS, e o estado. step() dá um dia com a ordem permanente (testes). */
    pause, play, setSpeed, step: () => step(standingOrder({ dest, stance })), get running() { return running; }, get speed() { return speed; },
    get paused() { return paused; }, get holding() { return holding; }, get activity() { return activity(); },
    get dest() { return dest; }, get stance() { return stance; }, get interrupt() { return interrupt.slice(); },
    get flow() { return flow; }, get active() { return active; }, mapMetrics: () => map3d?.metrics(),
    hasSave: () => !!loadFlow(storage),
    saveState: () => { const f = loadFlow(storage); return f ? (f.phase === 'fim' ? 'fim' : 'meio') : null; },
    savedState: () => loadFlow(storage)?.state ?? null,
    resume: () => { const f = loadFlow(storage); if (f) open(f); return !!f; },
    fresh: seed => { open(createFlow({ storage, seed })); return flow; },
  };
}
