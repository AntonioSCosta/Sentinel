import { makeRng } from '../campaign/rng.js';

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (low, high, value) => {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Map +x becomes scene +x, map +y becomes scene +z, and elevation is scene +y. */
export function createMapProjection({ w, h }) {
  return {
    toScene: ({ x, y }, elevation = 0) => ({ x: x - w / 2, y: elevation, z: y - h / 2 }),
    toMap: ({ x, z }) => ({ x: x + w / 2, y: z + h / 2 }),
  };
}

/** Parse the geometry of a raw v1 campaign or its save envelope without opening the campaign. */
export function readPrototypeSave(text) {
  const save = JSON.parse(text);
  const state = save?.state ?? save;
  const world = state?.world;
  const point = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) &&
    p.x >= 0 && p.x <= world.w && p.y >= 0 && p.y <= world.h;
  if (save?.v !== 1 || state?.v !== 1 || !Number.isFinite(state.seed) ||
      !Number.isFinite(world?.w) || world.w <= 0 || !Number.isFinite(world.h) || world.h <= 0 ||
      !Array.isArray(world.road) || !world.road.every(point) ||
      !Array.isArray(world.settlements) || !world.settlements.every(p =>
        point(p) && typeof p.id === 'string' && typeof p.name === 'string' &&
        ['aldeia', 'castro', 'serra', 'posto'].includes(p.kind))) {
    throw new Error('O ficheiro não contém um mapa de campanha compatível com a gravação v1.');
  }
  return { seed: state.seed, world, day: state.day, intel: state.intel, communities: state.communities };
}

function noise(seed, x, y) {
  const i = Math.floor(x), j = Math.floor(y);
  const hash = (a, b) => {
    let n = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ seed;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const u = smooth(0, 1, x - i), v = smooth(0, 1, y - j);
  return lerp(lerp(hash(i, j), hash(i + 1, j), u), lerp(hash(i, j + 1), hash(i + 1, j + 1), u), v);
}

/** Minimum horizontal distance from a map point to a polyline. */
export function distanceToLine(x, y, road) {
  let nearest = Infinity;
  for (let i = 1; i < road.length; i++) {
    const a = road[i - 1], b = road[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    const t = length ? clamp(((x - a.x) * dx + (y - a.y) * dy) / length, 0, 1) : 0;
    nearest = Math.min(nearest, Math.hypot(x - a.x - t * dx, y - a.y - t * dy));
  }
  return nearest;
}

function valleyCourse(rng, { w, h, settlements }) {
  let best, bestClearance = -Infinity;
  for (let i = 0; i < 96; i++) {
    const center = rng.range(0.32, 0.68);
    const phase = rng.range(0, Math.PI * 2), bend = rng.range(0, Math.PI * 2);
    const course = x => h * (center + 0.09 * Math.sin(x / w * 6.5 + phase) +
      0.035 * Math.sin(x / w * 14 + bend));
    const clearance = Math.min(...settlements.map(place => Math.abs(place.y - course(place.x))));
    if (clearance >= 24) return course;
    if (clearance > bestClearance) {
      best = course;
      bestClearance = clearance;
    }
  }
  return best;
}

/** Densify an existing polyline, retaining its original vertices and straight segments. */
export function subdivideLine(points, maxStep) {
  if (!points.length) return [];
  const result = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) continue;
    const segments = Math.ceil(length / maxStep);
    for (let j = 1; j < segments; j++) result.push({ x: lerp(a.x, b.x, j / segments), y: lerp(a.y, b.y, j / segments) });
    result.push(b);
  }
  return result;
}

/**
 * Build the visual terrain independently of Three.js and the simulation.
 * Height queries interpolate the same triangles used by the rendered mesh.
 */
