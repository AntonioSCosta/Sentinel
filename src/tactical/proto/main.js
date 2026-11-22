// Protótipo M1 — a página: preparação, ordens, sinal, pausa e velocidades, feedback, resultados e cópia para o playtest.
import { createI18n } from '../../i18n/index.js';
import { DT } from '../data.js';
import { groupOf } from '../sim.js';
import { createView } from './view.js';
import { createSfx } from './sfx.js';
import { createSession, defaultPlacement, placeGroup, toggleRole, startsHidden } from './session.js';
import { radius } from '../combat.js';
import { COLUMN } from './field.js';

const $ = id => document.getElementById(id);
let storage; try { storage = window.localStorage; } catch { /* sem armazenamento */ }
const i18n = createI18n({ storage, languages: ['en'] });   // inglês por omissão; a escolha do jogador fica guardada
const t = (k, p) => i18n.t(`tactical.${k}`, p);

const view = createView($('view'));
const sfx = createSfx();

const ui = {
  phase: 'prep', seed: 1, placement: defaultPlacement(), session: null, selected: null,
  speed: 1, paused: false, slow: 0, acc: 0, drag: null, endShown: false, bannerT: 0, spottedShown: false,
};
const BAND_IDS = ui.placement.map(p => p.id);

// --- textos ---
function applyTexts() {
  document.documentElement.lang = i18n.locale;
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  $('lang').value = i18n.locale;
  $('seed').textContent = t('battleNo', { seed: ui.seed });
  $('pause').setAttribute('aria-label', ui.paused ? t('time.play') : t('time.pause'));
  if (!$('result').hidden) showResult();
}
i18n.subscribe(applyTexts);

// --- estado de cada grupo para o ecrã ---
const groupsNow = () => ui.session ? ui.session.battle.groups
  : [...ui.placement.map(p => ({ ...p, side: 'lusitanos', facing: p.y < 55 ? Math.PI / 2 : -Math.PI / 2, hidden: startsHidden(p.x, p.y), state: 'ativo', left: null, order: { type: 'manter' } })),
    ...COLUMN.map(c => ({ id: c.id, role: c.role, men: c.men, side: 'romanos', x: -20 - (22 - c.along), y: 58, facing: 0, state: 'ativo', left: null, order: { type: 'mover', pace: 'marcha', path: [] } }))];
const lookup = id => groupsNow().find(g => g.id === id) || null;

function stateOf(g) {
  if (g.left === 'morto' || g.left === 'fugiu' || g.left === 'retirou' || g.left === 'escapou') return t(`state.${g.left}`);
  if (ui.phase === 'prep') return g.side === 'lusitanos' ? t(g.hidden ? 'state.hidden' : 'state.exposed') : t('state.marching');
  if (ui.phase === 'over') return '';
  if (g.state === 'debandada') return t('state.routing');
  if (g.side === 'lusitanos' && g.order?.type === 'retirar') return t('state.retreating');
  if (g.engaged) return t('state.fighting');
  if (g.disorderT > 0) return t('state.surprised');
  if (g.hidden) return g.order?.type === 'atacar' || g.order?.type === 'mover' ? t('state.planned') : t('state.hidden');
  if (g.side === 'romanos') return g.alerted ? t('state.alert') : t('state.marching');
  return '';
}
const pips = g => {
  const start = g.start ?? g.men;
  return '●'.repeat(g.men) + `<i>${'●'.repeat(Math.max(0, start - g.men))}</i>`;
};

// --- cartões dos grupos e botões ---
function renderCards() {
  const gs = groupsNow().filter(g => g.side === 'lusitanos');
  $('cards').innerHTML = gs.map((g, i) => `<button class="card${ui.selected === g.id ? ' sel' : ''}${g.left ? ' gone' : ''}" data-id="${g.id}">
    <span class="n">${t(`group.${g.id}`)} <span class="role">${t(`role.${g.role}`)}</span></span>
    <span class="pips">${pips(g)}</span><span class="state">${stateOf(g)}</span><kbd style="justify-self:end;margin:0">${i + 1}</kbd></button>`).join('');
}
function renderOrders() {
  const sel = ui.selected && lookup(ui.selected);
  const live = ui.session && !ui.session.battle.over;
  const usable = sel && live && sel.left === null && sel.state === 'ativo';
  $('role').hidden = ui.phase !== 'prep';
  if (ui.phase === 'prep') {
    $('role').disabled = !sel;
    $('role').textContent = sel && sel.role === 'fundeiro' ? t('prep.toWarriors') : t('prep.toSlingers');
  }
  $('hold').hidden = $('retreat').hidden = ui.phase === 'prep';
  $('hold').disabled = $('retreat').disabled = !usable;
  const given = ui.session?.battle.signals.includes('lusitanos');
  $('signal').hidden = ui.phase === 'prep';
  $('signal').disabled = !live || given;
  $('signal').classList.toggle('ready', !!live && !given);
  $('prep').hidden = ui.phase !== 'prep';
  const hint = ui.phase === 'waiting' ? t('wait.hint') : ui.phase === 'battle' ? t('battle.hint') : '';
  $('hint').hidden = !hint; $('hint').textContent = hint;
  $('phase').textContent = t(`phase.${ui.phase === 'over' ? 'over' : ui.phase}`);
}

