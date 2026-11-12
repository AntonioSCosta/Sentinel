// Gerador pseudoaleatório com semente (mulberry32). Função pura, sem DOM nem Three.js.
// Com a mesma semente, a sequência é sempre igual.

/** @param {number} seed  @returns {{next(): number, range(a: number, b: number): number, int(a: number, b: number): number, pick<T>(arr: T[]): T, chance(p: number): boolean}} */
export function makeRng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (a, b) => a + next() * (b - a),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    pick: arr => arr[Math.floor(next() * arr.length)],
    chance: p => next() < p,
  };
}
