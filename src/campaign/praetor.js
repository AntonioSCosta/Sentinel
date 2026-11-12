// O pretor romano: dados e IA diária. Módulo puro (sem DOM nem Three.js).
import { YEAR_DAYS } from './clock.js';

export const SIGHT = 140;
export const FINAL_CONVERGENCE = 20;
const BURN_RANGE = 10;
const BURN_FAME = 3;
const JITTER = 0.15;

// pursuit: a partir de 0.5 persegue a party se a vir (determinista).
// scorch: reservado, ainda sem efeito; a afinar na tarefa de equilíbrio.
export const PRAETORS = {
  vetilio: { id: 'vetilio', name: 'Caio Vetílio', men: 60, speed: 30,
    traits: { pursuit: .7, scorch: .5 }, chronicleId: 'vetilio' },
};

const clamp01 = v => Math.min(1, Math.max(0, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Cria o pretor `id`, com traços variados pela semente, no posto mais afastado do início. */
export function makePraetor(id, rng, world) {
  const base = PRAETORS[id];
  const traits = {};
  for (const k of Object.keys(base.traits)) traits[k] = clamp01(base.traits[k] + rng.range(-JITTER, JITTER));
  const postos = world.settlements.filter(s => s.kind === 'posto');
  const spot = postos.reduce((best, p) => (dist(p, world.start) > dist(best, world.start) ? p : best), postos[0]);
  return { ...base, traits, x: spot.x, y: spot.y };
}

/** Um dia de marcha do pretor. Devolve os eventos ocorridos. */
export function praetorStep(state, rng) {
  const p = state.praetor;
  if (!p) return [];
  let target = null, village = null;
  if (state.day >= YEAR_DAYS - FINAL_CONVERGENCE) target = state.party;
  else if (dist(p, state.party) <= SIGHT && p.traits.pursuit >= 0.5) target = state.party;
  else {
    let best = Infinity;
    for (const s of state.world.settlements) {
      if (s.kind !== 'aldeia' || state.villages[s.id]?.burnt) continue;
      const d = dist(p, s);
      if (d < best) { best = d; village = s; }
    }
    target = village || state.party;
  }
  const d = dist(p, target);
  if (d <= p.speed) { p.x = target.x; p.y = target.y; }
  else { p.x += (target.x - p.x) / d * p.speed; p.y += (target.y - p.y) / d * p.speed; }
  const events = [];
  if (village && dist(p, village) <= BURN_RANGE) {
    state.villages[village.id].burnt = true;
    state.fame = Math.max(0, state.fame - BURN_FAME);
    events.push({ type: 'aldeia-queimada', id: village.id });
  }
  return events;
}
