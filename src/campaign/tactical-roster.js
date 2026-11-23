// Reconcile a frozen campaign roster with a final tactical result, without mutating either.
const sourceSides = new Map([
  ['band', 'lusitanos'], ['patrol', 'romanos'], ['praetor', 'romanos'], ['garrison', 'romanos'],
]);
const outcomes = new Set(['vitoria', 'derrota', 'retirada', 'escapou', 'tempo']);
const dispositions = ['dead', 'aliveOnField', 'fled', 'withdrawn', 'escaped'];
const isId = value => typeof value === 'string' && value.trim().length > 0;
const isCount = value => Number.isSafeInteger(value) && value >= 0;

function sourceKey(ref) {
  if (!sourceSides.has(ref?.kind) || !(isId(ref.id) || Number.isSafeInteger(ref.id))) {
    throw new Error('Invalid source reference');
  }
  // Older saves can use a numeric ID. Keep it distinct from a string with the same spelling.
  return JSON.stringify([ref.kind, ref.id]);
}

export function reconcileRoster(request, result) {
  if (request?.contractVersion !== 1 || result?.contractVersion !== 1) {
    throw new Error('Unsupported contract version');
  }
  if (!isId(request.campaignId) || !isId(request.encounterId) || !isCount(request.snapshotRevision)
    || request.campaignId !== result.campaignId || request.encounterId !== result.encounterId
    || request.snapshotRevision !== result.snapshotRevision) {
    throw new Error('Result does not match the pending encounter');
  }
  if (!outcomes.has(result.outcome) || !isCount(result.ticksElapsed)) throw new Error('Invalid final result');
  if (!Array.isArray(request.sources) || !Array.isArray(request.groups) || !Array.isArray(result.groups)) {
    throw new Error('Missing roster or group results');
  }

  const sources = new Map();
  for (const { ref, atStart } of request.sources) {
    const key = sourceKey(ref);
    if (sources.has(key) || !isCount(atStart)) throw new Error(`Invalid or repeated source ${key}`);
    sources.set(key, {
      ref: { kind: ref.kind, id: ref.id }, atStart, reserve: atStart,
      dead: 0, aliveOnField: 0, fled: 0, withdrawn: 0, escaped: 0,
    });
  }

  const pending = new Map();
  const sides = new Set();
  for (const { id, side, source, men } of request.groups) {
    const totals = sources.get(sourceKey(source));
    if (!isId(id) || pending.has(id)) throw new Error(`Invalid or repeated group ${id}`);
    if (!totals || side !== sourceSides.get(source.kind) || !isCount(men) || men === 0 || men > totals.reserve) {
      throw new Error(`Invalid allocation for group ${id}`);
    }
    totals.reserve -= men;
    pending.set(id, { totals, men });
    sides.add(side);
  }
  if (sides.size !== 2) throw new Error('Both sides need deployed groups');

  for (const group of result.groups) {
    const entry = pending.get(group?.id);
    if (!entry) throw new Error(`Unknown or repeated group result ${group?.id}`);
    const counts = dispositions.map(key => group[key]);
    if (!counts.every(isCount) || counts.reduce((sum, count) => sum + count, 0) !== entry.men) {
      throw new Error(`Headcount mismatch for group ${group.id}`);
    }
    for (const key of dispositions) entry.totals[key] += group[key];
    pending.delete(group.id);
  }
  if (pending.size) throw new Error('Missing group results');

  return Array.from(sources.values(), totals => ({ ...totals, survivors: totals.atStart - totals.dead }));
}