// --- textos flutuantes, faixa, registo ---
function pop(id, text, cls) {
  const w = view.where(id); if (!w) return;
  const p = view.project(w.x, w.y, 4.2); if (!p.visible) return;
  const el = document.createElement('div');
  el.className = `pop ${cls}`; el.textContent = text; el.style.left = `${p.x}px`; el.style.top = `${p.y}px`;
  $('labels').appendChild(el); setTimeout(() => el.remove(), 1500);
}
function banner(text, rome = false, secs = 1.8) {
  const b = $('banner'); b.textContent = text; b.classList.toggle('rome', rome); b.classList.add('show'); ui.bannerT = secs;
}
function feed(text) {
  const el = document.createElement('div'); el.textContent = text; $('feed').appendChild(el);
  while ($('feed').children.length > 4) $('feed').firstChild.remove();
  setTimeout(() => el.remove(), 6200);
}
const nameOf = id => t(`group.${id}`);

// --- acontecimentos da simulação → som e imagem ---
function onEvents(events) {
  const b = ui.session.battle;
  for (const e of events) {
    const g = e.group ? groupOf(b, e.group) : null;
    switch (e.type) {
      case 'salva': {
        const to = groupOf(b, e.target);
        if (g && to) { view.volley(g, to, g.role === 'fundeiro' ? 'stone' : 'jav', g.men); g.role === 'fundeiro' ? sfx.play.sling() : sfx.play.javelin(); }
        break;
      }
      case 'baixas':
        view.hit(e.group, e.n);
        sfx.play.death(g.side === 'lusitanos');
        pop(e.group, `−${e.n}`, g.side === 'lusitanos' ? 'loss' : 'kill');
        if (ui.phase === 'waiting') ui.phase = 'battle';
        break;
      case 'carga':
        view.charge(e.group); sfx.play.charge();
        if (g.side === 'lusitanos') pop(e.group, t('pop.charge'), 'good');
        break;
      case 'quebrou':
        sfx.play.broken(g.side === 'lusitanos'); view.shake(0.4);
        pop(e.group, t('pop.broken'), g.side === 'lusitanos' ? 'bad' : 'good');
        banner(t('banner.broken', { group: nameOf(e.group) }), g.side === 'lusitanos', 1.6);
        feed(t('banner.broken', { group: nameOf(e.group) }));
        break;
      case 'revelado':
        if (e.by) { pop(e.group, t('pop.spotted'), 'bad'); sfx.play.alarm(); }
        break;
      case 'descoberto': case 'avistado':
        pop(e.group, t('pop.spotted'), 'bad'); sfx.play.alarm();
        if (!ui.spottedShown) { ui.spottedShown = true; banner(t('banner.spotted'), true, 2.2); feed(t('banner.spotted')); }
        break;
      case 'saiu':
        feed(`${nameOf(e.group)} — ${t(`state.${e.how}`)}`);
        break;
      case 'fim':
        ui.phase = 'over';
        sfx.play.end(e.outcome === 'vitoria');
        setTimeout(() => { ui.endShown = true; showResult(); }, 1400);
        break;
    }
  }
}

