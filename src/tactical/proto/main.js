// Protótipo M1 — a página: preparação, ordens, sinal, pausa e velocidades, feedback, resultados e cópia para o playtest.
import { createI18n } from '../../i18n/index.js';
import { DT } from '../data.js';
import { groupOf } from '../sim.js';
import { createView } from './view.js';
import { createSfx } from './sfx.js';
import { createSession, defaultPlacement, placeGroup, toggleRole, startsHidden, clockText, PROTO_VERSION } from './session.js';
import { spotRange, STUB } from './roman-stub.js';
import { radius } from '../combat.js';
import { COLUMN, WOODS } from './field.js';
import { patrolColumn, patrolPlacement, patrolResult } from '../../campaign/tactical-patrol.js';

const $ = id => document.getElementById(id);
const campaign = window.frameElement?.sentinelCampaignArena;
let storage; try { storage = window.localStorage; } catch { /* sem armazenamento */ }
// O idioma escolhe-se só no menu principal do jogo (mesma chave); sem escolha gravada, o do browser, como no jogo.
const i18n = campaign?.i18n ?? createI18n({ storage, languages: navigator.languages?.length ? navigator.languages : [navigator.language] });
const t = (k, p) => i18n.t(`tactical.${k}`, p);

let view;
try { view = createView($('view')); } catch (error) { campaign?.fail(); throw error; }
const sfx = createSfx();
const column = campaign ? patrolColumn(campaign.request) : null;
const initialPlacement = () => campaign ? patrolPlacement(campaign.request) : defaultPlacement();

const ui = {
  phase: 'prep', seed: campaign?.request.seed ?? 1, placement: initialPlacement(), session: null, selected: null,
  speed: 1, paused: false, slow: 0, acc: 0, drag: null, endShown: false, bannerT: 0, spottedShown: false, flankedAt: new Map(), pops: new Map(),
};
const BAND_IDS = ui.placement.map(p => p.id);

// --- textos ---
function applyTexts() {
  document.documentElement.lang = i18n.locale;
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  $('seed').textContent = t('battleNo', { seed: ui.seed });
  $('fallback').title = t('cmd.fallBackTip'); $('retreat').title = t('cmd.retreatTip');
  $('ver').textContent = PROTO_VERSION;   // discreto, para não misturar resultados de versões diferentes no playtest
  $('pause').setAttribute('aria-label', ui.paused ? t('time.play') : t('time.pause'));
  if (campaign) {
    $('top').querySelector('[data-t="subtitle"]').textContent = t('campaign.subtitle');
    for (const id of ['campaign-prep-error', 'campaign-result-error']) $(id).textContent = t('campaign.saveFailed');
  }
  if (!$('result').hidden) showResult();
}
const unsubscribeTexts = i18n.subscribe(applyTexts);
function loseArena() { campaign.fail(); }
function releaseArena() {
  unsubscribeTexts();
  $('view').removeEventListener('webglcontextlost', loseArena);
  view.dispose();
}
if (campaign) {
  $('view').addEventListener('webglcontextlost', loseArena);
  $('campaign-cancel').hidden = $('campaign-return').hidden = false;
  $('replay').hidden = $('plan').hidden = true;
}

// --- estado de cada grupo para o ecrã ---
const groupsNow = () => ui.session ? ui.session.battle.groups
  : [...ui.placement.map(p => ({ ...p, side: 'lusitanos', facing: p.y < 55 ? Math.PI / 2 : -Math.PI / 2, hidden: startsHidden(p.x, p.y), state: 'ativo', left: null, order: { type: 'manter' } })),
    ...(column ?? COLUMN).map(c => ({ id: c.id, role: c.role, men: c.men, side: 'romanos', x: column ? c.x - 60 : -20 - (22 - c.along), y: 58, facing: 0, state: 'ativo', left: null, order: { type: 'mover', pace: 'marcha', path: [] } }))];
const lookup = id => groupsNow().find(g => g.id === id) || null;

/**
 * Perigo de um grupo lusitano, do mais grave para o menos: 'breaking' (em combate e mais uma baixa quebra-o),
 * 'outnumbered' (dois ou mais romanos em corpo a corpo com ele), 'flanked' (atacado pelo flanco há menos de 3 s),
 * 'threatened' (um romano vem direito a ele a menos de 30 m).
 */
