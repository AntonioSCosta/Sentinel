// Um dia de campanha: ordem do jogador, patrulhas, pretor, fome, ruína e encontros.
// Módulo puro (sem DOM nem Three.js).
import { romansCampaign } from './clock.js';
import { praetorStep } from './praetor.js';
import { foodPerDay, checkRuin } from './state.js';
import { communityAt, recruitLimit, levy, loseMen } from './communities.js';
import { closeDay } from './harvest.js';
import { noteSupport } from './rome.js';
import { updateIntel, SCOUTS, RECON_RANGE } from './intel.js';
import { ensureDoctrine, tickDoctrine, moveHunter, spottedAmbush, escortBonus, nextSpawnGap, FIRST_SPAWN, FIRST_SPAWN_MIN, FIRST_NEAR } from './doctrine.js';
import { makeRng } from './rng.js';

export const MARCH_SPEED = 45;
export const PATROL_SPEED = 35;
export const ENCOUNTER_RADIUS = 30;
const REACH = 20, ROAD_NEAR = 25, VILLAGE_NEAR = 25;
export const HELP_GAP = 25, HELP_FOOD = 40;   // afinados na Task 18 (npm run balance)
export const CONVOY_CHANCE = 0.45;   // cada destacamento que sai de um posto é uma coluna de abastecimento com esta probabilidade
const HELP_FAME = 30, HELP_MEN = 2;
const PATROL_MEN = { patrulha: 6, comboio: 8 };
const STARVE = 0.10;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** A party (ou ponto) está a <= r da estrada? */
export function nearRoad(world, p, r = ROAD_NEAR) {
  const road = world.road;
  for (let i = 1; i < road.length; i++) if (segDist(p, road[i - 1], road[i]) <= r) return true;
  return false;
}

function moveToward(p, to, step) {
  const d = dist(p, to);
  if (d <= step) { p.x = to.x; p.y = to.y; } else { p.x += (to.x - p.x) / d * step; p.y += (to.y - p.y) / d * step; }
}

const findSettlement = (state, id, kind) => state.world.settlements.find(x => x.id === id && x.kind === kind);

/**
 * Aplica a ordem. Devolve { events, encounter } parcial, ou { refused: true, events } quando a ordem não se
 * pode cumprir: aí nada mudou no estado, e stepDay não deixa passar o dia.
 */
function applyOrder(state, order) {
  const refuse = ev => ({ refused: true, events: [ev], encounter: null });
  const invalid = (why, id) => refuse({ type: 'ordem-invalida', order: order.kind, why, ...(id === undefined ? {} : { id }) });
  // a povoação pedida, se existir e estiver ao alcance; senão, a recusa com o motivo
  const reach = kind => {
    const s = findSettlement(state, order.id, kind);
    if (!s) return { no: invalid('desconhecido') };
    if (dist(s, state.party) > REACH) return { no: invalid('longe', s.id) };
    return { s };
  };
  const none = { events: [], encounter: null };
  const { world, party } = state;
  switch (order.kind) {
    case 'marchar': {
      const to = order.to;
      if (!to || !Number.isFinite(to.x) || !Number.isFinite(to.y)) return invalid('destino');
      moveToward(party, { x: Math.min(world.w, Math.max(0, to.x)), y: Math.min(world.h, Math.max(0, to.y)) }, MARCH_SPEED);
      return none;
    }
    case 'recrutar': {   // só as comunidades do vale dão homens; cada um sai dos jovens da sua aldeia (communities.js)
      const s = state.world.settlements.find(x => x.id === order.id && (x.kind === 'aldeia' || x.kind === 'castro'));
      if (!s) return invalid('desconhecido');
      if (dist(s, party) > REACH) return invalid('longe', s.id);
      const v = state.villages[s.id];
      if (v?.burnt) return invalid('queimada', s.id);
      const c = communityAt(state, s.id);
      if (!c) return s.kind === 'aldeia' ? refuse({ type: 'recrutar-recusado', id: s.id, why: 'sem-comunidade' }) : invalid('desconhecido');
      const { limit: n, why } = recruitLimit(c, state.arms);   // postura, jovens e armas; a fama não conta (GDD v2)
      if (why === 'sem-armas') return refuse({ type: 'sem-armas', id: s.id });   // não gasta a vez da aldeia
      if (why) return refuse({ type: 'recrutar-recusado', id: s.id, why, ...(why === 'postura' ? { posture: c.posture } : {}) });
      levy(c, n, state.day);   // os jovens saem da aldeia (e, acima de um sexto, custam confiança)
      state.men += n; state.arms -= n;
      if (v) v.recruitedDay = state.day;   // só registo: já não há espera entre recrutamentos
      return { events: [{ type: 'recrutou', id: s.id, men: n }, ...noteSupport(state, c.id, 'homens')], encounter: null };   // Roma repara (rome.js)
    }
    case 'pedir-ajuda': {
      const { s, no } = reach('castro');
      if (no) return no;
      if (state.help && s.id in state.help && state.day - state.help[s.id] < HELP_GAP) return refuse({ type: 'ajuda-recusada', id: s.id, days: HELP_GAP - (state.day - state.help[s.id]) });
      state.help = state.help || {};
      state.help[s.id] = state.day;
      state.food += HELP_FOOD;
      const men = state.fame >= HELP_FAME ? HELP_MEN : 0;
      state.men += men;
      const c = communityAt(state, s.id);   // o castro do Penedo é uma comunidade: Roma repara que o ajudam (rome.js)
      return { events: [{ type: 'ajuda', id: s.id, food: HELP_FOOD, men }, ...(c ? noteSupport(state, c.id, 'comida') : [])], encounter: null };
    }
    case 'atacar': {
      const { s, no } = reach('posto');
      if (no) return no;
      if (state.posts && s.id in state.posts) return refuse({ type: 'posto-atacado', id: s.id });   // uma vez por campanha
      state.posts = state.posts || {};
      state.posts[s.id] = { taken: false };   // tomado só se a batalha for ganha (battles.applyResult)
      return { events: [], encounter: { kind: 'posto', foe: s, waiting: false, context: 'ataque' } };
    }
    case 'reconhecer': {   // dois batedores vão ver uma zona e voltam no fim do dia; o bando fica acampado
      const to = order.to;
      if (!to || !Number.isFinite(to.x) || !Number.isFinite(to.y)) return invalid('destino');
      if (state.men < SCOUTS + 1) return refuse({ type: 'reconhecer-recusado', why: 'homens' });
      if (dist(to, party) > RECON_RANGE) return refuse({ type: 'reconhecer-recusado', why: 'longe' });
      return { events: [], encounter: null, recon: { x: Math.min(world.w, Math.max(0, to.x)), y: Math.min(world.h, Math.max(0, to.y)) } };
    }
    case 'acampar': case 'esperar': case 'esconder': return none;
    default: return invalid('desconhecido');
  }
}