// --- partidas ---
function startBattle() {
  sfx.unlock();
  ui.session = createSession({ seed: ui.seed, placement: ui.placement });
  ui.phase = 'waiting'; ui.acc = 0; ui.endShown = false; ui.spottedShown = false; ui.slow = 0;
  view.setPrep(false); view.reset();
  $('result').hidden = true;
  renderOrders();
}
function backToPrep(nextSeed) {
  if (nextSeed) ui.seed++;
  ui.session = null; ui.phase = 'prep'; ui.selected = null; ui.paused = false;
  view.reset(); view.setPrep(true);
  $('result').hidden = true; $('progress').querySelector('.sig').style.display = 'none';
  applyTexts(); renderOrders();
}
function giveSignal() {
  if (!ui.session || ui.session.battle.over) return;
  if (!ui.session.order({ type: 'sinal' }).ok) return;
  sfx.play.signal(); view.shake(0.9); ui.slow = 0.9;
  banner(t('signal.banner'));
  $('flash').style.opacity = 1; setTimeout(() => { $('flash').style.opacity = 0; }, 160);
  const sig = $('progress').querySelector('.sig'); sig.style.display = 'block'; sig.style.left = `${ui.session.progress() * 100}%`;
  ui.phase = 'battle'; feed(t('signal.given'));
  renderOrders();
}
function order(cmd) {
  if (!ui.session || !ui.selected) return;
  const r = ui.session.order({ group: ui.selected, ...cmd });
  if (r.ok) sfx.play.clash();
}

// --- resultados ---
function showResult() {
  if (!ui.session || !ui.endShown) return;
  const r = ui.session.report({ language: i18n.locale }).data;
  $('r-title').textContent = t(`result.${r.outcome}`);
  $('r-text').textContent = t(`result.text.${r.outcome}`);
  const lus = r.lusitanians, rom = r.romans;
  const rows = [
    [t('result.losses'), `${lus.dead} / ${lus.start}`],
    [t('result.killed'), `${rom.dead} / ${rom.start}`],
    [t('result.fled'), rom.fled], [t('result.escaped'), rom.escaped],
    [t('result.length'), t('seconds', { count: Math.round(r.combatSeconds) })],
    [t('result.signal'), r.signalAt === null ? t('result.noSignal') : t('result.signalAt', { time: Math.round(r.signalAt), percent: Math.round(r.signalColumnProgress * 100) })],
  ];
  $('r-stats').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('result').hidden = false;
  $('banner').classList.remove('show'); ui.bannerT = 0;
  $('replay').focus();
}
async function copyResults() {
  const text = ui.session.report({ language: i18n.locale }).text;
  try { await navigator.clipboard.writeText(text); $('copy-status').textContent = t('result.copied'); $('copy-text').hidden = true; }
  catch {
    const ta = $('copy-text'); ta.hidden = false; ta.value = text; ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* bloqueado */ }
    $('copy-status').textContent = ok ? t('result.copied') : t('result.copyFailed');
  }
}

// --- rato e teclado ---
const canvas = $('view');
const nearestGroup = (p, side) => {
  let best = null, bd = Infinity;
  for (const g of groupsNow()) {
    if (g.side !== side || g.left) continue;
    const d = Math.hypot(g.x - p.x, g.y - p.y);
    if (d < radius(g.men) + 3 && d < bd) { best = g; bd = d; }
  }
  return best;
};
function ping(x, y) {
  const p = view.project(x, y, 0.2); const el = document.createElement('div');
  el.className = 'ping'; el.style.left = `${p.x}px`; el.style.top = `${p.y}px`; $('labels').appendChild(el); setTimeout(() => el.remove(), 650);
}
let panDrag = null;
canvas.addEventListener('pointerdown', ev => {
  sfx.unlock();
  const p = view.pick(ev.clientX, ev.clientY); if (!p) return;
  const foe = ui.session && !ui.session.battle.over ? nearestGroup(p, 'romanos') : null;
  if (ev.button === 0 && foe && ui.selected && !nearestGroup(p, 'lusitanos')) { order({ type: 'atacar', target: foe.id }); ping(foe.x, foe.y); return; }
  if (ev.button === 0) {
    const g = nearestGroup(p, 'lusitanos');
    ui.selected = g ? g.id : null;
    if (g && ui.phase === 'prep') { ui.drag = g.id; canvas.setPointerCapture(ev.pointerId); }
    else if (!g) { panDrag = { x: ev.clientX, y: ev.clientY }; canvas.setPointerCapture(ev.pointerId); }
  } else if (ev.button === 1) { panDrag = { x: ev.clientX, y: ev.clientY, rotate: true }; canvas.setPointerCapture(ev.pointerId); }
  else if (ev.button === 2 && ui.session && ui.selected && !ui.session.battle.over) {
    if (foe) { order({ type: 'atacar', target: foe.id }); ping(foe.x, foe.y); }
    else { order({ type: 'atacar', x: p.x, y: p.y }); ping(p.x, p.y); }
  }
});
canvas.addEventListener('pointermove', ev => {
  if (ui.drag) { const p = view.pick(ev.clientX, ev.clientY); if (p) placeGroup(ui.placement, ui.drag, p.x, p.y); return; }
  if (panDrag) {
    const dx = ev.clientX - panDrag.x, dy = ev.clientY - panDrag.y; panDrag.x = ev.clientX; panDrag.y = ev.clientY;
    if (panDrag.rotate) view.rotate(-dx * 0.006);
    else { const k = view.camera.dist / 900; view.pan(-dx * k, -dy * k); }
    canvas.style.cursor = 'grabbing';
    return;
  }
  const p = view.pick(ev.clientX, ev.clientY);
  if (!p) return;
  const own = nearestGroup(p, 'lusitanos'), foe = ui.session && ui.selected ? nearestGroup(p, 'romanos') : null;
  canvas.style.cursor = own ? (ui.phase === 'prep' ? 'grab' : 'pointer') : foe ? 'crosshair' : 'default';
});
const endDrag = () => { ui.drag = null; panDrag = null; canvas.style.cursor = 'default'; };
canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('contextmenu', ev => ev.preventDefault());
canvas.addEventListener('wheel', ev => { ev.preventDefault(); view.zoom(ev.deltaY > 0 ? 1.1 : 0.9); }, { passive: false });

