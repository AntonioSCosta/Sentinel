// Os capitães do bando: geração, passivas no mapa, evolução e lealdade. Módulo puro (sem DOM nem Three.js).
// Determinista: cada sorteio usa um gerador próprio (semente, dia e motivo), nunca o do dia, que fica como estava.
// Só os capitães ativos (RULES.active) dão passivas, ganham experiência e reagem ao que o bando faz; o da reserva
// apenas perde lealdade com o tempo. Os efeitos do mesmo tipo não somam: vale o mais forte, dentro de RULES.caps.
import { makeRng } from './rng.js';
import { ARCHETYPES, TRAITS, SCARS, RULES, NAMES } from './captains-data.js';
import { COMMUNITY_IDS, shift, loseMen } from './communities.js';
import { gainAttention } from './rome.js';
import { ensureDoctrine } from './doctrine.js';

const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const num = x => typeof x === 'number' && Number.isFinite(x);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = v => Math.max(0, Math.min(100, Math.round(v)));
const OPEN = ['campo-aberto', 'decisiva'];

/** Gerador próprio a partir da semente e de um motivo (e do dia, quando o sorteio é desse dia). */
function rngOf(...parts) {
  let h = 2166136261;
  for (const ch of parts.join(':')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return makeRng((h >>> 0) || 1);
}
export const captainRng = (state, why) => rngOf(state.seed | 0, state.day | 0, why);

// --- geração e gravação ---

function newCaptain(state, archetype, rng) {
  const a = ARCHETYPES[archetype], L = RULES.loyalty;
  const used = new Set((state.captains || []).map(c => c.name)), names = NAMES.filter(n => !used.has(n));
  state.captainSeq = (state.captainSeq ?? 0) + 1;
  return { id: `cap-${state.captainSeq}`, name: rng.pick(names.length ? names : NAMES), archetype, level: 1, xp: 0,
    loyalty: clamp((a.loyalty ?? L.start) + rng.int(-L.jitter, L.jitter)), traits: [], activeSkill: a.skill, active: true };
}

/**
 * Os capitães da campanha, criados na primeira vez: dois arquétipos iniciais diferentes, sorteados só pela semente
 * (uma gravação antiga que os ganhe ao carregar tem sempre os mesmos, seja qual for o dia).
 */
export function ensureCaptains(state) {
  if (Array.isArray(state.captains)) return state.captains;
  const rng = rngOf(state.seed | 0, 'capitaes-iniciais'), pool = Object.keys(ARCHETYPES).filter(k => ARCHETYPES[k].start);
  state.captains = [];
  for (let i = 0; i < 2; i++) state.captains.push(newCaptain(state, pool.splice(Math.floor(rng.next() * pool.length), 1)[0], rng));
  return state.captains;
}

const traitOf = id => TRAITS[id] ?? SCARS[id] ?? null;
function validCaptain(c) {
  if (!isObj(c) || typeof c.id !== 'string' || typeof c.name !== 'string' || !ARCHETYPES[c.archetype]) return false;
  if (!(Number.isInteger(c.level) && c.level >= 1 && c.level <= RULES.xp.levels.length + 1) || !(num(c.xp) && c.xp >= 0)) return false;
  if (!(num(c.loyalty) && c.loyalty >= 0 && c.loyalty <= 100) || typeof c.active !== 'boolean' || typeof c.activeSkill !== 'string') return false;
  if (!Array.isArray(c.traits) || !c.traits.every(t => traitOf(t)) || new Set(c.traits).size !== c.traits.length) return false;
  if ('offer' in c && !(isObj(c.offer) && Array.isArray(c.offer.options) && c.offer.options.every(t => TRAITS[t]))) return false;
  if ('crisis' in c && !(isObj(c.crisis) && num(c.crisis.due))) return false;
  return true;
}
/** Valida os capitães de uma gravação (campos opcionais: gravações antigas não os têm). */
export function validCaptains(o) {
  const list = o.captains;
  if (!Array.isArray(list) || list.length > RULES.max || !list.every(validCaptain)) return false;
  if (new Set(list.map(c => c.id)).size !== list.length || list.filter(c => c.active).length > RULES.active) return false;
  if ('captainOffer' in o && o.captainOffer !== null && !(isObj(o.captainOffer) && num(o.captainOffer.due) && validCaptain(o.captainOffer.captain))) return false;
  return true;
}

// --- passivas ---

export const activeCaptains = state => (state.captains || []).filter(c => c.active);
const sourcesOf = c => [ARCHETYPES[c.archetype], ...c.traits.map(traitOf)].filter(Boolean);

/** Cada valor de `key` dado pelos capitães ativos, com o capitão que o dá. */
function offers(state, key) {
  const out = [];
  for (const c of activeCaptains(state)) for (const s of sourcesOf(c)) if (s.fx?.[key] !== undefined) out.push({ c, v: s.fx[key], s });
  return out;
}
const strongest = (list, low = false) => list.reduce((a, b) => (!a || (low ? b.v < a.v : b.v > a.v) ? b : a), null);
const top = (state, key, low = false) => strongest(offers(state, key), low);

export const reconRange = (state, base) => Math.min(RULES.caps.reconRange, Math.max(base, top(state, 'reconRange')?.v ?? base));
export const reconRadius = (state, base) => Math.max(base, top(state, 'reconRadius')?.v ?? base);
export const reconFood = state => top(state, 'reconFood')?.v ?? 0;
/** Até onde o bando vê: o Batedor Nocturno vê mais longe com o bando escondido. */
export const sightOf = (state, base, hidden) => (hidden ? Math.max(base, top(state, 'hiddenSight')?.v ?? base) : base);
export const exactMen = state => offers(state, 'exactMen').length > 0;
export const reportDelay = (state, delay) => Math.max(0, delay - (top(state, 'reportsFaster')?.v ?? 0));
export const doctrineWeight = state => top(state, 'doctrineWeight', true)?.v ?? 1;
/** Armas que custam `n` recrutas: com o Ferreiro, um em cada três vem armado da forja. */
export const recruitArms = (state, n) => n - Math.floor(n / (top(state, 'recruitFreeEvery')?.v ?? Infinity));
/** Voluntários a mais numa comunidade amiga ou neutra (Querido do Povo). */
export const volunteers = (state, c) => (c && ['amiga', 'neutra'].includes(c.posture) ? top(state, 'volunteer')?.v ?? 0 : 0);
export const lossKeep = state => Math.max(RULES.caps.lossKeep, top(state, 'lossKeep', true)?.v ?? 1);
export const withdrawKeep = state => top(state, 'withdrawKeep', true)?.v ?? 1;
/** Homens a mais (multiplicador do motor 3D, spec.bonus) nas batalhas em campo que o Veterano conhece. */
export function legacyBonus(state, type) {
  const o = strongest(offers(state, 'legacyBonus').filter(x => x.s.fx.legacyOn?.includes(type)));
  return o ? Math.min(RULES.caps.legacyBonus, o.v) : 0;
}
const serraNear = (state, p, range) => (state.world?.settlements || []).some(s => s.kind === 'serra' && p && dist(s, p) <= range);
/**
 * Probabilidade de Roma continuar a descobrir uma emboscada que a doutrina descobriria: o Fundibulário junto a uma serra
 * (×0,5), o Emboscador Nato em qualquer sítio (×0,75); vale o mais forte, nunca abaixo de RULES.caps.ambushKeep.
 */
export function ambushKeep(state) {
  const list = offers(state, 'ambushKeep').filter(x => !x.s.fx.serraRange || serraNear(state, state.party, x.s.fx.serraRange));
  const o = strongest(list, true);
  return o ? { keep: Math.max(RULES.caps.ambushKeep, o.v), by: o.c } : { keep: 1, by: null };
}
/** Comida poupada hoje com fome à porta (Ladrão de Galinhas): { save, by } ou null. */
export function famineSave(state, foodDays) {
  const o = top(state, 'famineSave');
  return o && foodDays < o.s.fx.famineDays ? { save: o.v, by: o.c, trust: o.s.fx.famineTrust } : null;
}
/** A comunidade viva mais próxima do bando (quem paga a confiança dos excessos do bando). */
function nearestCommunity(state) {
  let best = null, bd = Infinity;
  for (const id of COMMUNITY_IDS) {
    const c = state.communities?.[id], p = c && state.world.settlements.find(s => s.id === c.settlement);
    if (!p || c.families <= 0 || c.situation === 'queimada' || c.situation === 'abandonada') continue;
    const d = dist(p, state.party);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
/** Uma comunidade paga em confiança um excesso do bando (a mudança de postura, se houver, regista-a o fluxo). */
export function blame(state, c, trust, key, text) { if (c && trust) shift(c, { trust }, { key, text }, state.day); }
export const nearestBlame = (state, trust, key, text) => blame(state, nearestCommunity(state), trust, key, text);

// --- lealdade ---

const loyalOf = (c, key) => sourcesOf(c).map(s => s.loyal?.[key]).filter(v => v !== undefined);
function bump(c, delta, why, day) {
  if (!delta) return;
  c.loyalty = clamp(c.loyalty + delta);
  c.notes = [{ day, d: delta, why }, ...(c.notes || [])].slice(0, 3);
}
/** Aplica a cada capitão ativo o que a regra `key` lhe faz (arquétipo, traços e cicatrizes somam: são reações, não poder). */
function react(state, key, why, list = activeCaptains(state)) {
  for (const c of list) for (const v of loyalOf(c, key)) if (num(v)) bump(c, v, why, state.day);
}

// --- evolução ---

const levelFor = xp => 1 + RULES.xp.levels.filter(t => xp >= t).length;
const traitCount = c => c.traits.filter(t => TRAITS[t]).length;
const scarCount = c => c.traits.filter(t => SCARS[t]).length;
/** Três traços diferentes que este capitão pode receber, sorteados por raridade (gerador próprio do capitão e do dia). */
export function drawCards(state, c) {
  const rng = captainRng(state, `cartas:${c.id}`), W = RULES.cards.weights;
  const pool = Object.keys(TRAITS).filter(t => !c.traits.includes(t) && !TRAITS[t].not?.includes(c.archetype));
  const out = [];
  while (out.length < RULES.cards.offer && pool.length) {
    let r = rng.next() * pool.reduce((n, t) => n + W[TRAITS[t].rarity], 0);
    const i = pool.findIndex(t => (r -= W[TRAITS[t].rarity]) < 0);
    out.push(pool.splice(i < 0 ? pool.length - 1 : i, 1)[0]);
  }
  return out;
}
function offerCards(state, c, why, events) {
  if (c.offer || traitCount(c) >= RULES.cards.maxTraits) return;
  const options = drawCards(state, c);
  if (!options.length) return;
  c.offer = { options, why };
  c.lastCard = state.day;
  events.push({ type: 'capitao', what: 'evolucao', id: c.id, name: c.name, why });
}
function gainXp(state, c, xp, events) {
  const rate = Math.min(1, ...sourcesOf(c).map(s => s.fx?.xpRate ?? 1));
  c.xp += Math.round(xp * rate);
  const to = levelFor(c.xp);
  if (to <= c.level) return false;
  c.level = to;
  bump(c, RULES.loyalty.levelUp, 'nivel', state.day);
  events.push({ type: 'capitao', what: 'nivel', id: c.id, name: c.name, level: to });
  offerCards(state, c, 'nivel', events);
  return true;
}

// --- depois de uma batalha ---

/** Quantos homens das aldeias o bando tem agora (para saber quantos deles morreram numa batalha). */
export const awayOf = state => COMMUNITY_IDS.reduce((n, id) => n + (state.communities?.[id]?.away ?? 0), 0);
const foes = spec => { const e = spec?.enemies || {}; return (e.legio || 0) + (e.velites || 0) + (e.centurion ? 1 : 0) + (spec?.bonus?.enemies || 0); };

/**
 * Depois de uma batalha (ou de recusar o combate): passivas da vitória, experiência, cartas, cicatrizes e lealdade.
 * `events` são os que a batalha deu (battles.applyResult, applyPatrolResult ou withdrawFrom); `awayBefore` é awayOf
 * antes dela. Muda o estado e devolve os eventos novos.
 */
export function afterBattle(state, spec, events, { awayBefore = awayOf(state) } = {}) {
  if (!state.captains?.length || !spec) return [];
  const out = [], tactical = events.find(e => e.type === 'emboscada-tatica');
  const victory = events.find(e => e.type === 'vitoria');
  const withdrew = events.some(e => e.type === 'retirada' && e.withdrew);
  const won = !!victory || tactical?.outcome === 'vitoria';
  const lost = tactical ? tactical.alliedDead : events.find(e => ['vitoria', 'derrota', 'retirada', 'fuga'].includes(e.type))?.lost ?? 0;
  const result = won ? 'win' : withdrew ? 'withdraw' : events.some(e => e.type === 'derrota') || tactical?.outcome === 'derrota' ? 'loss' : 'retreat';
  const team = activeCaptains(state), type = spec.type;
  for (const c of team) c.idle = 0;

  if (won) {
    // saque: o mais forte de quem o dá para este tipo de batalha (Saqueador +40 % em emboscadas e colunas, Olho no Ouro +20 %)
    const loot = strongest(offers(state, 'loot').filter(x => !x.s.fx.lootOn || x.s.fx.lootOn.includes(type)));
    if (loot && victory) {
      const b = Math.min(RULES.caps.loot, loot.v), food = Math.round(victory.food * b), arms = Math.round(victory.arms * b);
      if (food || arms) {
        state.food += food; state.arms += arms;
        out.push({ type: 'capitao', what: 'saque', id: loot.c.id, name: loot.c.name, food, arms });
        if (loot.s.fx.lootTrust) nearestBlame(state, loot.s.fx.lootTrust, 'saque', 'O bando passou por cá a saquear');
      }
    }
    let fame = 0;
    const where = spec.where;
    const sling = offers(state, 'ambushFame').find(x => type === 'emboscada' && serraNear(state, where, x.s.fx.serraRange));
    if (sling) fame += sling.v;
    if (type === 'historica' && spec.chapter === 'acampamento' && state.posts?.[spec.foeId]?.taken) fame += top(state, 'postFame')?.v ?? 0;
    fame += top(state, 'winFame')?.v ?? 0;
    for (const c of team) if (c.vengeance && state.day <= c.vengeance.until) { fame += TRAITS.vingativo.fx.vengeance.fame; delete c.vengeance; }
    if (fame) { state.fame += fame; out.push({ type: 'capitao', what: 'fama', fame }); }
    const fire = offers(state, 'winAttention')[0];
    if (fire) {
      const ch = gainAttention(state, fire.v);
      out.push({ type: 'capitao', what: 'fumo', id: fire.c.id, name: fire.c.name });
      if (ch) out.push({ type: 'roma-atencao', ...ch });
      for (const id of COMMUNITY_IDS) {
        const c = state.communities?.[id];
        if (c?.posture === 'receosa') blame(state, c, fire.s.fx.fearfulTrust, 'fumo', 'O fumo das vitórias do bando chega cá');
      }
    }
  } else if (withdrew) {
    const trail = top(state, 'withdrawFame');
    if (trail) { state.fame = Math.max(0, state.fame - trail.v); out.push({ type: 'capitao', what: 'fama', fame: -trail.v }); }
  }

  // lealdade: o que cada um sente pelo que o bando fez
  if (won) react(state, 'win', 'vitoria', team);
  if (won && type === 'emboscada') react(state, 'ambushWin', 'emboscada', team);
  if (won && ['emboscada', 'assalto-coluna'].includes(type)) react(state, 'lootWin', 'saque', team);
  if (won && OPEN.includes(type)) react(state, 'openWin', 'campo', team);
  if (!withdrew && OPEN.includes(type)) react(state, 'openBattle', 'campo-aberto', team);
  if (won && type === 'historica' && state.posts?.[spec.foeId]?.taken) react(state, 'postTaken', 'posto', team);
  if (withdrew) react(state, 'withdraw', 'recusa', team);
  if (withdrew || result === 'retreat') react(state, 'flee', 'fuga', team);
  const villageDead = Math.max(0, awayBefore - awayOf(state));
  if (villageDead) for (const c of team) for (const r of loyalOf(c, 'villageDead')) bump(c, Math.max(r.max, r.each * villageDead), 'mortos', state.day);

  // experiência, cartas e cicatrizes (recusar o combate não ensina nada)
  if (!withdrew) {
    const hard = foes(spec) >= RULES.hard.ratio * Math.max(1, spec.realMen ?? 1) || lost >= RULES.hard.loss * Math.max(1, spec.realMen ?? 1);
    const X = RULES.xp, base = (result === 'win' ? X.win : result === 'loss' ? X.loss : X.retreat) + (hard ? X.hard : 0);
    for (const c of team) {
      const up = gainXp(state, c, base, out);
      if (hard && !up && state.day - (c.lastCard ?? -Infinity) >= RULES.hard.cardGap) offerCards(state, c, 'batalha', out);
      if (hard && !won && scarCount(c) < RULES.cards.maxScars) {
        const rng = captainRng(state, `cicatriz:${c.id}`);
        if (rng.chance(RULES.cards.scarChance)) {
          const free = Object.keys(SCARS).filter(t => !c.traits.includes(t));
          const scar = free[Math.floor(rng.next() * free.length)];
          c.traits.push(scar);
          bump(c, SCARS[scar].gain ?? 0, 'cicatriz', state.day);
          out.push({ type: 'capitao', what: 'cicatriz', id: c.id, name: c.name, scar });
        }
      }
    }
  }
  out.push(...settle(state));
  return out;
}

// --- no fim de cada dia ---

/** Depois do dia (simulation.stepDay e o acontecimento): lealdade, forja, vigias, reserva, crises e desertor. */
export function afterDay(state, events) {
  if (!state.captains?.length) return [];
  const out = [], team = activeCaptains(state), day = state.day;
  const has = type => events.some(e => e.type === type);
  if (has('fome')) { react(state, 'famine', 'fome', team); for (const c of team) c.hungry = true; }
  if (events.some(e => e.type === 'reconhecimento' && e.found?.length)) react(state, 'reconFound', 'reconhecimento', team);
  if (events.some(e => e.type === 'acontecimento' && e.id === 'traidor')) react(state, 'armsLost', 'armas', team);
  if (has('aldeia-queimada')) {
    react(state, 'burnt', 'aldeia', team);
    for (const c of team) if (c.traits.includes('vingativo')) c.vengeance = { until: day + TRAITS.vingativo.fx.vengeance.days };
  }
  if (has('colheita')) for (const c of team) {   // a forja trabalha se a estação passou sem fome
    const arms = sourcesOf(c).reduce((n, s) => Math.max(n, s.fx?.seasonArms ?? 0), 0);
    if (arms && !c.hungry) { state.arms += arms; bump(c, ARCHETYPES.ferreiro.loyal.forge, 'forja', day); out.push({ type: 'capitao', what: 'forja', id: c.id, name: c.name, arms }); }
    delete c.hungry;
  }
  for (const c of team) {
    if (c.vengeance && day > c.vengeance.until) { bump(c, TRAITS.vingativo.fx.vengeance.loss, 'vinganca', day); delete c.vengeance; }
    const far = loyalOf(c, 'farFromSerra')[0];
    if (far) {
      c.far = serraNear(state, state.party, far.range) ? 0 : (c.far ?? 0) + 1;
      if (c.far >= far.after && (c.far - far.after) % far.every === 0) bump(c, far.loss, 'serra', day);
    }
    const idle = loyalOf(c, 'idle')[0];
    if (idle) { c.idle = (c.idle ?? 0) + 1; if (c.idle % idle.every === 0) bump(c, idle.loss, 'parado', day); }
  }
  const R = RULES.loyalty.reserve;
  for (const c of state.captains) if (!c.active) { c.waited = (c.waited ?? 0) + 1; if (c.waited % R.every === 0) bump(c, R.loss, 'reserva', day); }
  const watch = top(state, 'watchFood');
  if (watch && day % watch.v.every === 0 && state.food > 0) state.food = Math.max(0, state.food - watch.v.food);
  out.push(...settle(state), ...deserter(state));
  return out;
}

/** Depois de pagar um tributo a Roma por ordem do bando. */
export function afterTribute(state) { if (state.captains?.length) react(state, 'tribute', 'tributo'); }

/** Abre, fecha ou cumpre as crises de lealdade. */
function settle(state) {
  const out = [], L = RULES.loyalty, day = state.day;
  for (const c of [...state.captains]) {
    if (c.crisis && c.loyalty > L.calm) { delete c.crisis; out.push({ type: 'capitao', what: 'acalmou', id: c.id, name: c.name }); continue; }
    if (!c.crisis && c.loyalty <= L.crisis) { c.crisis = { due: day + L.crisisDays }; out.push({ type: 'capitao', what: 'crise', id: c.id, name: c.name, due: c.crisis.due }); continue; }
    if (c.crisis && day >= c.crisis.due) out.push(...leave(state, c, ARCHETYPES[c.archetype].betrays ? 'traiu' : 'desertou'));
  }
  return out;
}

/**
 * Quantos homens leva um capitão que deserta ou trai: o seu nível, mas nunca mais de 20 % do bando (por excesso) nem de 4,
 * e o bando nunca fica sem homens por causa disto (RULES.loyalty.desert).
 */
export function desertionMen(state, c) {
  const D = RULES.loyalty.desert;
  return Math.max(0, Math.min(c.level, Math.ceil(state.men * D.share), D.max, state.men - 1));
}

/** O capitão sai do bando: `partiu` (deixaste-o ir), `desertou` (leva um homem por nível) ou `traiu` (vai contar a Roma). */
function leave(state, c, how) {
  state.captains = state.captains.filter(x => x !== c);
  const ev = { type: 'capitao', what: how, id: c.id, name: c.name, archetype: c.archetype };
  const out = [ev];
  if (how !== 'partiu') {
    const n = desertionMen(state, c);
    if (n) { loseMen(state, n); ev.men = n; }
  }
  if (how === 'traiu') {
    const ch = gainAttention(state, ARCHETYPES[c.archetype].betrays.attention);
    if (ch) out.push({ type: 'roma-atencao', ...ch });
    ensureDoctrine(state).lastSeen = { x: state.party.x, y: state.party.y, day: state.day };   // os caçadores sabem onde ir
  }
  return out;
}

/** O desertor romano aparece (uma vez), e vai-se embora se ninguém o aceitar a tempo. */
function deserter(state) {
  const D = RULES.deserter, o = state.captainOffer;
  if (o) { if (state.day >= o.due) { state.captainOffer = null; return [{ type: 'capitao', what: 'desertor-partiu', name: o.captain.name }]; } return []; }
  if (state.deserterSeen || state.day < D.from || state.captains.length >= RULES.max || state.captains.some(c => c.archetype === 'veterano')) return [];
  const rng = captainRng(state, 'desertor');
  if (!rng.chance(D.chance)) return [];
  const captain = newCaptain(state, 'veterano', rng);
  state.deserterSeen = true;
  state.captainOffer = { due: state.day + D.days, captain };
  return [{ type: 'capitao', what: 'desertor', name: captain.name, due: state.captainOffer.due }];
}

// --- ordens do jogador (não gastam o dia) ---

const find = (state, id) => (state.captains || []).find(c => c.id === id) ?? null;
const no = why => ({ ok: false, why, events: [] });

/** Escolhe um dos traços oferecidos ao capitão `id`. */
export function chooseCard(state, id, card) {
  const c = find(state, id);
  if (!c?.offer || !c.offer.options.includes(card)) return no('carta');
  c.traits.push(card);
  delete c.offer;
  return { ok: true, events: [{ type: 'capitao', what: 'carta', id: c.id, name: c.name, card }] };
}

/** Põe o capitão no bando ativo (on) ou na reserva. No máximo RULES.active ativos. */
export function setActive(state, id, on) {
  const c = find(state, id);
  if (!c || c.active === on) return no('capitao');
  if (on && activeCaptains(state).length >= RULES.active) return no('cheio');
  c.active = on;
  c.waited = 0;
  return { ok: true, events: [] };
}

/** Responde a uma crise de lealdade: `parte` (paga comida e armas) ou `partir` (deixa-o ir em paz). */
export function answerCrisis(state, id, answer) {
  const c = find(state, id), S = RULES.loyalty.share;
  if (!c?.crisis) return no('crise');
  if (answer === 'partir') return { ok: true, events: leave(state, c, 'partiu') };
  if (answer !== 'parte') return no('resposta');
  if (state.food < S.food || state.arms < S.arms) return no('sem-parte');
  state.food -= S.food; state.arms -= S.arms;
  bump(c, S.gain, 'parte', state.day);
  delete c.crisis;
  return { ok: true, events: [{ type: 'capitao', what: 'parte', id: c.id, name: c.name, food: S.food, arms: S.arms }] };
}

const joins = (state, c) => { c.active = activeCaptains(state).length < RULES.active; state.captains.push(c); };

/** Aceita (ou recusa) o desertor romano que está à espera. */
export function answerDeserter(state, accept) {
  const o = state.captainOffer;
  if (!o) return no('oferta');
  state.captainOffer = null;
  if (!accept) return { ok: true, events: [{ type: 'capitao', what: 'desertor-recusado', name: o.captain.name }] };
  if (state.captains.length >= RULES.max) return no('cheio');
  joins(state, o.captain);
  return { ok: true, events: [{ type: 'capitao', what: 'juntou', id: o.captain.id, name: o.captain.name, archetype: 'veterano' }] };
}

/**
 * Quem se pode recrutar como capitão na comunidade `communityId`, e porque não: { archetype, why }. `why`: null
 * (pode), 'cheio', 'ja' (já deu um capitão), 'tem' (esse arquétipo já está no bando), 'postura', 'longe', 'custo'.
 */
export function captainAt(state, communityId, { inReach = true } = {}) {
  const archetype = Object.keys(ARCHETYPES).find(k => ARCHETYPES[k].origin === communityId) ?? null, c = state.communities?.[communityId];
  if (!archetype || !c) return { archetype, why: 'nenhum' };
  const R = RULES.recruit;
  const why = state.captains.length >= RULES.max ? 'cheio' : state.captainsFrom?.includes(communityId) ? 'ja'
    : state.captains.some(x => x.archetype === archetype) ? 'tem' : !R.postures.includes(c.posture) ? 'postura'
      : !inReach ? 'longe' : state.food < R.food || state.arms < R.arms ? 'custo' : null;
  return { archetype, why };
}

/** Recruta o capitão da comunidade (captainAt); custa RULES.recruit e não gasta o dia. */
export function recruitCaptain(state, communityId, opts) {
  const { archetype, why } = captainAt(state, communityId, opts);
  if (why) return no(why);
  state.food -= RULES.recruit.food; state.arms -= RULES.recruit.arms;
  state.captainsFrom = [...(state.captainsFrom || []), communityId];
  const c = newCaptain(state, archetype, captainRng(state, `recruta:${communityId}`));
  joins(state, c);
  return { ok: true, events: [{ type: 'capitao', what: 'juntou', id: c.id, name: c.name, archetype, community: communityId }] };
}
