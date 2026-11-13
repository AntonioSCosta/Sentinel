// Ecrã do mapa da campanha: HUD em HTML + canvas 2D. Liga o DOM ao Flow; não conhece Three.js nem as batalhas 3D.
import { makeView, drawMap, hitTest, toWorld } from './map-view.js';
import { createFlow, loadFlow, clearSave, WIN_MEN, WIN_FAME } from './flow.js';
import { dateLabel, season, daysLeft, YEAR_DAYS } from './clock.js';
import { entryFor, CHRONICLE, SOURCE_LABELS, isUnlocked } from './chronicle.js';
import { isBridged, isStory } from './bridge.js';
import { START } from './state.js';
import { MARCH_SPEED } from './simulation.js';

const BAR_TOP = 52, BAR_BOTTOM = 64; // alturas das barras HTML (px) que o canvas deixa livres
const LOG_LINES = 6;
const BATTLE_NAMES = {
  emboscada: 'Emboscada', 'campo-aberto': 'Combate em campo aberto', 'defesa-aldeia': 'Defesa da aldeia',
  'assalto-coluna': 'Assalto a um comboio', retirada: 'Retirada', decisiva: 'A batalha decisiva', historica: 'Um episódio da guerra',
};
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

/** Uma frase curta (pt-PT) por evento devolvido por flow.order()/finishBattle(). */
export function eventText(ev, state) {
  const name = id => state.world.settlements.find(s => s.id === id)?.name ?? 'o povoado';
  switch (ev.type) {
    case 'recrutou': return ev.men ? `${name(ev.id)}: ${ev.men} homens juntam-se a ti.` : `${name(ev.id)}: ninguém tem armas para dar.`;
    case 'recrutar-cedo': return `${name(ev.id)}: já recrutaste aqui há pouco.`;
    case 'sem-armas': return 'Não tens armas para equipar recrutas.';
    case 'posto-atacado': return `${name(ev.id)}: este posto já foi atacado.`;
    case 'ajuda': return `${name(ev.id)} dá-te ${ev.food} de comida${ev.men ? ` e ${ev.men} homens` : ''}.`;
    case 'ajuda-recusada': return `${name(ev.id)}: ainda não podem dar mais ajuda.`;
    case 'fome': return `Fome no bando: morrem ${ev.mortos}.`;
    case 'derrota': return ev.lost !== undefined ? `Derrota: perdes ${ev.lost} homens.` : 'O bando está arruinado.';
    case 'vitoria': return `Vitória: perdes ${ev.lost}, ganhas ${ev.food} de comida, ${ev.arms} armas e ${ev.fame} de fama.`;
    case 'retirada': return ev.serraId ? `O bando recua para ${name(ev.serraId)}; perdes ${ev.lost} homens.` : `Recuas, perdendo ${ev.lost} homens.`;
    case 'fuga': return `A coluna escapou-se com a carga${ev.lost ? `; perdes ${ev.lost} homens` : ''}.`;
    case 'ano-vencido': return 'O exército do pretor foi desfeito.';
    case 'ruina': return 'O bando desfez-se.';
    case 'aldeia-queimada': return `${name(ev.id)} foi queimada pelos romanos.`;
    case 'acontecimento': return ev.text;
    case 'ordem-invalida': return 'Não podes fazer isso daqui: aproxima-te primeiro.';
    default: return null;
  }
}

/**
 * @param {{document, window, storage, onClose?: () => void, startBattle?: (spec) => boolean}} o
 * `startBattle(spec)` arranca a batalha 3D (emboscada, campo aberto) e devolve true se o fez; o ecrã do mapa fica
 * suspenso até o jogo chamar `battleDone(result, line)`.
 */