function threatOf(g) {
  if (!ui.session || g.side !== 'lusitanos' || g.left || g.state !== 'ativo' || g.hidden) return null;
  const b = ui.session.battle, danger = ui.session.dangerOf(g.id);
  if (g.engaged && danger?.nearBreak) return 'breaking';
  if (danger && danger.foes.length >= 2) return 'outnumbered';
  if (b.t - (ui.flankedAt.get(g.id) ?? -99) < 3) return 'flanked';
  const foes = b.groups.filter(r => r.side === 'romanos' && r.left === null && r.state === 'ativo');
  if (foes.some(r => r.order.type === 'atacar' && r.order.target === g.id && !r.engaged && Math.hypot(r.x - g.x, r.y - g.y) < 30)) return 'threatened';
  return null;
}
/** «contra X» (e «+n» se forem mais) para um grupo em corpo a corpo: quem combate quem. */
function vsOf(g) {
  if (!ui.session || !g.engaged) return '';
  // o alvo do próprio grupo primeiro, depois quem mais está em corpo a corpo com ele
  const foes = [...new Set([g.target, ...(ui.session.dangerOf(g.id)?.foes ?? [])].filter(Boolean))];
  if (!foes.length) return '';
  return foes.length > 1 ? t('vsMany', { group: nameOf(foes[0]), more: foes.length - 1 }) : t('vs', { group: nameOf(foes[0]) });
}
/** Exposição de um grupo lusitano: 'hidden' | 'exposed' | 'seen' (na preparação, pela posição). */
const exposureOf = g => ui.session ? ui.session.exposureOf(g.id) : startsHidden(g.x, g.y) ? 'hidden' : 'exposed';
function stateOf(g) {
  if (g.left === 'morto' || g.left === 'fugiu' || g.left === 'retirou' || g.left === 'escapou') return t(`state.${g.left}`);
  if (ui.phase === 'prep') return g.side === 'lusitanos' ? t(g.hidden ? 'state.hidden' : 'state.exposed') : t('state.marching');
  if (ui.phase === 'over') return '';
  if (g.state === 'debandada') return t('state.routing');
  const threat = threatOf(g), vs = vsOf(g);
  if (threat) return [t(`state.${threat}`), vs].filter(Boolean).join(' · ');
  if (g.side === 'lusitanos' && g.order?.type === 'retirar') return g.order.x !== undefined ? t('cmd.fallBack') : t('state.retreating');
  if (g.side === 'romanos' && g.rough && g.role === 'legionario') return [t('state.noFormation'), vs].filter(Boolean).join(' · ');
  if (vs) return vs;
  if (g.engaged) return t('state.fighting');
  if (g.disorderT > 0) return t('state.surprised');
  if (g.hidden) return g.order?.type === 'atacar' || g.order?.type === 'mover' ? t('state.planned') : t('state.hidden');
  if (g.side === 'lusitanos') return t(`state.${exposureOf(g)}`);
  if (g.side === 'romanos') {
    const intent = ui.session?.intentOf(g.id);
    const label = { support: 'state.supporting', pursue: 'state.pursuing', hold: 'state.holdingRoad', shelter: 'state.sheltering', skirmish: 'state.skirmishing' }[intent];
    if (!g.alerted) return t('state.marching');
    const temper = ui.session?.temperOf(g.id);
    return [label && g.order.type !== 'mover' ? t(label) : t('state.alert'), temper ? t(`temper.${temper}`) : ''].filter(Boolean).join(' · ');
  }
  return '';
}
const pips = g => {
  const start = g.start ?? g.men;
  return '●'.repeat(g.men) + `<i>${'●'.repeat(Math.max(0, start - g.men))}</i>`;
};

