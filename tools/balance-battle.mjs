/** Apply the balance bot's sampled outcome through the pending encounter's own engine. */
export function finishBalanceBattle(flow, result) {
  const request = flow.tactical;
  if (!request) return flow.finishBattle(result);

  const { contractVersion, campaignId, encounterId, snapshotRevision } = request;
  const remaining = { lusitanos: result.alliesLost, romanos: result.enemiesKilled };
  return flow.finishTactical({
    contractVersion, campaignId, encounterId, snapshotRevision,
    outcome: result.won ? 'vitoria' : 'derrota',
    ticksElapsed: 0, // The probabilistic model does not run the arena clock.
    groups: request.groups.map(({ id, side, men }) => {
      // Distribute aggregate losses in roster order. Reserves are never deployed.
      const dead = Math.min(men, remaining[side]);
      remaining[side] -= dead;
      return { id, dead, aliveOnField: men - dead, fled: 0, withdrawn: 0, escaped: 0 };
    }),
  });
}
