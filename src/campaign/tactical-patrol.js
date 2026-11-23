import { DT, TUNING } from '../tactical/data.js';
import { canPlace, EXITS, FIELD } from '../tactical/proto/field.js';
import { defaultPlacement, marchingColumn, PROTO_VERSION, startsHidden } from '../tactical/proto/setup.js';
import { reconcileRoster } from './tactical-roster.js';

export const PATROL_ENGINE = 'm3.1-patrol';
const count = n => Number.isSafeInteger(n) && n > 0;
const forceId = id => (typeof id === 'string' && id.trim().length > 0) || Number.isSafeInteger(id);

export function patrolOf(state, spec) {
  if (spec?.type !== 'emboscada' || spec.site !== 'estrada' || spec.foeKind !== 'patrulha' || !forceId(spec.foeId)) return null;
  // Intel uses string keys. Only route forces unambiguous in both campaign and intel.
  const id = String(spec.foeId);
  const matches = state.patrols.filter(p => String(p.id) === id);
  const patrol = matches[0];
  if (matches.length !== 1 || (state.praetor && String(state.praetor.id ?? 'pretor') === id)
    || patrol.id !== spec.foeId || patrol.kind !== 'patrulha' || patrol.hunt || !count(patrol.men)) return null;
  return patrol;
}

// Scale formation weights to the actual roster, capped by the authored M1.2 formation.
function allocate(layout, available) {
  const capacity = layout.reduce((sum, group) => sum + group.men, 0);
  const deployed = Math.min(available, capacity);
  const shares = layout.map(group => deployed * group.men / capacity);
  const men = shares.map(Math.floor);
  const left = deployed - men.reduce((sum, value) => sum + value, 0);
  const priority = men.map((value, index) => ({ index, fraction: shares[index] - value }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of priority.slice(0, left)) men[index]++;
  return layout.map((group, index) => ({ ...group, men: men[index] })).filter(group => group.men > 0);
}

export function createPatrolEncounter(state, spec, { campaignId, revision }) {
  const patrol = patrolOf(state, spec);
  if (!patrol || !count(state.men) || !count(spec.seed) || state.men !== spec.realMen || !spec.where) return null;
  const band = { kind: 'band', id: 'band' };
  const romans = { kind: 'patrol', id: patrol.id };
  const bandGroups = allocate(defaultPlacement(), state.men).map(({ id, role, men, x, y }) => ({
    id, side: 'lusitanos', role, source: band, men, spawn: { x, y, facing: Math.PI / 2 }, hidden: startsHidden(x, y),
  }));
  const romanGroups = allocate(marchingColumn(spec.seed), patrol.men).map(({ id, role, men, x, y, facing, order }) => ({
    id, side: 'romanos', role, source: romans, men, spawn: { x, y, facing }, order,
  }));
  return {
    contractVersion: 1, campaignId, encounterId: `patrol-${revision}`, snapshotRevision: revision,
    seed: spec.seed, rulesetId: PROTO_VERSION,
    site: { kind: 'estrada', anchorMap: { ...spec.where }, field: { recipeId: 'm1.2', recipeVersion: 1, widthM: FIELD.w, heightM: FIELD.h } },
    objective: { code: 'intercept-patrol', targetRef: romans },
    conditions: { policyId: PATROL_ENGINE, maxTicks: Math.round(TUNING.maxTime / DT), exits: EXITS, preBattleWithdrawalAllowed: false },
    sources: [{ ref: band, atStart: state.men }, { ref: romans, atStart: patrol.men }],
    groups: [...romanGroups, ...bandGroups],
  };
}

export const patrolPlacement = request => request.groups.filter(group => group.side === 'lusitanos')
  .map(({ id, role, men, spawn: { x, y } }) => ({ id, role, men, x, y }));

export const patrolColumn = request => request.groups.filter(group => group.side === 'romanos')
  .map(({ id, role, men, spawn, order }) => ({ id, role, men, ...spawn, order }));

export function preparePatrol(request, placement) {
  if (!Array.isArray(placement) || placement.length !== patrolPlacement(request).length) return null;
  const byId = new Map(placement.map(group => [group?.id, group]));
  const groups = [];
  for (const group of request.groups) {
    if (group.side === 'romanos') { groups.push(group); continue; }
    const p = byId.get(group.id);
    if (!p || p.men !== group.men || !['guerreiro', 'fundeiro'].includes(p.role)
      || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !canPlace(p.x, p.y)) return null;
    groups.push({ ...group, role: p.role, spawn: { x: p.x, y: p.y, facing: p.y < 55 ? Math.PI / 2 : -Math.PI / 2 }, hidden: startsHidden(p.x, p.y) });
  }
  return { ...request, groups };
}

export function restorePatrol(state, spec, meta, saved) {
  try {
    const original = createPatrolEncounter(state, spec, meta);
    const prepared = original && preparePatrol(original, patrolPlacement(saved));
    return prepared && JSON.stringify(prepared) === JSON.stringify(saved) ? prepared : null;
  } catch { return null; }
}

const destinations = { fugiu: 'fled', retirou: 'withdrawn', escapou: 'escaped' };

export function patrolResult(request, battle) {
  if (!battle.over || battle.seed !== request.seed) return null;
  const { contractVersion, campaignId, encounterId, snapshotRevision } = request;
  return {
    contractVersion, campaignId, encounterId, snapshotRevision, outcome: battle.over, ticksElapsed: battle.tick,
    groups: battle.groups.map(group => {
      const result = { id: group.id, dead: group.dead, aliveOnField: 0, fled: 0, withdrawn: 0, escaped: 0 };
      if (group.left === null) result.aliveOnField = group.men;
      else if (Object.hasOwn(destinations, group.left)) result[destinations[group.left]] = group.men;
      else if (group.left !== 'morto' || group.men !== 0) throw new Error(`Invalid group destination ${group.left}`);
      return result;
    }),
  };
}

export function patrolCasualties(state, spec, request, result) {
  try {
    const patrol = patrolOf(state, spec);
    if (!patrol || !Number.isSafeInteger(result?.ticksElapsed) || result.ticksElapsed > request.conditions.maxTicks) return null;
    const [band, romans] = reconcileRoster(request, result);
    if (state.men !== band.atStart || patrol.men !== romans.atStart) return null;
    return { alliedDead: band.dead, romanDead: romans.dead, romanSurvivors: romans.survivors, outcome: result.outcome };
  } catch { return null; }
}