export function createCampaignTerrain(seed, world) {
  const { w, h } = world;
  // The visual RNG has its own state. No campaign RNG is passed in.
  const rng = makeRng((seed >>> 0) ^ 0x59ad03c7);
  const noiseSeed = rng.int(0, 0xffffffff);
  const riverY = valleyCourse(rng, world);
  const riverFloor = x => 15 - 10 * x / w;
  const peaks = world.settlements.filter(p => p.kind === 'serra' || p.kind === 'castro');
  const pads = world.settlements.filter(p => p.kind !== 'serra').map(place => ({
    ...place, elevation: landHeight(place.x, place.y),
  }));

  function landHeight(x, y) {
    const valley = Math.abs(y - riverY(x));
    const highland = smooth(22, 215, valley);
    const broad = noise(noiseSeed, x / 150, y / 150);
    const detail = noise(noiseSeed, x / 53 + 120, y / 53 + 120);
    const grain = noise(noiseSeed, x / 19 + 330, y / 19 + 330);
    let peakHeight = 0;
    for (const peak of peaks) {
      const distance = Math.hypot(x - peak.x, y - peak.y);
      const height = peak.kind === 'serra' ? 109 : 57;
      peakHeight = Math.max(peakHeight, height * (1 - smooth(3, 133, distance)));
    }
    const roadDistance = distanceToLine(x, y, world.road);
    const texture = lerp(0.25, 1, smooth(4, 28, roadDistance));
    return riverFloor(x) + 8 + highland * (18 + 63 * broad + 38 * detail) +
      peakHeight * smooth(17, 90, valley) + (detail * 9 + grain * 6) * texture;
  }

  function ground(x, y) {
    let height = landHeight(x, y);
    // A settlement gets a small local pad, centred on its exact strategic location.
    for (const pad of pads) {
      const distance = Math.hypot(x - pad.x, y - pad.y);
      if (distance < 21) height = lerp(pad.elevation, height, smooth(6, 21, distance));
    }
    const distance = Math.abs(y - riverY(x));
    return lerp(riverFloor(x) - 2, height, smooth(6, 23, distance));
  }

  const columns = 220, rows = 154;
  const dx = w / columns, dy = h / rows;
  const heights = new Float32Array((columns + 1) * (rows + 1));
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= columns; col++) heights[row * (columns + 1) + col] = ground(col * dx, row * dy);
  }

  function heightAt(x, y) {
    const u = clamp(x / dx, 0, columns), v = clamp(y / dy, 0, rows);
    const col = Math.min(Math.floor(u), columns - 1), row = Math.min(Math.floor(v), rows - 1);
    const a = u - col, b = v - row, i = row * (columns + 1) + col;
    const nw = heights[i], ne = heights[i + 1], sw = heights[i + columns + 1], se = heights[i + columns + 2];
    return a + b <= 1 ? nw + (ne - nw) * a + (sw - nw) * b
      : se + (sw - se) * (1 - a) + (ne - se) * (1 - b);
  }

  const river = Array.from({ length: columns * 2 + 1 }, (_, i) => {
    const x = w * i / (columns * 2);
    return { x, y: riverY(x) };
  });
  const road = subdivideLine(world.road, 2);
  const settlements = world.settlements.map(place => ({ ...place, height: heightAt(place.x, place.y) }));
  return { w, h, columns, rows, heights, heightAt, river, riverY, road, settlements };
}

// Presentation coordinates only. The playable rectangle remains the pan target limit.
export const marginWidth = ({ w, h }) => Math.max(600, 2 * Math.max(w, h));

export function marginHeight(terrain, x, y, edgeX, edgeY, distance) {
  const edge = terrain.heightAt(edgeX, edgeY);
  const ridge = 75 + 28 * Math.sin(x / 83 + y / 117) + 16 * Math.sin(y / 47 - x / 61);
  // Continue the boundary slope for the first few metres so a sudden change
  // in the normal does not outline the playable rectangle in the lighting.
  const length = Math.hypot(x - edgeX, y - edgeY);
  if (!length) return edge;
  const dx = (x - edgeX) / length, dy = (y - edgeY) / length;
  const slope = (edge - terrain.heightAt(edgeX - dx * 4, edgeY - dy * 4)) / 4;
  return lerp(edge + clamp(slope, -1, 1) * Math.min(length, 18), ridge, smooth(0, 170, distance));
}

// At ground height the inclined frustum has half-extents H*aspect and
// H/cos(tilt). Its diagonal bounds any azimuth. Allow for the displacement
// of its centre at the outer rim, whose height is in [31,119].
export function framingHeight(terrain, aspect, tiltTangent, targetY, requested) {
  const displacement = Math.max(Math.abs(targetY - 31), Math.abs(targetY - 119)) * tiltTangent;
  const limit = (marginWidth(terrain) - displacement - 2) / Math.hypot(aspect, 1, tiltTangent);
  return Math.min(requested, limit);
}