// --- cartões dos grupos e botões ---
function renderCards() {
  const gs = groupsNow().filter(g => g.side === 'lusitanos');
  $('cards').innerHTML = gs.map((g, i) => `<button class="card${ui.selected === g.id ? ' sel' : ''}${g.left ? ' gone' : ''}${threatOf(g) ? ' threat' : ''}${!g.left && ui.phase !== 'over' && exposureOf(g) === 'exposed' ? ' exposed' : ''}" data-id="${g.id}">
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
  $('hold').hidden = $('retreat').hidden = $('fallback').hidden = ui.phase === 'prep';
  $('hold').disabled = $('retreat').disabled = $('fallback').disabled = !usable;
  const given = ui.session?.battle.signals.includes('lusitanos');
  const late = !!live && !given && ui.session.columnAlerted();   // a coluna já viu alguém: o sinal já não surpreende
  $('signal').hidden = ui.phase === 'prep';
  $('signal').disabled = !live || given;
  $('signal').classList.toggle('ready', !!live && !given && !late);
  $('signal').classList.toggle('late', late);
  $('signal').title = late ? t('signal.lateTitle') : '';
  $('prep').hidden = ui.phase !== 'prep';
  const open = exposedNames();
  if (ui.phase === 'prep') $('prep-warn').textContent = open ? t('prep.exposed', { groups: open, range: STUB.spotOpen }) : t('prep.allHidden');
  $('prep-warn').classList.toggle('bad', !!open);
  // Só avisos de estado na espera (a coluna já viu alguém, ou há grupos à vista); os controlos estão em «Controlos».
  const hint = ui.phase !== 'waiting' ? '' : late ? t('wait.seen') : open ? t('wait.exposed', { groups: open, range: STUB.spotOpen }) : '';
  $('hint').classList.toggle('bad', !!hint);
  $('hint').hidden = !hint; $('hint').textContent = hint;
  $('phase').textContent = t(`phase.${ui.phase === 'over' ? 'over' : ui.phase}`);
  renderMarch();
}
/** Nomes dos grupos ainda à vista e por descobrir (a coluna vê-os a `spotOpen` metros), separados por vírgulas. */
function exposedNames() {
  if (ui.session && (ui.session.battle.over || ui.session.columnAlerted())) return '';
  return groupsNow().filter(g => g.side === 'lusitanos' && !g.left && exposureOf(g) === 'exposed').map(g => nameOf(g.id)).join(', ');
}
/** Estado da marcha romana, numa linha discreta junto à barra da coluna (só um número: quando retoma a marcha). */
function renderMarch() {
  const el = $('march'), m = ui.session && !ui.session.battle.over ? ui.session.march() : null;
  el.hidden = !m || m.mode === 'gone';
  if (el.hidden) return;
  el.textContent = m.mode === 'halted' && m.resumeIn !== null ? t('march.haltedIn', { n: m.resumeIn }) : t(`march.${m.mode}`);
  el.dataset.mode = m.mode;
}

// --- textos flutuantes, faixa, registo ---
/** Prioridade das mensagens sobre os grupos: uma por grupo; uma menos importante não tapa uma mais importante. */
const POP_PRIORITY = { loss: 0, kill: 0, ack: 1, good: 2, bad: 2 };
function pop(id, text, cls, priority = POP_PRIORITY[cls] ?? 1) {
  const w = view.where(id); if (!w) return;
  const now = performance.now(), cur = ui.pops.get(id);
  if (cur && cur.el.isConnected && cur.until > now && cur.priority > priority) return;
  if (cur) cur.el.remove();
  if (priority < 2 && $('labels').querySelectorAll('.pop').length >= 6) return;   // com muita coisa a acontecer, só o importante
  const lbl = labelEls.get(id);
  let p = view.project(w.x, w.y, 4.2); if (!p.visible) return;
  if (lbl && lbl.style.display !== 'none') p = { x: parseFloat(lbl.style.left), y: parseFloat(lbl.style.top) - lbl.offsetHeight - 2 };   // por cima da etiqueta, não sobre os soldados
  const el = document.createElement('div');
  el.className = `pop ${cls}`; el.textContent = text; el.style.left = `${p.x}px`; el.style.top = `${p.y}px`;
  $('labels').appendChild(el); setTimeout(() => el.remove(), 1500);
  ui.pops.set(id, { el, priority, until: now + 900 });
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
        if (g.side === 'lusitanos') { $('hurt').style.opacity = 1; setTimeout(() => { $('hurt').style.opacity = 0; }, 140); }
        pop(e.group, `−${e.n}`, g.side === 'lusitanos' ? 'loss' : 'kill');
        if (ui.phase === 'waiting') ui.phase = 'battle';
        break;
      case 'carga':
        view.charge(e.group); sfx.play.charge();
        pop(e.group, t('pop.charge'), g.side === 'lusitanos' ? 'good' : 'bad');
        break;
      case 'flanco': {
        const ours = g.side === 'lusitanos';
        pop(e.target, t(e.side === 'costas' ? 'pop.rear' : 'pop.flank'), ours ? 'good' : 'bad', 3);
        sfx.play.flank(); view.shake(0.35);
        if (!ours) ui.flankedAt.set(e.target, b.t);
        break;
      }
      case 'terreno':
        if (e.rough && g.side === 'romanos') { pop(e.group, t('pop.formationBroken'), 'good'); feed(t('feed.woods', { group: nameOf(e.group) })); }
        break;
      case 'apoio':
        pop(e.group, t('pop.support'), 'bad'); sfx.play.alarm();
        banner(t('banner.support', { group: nameOf(e.group), ally: nameOf(e.ally) }), true, 1.8);
        break;
      case 'persegue':
        pop(e.group, t('pop.pursuing'), 'bad');
        feed(t('feed.pursue', { group: nameOf(e.group), target: nameOf(e.target) }));
        break;
      case 'segura':
        feed(t('feed.hold', { group: nameOf(e.group) }));
        break;
      case 'cerra':
        if (!ui.closeShown) { ui.closeShown = true; if (ui.bannerT > 0) feed(t('banner.closeRanks')); else banner(t('banner.closeRanks'), true, 1.6); }
        break;
      case 'quebrou':
        sfx.play.broken(g.side === 'lusitanos'); view.shake(0.4);
        pop(e.group, t('pop.broken'), g.side === 'lusitanos' ? 'bad' : 'good', 4);
        banner(t('banner.broken', { group: nameOf(e.group) }), g.side === 'lusitanos', 1.6);
        feed(t('banner.broken', { group: nameOf(e.group) }));
        break;
      case 'revelado': case 'descoberto': case 'avistado':
        if (!e.cause) break;   // a sessão só marca a causa na primeira vez que um grupo é visto (o sinal revela sem causa)
        pop(e.group, t('pop.seen'), 'bad', 3); sfx.play.alarm();
        feed(t(`cause.${e.cause}`, { group: nameOf(e.group), d: e.d }));   // quem foi visto e porquê
        if (!ui.spottedShown) { ui.spottedShown = true; banner(t('banner.seenGroup', { group: nameOf(e.group) }), true, 2.4); }
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
  ui.session = createSession({ seed: ui.seed, placement: ui.placement, column: column ?? undefined });
  ui.phase = 'waiting'; ui.acc = 0; ui.endShown = false; ui.spottedShown = false; ui.closeShown = false; ui.slow = 0; ui.flankedAt = new Map(); ui.pops = new Map();
  view.setPrep(false); view.reset();
  $('result').hidden = true; $('progress').querySelector('.sig').style.display = 'none';
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
  const surprised = ui.session.stats.signalSurprised;
  if (surprised) {   // emboscada a sério: corneta, grito, clarão, câmara lenta
    sfx.play.signal(); view.shake(0.9); ui.slow = 0.9;
    banner(t('signal.banner'));
    $('flash').style.opacity = 1; setTimeout(() => { $('flash').style.opacity = 0; }, 160);
    feed(t('signal.surprised', { count: surprised }));
  } else {   // Roma já estava pronta: o sinal só solta os escondidos — sem festa
    sfx.play.signalLate(); view.shake(0.25);
    banner(t('signal.late'), true, 1.8);
    feed(t('signal.lateFeed'));
  }
  const sig = $('progress').querySelector('.sig'); sig.style.display = 'block'; sig.style.left = `${ui.session.progress() * 100}%`;
  sig.classList.toggle('late', !surprised);
  ui.phase = 'battle';
  renderOrders();
}
function order(cmd) {
  if (!ui.session || !ui.selected) return false;
  const r = ui.session.order({ group: ui.selected, ...cmd });
  if (r.ok) {
    const kind = cmd.type === 'retirar' && cmd.x !== undefined ? 'recuar' : cmd.type;
    pop(ui.selected, t(`ack.${kind}`), 'ack'); sfx.play.order(kind);
  }
  return r.ok;
}
/** Recuar para o bosque mais perto do grupo selecionado (larga o combate e fica lá a manter). */
function fallBack() {
  const g = ui.selected && lookup(ui.selected); if (!g) return;
  const w = WOODS.reduce((b, o) => (!b || Math.hypot(o.x - g.x, o.y - g.y) < Math.hypot(b.x - g.x, b.y - g.y) ? o : b), null);
  if (order({ type: 'retirar', x: w.x, y: w.y })) ping(w.x, w.y);
}

// --- resultados ---
function showResult() {
  if (!ui.session || !ui.endShown) return;
  const r = ui.session.report({ language: i18n.locale }).data;
  $('r-title').textContent = t(`result.${r.outcome}`);
  $('r-text').textContent = t(r.outcome === 'escapou' && r.lusitanians.dead + r.romans.dead > 0 ? 'result.text.escapouFought' : `result.text.${r.outcome}`);
  const lus = r.lusitanians, rom = r.romans;
  const rows = [
    [t('result.losses'), `${lus.dead} / ${lus.start}`],
    [t('result.killed'), `${rom.dead} / ${rom.start}`],
    [t('result.fled'), rom.fled], [t('result.escaped'), rom.escaped],
    [t('result.length'), t('seconds', { count: Math.round(r.combatSeconds) })],
    [t('result.signal'), r.signalAt === null ? t('result.noSignal') : t('result.signalAt', { time: Math.round(r.signalAt), percent: Math.round(r.signalColumnProgress * 100) })],
    [t('result.flanks'), t('result.flanksValue', { ours: r.flanks.lusitanos, rome: r.flanks.romanos })],
  ];
  $('r-stats').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  const why = r.keyMoments.map(k => `<li><span class="at">${clockText(k.t)}</span>${t(`why.${whyKey(k)}`, { ...k, group: k.group ? nameOf(k.group) : '', ally: k.ally ? nameOf(k.ally) : '' })}</li>`).join('');
  $('r-why').innerHTML = why ? `<b>${t('why.title')}</b><ul>${why}</ul>` : '';
  $('r-ver').textContent = `${PROTO_VERSION} · seed ${r.seed}`;
  $('result').hidden = false;
  $('banner').classList.remove('show'); ui.bannerT = 0;
  $(campaign ? 'campaign-return' : 'replay').focus();
}
/** Chave do catálogo de um momento do relatório (a variante diz porquê: causa, quantos inimigos, flanco). */
function whyKey(k) {
  if (k.code === 'seen') return `seen.${k.cause}`;
  if (k.code === 'lost') return k.foes > 1 ? 'lostMany' : 'lost';
  if (k.code === 'romanBroke') return k.flanked ? 'romanBrokeFlank' : k.foes > 1 ? 'romanBrokeMany' : 'romanBroke';
  return k.code;
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
    if (ev.shiftKey) { if (order({ type: 'retirar', x: p.x, y: p.y })) ping(p.x, p.y); }
    else if (foe) { order({ type: 'atacar', target: foe.id }); ping(foe.x, foe.y); }
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
  else if (ev.code === 'KeyB') fallBack();
  else if (ev.code === 'KeyP') togglePause();
  else if (ev.code === 'KeyF') setSpeed(ui.speed === 1 ? 2 : ui.speed === 2 ? 4 : 1);
  else if (/^Digit[1-4]$/.test(ev.code)) ui.selected = BAND_IDS[+ev.code.slice(5) - 1];
  else if (ev.code === 'Escape') ui.selected = null;
});
window.addEventListener('keyup', ev => keys.delete(ev.code));
window.addEventListener('blur', () => keys.clear());

function togglePause() { ui.paused = !ui.paused; $('pause').classList.toggle('on', ui.paused); $('pause').textContent = ui.paused ? '▶' : '❚❚'; applyTexts(); }
function setSpeed(s) { ui.speed = s; for (const b of document.querySelectorAll('[data-speed]')) b.classList.toggle('on', +b.dataset.speed === s); }

// A barra de baixo muda de altura (duas linhas em ecrãs estreitos): a dica e o registo ficam sempre por cima dela.
new ResizeObserver(() => { const b = `${$('bar').offsetHeight + 22}px`; $('hint').style.bottom = $('feed').style.bottom = b; }).observe($('bar'));
$('cards').addEventListener('click', ev => { const c = ev.target.closest('.card'); if (c) ui.selected = c.dataset.id; });
$('start').addEventListener('click', async () => {
  if (!campaign) { startBattle(); return; }
  sfx.unlock();
  const start = $('start');
  start.disabled = true;
  $('campaign-prep-error').hidden = true;
  const placement = structuredClone(ui.placement);
  try {
    if (!await campaign.prepare(placement)) { $('campaign-prep-error').hidden = false; return; }
    ui.placement = placement;
    startBattle();
  } catch { campaign.fail(); }
  finally { start.disabled = false; }
});
$('reset').addEventListener('click', () => { ui.placement = initialPlacement(); });
$('campaign-cancel').addEventListener('click', () => campaign?.cancel());
$('campaign-return').addEventListener('click', async () => {
  if (!campaign || !ui.session?.battle.over) return;
  const button = $('campaign-return');
  button.disabled = true;
  $('campaign-result-error').hidden = true;
  try {
    if (!await campaign.finish(patrolResult(campaign.request, ui.session.battle))) $('campaign-result-error').hidden = false;
  } catch { $('campaign-result-error').hidden = false; }
  finally { button.disabled = false; }
});
$('role').addEventListener('click', () => { if (ui.selected) toggleRole(ui.placement, ui.selected); });
$('hold').addEventListener('click', () => order({ type: 'manter' }));
$('retreat').addEventListener('click', () => order({ type: 'retirar' }));
$('fallback').addEventListener('click', fallBack);
$('signal').addEventListener('click', giveSignal);
$('pause').addEventListener('click', togglePause);
for (const b of document.querySelectorAll('[data-speed]')) b.addEventListener('click', () => setSpeed(+b.dataset.speed));
$('replay').addEventListener('click', () => { ui.seed++; applyTexts(); startBattle(); });
$('plan').addEventListener('click', () => backToPrep(true));
$('copy').addEventListener('click', copyResults);
$('sound').addEventListener('click', () => { sfx.unlock(); sfx.setMuted(!sfx.muted); $('sound').classList.toggle('on', !sfx.muted); });
$('help-btn').addEventListener('click', () => { $('help').hidden = !$('help').hidden; });

// --- etiquetas sobre os grupos ---
const labelEls = new Map();
const SVGNS = 'http://www.w3.org/2000/svg';
const leaders = document.createElementNS(SVGNS, 'svg');
leaders.id = 'leaders';
$('labels').appendChild(leaders);
function renderLabels() {
  const seen = new Set();
  for (const g of groupsNow()) {
    if (g.left || g.men <= 0 || g.x < 0) continue;   // a coluna fora do campo, na preparação, não tem etiqueta
    seen.add(g.id);
    let el = labelEls.get(g.id);
    if (!el) { el = document.createElement('div'); $('labels').appendChild(el); labelEls.set(g.id, el); }
    const w = view.where(g.id) || g, p = view.project(w.x, w.y, 3.6);
    el.style.display = p.visible ? '' : 'none';
    const threat = threatOf(g);
    el.className = `lbl ${g.side === 'romanos' ? 'rom' : ''}${ui.selected === g.id ? ' sel' : ''}${threat ? ' danger' : ''}${g.engaged ? ' fight' : ''}`;
    el.dataset.ax = p.x; el.dataset.ay = p.y;
    const s = stateOf(g);
    el.innerHTML = `<b>${t(`group.${g.id}`)}</b> <span class="p">${pips(g)}</span>${s ? `<div class="s">${s}</div>` : ''}`;
  }
  for (const [id, el] of labelEls) if (!seen.has(id)) { el.remove(); labelEls.delete(id); }
  declutter();
}
/**
 * Afasta as etiquetas que se tapam, para os lados ou para cima (o eixo em que se tapam menos), e liga cada etiqueta
 * deslocada ao seu grupo com um traço fino. As etiquetas lusitanas mexem-se menos do que as romanas.
 */
function declutter() {
  const W = innerWidth, H = innerHeight;
  const list = [...labelEls.values()].filter(el => el.style.display !== 'none').map(el => {
    const ax = +el.dataset.ax, ay = +el.dataset.ay;
    return { el, ax, ay, x: ax, y: ay, w: el.offsetWidth + 6, h: el.offsetHeight + 2, k: el.classList.contains('rom') ? 0.65 : 0.35 };
  });
  for (let iter = 0; iter < 16; iter++) {
    let moved = false;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const dx = b.x - a.x, dy = (b.y - b.h / 2) - (a.y - a.h / 2);
      const ox = (a.w + b.w) / 2 - Math.abs(dx), oy = (a.h + b.h) / 2 - Math.abs(dy);
      if (ox <= 0 || oy <= 0) continue;
      moved = true;
      const wa = a.k / (a.k + b.k), wb = 1 - wa;
      if (ox < oy) { const sx = dx === 0 ? (a.ax <= b.ax ? 1 : -1) : Math.sign(dx); a.x -= sx * ox * wa; b.x += sx * ox * wb; }
      else { const sy = dy === 0 ? (a.ay <= b.ay ? 1 : -1) : Math.sign(dy); a.y -= sy * oy * wa; b.y += sy * oy * wb; }
    }
    for (const l of list) { l.x = Math.max(l.w / 2, Math.min(W - l.w / 2, l.x)); l.y = Math.max(l.h, Math.min(H, l.y)); }   // dentro do ecrã, a cada volta
    if (!moved) break;
  }
  let lines = '';
  for (const l of list) {
    l.el.style.left = `${l.x}px`; l.el.style.top = `${l.y}px`;
    if (Math.hypot(l.x - l.ax, l.y - l.ay) > 14) lines += `<line x1="${l.x}" y1="${l.y}" x2="${l.ax}" y2="${l.ay + 8}" class="${l.el.classList.contains('rom') ? 'rom' : ''}"/>`;
  }
  leaders.innerHTML = lines;
}

/**
 * Anéis do alcance de deteção romana: na preparação, à volta de todos os grupos (largos e vermelhos a descoberto,
 * curtos e claros no mato); depois, só enquanto a coluna não viu ninguém — os grupos à vista e o selecionado.
 */
function detectionRings() {
  if (ui.phase === 'prep') return ui.placement.map(p => { const hidden = startsHidden(p.x, p.y); return { x: p.x, y: p.y, r: spotRange(p.x, p.y, hidden), kind: hidden ? 'hidden' : 'exposed' }; });
  if (!ui.session || ui.session.battle.over || ui.session.columnAlerted()) return [];
  return ui.session.battle.groups.filter(g => g.side === 'lusitanos' && g.left === null).flatMap(g => {
    const kind = ui.session.exposureOf(g.id), r = ui.session.detectionRange(g.id);
    return r !== null && (kind === 'exposed' || g.id === ui.selected) ? [{ x: g.x, y: g.y, r, kind }] : [];
  });
}

// --- ciclo ---
let last = performance.now(), uiT = 0, clashT = 0, campaignReady = false;
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
  const threats = new Set(groupsNow().filter(g => threatOf(g)).map(g => g.id));
  view.sync(groupsNow(), visDt, { selected: ui.selected, showPlans: ui.phase === 'waiting', lookup, threats });
  view.setRanges(detectionRings());
  view.render();
  if (campaign && !campaignReady) { campaignReady = true; campaign.ready(releaseArena); }

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
  seed(n) { ui.seed = n; applyTexts(); },
  start: startBattle, signal: giveSignal, order: (id, cmd) => { ui.selected = id; order(cmd); },
  place: (id, x, y) => placeGroup(ui.placement, id, x, y), role: id => toggleRole(ui.placement, id),
  run(seconds) { const end = ui.session.battle.t + seconds; while (!ui.session.battle.over && ui.session.battle.t < end) onEvents(ui.session.tick()); },
  info: () => view.info(),
};
