// Um dia de campanha: ordem do jogador, patrulhas, pretor, fome, ruína e encontros.
// Módulo puro (sem DOM nem Three.js).
import { romansCampaign } from './clock.js';
import { praetorStep } from './praetor.js';
import { foodPerDay, recruitsFrom, checkRuin } from './state.js';

export const MARCH_SPEED = 45;
export const PATROL_SPEED = 35;
export const ENCOUNTER_RADIUS = 30;
const REACH = 20, ROAD_NEAR = 25, VILLAGE_NEAR = 25;
const SPAWN_EVERY = 12, RECRUIT_GAP = 10, HELP_GAP = 30, HELP_FOOD = 25, HELP_FAME = 30, HELP_MEN = 2;
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
      return s ? { events: [], encounter: { kind: 'posto', foe: s, waiting: false } } : invalid();
    }
    case 'acampar': case 'esperar': case 'esconder': return none;
    default: return invalid();
  }
}

/** Avança as patrulhas ao longo da estrada (para leste) e remove as que chegam ao fim. */
function stepPatrols(state) {
  const road = state.world.road;
  state.patrols = state.patrols.filter(p => {
    let left = PATROL_SPEED;
    while (left > 0 && p.i < road.length) {
      const d = dist(p, road[p.i]);
      if (d <= left) { p.x = road[p.i].x; p.y = road[p.i].y; left -= d; p.i++; } else { moveToward(p, road[p.i], left); left = 0; }
    }
    return p.i < road.length;
  });
}

function spawnPatrol(state) {
  if (state.day <= 0 || state.day % SPAWN_EVERY || !romansCampaign(state.day)) return;
  const posto = state.world.settlements.filter(s => s.kind === 'posto').reduce((a, b) => (b.x < a.x ? b : a));
  const road = state.world.road;
  let i = road.findIndex(r => r.x > posto.x);
  if (i < 0) return;
  const n = state.day / SPAWN_EVERY - 1, kind = n % 2 ? 'comboio' : 'patrulha';
  state.patrols.push({ id: `${kind}-${state.day}`, kind, x: posto.x, y: posto.y, i, men: PATROL_MEN[kind] });
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

function detect(state, order, hidden) {
  const { party } = state;
  if (state.praetor && dist(state.praetor, party) <= ENCOUNTER_RADIUS) return { kind: 'pretor', foe: state.praetor, waiting: false };
  if (hidden) return null;
  const threat = villageThreat(state);
  if (threat) return threat;
  const foe = state.patrols.find(p => dist(p, party) <= ENCOUNTER_RADIUS);
  if (!foe) return null;
  return { kind: foe.kind, foe, waiting: order.kind === 'esperar' && nearRoad(state.world, party) };
}

/** Um dia. Devolve os eventos e o eventual encontro. */
export function stepDay(state, order, rng) {
  if (state.over) return { events: [], encounter: null };
  const res = applyOrder(state, order);
  const events = res.events;
  stepPatrols(state);
  spawnPatrol(state);
  if (state.praetor) events.push(...praetorStep(state, rng));
  feed(state, events);
  if (checkRuin(state)) events.push({ type: 'derrota' });
  state.day += 1;
  const blocked = state.cooldown > 0;
  if (blocked) state.cooldown -= 1;
  let encounter = res.encounter;
  if (!encounter && !state.over && !blocked) encounter = detect(state, order, order.kind === 'esconder');
  return { events, encounter };
}
