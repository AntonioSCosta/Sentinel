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