const keys = new Set();
window.addEventListener('keydown', ev => {
  if (ev.target.tagName === 'SELECT' || ev.target.tagName === 'TEXTAREA') return;
  keys.add(ev.code);
  if (ev.code === 'Space') { ev.preventDefault(); giveSignal(); }
  else if (ev.code === 'KeyH') order({ type: 'manter' });
  else if (ev.code === 'KeyR') order({ type: 'retirar' });
  else if (ev.code === 'KeyP') togglePause();
  else if (ev.code === 'KeyF') setSpeed(ui.speed === 1 ? 2 : ui.speed === 2 ? 4 : 1);
  else if (/^Digit[1-4]$/.test(ev.code)) ui.selected = BAND_IDS[+ev.code.slice(5) - 1];
  else if (ev.code === 'Escape') ui.selected = null;
});
window.addEventListener('keyup', ev => keys.delete(ev.code));
window.addEventListener('blur', () => keys.clear());

function togglePause() { ui.paused = !ui.paused; $('pause').classList.toggle('on', ui.paused); $('pause').textContent = ui.paused ? '▶' : '❚❚'; applyTexts(); }
function setSpeed(s) { ui.speed = s; for (const b of document.querySelectorAll('[data-speed]')) b.classList.toggle('on', +b.dataset.speed === s); }

$('cards').addEventListener('click', ev => { const c = ev.target.closest('.card'); if (c) ui.selected = c.dataset.id; });
$('start').addEventListener('click', startBattle);
$('reset').addEventListener('click', () => { ui.placement = defaultPlacement(); });
$('role').addEventListener('click', () => { if (ui.selected) toggleRole(ui.placement, ui.selected); });
$('hold').addEventListener('click', () => order({ type: 'manter' }));
$('retreat').addEventListener('click', () => order({ type: 'retirar' }));
$('signal').addEventListener('click', giveSignal);
$('pause').addEventListener('click', togglePause);
for (const b of document.querySelectorAll('[data-speed]')) b.addEventListener('click', () => setSpeed(+b.dataset.speed));
$('replay').addEventListener('click', () => { ui.seed++; applyTexts(); startBattle(); });
$('plan').addEventListener('click', () => backToPrep(true));
$('copy').addEventListener('click', copyResults);
$('lang').addEventListener('change', () => i18n.setLocale($('lang').value));
$('sound').addEventListener('click', () => { sfx.unlock(); sfx.setMuted(!sfx.muted); $('sound').classList.toggle('on', !sfx.muted); });
$('help-btn').addEventListener('click', () => { $('help').hidden = !$('help').hidden; });

