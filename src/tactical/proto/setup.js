// The authored M1.2 layout shared by the standalone prototype and the campaign adapter.
import { makeRng } from '../../campaign/rng.js';
import { BAND, COLUMN_VARIANTS, ROAD, concealAt, roadPoint } from './field.js';

export const PROTO_VERSION = 'm1.2-proto-1';
export const defaultPlacement = () => BAND.map(group => ({ ...group }));
export const startsHidden = (x, y) => concealAt(x, y) > 0.5;
export const columnVariant = seed => makeRng(((seed | 0) ^ 0xc01) >>> 0 || 1).int(0, COLUMN_VARIANTS.length - 1);

export function marchingColumn(seed) {
  return COLUMN_VARIANTS[columnVariant(seed)].map(c => {
    const at = roadPoint(c.along);
    return { id: c.id, role: c.role, men: c.men, ...at,
      order: { type: 'mover', path: ROAD.filter(p => p.x > at.x + 1), pace: 'marcha', leave: true } };
  });
}
