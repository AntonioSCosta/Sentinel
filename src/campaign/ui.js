// Ecrã do mapa da campanha: HUD em HTML + canvas 2D. Liga o DOM ao Flow; não conhece Three.js nem as batalhas 3D.
import { makeView, drawMap, hitTest, toWorld, agoLabel } from './map-view.js';
import { intelView, estimateMen, SCOUTS, RECON_RANGE, RECON_RADIUS } from './intel.js';
import { createFlow, loadFlow, clearSave, WIN_MEN, WIN_FAME } from './flow.js';
import { dateLabel, season, daysLeft, YEAR_DAYS } from './clock.js';
import { entryFor, CHRONICLE, SOURCE_LABELS, isUnlocked } from './chronicle.js';
import { isBridged, isStory } from './bridge.js';
import { START } from './state.js';
import { MARCH_SPEED } from './simulation.js';

/** Relatos de Roma (doctrine.js): o que muda quando uma contramedida entra e quando sai. */
const DOCTRINE_TEXT = {
  batedores: ['Relato: as patrulhas romanas trazem agora batedores a cavalo à frente. Emboscar patrulhas deixou de resultar.', 'Relato: as patrulhas deixaram de levar batedores.'],
  escolta: ['Relato: as colunas de abastecimento saem agora com escolta reforçada.', 'Relato: as colunas voltaram à escolta habitual.'],
  forca: ['Relato: as patrulhas romanas andam agora em força.', 'Relato: as patrulhas voltaram ao número habitual.'],
  guarnicao: ['Relato: Roma guarneceu o troço da estrada onde mais atacaste.', 'Relato: a guarnição deixou a estrada.'],
  cacadores: ['Relato: Roma decidiu caçar o bando.', 'Relato: Roma deixou de te caçar, por agora.'],
};

