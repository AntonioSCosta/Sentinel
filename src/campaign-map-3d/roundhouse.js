import { distanceToLine } from './terrain.js';

// The strategic markers are exaggerated. Keep the house smaller than the marker
// while giving its roughly seven-metre footprint enough pixels to read at close zoom.
const ROUNDHOUSE_SCALE = 2;
const BASE_RADIUS = 3.7 * ROUNDHOUSE_SCALE;
const PAD_RADIUS = BASE_RADIUS + 12;

export function roundhousePlacement(place, terrain, places) {
  let best, bestScore = Infinity;
  for (const distance of [22, 26, 30, 34, 38, 42, 46]) {
    for (let index = 0; index < 16; index++) {
      const angle = index * Math.PI / 8;
      const x = place.x + distance * Math.cos(angle);
      const y = place.y + distance * Math.sin(angle);
      if (x < PAD_RADIUS || x > terrain.w - PAD_RADIUS ||
          y < PAD_RADIUS || y > terrain.h - PAD_RADIUS ||
          distanceToLine(x, y, terrain.river) < PAD_RADIUS + 5 ||
          distanceToLine(x, y, terrain.road) < PAD_RADIUS + 3 ||
          places.some(other => other.id !== place.id && Math.hypot(other.x - x, other.y - y) < 22)) continue;
      const heights = [terrain.heightAt(x, y)];
      for (let sample = 0; sample < 8; sample++) {
        const bearing = sample * Math.PI / 4;
        heights.push(terrain.heightAt(x + BASE_RADIUS * Math.cos(bearing),
          y + BASE_RADIUS * Math.sin(bearing)));
      }
      const low = Math.min(...heights), high = Math.max(...heights);
      const score = high - low + (distance - 22) * 0.14;
      if (score >= bestScore) continue;
      best = { x, y, elevation: (low + high) / 2 };
      bestScore = score;
    }
  }
  return best;
}

/** Blend a small level terrace into the visual height grid before building its mesh. */
export function levelRoundhouseSite(terrain, site) {
  const { w, h, rows, columns, heights } = terrain;
  // The terrain quads are about 4.5 m apart. Include the vertices of any
  // triangle that could cross the footprint, then feather out the terrace.
  const flatRadius = BASE_RADIUS + Math.hypot(w / columns, h / rows);
  const outerRadius = flatRadius + 5;
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= columns; col++) {
      const distance = Math.hypot(w * col / columns - site.x, h * row / rows - site.y);
      if (distance >= outerRadius) continue;
      const t = Math.max(0, (distance - flatRadius) / (outerRadius - flatRadius));
      const i = row * (columns + 1) + col;
      heights[i] = site.elevation + (heights[i] - site.elevation) * t * t * (3 - 2 * t);
    }
  }
}

export async function loadRoundhouse() {
  const [{ GLTFLoader }, { MeshoptDecoder }, { default: encoded }] = await Promise.all([
    import('../../vendor/three/addons/loaders/GLTFLoader.js'),
    import('../../vendor/three/addons/libs/meshopt_decoder.module.js'),
    import('../../assets/map/models/casa_redonda.glb.js'),
  ]);
  const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const { scene } = await loader.parseAsync(bytes.buffer, '');
  return [0, 1].map(level => {
    const lod = scene.getObjectByName(`mapa_casa_redonda_a_LOD${level}`);
    lod.scale.multiplyScalar(ROUNDHOUSE_SCALE);
    lod.position.multiplyScalar(ROUNDHOUSE_SCALE);
    lod.removeFromParent();
    return lod;
  });
}
