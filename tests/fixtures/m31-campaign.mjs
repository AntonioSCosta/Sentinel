import { newCampaign } from '../../src/campaign/state.js';
import { PATROL_SPEED } from '../../src/campaign/simulation.js';

export const PATROL_ID = 17;

export function patrolSave({ allies = 22, romans = 18, kind = 'patrulha' } = {}) {
  const state = newCampaign(3);
  const i = 3, a = state.world.road[i - 1], b = state.world.road[i];
  const fraction = PATROL_SPEED / Math.hypot(b.x - a.x, b.y - a.y);
  state.party = { x: a.x + fraction * (b.x - a.x), y: a.y + fraction * (b.y - a.y) };
  state.patrols = [{ id: PATROL_ID, kind, men: romans, ...a, i, dir: 1 }];
  state.men = allies;
  state.done.push('cativos');
  return { v: 1, phase: 'mapa', battle: null, state };
}
