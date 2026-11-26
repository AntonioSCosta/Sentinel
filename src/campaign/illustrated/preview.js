import { STORAGE_KEY } from '../flow.js';
import { BORDER, createSymbolCache, landscape, loadBrushes } from './landscape.js';
import { illustratedNavigation } from './navigation.js';

export async function createIllustratedPreview(params) {
  const brushes = await loadBrushes();
  const illustrated = {
    navigation: illustratedNavigation,
    symbols: createSymbolCache(),
    background: (seed, world) => ({ image: landscape(seed, world, brushes), border: BORDER }),
  };

  // Keep orders and battle saves in this tab while reviewing the new map.
  const data = new Map();
  const storage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
    clear: () => data.clear(),
  };
  const scenario = params.get('scenario');
  if (scenario) {
    const { comparisonState, scenarioIds } = await import('../../../tests/fixtures/valley-comparison.js');
    if (scenarioIds.includes(scenario)) {
      const state = comparisonState(scenario);
      storage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, phase: 'mapa', state, battle: null }));
    }
  }
  const seed = Number(params.get('seed') ?? 1234);
  return {
    illustrated, storage,
    open(campaign) {
      if (!data.has(STORAGE_KEY) || !campaign.resume()) campaign.fresh(Number.isSafeInteger(seed) ? seed : 1234);
    },
  };
}
