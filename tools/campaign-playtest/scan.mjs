import { loadFlow, STORAGE_KEY } from '../../src/campaign/flow.js';
import { intelView } from '../../src/campaign/intel.js';
import { marchDays } from '../../src/campaign/simulation.js';
import { distance, makeCheckpoint, memoryStorage } from './fixture.mjs';

const candidates = [];
for (let seed = 1; seed <= 48; seed++) {
  const checkpoint = makeCheckpoint(seed);
  if (!checkpoint) continue;
  const { flow: start, castro, raw } = checkpoint;
  const road = start.state.world.road.map((point, index) => ({ point, index, range: distance(point, castro) }));
  for (const { point, index } of road.filter(p => p.range <= 135).sort((a, b) => a.range - b.range).slice(0, 3)) {
    const storage = memoryStorage(raw), flow = loadFlow(storage);
    const aid = flow.order({ kind: 'pedir-ajuda', id: castro.id });
    if (aid.refused) continue;
    const moves = marchDays(flow.state.world, flow.state.party, point);
    for (let i = 0; i < moves && flow.phase === 'mapa'; i++) flow.order({ kind: 'marchar', to: point });
    while (flow.phase === 'mapa' && flow.state.day < 9) {
      const before = storage.getItem(STORAGE_KEY), known = intelView(flow.state).forces;
      flow.order({ kind: 'esperar' });
      if (!flow.tactical) continue;
      const avoid = loadFlow(memoryStorage(before));
      avoid.order({ kind: 'esconder' });
      const patrol = flow.battle.foeId;
      if (avoid.phase !== 'mapa' || !known.some(f => f.id === patrol && f.status === 'confirmada')) continue;
      candidates.push({ seed, castro: castro.id, checkpointDay: start.state.day, road: index, moves, encounterDay: flow.state.day,
        patrol, men: flow.tactical.sources[1].atStart, food: flow.state.food, attention: flow.state.rome.attention });
    }
  }
}
candidates.sort((a, b) => a.moves - b.moves || a.encounterDay - b.encounterDay || a.seed - b.seed);
console.log(JSON.stringify(candidates, null, 2));
