import { BufferGeometry, DoubleSide, Float32BufferAttribute, Mesh, MeshBasicMaterial } from 'three';

const LIFT = 4.5;

/** Draw a terrain-following stroke with map-unit width and optional dash/gap lengths. */
export function tacticalStroke(points, terrain, projection, { color, width, dash, gap }) {
  const vertices = [];
  let travelled = 0;
  const cycle = dash ? dash + gap : 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (length < 1e-6) continue;
    const nx = -dy / length * width / 2, ny = dx / length * width / 2;
    const at = (distance, side) => ({
      x: a.x + dx * distance / length + nx * side,
      y: a.y + dy * distance / length + ny * side,
    });
    function append(start, end) {
      const corners = [at(start, -1), at(start, 1), at(end, -1), at(end, 1)];
      if (corners.some(p => p.x < 0 || p.y < 0 || p.x > terrain.w || p.y > terrain.h)) return;
      const scene = corners.map(p => projection.toScene(p, terrain.heightAt(p.x, p.y) + LIFT));
      for (const index of [0, 1, 2, 2, 1, 3]) {
        const { x, y, z } = scene[index];
        vertices.push(x, y, z);
      }
    }
    if (!cycle) append(0, length);
    else {
      const end = travelled + length;
      for (let origin = Math.floor(travelled / cycle) * cycle; origin < end; origin += cycle) {
        const start = Math.max(travelled, origin), finish = Math.min(end, origin + dash);
        if (finish > start + 1e-6) append(start - travelled, finish - travelled);
      }
    }
    travelled += length;
  }
  const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(vertices, 3));
  return new Mesh(geometry, new MeshBasicMaterial({ color, side: DoubleSide, depthWrite: false }));
}

/** Build a ring without changing the information radius or location in map space. */
export function tacticalRing(zone, terrain, projection, style) {
  const count = Math.min(600, Math.max(32, Math.ceil(zone.r * 2)));
  const points = Array.from({ length: count + 1 }, (_, i) => {
    const angle = 2 * Math.PI * i / count;
    return { x: zone.x + zone.r * Math.cos(angle), y: zone.y + zone.r * Math.sin(angle) };
  });
  return tacticalStroke(points, terrain, projection, style);
}
