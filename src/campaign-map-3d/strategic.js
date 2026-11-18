import { intelView, validIntel } from '../campaign/intel.js';
import { makeRng } from '../campaign/rng.js';
import { communityOf, placeName } from '../campaign/strings.js';
import { distanceToLine } from './terrain.js';

export const TREE_CLEARANCE = Object.freeze({ road: 11, river: 15, place: 20 });

/** Project only the information the campaign UI is allowed to display. */
export function strategicView({ world, day, intel, communities, villages, posts }) {
  const names = { world, communities };
  const knowledge = Number.isFinite(day) && validIntel(intel) ? intelView({ day, intel }) : intelView({});
  return {
    places: world.settlements.map(place => ({
      ...place, name: placeName(names, place.id), community: !!communityOf(names, place.id),
      burnt: !!(villages?.[place.id]?.burnt || posts?.[place.id]?.taken ||
        ['queimada', 'abandonada'].includes(communities?.[communityOf(names, place.id)]?.situation)),
    })),
    forces: knowledge.forces,
    zones: knowledge.zones,
  };
}

/** Deterministically distribute tree centres with clearance for their canopies. */
export function generateVegetation(seed, world, terrain) {
  const rng = makeRng((seed >>> 0) ^ 0x4b29db71);
  const trees = [];
  const spacing = Math.max(12, world.w / 100, world.h / 100);
  for (let y = 8; y < world.h - 8; y += spacing) {
    for (let x = 8; x < world.w - 8; x += spacing) {
      const px = x + rng.range(-3, 3), py = y + rng.range(-3, 3);
      const patch = 0.38 + 0.29 * Math.sin(px / 41 + Math.cos(py / 64)) * Math.cos(py / 55);
      if (rng.next() > patch) continue;
      if (Math.abs(py - terrain.riverY(px)) < TREE_CLEARANCE.river ||
          distanceToLine(px, py, world.road) < TREE_CLEARANCE.road ||
          world.settlements.some(place => Math.hypot(px - place.x, py - place.y) < TREE_CLEARANCE.place)) continue;
      const height = terrain.heightAt(px, py);
      const slope = Math.hypot(terrain.heightAt(px + 2, py) - terrain.heightAt(px - 2, py),
        terrain.heightAt(px, py + 2) - terrain.heightAt(px, py - 2)) / 4;
      if (slope > 0.65 || height > 142) continue;
      trees.push({ x: px, y: py, height, scale: rng.range(0.7, 1.35), rotation: rng.range(0, 2 * Math.PI) });
    }
  }
  return trees;
}