/**
 * Avança os destacamentos: patrulhas e colunas pela estrada, no sentido em que saíram (dir), até à outra
 * ponta; os caçadores fora da estrada, atrás do bando (doctrine.moveHunter).
 */
function stepPatrols(state, hidden) {
  const road = state.world.road;
  state.patrols = state.patrols.filter(p => {
    if (p.hunt) return moveHunter(state, p, hidden);
    const dir = p.dir === -1 ? -1 : 1;
    let left = PATROL_SPEED;
    while (left > 0 && p.i >= 0 && p.i < road.length) {
      const d = dist(p, road[p.i]);
      if (d <= left) { p.x = road[p.i].x; p.y = road[p.i].y; left -= d; p.i += dir; } else { moveToward(p, road[p.i], left); left = 0; }
    }
    return p.i >= 0 && p.i < road.length;
  });
}

/**
 * Um destacamento sai de um dos postos, no dia marcado em doctrine.nextSpawn: posto, tipo e o intervalo
 * até ao seguinte são sorteados (determinista por semente e dia). Leva escolta a mais conforme a doutrina.
 */
function spawnPatrol(state, rng) {
  const d = ensureDoctrine(state);
  const firstRng = () => makeRng(((state.seed | 0) * 131 + 7) >>> 0);   // sorteio próprio do primeiro destacamento
  if (d.nextSpawn === null) d.nextSpawn = firstRng().int(FIRST_SPAWN_MIN, FIRST_SPAWN);
  if (state.day < d.nextSpawn || !romansCampaign(state.day)) return;
  const opening = state.day <= FIRST_SPAWN && !state.patrols.length && !(state.battles > 0);   // só pode ser o primeiro
  d.nextSpawn = state.day + nextSpawnGap(state, rng);
  const road = state.world.road, postos = state.world.settlements.filter(s => s.kind === 'posto');
  if (!postos.length || road.length < 2) return;
  let posto = rng.pick(postos);
  if (opening) {   // o primeiro: metade das vezes do posto mais perto do bando
    const r = firstRng(); r.int(FIRST_SPAWN_MIN, FIRST_SPAWN);
    if (r.chance(FIRST_NEAR)) posto = postos.reduce((b, q) => (dist(q, state.party) < dist(b, state.party) ? q : b));
  }
  let at = 0, bd = Infinity;
  for (let k = 0; k < road.length; k++) { const q = dist(road[k], posto); if (q < bd) { bd = q; at = k; } }
  const dir = at < road.length / 2 ? 1 : -1, i = at + dir;
  if (i < 0 || i >= road.length) return;
  const kind = rng.chance(CONVOY_CHANCE) ? 'comboio' : 'patrulha';
  const p = { id: `${kind}-${state.day}`, kind, x: posto.x, y: posto.y, i, dir, men: PATROL_MEN[kind] + escortBonus(state, kind) };
  state.patrols.push(p);
}

