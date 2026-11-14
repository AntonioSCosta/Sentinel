// Pure world maths: noise, terrain height, road, camp, static collision.
/* =========================================================
   Utilities, noise and terrain height
   ========================================================= */
export const TAU = Math.PI * 2;
let seed = 1;
export const setSeed = v => { seed = v; };
export const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
export const rr = (a, b) => a + (b - a) * rand();
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const wrapA = a => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
export function hash(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
export function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y) { let s = 0, a = .5, f = 1; for (let i = 0; i < 5; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= .5; } return s / .96875; }

export const WORLD = 200;
export const roadX = z => Math.sin(z * .018) * 20 + Math.sin(z * .047) * 6;

// Mountain brook (Ribeira dos Montes Hermínios): runs winding through the lower valley floor
export const streamX = z => roadX(z) - 24 + Math.sin(z * .031) * 7;
export const inStream = (x, z, width = 3.6) => Math.abs(x - streamX(z)) < width;

export function rawH(x, z) {
  let h = (fbm(x * .010 + 3.1, z * .010 - 7.3) - .45) * 52;
  h = 1 + Math.log(1 + Math.exp(h - 1));                 // soft floor
  h += smooth(150, 208, Math.max(Math.abs(x), Math.abs(z))) * 55;
  const d = Math.abs(x - roadX(z));
  h = lerp(1, h, smooth(4, 48, d));
  h += (vnoise(x * .06, z * .06) - .5) * 2.4 * smooth(3, 10, d);
  
  // Tactical defile & mountain stream bed: carve natural shallow ravine along the stream
  const ds = Math.abs(x - streamX(z));
  const streamCarve = (1 - smooth(1.2, 5.0, ds)) * 0.95;
  h = Math.max(0.2, h - streamCarve);
  
  return h;
}
export const CAMP = { x: roadX(-135), z: -135, h: 1, half: 28 };
export const CASTRO = { x: roadX(150) + 40, z: 150, h: 0 };
CASTRO.h = rawH(CASTRO.x, CASTRO.z);
export function heightAt(x, z) {
  let h = rawH(x, z);
  h = lerp(CAMP.h, h, smooth(40, 62, Math.hypot(x - CAMP.x, z - CAMP.z)));
  h = lerp(CASTRO.h, h, smooth(11, 24, Math.hypot(x - CASTRO.x, z - CASTRO.z)));
  return h;
}
export const inCamp = (x, z, m = 0) => Math.abs(x - CAMP.x) < CAMP.half + m && Math.abs(z - CAMP.z) < CAMP.half + m;

/* collision grid of static circles */
export const GRID = 8, grid = new Map();
export const gkey = (i, j) => (i + 200) * 1000 + (j + 200);
export function addCol(x, z, r, h = 99) {
  const c = { x, z, r, h };
  for (let i = Math.floor((x - r) / GRID); i <= Math.floor((x + r) / GRID); i++)
    for (let j = Math.floor((z - r) / GRID); j <= Math.floor((z + r) / GRID); j++) {
      const k = gkey(i, j); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(c);
    }
  return c;   // set c.off = true to switch it off (scenery that belongs to one mission only)
}
export function resolve(p, r) {
  const i0 = Math.floor(p.x / GRID), j0 = Math.floor(p.z / GRID);
  for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
    const l = grid.get(gkey(i, j)); if (!l) continue;
    for (const c of l) {
      if (c.off) continue;
      const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), m = r + c.r;
      if (d < m && d > 1e-4) { p.x = c.x + dx / d * m; p.z = c.z + dz / d * m; }
    }
  }
  p.x = clamp(p.x, -WORLD + 6, WORLD - 6); p.z = clamp(p.z, -WORLD + 6, WORLD - 6);
}
export function losTerrain(ax, ay, az, bx, by, bz) {
  const n = 14;
  for (let i = 1; i < n; i++) { const t = i / n; const x = lerp(ax, bx, t), y = lerp(ay, by, t), z = lerp(az, bz, t); if (heightAt(x, z) > y) return false; }
  return true;
}


export function clearColliders() { grid.clear(); }

/** True if (x, z) — at height `above` over the ground — is inside a static collider (trunk, log, rock…). */
export function solidAt(x, z, above = 0) {
  const l = grid.get(gkey(Math.floor(x / GRID), Math.floor(z / GRID)));
  if (!l) return false;
  for (const c of l) if (!c.off && above < c.h && Math.hypot(x - c.x, z - c.z) < c.r) return true;
  return false;
}