const BAR_TOP = 52, BAR_BOTTOM = 64; // alturas das barras HTML (px) que o canvas deixa livres
const LOG_LINES = 6;
const BATTLE_NAMES = {
  emboscada: 'Emboscada', 'campo-aberto': 'Combate em campo aberto', 'defesa-aldeia': 'Defesa da aldeia',
  'assalto-coluna': 'Assalto a um comboio', retirada: 'Retirada', decisiva: 'A batalha decisiva', historica: 'Um episódio da guerra',
};
const RELIABILITY = { certa: 'visto pelos teus', boa: 'fiável', fraca: 'pouco fiável' };
const KIND_NAMES = { aldeia: 'Aldeia', castro: 'Castro', posto: 'Posto romano', serra: 'Serra' };
/** Episódios históricos: título e uma linha sóbria; o que é invenção diz-se (ver a Crónica). */
const EPISODES = {
  cativos: ['Os Cativos', 'Cena inspirada nas consequências da traição de Galba (ver a Crónica): uma coluna romana leva cativos para serem vendidos e parou numa clareira. Viriato vai com dois homens.'],
  acampamento: ['O acampamento', 'Invenção do jogo: o posto guarda os mantimentos da guarnição. Entra sem dar o alarme, queima os três depósitos e derruba o centurião.'],
};
const REACH = 20;   // a esta distância (no mapa) já se está no lugar
/** Estado de um lugar, para o painel e a lista: «queimada», «tomado», «já atacado» ou nada. */
function placeState(s, state) {
  if (s.kind === 'aldeia' && state.villages?.[s.id]?.burnt) return 'queimada';
  if (s.kind === 'posto' && state.posts && s.id in state.posts) return state.posts[s.id].taken ? 'tomado' : 'já atacado';
  return '';
}
/** «Aldeia do Vale — aldeia, 3 dias»: dias de marcha do bando até lá. */
export function placeLabel(s, state) {
  const d = Math.hypot(s.x - state.party.x, s.y - state.party.y), days = d <= REACH ? 0 : Math.ceil((d - REACH) / MARCH_SPEED) || 1;
  const st = placeState(s, state);
  return `${s.name} — ${s.kind}${st ? ' ' + st : ''}, ${days ? `${days} ${days === 1 ? 'dia' : 'dias'}` : 'aqui'}`;
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
  const place = id => state.world.settlements.find(s => s.id === id)?.name;
  const nearest = () => state.world.settlements.reduce((a, b) => (Math.hypot(b.x - r.x, b.y - r.y) < Math.hypot(a.x - r.x, a.y - r.y) ? b : a)).name;
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

/** Uma frase curta (pt-PT) por evento devolvido por flow.order()/finishBattle(); `dayEvents` são os outros eventos do mesmo dia. */
export function eventText(ev, state, dayEvents = []) {
  const name = id => state.world.settlements.find(s => s.id === id)?.name ?? 'o povoado';
  switch (ev.type) {
    case 'recrutou': return ev.men ? `${name(ev.id)}: ${ev.men} homens juntam-se a ti.` : `${name(ev.id)}: ninguém tem armas para dar.`;
    case 'recrutar-cedo': return `${name(ev.id)}: já recrutaste aqui há pouco${ev.days ? `; volta daqui a ${days(ev.days)}` : ''}. ${KEEP_DAY}`;
    case 'sem-armas': return `Não tens armas para equipar recrutas. ${KEEP_DAY}`;
    case 'posto-atacado': return `${name(ev.id)}: este posto já foi atacado, e só se ataca uma vez. ${KEEP_DAY}`;
    case 'ajuda': return `${name(ev.id)} dá-te ${ev.food} de comida${ev.men ? ` e ${ev.men} homens` : ''}.`;
    case 'ajuda-recusada': return `${name(ev.id)}: ainda não podem dar mais ajuda${ev.days ? `; volta daqui a ${days(ev.days)}` : ''}. ${KEEP_DAY}`;
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

const FOE_WHO = { patrulha: 'uma patrulha romana', comboio: 'um comboio romano', cacadores: 'uma coluna de caçadores', posto: 'a guarnição do posto' };
const CONTEXT_TEXT = {
  emboscada: 'Esperavas na estrada e caíram na emboscada.',
  descoberta: 'Esperavas na estrada, mas descobriram a emboscada: a luta é a descoberto.',
  'fora-estrada': 'Esperavas longe da estrada: deram convosco antes de os poderes emboscar.',
  encontro: 'Esbarraste com eles em campo aberto.',
  cacadores: 'Os caçadores deram com o rasto do bando.',
  ataque: 'Atacas o posto.',
};
/**
 * O texto do painel de batalha: quem é a força, quantos são, porque se luta e o que está em jogo.
 * Só usa a especificação da batalha (o inimigo está à frente do bando: os números são os que se veem).
 */
export function battleBrief(b, state) {
  const name = id => state.world.settlements.find(s => s.id === id)?.name;
  const mine = b.allies + (b.bonus?.allies || 0), theirs = b.enemies.legio + b.enemies.velites + (b.bonus?.enemies || 0) + (b.enemies.centurion && !b.commander ? 1 : 0);
  const chief = b.commander || state.praetor?.name || 'o pretor';
  const who = b.foeKind === 'pretor' ? `o exército de ${chief}` : FOE_WHO[b.foeKind] || 'uma força romana';
  const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
  const why = b.type === 'defesa-aldeia' ? `${cap(who)} chegou a ${name(b.villageId) ?? 'uma aldeia'}: se não a defenderes, a aldeia arde.`
    : b.type === 'decisiva' ? `${chief} apanhou o bando. Vencê-lo acaba com a campanha deste ano.`
    : b.type === 'assalto-coluna' ? 'O comboio caiu na emboscada: toma os carros antes que fujam.'
    : `${cap(who)}. ${CONTEXT_TEXT[b.context] || ''}`.trim();
  const out = b.withdraw?.possible
    ? `Podes recusar o combate e recuar para ${name(b.withdraw.serraId) ?? 'a serra'}${b.withdraw.lost ? `, perdendo ${b.withdraw.lost} ${b.withdraw.lost === 1 ? 'homem' : 'homens'} na retaguarda` : ''}${b.type === 'defesa-aldeia' ? ', mas a aldeia fica entregue' : ''}.`
    : b.withdraw?.why === 'sem-serra' ? 'Não há serra perto para onde recuar.' : '';
  return [why, `${mine} dos teus contra ${theirs} romanos.`,
    b.bonus?.allies > 0 ? `Os teus ${b.realMen} homens pesam na linha.` : '',
    b.bonus?.enemies > 0 ? 'Há mais romanos do que os que entram em campo.' : '', out].filter(Boolean).join(' ');
}

/**
 * @param {{document, window, storage, onClose?: () => void, startBattle?: (spec) => boolean}} o
 * `startBattle(spec)` arranca a batalha 3D (emboscada, campo aberto) e devolve true se o fez; o ecrã do mapa fica
 * suspenso até o jogo chamar `battleDone(result, line)`.
 */
export function createCampaignUI({ document: doc, window: win, storage, onClose = () => {}, startBattle = () => false }) {
  const $ = id => doc.getElementById(id);
  let flow = null, view = null, active = false, selected = null, logDirty = true;
  let anim = null, shown = null, facing = 1, walk = 0, rafId = 0, hover = null, paintPending = false;
  let recon = false, reconClick = null, focus = null, intelKey = '';   // modo «reconhecer», clique que o consumiu, relato em destaque, e o que a lista mostra
  const trail = [];
  const log = [];
  const now = () => (win.performance && win.performance.now ? win.performance.now() : Date.now());
  const reduceMotion = () => !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const ctx2d = () => $('mapcv').getContext('2d');

  function resize() {
    const cv = $('mapcv'), dpr = win.devicePixelRatio || 1;
    const r = cv.getBoundingClientRect();
    const w = Math.round(r.width || win.innerWidth || 800), h = Math.round(r.height || (win.innerHeight || 600) - BAR_TOP - BAR_BOTTOM);
    cv.width = Math.max(1, Math.round(w * dpr)); cv.height = Math.max(1, Math.round(h * dpr));
    view = makeView(flow.state.world, w, h);
    return dpr;
  }

  function paint() {
    if (!active || !flow || !view) return;
    const ctx = ctx2d();
    if (!ctx) return;
    const dpr = win.devicePixelRatio || 1;
    ctx.setTransform?.(dpr, 0, 0, dpr, 0, 0);
    const scouting = recon && flow.phase === 'mapa' ? { range: RECON_RANGE, radius: RECON_RADIUS, ok: !!hover && inRecon(hover) } : null;
    drawMap(ctx, view, flow.state, { party: shown || flow.state.party, facing, step: walk, selected, hover, trail, reach: REACH, focus, recon: scouting });
  }

  /** Redesenha no máximo uma vez por frame (o rato pode disparar dezenas de eventos por segundo). */
  function schedulePaint() {
    if (paintPending) return;
    if (typeof win.requestAnimationFrame !== 'function') { paint(); return; }
    paintPending = true;
    win.requestAnimationFrame(() => { paintPending = false; paint(); });
  }

  /** Segue a party: quando o estado salta (uma ordem, uma retirada), mostra a marcha em vez do salto. */
  function syncParty() {
    const p = flow.state.party;
    if (!shown) { shown = { x: p.x, y: p.y }; return; }
    const d = Math.hypot(p.x - shown.x, p.y - shown.y);
    if (d < 0.5) { shown.x = p.x; shown.y = p.y; return; }
    if (anim && Math.hypot(anim.to.x - p.x, anim.to.y - p.y) < 0.5) return;   // já a caminho deste destino
    startMarch(p, d);
  }

  function startMarch(to, d) {
    const from = { x: shown.x, y: shown.y };
    facing = to.x >= from.x ? 1 : -1;
    trail.push(from);
    if (trail.length > 6) trail.shift();
    if (reduceMotion() || typeof win.requestAnimationFrame !== 'function') { shown = { x: to.x, y: to.y }; return; }
    const dur = Math.max(150, Math.min(900, (d / MARCH_SPEED) * 300));
    anim = { from, to: { x: to.x, y: to.y }, t0: now(), dur };
    if (rafId) win.cancelAnimationFrame?.(rafId);
    rafId = win.requestAnimationFrame(frame);
  }

  function frame() {
    rafId = 0;
    if (!active || !anim) { anim = null; return; }
    const t = Math.min(1, (now() - anim.t0) / anim.dur);
    const e = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;   // ease-in-out
    shown = { x: anim.from.x + (anim.to.x - anim.from.x) * e, y: anim.from.y + (anim.to.y - anim.from.y) * e };
    walk = t * Math.PI * 5;   // ciclo de passada
    paint();
    if (t < 1) { rafId = win.requestAnimationFrame(frame); return; }
    shown = { x: anim.to.x, y: anim.to.y };
    anim = null; walk = 0;
    paint();
  }

  function stopMarch() {
    if (rafId) win.cancelAnimationFrame?.(rafId);
    rafId = 0; anim = null; walk = 0;
  }

  function render() {
    if (!active || !flow) return;
    const s = flow.state;
    resize();
    syncParty();
    paint();
    $('m-date').textContent = dateLabel(s.day);
    $('m-season').textContent = season(s.day);
    $('m-day').textContent = s.day; $('m-left').textContent = daysLeft(s.day);
    for (const k of ['men', 'food', 'arms', 'fame']) $('m-' + k).textContent = s[k];
    if (logDirty) { // só reconstrói o registo quando há linhas novas (leitores de ecrã não repetem o antigo)
      logDirty = false;
      const ul = $('mlog'); ul.textContent = '';
      for (const line of log.slice(-LOG_LINES)) { const li = doc.createElement('li'); li.textContent = line; ul.append(li); }
    }
    renderBattle(); renderEnd(); renderContext(); renderPlaces(); renderIntel();
    if (flow.phase !== 'mapa' && recon) setRecon(false);
    const busy = flow.phase !== 'mapa';
    for (const b of $('map').querySelectorAll('[data-act]')) b.disabled = busy;
  }

  // a mesma linha em dias seguidos (esperar três dias sem nada) conta-se em vez de se repetir
  let lastSaid = null, repeat = 1;
  function say(events) {
    for (const ev of events || []) {
      const t = eventText(ev, flow.state, events);
      if (!t) continue;
      if (t === lastSaid && log.length) { repeat += 1; log[log.length - 1] = `${t} (${repeat}.º dia)`; }
      else { lastSaid = t; repeat = 1; log.push(t); }
      logDirty = true;
    }
  }

  function order(o) {
    if (!flow || flow.phase !== 'mapa') return null;
    if (recon) setRecon(false);   // outra ordem cancela o modo de reconhecimento
    const r = flow.order(o);
    say(r.events);
    selected = null;
    hover = null;
    focus = null;
    render();
    return r;
  }

  // --- reconhecimento e relatos ---
  const inRecon = p => Math.hypot(p.x - flow.state.party.x, p.y - flow.state.party.y) <= RECON_RANGE;
  /** O segundo clique (e o dblclick) do mesmo gesto que mandou os batedores não deve marchar. */
  const sameReconClick = (sx, sy) => !!reconClick && now() - reconClick.t < 600
    && Math.hypot(sx - reconClick.x, sy - reconClick.y) <= 8;
  const HINT = $('m-hint')?.textContent ?? '';
  function setRecon(on) {
    recon = !!on;
    $('m-recon').setAttribute('aria-pressed', recon ? 'true' : 'false');
    if ($('m-hint')) $('m-hint').textContent = recon ? `Clica na zona a reconhecer, dentro do círculo: ${SCOUTS} batedores, 1 dia · ESC desiste` : HINT;
    schedulePaint();
  }
  $('m-recon').addEventListener('click', () => { if (active && flow?.phase === 'mapa') setRecon(!recon); });
  const intelOpen = () => !$('mintel').classList.contains('hidden');
  /** Lista dos últimos relatos; só se reconstrói quando mudam. Escolher um destaca a zona no mapa. */
  let archive = false;   // a lista mostra os relatos recentes; os antigos ficam no arquivo, a um clique
  function renderIntel() {
    const v = intelView(flow.state), reports = archive ? v.archive : v.recent;
    $('m-intel').textContent = v.recent.some(r => r.got === flow.state.day) ? 'Relatos •' : 'Relatos';
    if (!intelOpen()) return;
    const k = `${flow.state.day}:${archive}:${reports.map(r => r.id).join(',')}:${v.archive.length}`;
    if (k === intelKey) return;
    intelKey = k;
    const ul = $('mintel'); ul.textContent = '';
    const toggle = doc.createElement('li'), tb = doc.createElement('button');
    tb.type = 'button'; tb.className = 'arch'; tb.dataset.archive = archive ? 'on' : 'off';
    tb.textContent = archive ? '← Relatos recentes' : `Arquivo (${v.archive.length} antigos)`;
    tb.disabled = !archive && !v.archive.length;
    tb.addEventListener('click', () => { archive = !archive; focus = null; renderIntel(); schedulePaint(); $('mintel').querySelector('button')?.focus?.(); });
    toggle.append(tb);
    const legend = doc.createElement('li'); legend.className = 'legend';
    legend.textContent = 'No mapa: figura nítida, à vista hoje; esbatida, vista há dias; círculo com «?», relato (pontilhado largo: rumor).';
    if (!reports.length) {
      const li = doc.createElement('li'); li.className = 'none';
      li.textContent = archive ? 'Sem relatos antigos.' : 'Sem relatos recentes. Manda batedores ou espera por notícias das aldeias.';
      ul.append(li, toggle, legend); return;
    }
    for (const r of reports) {
      const li = doc.createElement('li'), b = doc.createElement('button'), t = doc.createElement('small');
      b.type = 'button'; b.dataset.report = r.id; if (r.old) b.className = 'old';
      t.textContent = `${r.age ? agoLabel(r.age) : 'hoje'} · ${r.old ? 'antigo' : RELIABILITY[r.rel] || ''}`;
      b.append(doc.createTextNode(reportText(r, flow.state)), t);
      b.addEventListener('click', () => { focus = { x: r.x, y: r.y, r: r.r }; schedulePaint(); });
      li.append(b); ul.append(li);
    }
    ul.append(toggle, legend);
  }
  function toggleIntel(on) {
    $('mintel').classList.toggle('hidden', !on);
    $('m-intel').setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on) { intelKey = ''; archive = false; renderIntel(); $('mintel').querySelector('button')?.focus?.(); } else if (focus) { focus = null; schedulePaint(); }
  }
  $('m-intel').addEventListener('click', () => { if (active && flow) toggleIntel(!intelOpen()); });

  function renderContext() {
    const box = $('mctx');
    const s = selected && flow.phase === 'mapa' ? flow.state.world.settlements.find(x => x.id === selected) : null;
    box.classList.toggle('hidden', !s);
    if (!s) return;
    box.textContent = '';
    const h = doc.createElement('h3'); h.textContent = s.name;
    const p = doc.createElement('p'); p.textContent = KIND_NAMES[s.kind] || s.kind;
    box.append(h, p);
    const add = (label, act, o) => {
      const b = doc.createElement('button'); b.type = 'button'; b.dataset.act = act; b.textContent = label;
      b.setAttribute('aria-label', `${label} — ${s.name}`);
      b.addEventListener('click', () => order(o)); box.append(b);
    };
    const st = placeState(s, flow.state), note = t => { const q = doc.createElement('p'); q.textContent = t; box.append(q); };
    if (s.kind === 'aldeia') { if (st) note('Queimada.'); else add('Recrutar', 'recrutar', { kind: 'recrutar', id: s.id }); }
    if (s.kind === 'castro') add('Pedir ajuda', 'pedir-ajuda', { kind: 'pedir-ajuda', id: s.id });
    if (s.kind === 'posto') { if (st) note(st === 'tomado' ? 'Tomado pelo bando.' : 'Já atacado: a guarnição está avisada.'); else add('Atacar', 'atacar', { kind: 'atacar', id: s.id }); }
    add('Marchar para aqui', 'marchar', { kind: 'marchar', to: { x: s.x, y: s.y } });
    add('Reconhecer a zona', 'reconhecer', { kind: 'reconhecer', to: { x: s.x, y: s.y } });
    const x = doc.createElement('button'); x.type = 'button'; x.textContent = 'Fechar';
    x.addEventListener('click', () => { selected = null; render(); }); box.append(x);
  }

  function renderBattle() {
    const m = $('mbattle'), on = flow.phase === 'batalha';
    m.classList.toggle('hidden', !on);
    if (!on) { delete m.dataset.shown; return; }
    const b = flow.battle, ep = isStory(b) && EPISODES[b.chapter];
    $('mb-type').textContent = ep ? ep[0] : BATTLE_NAMES[b.type] || 'Batalha';
    if (!m.dataset.shown) { m.dataset.shown = '1'; $('mb-fight').focus?.(); }
    $('mb-withdraw').classList.toggle('hidden', !!ep || !b.withdraw?.possible);
    if (ep) { $('mb-info').textContent = ep[1]; return; }   // a cena é a do capítulo, com os seus homens: sem contas que não batem certo
    $('mb-info').textContent = battleBrief(b, flow.state);
  }

  function renderEnd() {
    const e = $('mend'), on = flow.phase === 'fim';
    e.classList.toggle('hidden', !on);
    if (!on) { delete e.dataset.shown; return; }
    const s = flow.state, won = s.over === 'vitoria', yearOut = s.day >= YEAR_DAYS, pretor = s.praetor?.name || 'o pretor';
    const decisive = won && !!s.decisivaWon;   // a decisiva vencida conta mais que o fim do ano, mesmo no último dia
    $('mend-title').textContent = decisive && !yearOut ? 'A campanha de 147 a.C.' : won || yearOut ? 'Fim do ano de 147 a.C.' : 'O bando desfez-se';
    $('mend-result').textContent = won ? 'Vitória' : 'Derrota';
    $('mend-text').textContent = won ? (decisive ? `O exército de ${pretor} foi desfeito em campo.`
      : s.men >= START.men ? 'Viriato chegou ao fim do ano com o bando inteiro. Roma não o venceu.' : 'Viriato chegou ao fim do ano. Roma não o venceu.')
      : yearOut ? `O inverno chegou sem ${s.men < WIN_MEN ? (s.fame < WIN_FAME ? 'homens nem fama bastantes' : 'homens bastantes') : 'fama bastante'} para manter a guerra.`
      : s.men <= 0 ? 'Não restam homens para combater.' : 'Sem fama, as aldeias deixaram de dar homens e comida.';
    const vals = { days: Math.min(s.day, YEAR_DAYS), men: s.men, burnt: Object.values(s.villages).filter(v => v.burnt).length, kills: s.kills || 0, battles: s.battles || 0 };
    for (const [k, v] of Object.entries(vals)) e.querySelector(`[data-k="${k}"]`).textContent = v;
    const chron = $('mend-chron'); chron.textContent = '';
    if (decisive) {   // a frase das fontes sobre Vetílio, tal como está na Crónica; só quando o venceste em campo
      const ent = entryFor('vetilio'), line = ent.text.split(/(?<=\.)\s+/).find(x => x.includes('Periochae')) || ent.title;
      const c = doc.createElement('cite'); c.textContent = ent.citation;
      chron.append(line, c);
    } else if (!won) chron.textContent = 'Os montes ficaram em silêncio.';
    if (!e.dataset.shown) { e.dataset.shown = '1'; $('mend-new').focus?.(); }
  }

  // --- lista de lugares (o mapa pelo teclado) ---
  let placesKey = '';
  const placesOpen = () => !$('mplaces').classList.contains('hidden');
  function renderPlaces() {
    const ul = $('mplaces'), on = placesOpen() && flow.phase === 'mapa';
    if (!on) { if (placesOpen()) togglePlaces(false); return; }
    const s = flow.state, k = `${s.day}:${s.party.x}:${s.party.y}:${JSON.stringify(s.posts || {})}:${Object.values(s.villages).filter(v => v.burnt).length}`;
    if (k === placesKey) return;   // só reconstrói quando algo mudou (não rouba o foco a quem está na lista)
    placesKey = k;
    const had = ul.contains(doc.activeElement) ? doc.activeElement.dataset.place : null;
    ul.textContent = '';
    const d = x => Math.hypot(x.x - s.party.x, x.y - s.party.y);
    for (const p of [...s.world.settlements].sort((a, b) => d(a) - d(b))) {
      const li = doc.createElement('li'), b = doc.createElement('button');
      b.type = 'button'; b.dataset.place = p.id; b.textContent = placeLabel(p, s);
      b.addEventListener('click', () => { if (!active || flow.phase !== 'mapa') return; selected = p.id; render(); $('mctx').querySelector('button')?.focus?.(); });
      li.append(b); ul.append(li);
    }
    if (had) ul.querySelector(`[data-place="${had}"]`)?.focus?.();
  }
  function togglePlaces(on) {
    $('mplaces').classList.toggle('hidden', !on);
    $('m-places').setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on) { placesKey = ''; renderPlaces(); $('mplaces').querySelector('button')?.focus?.(); }
  }
  $('m-places').addEventListener('click', () => { if (active && flow?.phase === 'mapa') togglePlaces(!placesOpen()); });

  // --- ações ---
  function mapClick(e) {
    if (!active || flow.phase !== 'mapa') return;
    const r = $('mapcv').getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const hit = hitTest(view, flow.state, sx, sy);
    if (recon) {   // o clique manda os batedores; a recusa (longe, poucos homens) não gasta o dia
      const at = toWorld(view, { x: sx, y: sy });
      reconClick = { t: now(), x: sx, y: sy };
      setRecon(false);
      order({ kind: 'reconhecer', to: { x: at.x, y: at.y } });
      return;
    }
    if (sameReconClick(sx, sy)) return;   // segundo clique do gesto que já mandou os batedores
    if (hit && hit.type === 'settlement') { selected = hit.id; render(); return; }
    const w = toWorld(view, { x: sx, y: sy });
    const d = Math.hypot(w.x - flow.state.party.x, w.y - flow.state.party.y);
    if (d < 2) return;   // clicar em cima do próprio bando não gasta um dia
    order({ kind: 'marchar', to: { x: w.x, y: w.y } });
  }
  $('mapcv').addEventListener('click', mapClick);

  /** Texto da pré-visualização: nome do lugar, dias de marcha, ou a força da patrulha. */
  function hoverLabel(hit, at) {
    const s = flow.state;
    const d = Math.hypot(at.x - s.party.x, at.y - s.party.y);
    const days = d <= REACH ? 0 : Math.max(1, Math.ceil((d - REACH) / MARCH_SPEED));
    const when = days ? `${days} ${days === 1 ? 'dia' : 'dias'}` : 'aqui';
    if (recon) return inRecon(at) ? `Reconhecer · ${SCOUTS} batedores, 1 dia` : 'Longe de mais para os batedores';
    if (hit?.type === 'settlement') {
      const st = s.world.settlements.find(x => x.id === hit.id);
      return st ? `${st.name} · ${when}` : when;
    }
    if (hit?.type === 'patrol' || hit?.type === 'praetor') {   // só o que o jogador sabe (intel.js), com a idade
      const f = intelView(s).forces.find(x => x.id === hit.id);
      if (!f) return when;
      const what = f.kind === 'pretor' ? `${f.name || 'Pretor'} · pretor` : `${FORCE_NAMES[f.kind] || 'Força romana'}${f.men ? ` · ${menText(estimateMen(f.men))}` : ''}${f.dir ? ` · para ${f.dir}` : ''}`;
      return f.status === 'confirmada' ? `${what} · à vista` : `${what} · visto ${agoLabel(f.age)}`;
    }
    return when;
  }

  function pointerMove(e) {
    if (!active || !flow || flow.phase !== 'mapa' || !view) return;
    const r = $('mapcv').getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const s = flow.state, hit = hitTest(view, s, sx, sy);
    const at = hit && hit.type === 'settlement' ? s.world.settlements.find(x => x.id === hit.id) || toWorld(view, { x: sx, y: sy }) : toWorld(view, { x: sx, y: sy });
    hover = { x: at.x, y: at.y, id: hit?.type === 'settlement' ? hit.id : null, label: hoverLabel(hit, at) };
    $('mapcv').style.cursor = hit ? 'pointer' : 'crosshair';
    schedulePaint();
  }

  function pointerLeave() {
    if (!hover) return;
    hover = null;
    $('mapcv').style.cursor = 'crosshair';
    schedulePaint();
  }
  $('mapcv').addEventListener('mousemove', pointerMove);
  $('mapcv').addEventListener('mouseleave', pointerLeave);

  // duplo clique em terreno vazio: três dias de marcha para o mesmo ponto (um por cada clique, mais um)
  $('mapcv').addEventListener('dblclick', e => {
    if (!active || flow.phase !== 'mapa' || recon) return;
    const r = $('mapcv').getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (sameReconClick(sx, sy)) { reconClick = null; return; }   // o gesto já mandou os batedores
    if (hitTest(view, flow.state, sx, sy)) return;   // numa povoação manda o painel, não a marcha
    const w = toWorld(view, { x: sx, y: sy });
    if (flow.phase === 'mapa') order({ kind: 'marchar', to: { x: w.x, y: w.y } });
  });
  for (const b of $('map').querySelectorAll('[data-order]')) b.addEventListener('click', () => order({ kind: b.dataset.order }));

  /** Só para testes (__game): termina a batalha pendente com um resultado já pronto. Nunca é mostrado ao jogador. */
  function simulateBattle(result) {
    if (!flow || flow.phase !== 'batalha') return null;
    const r = flow.finishBattle(result); say(r.events); render(); return r;
  }
  $('mb-fight').addEventListener('click', () => {
    if (!active || flow?.phase !== 'batalha') return;
    if (isBridged(flow.battle) && startBattle(flow.battle)) return;   // o jogo chama suspend() ao arrancar
    // uma batalha sem cena (gravação antiga): o bando evita-a, com o custo de uma retirada
    log.push('Não há como travar esta batalha; o bando evita-a.'); logDirty = true;
    simulateBattle({ won: false, retreated: true, alliesLost: 0, enemiesKilled: 0 });
  });
  $('mb-withdraw')?.addEventListener('click', () => {
    if (!active || flow?.phase !== 'batalha') return;
    const r = flow.withdraw();
    if (r.refused) return;
    say(r.events); render();
  });
  /** O 3D tomou conta do ecrã: esconde o mapa sem voltar ao menu. */
  function suspend() { stopMarch(); hover = null; active = false; $('map').classList.add('hidden'); }
  /** A batalha 3D acabou: entrega o resultado ao fluxo (uma vez) e mostra o mapa outra vez. */
  function battleDone(result, line) {
    let r = { events: [] };
    if (flow && flow.phase === 'batalha') r = flow.finishBattle(result);
    if (line) { log.push(line); logDirty = true; }
    say(r.events);
    active = true; $('map').classList.remove('hidden'); render();
    return r;
  }

  // --- Crónica ---
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
    renderChronicle();
    $('mcron').classList.remove('hidden');
    $('mcron-list').scrollTop = 0;
    $('mcron-list').firstElementChild?.focus?.();
  }
  function closeChronicle() {
    if (!cronOpen()) return;
    $('mcron').classList.add('hidden');
    cronOpener?.focus?.(); cronOpener = null;
  }
  $('m-cronica').addEventListener('click', () => { if (active && flow?.phase === 'mapa') openChronicle($('m-cronica')); });
  $('mend-cronica').addEventListener('click', () => { if (active && flow?.phase === 'fim') openChronicle($('mend-cronica')); });
  $('mcron-close').addEventListener('click', closeChronicle);
  $('mcron').addEventListener('keydown', e => {   // Tab não sai do diálogo
    if (e.key !== 'Tab') return;
    const items = [...$('mcron').querySelectorAll('[data-entry], button')], first = items[0], last = items[items.length - 1];
    if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  $('mcron-list').addEventListener('keydown', e => {   // setas, Home e End entre entradas
    const li = e.target.closest?.('[data-entry]'); if (!li) return;
    const to = e.key === 'ArrowDown' ? li.nextElementSibling : e.key === 'ArrowUp' ? li.previousElementSibling
      : e.key === 'Home' ? li.parentElement.firstElementChild : e.key === 'End' ? li.parentElement.lastElementChild : null;
    if (to) { e.preventDefault(); to.focus(); }
  });

  $('mend-new').addEventListener('click', () => { try { clearSave(storage); } catch { /* ignorado */ }
    open(createFlow({ storage })); });
  $('mend-menu').addEventListener('click', close);
  win.addEventListener('resize', render);
  win.addEventListener('keydown', e => {
    // setas: um dia de marcha para norte/sul/este/oeste (o mapa também se joga sem rato)
    if (!active || !flow || flow.phase !== 'mapa' || cronOpen() || placesOpen() || intelOpen()) return;
    const dir = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.code];
    if (!dir) return;
    e.preventDefault();
    const p = flow.state.party;
    order({ kind: 'marchar', to: { x: p.x + dir[0] * MARCH_SPEED, y: p.y + dir[1] * MARCH_SPEED } });
  });
  win.addEventListener('keydown', e => {
    if (!active || e.code !== 'Escape') return;
    if (cronOpen()) { closeChronicle(); return; }   // ESC fecha a Crónica primeiro, sem sair do mapa
    if (placesOpen()) { togglePlaces(false); $('m-places').focus?.(); return; }   // depois a lista de lugares
    if (recon) { setRecon(false); return; }
    if (intelOpen()) { toggleIntel(false); $('m-intel').focus?.(); return; }
    close();
  });

  function open(f) {
    flow = f; active = true; selected = null; log.length = 0; logDirty = true; lastSaid = null; repeat = 1;
    stopMarch(); shown = null; hover = null; facing = 1; trail.length = 0;
    $('mcron').classList.add('hidden'); cronOpener = null; togglePlaces(false); toggleIntel(false); setRecon(false); focus = null;
    log.push(flow.state.day ? 'A marcha continua.' : 'Um ano de guerra começa nos montes. Clica no mapa para marchar.');
    if (!flow.state.day) {   // o relato do dia 0 também se lê no registo, não só no painel «Relatos»
      const initial = flow.state.intel?.reports?.find(r => r.src === 'inicio' && r.got <= flow.state.day);
      if (initial) log.push(reportText(initial, flow.state));
    }
    $('map').classList.remove('hidden');
    render();
  }
  function close() {
    if (!active) return;
    stopMarch(); hover = null;
    $('mcron').classList.add('hidden'); cronOpener = null;
    active = false; $('map').classList.add('hidden');
    onClose();
  }
  return {
    open, close, render, order, openChronicle, closeChronicle, simulateBattle, suspend, battleDone, select: id => { selected = id; render(); }, view: () => view,
    get flow() { return flow; }, get active() { return active; },
    hasSave: () => !!loadFlow(storage),
    /** null sem gravação, 'fim' para uma campanha acabada, 'meio' para uma a meio. */
    saveState: () => { const f = loadFlow(storage); return f ? (f.phase === 'fim' ? 'fim' : 'meio') : null; },
    resume: () => { const f = loadFlow(storage); if (f) open(f); return !!f; },
    fresh: seed => { open(createFlow({ storage, seed })); return flow; },
  };
}