function feed(state, events) {
  const need = foodPerDay(state.men);
  if (state.food >= need) { state.food -= need; return; }
  state.food = 0;
  const dead = Math.min(state.men, Math.max(1, Math.floor(state.men * STARVE)));
  loseMen(state, dead);
  events.push({ type: 'fome', mortos: dead });
}

/** Uma aldeia intacta a <= VILLAGE_NEAR da party com o pretor ou uma patrulha a <= ENCOUNTER_RADIUS dela.
 *  Os caçadores não contam: vêm atrás do bando, não da aldeia. */
function villageThreat(state) {
  const roads = state.patrols.filter(p => !p.hunt);
  const foes = state.praetor ? [state.praetor, ...roads] : roads;   // o pretor primeiro: é ele quem queima aldeias
  for (const s of state.world.settlements) {
    if (s.kind !== 'aldeia' || state.villages[s.id]?.burnt || dist(s, state.party) > VILLAGE_NEAR) continue;
    const foe = foes.find(f => dist(f, s) <= ENCOUNTER_RADIUS);
    if (foe) return { kind: 'defesa', foe, villageId: s.id, waiting: false };
  }
  return null;
}

/**
 * O encontro do dia, se houver. `context` diz porque é que se luta (o painel de batalha explica-o):
 * 'pretor', 'aldeia', 'emboscada', 'descoberta', 'fora-estrada', 'cacadores' ou 'encontro'.
 * Uma emboscada montada na estrada ataca a coluna que lhe passa à frente antes de esta chegar à aldeia;
 * só o pretor a chegar a uma aldeia (uma ameaça real: queima-a) passa à frente da emboscada.
 */
function detect(state, order, hidden, events) {
  const { party } = state;
  if (state.praetor && dist(state.praetor, party) <= ENCOUNTER_RADIUS) return { kind: 'pretor', foe: state.praetor, waiting: false, context: 'pretor' };
  if (hidden) return null;
  const waiting = order.kind === 'esperar', onRoad = waiting && nearRoad(state.world, party);
  const foe = state.patrols.find(p => dist(p, party) <= ENCOUNTER_RADIUS);
  let spotted = null;
  if (foe && onRoad && !foe.hunt) {
    spotted = spottedAmbush(state, foe);   // Roma aprendeu: batedores ou guarnição descobrem a emboscada
    if (spotted) events.push({ type: 'emboscada-descoberta', why: spotted });
    else {
      const threat = villageThreat(state);
      if (threat && threat.foe === state.praetor) return { ...threat, context: 'aldeia' };
      return { kind: foe.kind, foe, waiting: true, context: 'emboscada' };
    }
  }
  const threat = villageThreat(state);
  if (threat) return { ...threat, context: 'aldeia' };
  if (!foe) return null;
  const context = foe.hunt ? 'cacadores' : spotted ? 'descoberta' : waiting ? 'fora-estrada' : 'encontro';
  return { kind: foe.kind, foe, waiting: false, context };
}

/**
 * Um dia. Devolve os eventos e o eventual encontro, e `dayBreak`: o índice do primeiro evento que já é do dia seguinte. Uma ordem recusada não gasta o dia: devolve
 * { refused: true, events } sem mexer no estado (nem dia, nem comida, nem patrulhas, nem pretor).
 */
export function stepDay(state, order, rng) {
  if (state.over) return { events: [], encounter: null };
  const res = applyOrder(state, order);
  if (res.refused) return res;
  const events = res.events;
  const hidden = order.kind === 'esconder';
  stepPatrols(state, hidden);
  spawnPatrol(state, rng);
  if (state.praetor) events.push(...praetorStep(state, rng));
  events.push(...tickDoctrine(state));
  const food = state.food;
  feed(state, events);
  if (checkRuin(state)) events.push({ type: 'derrota' });
  state.day += 1;
  const dayBreak = events.length;   // daqui em diante os eventos já são do dia novo (colheita, Roma, relatos): o Diário regista-os nesse dia
  events.push(...closeDay(state, state.day - 1));   // fim de estação: colheita; de setembro em diante, a fome das aldeias
  const blocked = state.cooldown > 0;
  if (blocked) state.cooldown -= 1;
  let encounter = res.encounter;
  if (!encounter && !state.over && !blocked) encounter = detect(state, order, hidden, events);
  // o que o jogador ficou a saber hoje (só lê as posições; os encontros acima usam sempre as reais)
  events.push(...updateIntel(state, { recon: res.recon, dayEvents: events }));
  // esperar e esconder respondem sempre no diário (o resto do dia explica-se pelos outros eventos)
  if (!encounter && !state.over && (order.kind === 'esperar' || order.kind === 'esconder')) {
    events.push({ type: 'espera', order: order.kind, road: nearRoad(state.world, state.party), food: food - state.food });
  }
  return { events, encounter, dayBreak };
}
