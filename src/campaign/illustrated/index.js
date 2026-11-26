import { BORDER, createSymbolCache, landscape, loadBrushes } from './landscape.js';
import { illustratedNavigation } from './navigation.js';

/** Carrega a pintura de fundo e devolve o objeto que `createCampaignUI` recebe para o mapa ilustrado. */
export async function loadIllustrated() {
  const brushes = await loadBrushes();
  return {
    navigation: illustratedNavigation,
    symbols: createSymbolCache(),
    background: (seed, world) => ({ image: landscape(seed, world, brushes), border: BORDER }),
  };
}
