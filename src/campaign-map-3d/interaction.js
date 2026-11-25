import { Raycaster, Vector2 } from 'three';

/** Raycast only the terrain and the explicit targets in the strategic view. */
export function pickStrategicPoint(camera, x, y, relief, targets, projection) {
  const ray = new Raycaster();
  ray.setFromCamera(new Vector2(x, y), camera);
  const [hit] = ray.intersectObjects([relief, ...targets], true);
  if (!hit) return null;
  if (hit.object === relief) return { type: 'terrain', ...projection.toMap(hit.point) };

  let object = hit.object;
  while (object && !object.userData.selection) object = object.parent;
  return object?.userData.selection ?? null;
}

const overlaps = (a, b) => a.x < b.x + b.w + 3 && a.x + a.w + 3 > b.x &&
  a.y < b.y + b.h + 3 && a.y + a.h + 3 > b.y;

/** Pack screen-space label boxes by priority, trying alternative anchors before hiding one. */
export function positionLabels(labels, width, height, reserved = []) {
  const occupied = [...reserved], placed = new Map();
  for (const label of [...labels].sort((a, b) => b.priority - a.priority)) {
    const { x, y, w, h } = label;
    if (x < 0 || y < 0 || x > width || y > height) continue;
    const positions = [[x - w / 2, y - h - 8], [x + 12, y - h / 2],
      [x - w - 12, y - h / 2], [x - w / 2, y + 14]];
    // Essential labels can move farther from their marker, with a leader line.
    if (label.reposition) {
      for (const offset of [22, 44, 66, 88, 110, 132, 154, 176, 198]) {
        positions.push([x - w / 2, y - h - offset], [x - w / 2, y + offset]);
        for (const left of [x - w - offset, x + offset]) {
          positions.push([left, y - h / 2], [left, y - h - offset], [left, y + offset]);
        }
      }
    }
    for (const [left, top] of positions) {
      const box = { x: left, y: top, w, h };
      if (left < 4 || top < 4 || left + w > width - 4 || top + h > height - 4 ||
          occupied.some(other => overlaps(box, other))) continue;
      occupied.push(box);
      placed.set(label.id, box);
      break;
    }
  }
  return placed;
}

/** Connect the marker to the nearest label edge only when the gap needs a cue. */
export function labelLeader(anchor, box) {
  const x = Math.max(box.x, Math.min(anchor.x, box.x + box.w));
  const y = Math.max(box.y, Math.min(anchor.y, box.y + box.h));
  return Math.hypot(anchor.x - x, anchor.y - y) >= 10 ? { x, y } : null;
}

/** Prefer a short unobstructed connector. A hidden connector is clearer than one crossing a label. */
export function leaderPath(anchor, box, obstacles) {
  const end = labelLeader(anchor, box);
  if (!end) return null;
  const clear = points => obstacles.every(obstacle => points.slice(1).every((point, index) => {
    const start = points[index];
    const steps = Math.ceil(Math.hypot(point.x - start.x, point.y - start.y) / 4);
    for (let step = 1; step < steps; step++) {
      const x = start.x + (point.x - start.x) * step / steps;
      const y = start.y + (point.y - start.y) * step / steps;
      if (x >= obstacle.x - 2 && x <= obstacle.x + obstacle.w + 2 &&
          y >= obstacle.y - 2 && y <= obstacle.y + obstacle.h + 2) return false;
    }
    return true;
  }));
  const routes = [[anchor, end], [anchor, { x: anchor.x, y: end.y }, end],
    [anchor, { x: end.x, y: anchor.y }, end]];
  const route = routes.find(clear);
  return route?.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ') ?? null;
}
