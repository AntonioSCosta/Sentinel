// Visual coordinates only: x/z lie on the field and y is elevation in metres.
const EYE_HEIGHT = 1.65;
const TRANSITION = 0.55;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const mix = (a, b, f) => a + (b - a) * f;
const angle = (a, b, f) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * f;
const settle = (rate, dt) => 1 - Math.exp(-rate * dt);

function blend(a, b, f) {
  return {
    x: mix(a.x, b.x, f), y: mix(a.y, b.y, f), z: mix(a.z, b.z, f),
    yaw: angle(a.yaw, b.yaw, f), pitch: mix(a.pitch, b.pitch, f), fov: mix(a.fov, b.fov, f),
  };
}

export const canFollow = group => group.men > 0 && group.left == null && group.x >= 0;

export function createCameraRig({ heightAt, width, depth, reducedMotion = false }) {
  let mode = 'strategic', targetId = null, focusId = null;
  let current, free, heading, from;
  let elapsed = TRANSITION, yawOffset = 0, tilt = 0, distance = 6.5;

  function select(next, id = null) {
    if (next === mode && (next !== 'follow' || id === targetId)) return;
    mode = next;
    targetId = next === 'follow' ? id : null;
    focusId = next === 'immersive' ? id : null;
    free = heading = undefined;
    yawOffset = tilt = 0;
    distance = 6.5;
    elapsed = reducedMotion ? TRANSITION : 0;
    from = current;
  }

  function look(yaw, pitch) {
    if (mode === 'immersive' && free) {
      free.yaw += yaw;
      free.pitch = clamp(free.pitch + pitch, -0.5, 0.52);
    } else if (mode === 'follow') {
      yawOffset += yaw;
      tilt = clamp(tilt + pitch, -0.36, 0.44);
    }
  }

  function move(right, forward) {
    if (mode !== 'immersive' || !free) return;
    const s = Math.sin(free.yaw), c = Math.cos(free.yaw);
    free.x = clamp(free.x - right * c + forward * s, 0, width);
    free.z = clamp(free.z + right * s + forward * c, 0, depth);
  }

  function zoom(amount) {
    if (mode === 'follow') distance = clamp(distance - amount, 3.8, 12);
    else move(0, amount);
  }

  function immersive(base, groups) {
    if (!free) {
      const g = groups.find(group => group.id === focusId && canFollow(group));
      const reach = -base.y / Math.tan(base.pitch);
      const x = g?.x ?? base.x + Math.sin(base.yaw) * reach;
      const z = g?.y ?? base.z + Math.cos(base.yaw) * reach;
      free = { x: clamp(x - Math.sin(base.yaw) * 7, 0, width), z: clamp(z - Math.cos(base.yaw) * 7, 0, depth),
        yaw: base.yaw, pitch: -0.05, fov: 61 };
    }
    return { ...free, y: heightAt(free.x, free.z) + EYE_HEIGHT };
  }

  function follow(group, groups, dt) {
    const forward = Math.PI / 2 - (group.facing ?? 0);
    heading = heading === undefined ? forward : angle(heading, forward, settle(2.8, dt));
    const bearing = heading + 0.58 + yawOffset;
    const x = clamp(group.x - Math.sin(bearing) * distance, -5, width + 5);
    const z = clamp(group.y - Math.cos(bearing) * distance, -5, depth + 5);
    const y = heightAt(x, z) + EYE_HEIGHT + 0.45;
    const rival = group.engaged && groups.find(g => g.id === group.target && canFollow(g) && !g.hidden);
    const tx = rival ? mix(group.x, rival.x, 0.32) : group.x;
    const tz = rival ? mix(group.y, rival.y, 0.32) : group.y;
    const dx = tx - x, dz = tz - z;
    const pitch = Math.atan2(heightAt(tx, tz) + 1.22 - y, Math.max(1, Math.hypot(dx, dz)));
    return { x, y, z, yaw: Math.atan2(dx, dz), pitch: clamp(pitch + tilt, -0.55, 0.5), fov: 58 };
  }

  function update(dt, base, groups) {
    current ??= base;
    const group = mode === 'follow' && groups.find(g => g.id === targetId && canFollow(g));
    if (mode === 'follow' && !group) select('strategic');
    if (mode === 'strategic' && elapsed >= TRANSITION) { current = base; return null; }
    const desired = mode === 'follow' ? follow(group, groups, dt) : mode === 'immersive' ? immersive(base, groups) : base;
    if (reducedMotion && from) { current = desired; from = undefined; }
    else if (elapsed < TRANSITION) {
      from ??= current;
      elapsed = Math.min(TRANSITION, elapsed + dt);
      const t = elapsed / TRANSITION;
      current = blend(from, desired, t * t * (3 - 2 * t));
    } else current = blend(current, desired, settle(7.5, dt));
    current.y = Math.max(current.y, heightAt(current.x, current.z) + 1.1);
    return current;
  }

  return { select, look, move, zoom, update, get mode() { return mode; }, get targetId() { return targetId; },
    get busy() { return mode !== 'strategic' || elapsed < TRANSITION; } };
}