export function createCampaignUI({ document: doc, window: win, storage, onClose = () => {}, startBattle = () => false }) {
  const $ = id => doc.getElementById(id);
  let flow = null, view = null, active = false, selected = null, logDirty = true;
  const log = [];

  const ctx2d = () => $('mapcv').getContext('2d');

  function resize() {
    const cv = $('mapcv'), dpr = win.devicePixelRatio || 1;
    const r = cv.getBoundingClientRect();
    const w = Math.round(r.width || win.innerWidth || 800), h = Math.round(r.height || (win.innerHeight || 600) - BAR_TOP - BAR_BOTTOM);
    cv.width = Math.max(1, Math.round(w * dpr)); cv.height = Math.max(1, Math.round(h * dpr));
    view = makeView(flow.state.world, w, h);
    return dpr;
  }

  function render() {
    if (!active || !flow) return;
    const s = flow.state, dpr = resize();
    const ctx = ctx2d();
    if (ctx) { ctx.setTransform?.(dpr, 0, 0, dpr, 0, 0); drawMap(ctx, view, s); }
    $('m-date').textContent = dateLabel(s.day);
    $('m-season').textContent = season(s.day);
    $('m-day').textContent = s.day; $('m-left').textContent = daysLeft(s.day);
    for (const k of ['men', 'food', 'arms', 'fame']) $('m-' + k).textContent = s[k];
    if (logDirty) { // só reconstrói o registo quando há linhas novas (leitores de ecrã não repetem o antigo)
      logDirty = false;
      const ul = $('mlog'); ul.textContent = '';
      for (const line of log.slice(-LOG_LINES)) { const li = doc.createElement('li'); li.textContent = line; ul.append(li); }
    }
    renderBattle(); renderEnd(); renderContext(); renderPlaces();
    const busy = flow.phase !== 'mapa';
    for (const b of $('map').querySelectorAll('[data-act]')) b.disabled = busy;
  }

  function say(events) {
    for (const ev of events || []) { const t = eventText(ev, flow.state); if (t) log.push(t); logDirty = true; }
  }

  function order(o) {
    if (!flow || flow.phase !== 'mapa') return null;
    const r = flow.order(o);
    say(r.events);
    selected = null;
    render();
    return r;
  }

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
    if (ep) { $('mb-info').textContent = ep[1]; return; }   // a cena é a do capítulo, com os seus homens: sem contas que não batem certo
    const mine = b.allies + (b.bonus?.allies || 0), theirs = b.enemies.legio + b.enemies.velites + (b.bonus?.enemies || 0) + (b.enemies.centurion && !b.commander ? 1 : 0);
    $('mb-info').textContent = `${mine} dos teus contra ${theirs} romanos.` + (b.commander ? ` Comanda-os ${b.commander}.` : '')
      + (b.bonus?.allies > 0 ? ` Os teus ${b.realMen} homens pesam na linha.` : '')
      + (b.bonus?.enemies > 0 ? ' Há mais romanos do que os que entram em campo.' : '');
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
    if (hit && hit.type === 'settlement') { selected = hit.id; render(); return; }
    const w = toWorld(view, { x: sx, y: sy });
    order({ kind: 'marchar', to: { x: w.x, y: w.y } });
  }
  $('mapcv').addEventListener('click', mapClick);
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
  /** O 3D tomou conta do ecrã: esconde o mapa sem voltar ao menu. */
  function suspend() { active = false; $('map').classList.add('hidden'); }
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
    if (!active || e.code !== 'Escape') return;
    if (cronOpen()) { closeChronicle(); return; }   // ESC fecha a Crónica primeiro, sem sair do mapa
    if (placesOpen()) { togglePlaces(false); $('m-places').focus?.(); return; }   // depois a lista de lugares
    close();
  });

  function open(f) {
    flow = f; active = true; selected = null; log.length = 0; logDirty = true;
    $('mcron').classList.add('hidden'); cronOpener = null; togglePlaces(false);
    log.push(flow.state.day ? 'A marcha continua.' : 'Um ano de guerra começa nos montes. Clica no mapa para marchar.');
    $('map').classList.remove('hidden');
    render();
  }
  function close() {
    if (!active) return;
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
