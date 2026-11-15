// Um dia de campanha: ordem do jogador, patrulhas, pretor, fome, ruína e encontros.
// Módulo puro (sem DOM nem Three.js).
import { romansCampaign } from './clock.js';
import { praetorStep } from './praetor.js';
import { foodPerDay, recruitsFrom, checkRuin } from './state.js';
import { ensureDoctrine, tickDoctrine, moveHunter, spottedAmbush, escortBonus, nextSpawnGap, isActive, FIRST_SPAWN } from './doctrine.js';

export const MARCH_SPEED = 45;
export const PATROL_SPEED = 35;
export const ENCOUNTER_RADIUS = 30;
const REACH = 20, ROAD_NEAR = 25, VILLAGE_NEAR = 25;
export const HELP_GAP = 25, HELP_FOOD = 40;   // afinados na Task 18 (npm run balance)
export const CONVOY_CHANCE = 0.45;   // cada destacamento que sai de um posto é uma coluna de abastecimento com esta probabilidade
const RECRUIT_GAP = 10, HELP_FAME = 30, HELP_MEN = 2;
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

const settlementNear = (state, id, kind) => {
  const s = state.world.settlements.find(x => x.id === id && x.kind === kind);
  return s && dist(s, state.party) <= REACH ? s : null;
};

/** Aplica a ordem. Devolve { events, encounter } parcial. */
function applyOrder(state, order) {
  const invalid = () => ({ events: [{ type: 'ordem-invalida', order: order.kind }], encounter: null });
  const none = { events: [], encounter: null };
  const { world, party } = state;
  switch (order.kind) {
    case 'marchar': {
      const to = order.to;
      if (!to || !Number.isFinite(to.x) || !Number.isFinite(to.y)) return invalid();
      moveToward(party, { x: Math.min(world.w, Math.max(0, to.x)), y: Math.min(world.h, Math.max(0, to.y)) }, MARCH_SPEED);
      return none;
    }
    case 'recrutar': {
      const s = settlementNear(state, order.id, 'aldeia'), v = s && state.villages[s.id];
      if (!v || v.burnt) return invalid();
      if (state.day - v.recruitedDay < RECRUIT_GAP) return { events: [{ type: 'recrutar-cedo', id: s.id }], encounter: null };
      if (state.arms <= 0) return { events: [{ type: 'sem-armas', id: s.id }], encounter: null };   // não gasta a vez da aldeia
      const n = Math.min(recruitsFrom(state.fame), state.arms);
      state.men += n; state.arms -= n; v.recruitedDay = state.day;
      return { events: [{ type: 'recrutou', id: s.id, men: n }], encounter: null };
    }
    case 'pedir-ajuda': {
      const s = settlementNear(state, order.id, 'castro');
      if (!s) return invalid();
      state.help = state.help || {};
      if (s.id in state.help && state.day - state.help[s.id] < HELP_GAP) return { events: [{ type: 'ajuda-recusada', id: s.id }], encounter: null };
      state.help[s.id] = state.day;
      state.food += HELP_FOOD;
      const men = state.fame >= HELP_FAME ? HELP_MEN : 0;
      state.men += men;
      return { events: [{ type: 'ajuda', id: s.id, food: HELP_FOOD, men }], encounter: null };
    }
    case 'atacar': {
      const s = settlementNear(state, order.id, 'posto');
      if (!s) return invalid();
      if (state.posts && s.id in state.posts) return { events: [{ type: 'posto-atacado', id: s.id }], encounter: null };   // uma vez por campanha
      state.posts = state.posts || {};
      state.posts[s.id] = { taken: false };   // tomado só se a batalha for ganha (battles.applyResult)
      return { events: [], encounter: { kind: 'posto', foe: s, waiting: false } };
    }
    case 'acampar': case 'esperar': case 'esconder': return none;
    default: return invalid();
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
  if (d.nextSpawn === null) d.nextSpawn = FIRST_SPAWN;
  if (state.day < d.nextSpawn || !romansCampaign(state.day)) return;
  d.nextSpawn = state.day + nextSpawnGap(state, rng);
  const road = state.world.road, postos = state.world.settlements.filter(s => s.kind === 'posto');
  if (!postos.length || road.length < 2) return;
  const posto = rng.pick(postos);
  let at = 0, bd = Infinity;
  for (let k = 0; k < road.length; k++) { const q = dist(road[k], posto); if (q < bd) { bd = q; at = k; } }
  const dir = at < road.length / 2 ? 1 : -1, i = at + dir;
  if (i < 0 || i >= road.length) return;
  const kind = rng.chance(CONVOY_CHANCE) ? 'comboio' : 'patrulha';
  const p = { id: `${kind}-${state.day}`, kind, x: posto.x, y: posto.y, i, dir, men: PATROL_MEN[kind] + escortBonus(state, kind) };
  if (kind === 'patrulha' && isActive(state, 'batedores')) p.scouts = true;
  state.patrols.push(p);
}

function feed(state, events) {
  const need = foodPerDay(state.men);
  if (state.food >= need) { state.food -= need; return; }
  state.food = 0;
  const dead = Math.min(state.men, Math.max(1, Math.floor(state.men * STARVE)));
  state.men -= dead;
  events.push({ type: 'fome', mortos: dead });
}

/** Uma aldeia intacta a <= VILLAGE_NEAR da party com uma patrulha ou o pretor a <= ENCOUNTER_RADIUS dela. */
function villageThreat(state) {
  const foes = state.praetor ? [...state.patrols, state.praetor] : state.patrols;
  for (const s of state.world.settlements) {
    if (s.kind !== 'aldeia' || state.villages[s.id]?.burnt || dist(s, state.party) > VILLAGE_NEAR) continue;
    const foe = foes.find(f => dist(f, s) <= ENCOUNTER_RADIUS);
    if (foe) return { kind: 'defesa', foe, villageId: s.id, waiting: false };
  }
  return null;
}

function detect(state, order, hidden, events) {
  const { party } = state;
  if (state.praetor && dist(state.praetor, party) <= ENCOUNTER_RADIUS) return { kind: 'pretor', foe: state.praetor, waiting: false };
  if (hidden) return null;
  const threat = villageThreat(state);
  if (threat) return threat;
  const foe = state.patrols.find(p => dist(p, party) <= ENCOUNTER_RADIUS);
  if (!foe) return null;
  let waiting = order.kind === 'esperar' && nearRoad(state.world, party) && !foe.hunt;
  if (waiting) {   // Roma aprendeu: batedores ou guarnição descobrem a emboscada e a luta é em campo aberto
    const why = spottedAmbush(state, foe);
    if (why) { waiting = false; events.push({ type: 'emboscada-descoberta', why }); }
  }
  return { kind: foe.kind, foe, waiting };
}

/** Um dia. Devolve os eventos e o eventual encontro. */
export function stepDay(state, order, rng) {
  if (state.over) return { events: [], encounter: null };
  const res = applyOrder(state, order);
  const events = res.events;
  const hidden = order.kind === 'esconder';
  stepPatrols(state, hidden);
  spawnPatrol(state, rng);
  if (state.praetor) events.push(...praetorStep(state, rng));
  events.push(...tickDoctrine(state, rng));
  feed(state, events);
  if (checkRuin(state)) events.push({ type: 'derrota' });
  state.day += 1;
  const blocked = state.cooldown > 0;
  if (blocked) state.cooldown -= 1;
  let encounter = res.encounter;
  if (!encounter && !state.over && !blocked) encounter = detect(state, order, hidden, events);
  return { events, encounter };
}