// --- etiquetas sobre os grupos ---
const labelEls = new Map();
function renderLabels() {
  const seen = new Set();
  for (const g of groupsNow()) {
    if (g.left || g.men <= 0 || g.x < 0) continue;   // a coluna fora do campo, na preparação, não tem etiqueta
    seen.add(g.id);
    let el = labelEls.get(g.id);
    if (!el) { el = document.createElement('div'); $('labels').appendChild(el); labelEls.set(g.id, el); }
    const w = view.where(g.id) || g, p = view.project(w.x, w.y, 3.6);
    el.style.display = p.visible ? '' : 'none';
    el.className = `lbl ${g.side === 'romanos' ? 'rom' : ''}${ui.selected === g.id ? ' sel' : ''}`;
    el.style.left = `${p.x}px`; el.style.top = `${p.y}px`;
    const s = stateOf(g);
    el.innerHTML = `<b>${t(`group.${g.id}`)}</b><div class="p">${pips(g)}</div>${s ? `<div class="s">${s}</div>` : ''}`;
  }
  for (const [id, el] of labelEls) if (!seen.has(id)) { el.remove(); labelEls.delete(id); }
  // afastar etiquetas sobrepostas: as de baixo ficam, as de cima sobem
  const placed = [], list = [...labelEls.values()].filter(el => el.style.display !== 'none')
    .map(el => ({ el, x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: el.offsetWidth, h: el.offsetHeight })).sort((a, b) => b.y - a.y);
  for (const l of list) {
    for (const q of placed) if (Math.abs(l.x - q.x) < (l.w + q.w) / 2 && l.y > q.y - q.h && l.y - l.h < q.y) l.y = q.y - q.h - 2;
    l.el.style.top = `${l.y}px`; placed.push(l);
  }
}

// --- ciclo ---
let last = performance.now(), uiT = 0, clashT = 0;
function frame(now) {
  const real = Math.min(0.1, (now - last) / 1000); last = now;
  // câmara pelo teclado
  const k = view.camera.dist / 60 * real * 40;
  if (keys.has('KeyW') || keys.has('ArrowUp')) view.pan(0, -k);
  if (keys.has('KeyS') || keys.has('ArrowDown')) view.pan(0, k);
  if (keys.has('KeyA') || keys.has('ArrowLeft')) view.pan(-k, 0);
  if (keys.has('KeyD') || keys.has('ArrowRight')) view.pan(k, 0);
  if (keys.has('KeyQ')) view.rotate(real * 1.2);
  if (keys.has('KeyE')) view.rotate(-real * 1.2);

  let simDt = 0;
  if (ui.session && !ui.session.battle.over && !ui.paused) {
    const slow = ui.slow > 0 ? 0.3 : 1;
    ui.slow = Math.max(0, ui.slow - real);
    ui.acc += real * ui.speed * slow;
    let n = 0;
    while (ui.acc >= DT && n < 60) { onEvents(ui.session.tick()); ui.acc -= DT; n++; }
    simDt = real * ui.speed * slow;
  }
  const visDt = ui.paused ? 0 : (ui.session ? Math.max(simDt, real * 0.3) : real);
  view.sync(groupsNow(), visDt, { selected: ui.selected, showPlans: ui.phase === 'waiting', lookup });
  view.render();

  // som de combate e tambor de marcha
  if (ui.session && !ui.paused) {
    const b = ui.session.battle;
    const fights = b.groups.filter(g => g.engaged && g.left === null).length;
    clashT -= real * ui.speed;
    if (fights && clashT <= 0) { sfx.play.clash(); clashT = 0.35 / fights + Math.random() * 0.2; }
    const marching = b.groups.some(g => g.side === 'romanos' && g.left === null && !g.alerted);
    sfx.play.march(real * ui.speed, marching && !b.over, Math.min(1, ui.session.progress() * 1.6));
  }
  // barra da coluna e relógio
  const prog = ui.session ? ui.session.progress() : 0;
  $('progress').querySelector('.mark').style.left = `${prog * 100}%`;
  $('progress').querySelector('.done').style.width = `${prog * 100}%`;
  const secs = ui.session ? Math.floor(ui.session.battle.t) : 0;
  $('clock').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  if (ui.bannerT > 0) { ui.bannerT -= real; if (ui.bannerT <= 0) $('banner').classList.remove('show'); }
  renderLabels();
  uiT -= real;
  if (uiT <= 0) { uiT = 0.15; renderCards(); renderOrders(); }
  requestAnimationFrame(frame);
}

applyTexts(); renderCards(); renderOrders(); view.setPrep(true);
requestAnimationFrame(frame);

// Gancho para testes automáticos e para o playtest (consola): não faz parte da interface.
window.__proto = {
  get ui() { return ui; }, view, i18n,
  start: startBattle, signal: giveSignal, order: (id, cmd) => { ui.selected = id; order(cmd); },
  place: (id, x, y) => placeGroup(ui.placement, id, x, y), role: id => toggleRole(ui.placement, id),
  run(seconds) { const end = ui.session.battle.t + seconds; while (!ui.session.battle.over && ui.session.battle.t < end) onEvents(ui.session.tick()); },
  info: () => view.info(),
};
