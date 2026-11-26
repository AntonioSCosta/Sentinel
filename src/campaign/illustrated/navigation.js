import { makeView, toWorld } from '../map-view.js';
import { BORDER } from './landscape.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function illustratedNavigation(canvas, { onChange, onHover, onPick, reducedMotion }) {
  let view, base, center, anchor, cursor, drag;
  let zoom = 1, wanted = 1, frame = 0;

  function project() {
    const { width, height, world } = base;
    const scale = zoom * base.scale;
    const halfX = width / (2 * scale), halfY = height / (2 * scale);
    center.x = clamp(center.x, -BORDER + halfX, world.w + BORDER - halfX);
    center.y = clamp(center.y, -BORDER + halfY, world.h + BORDER - halfY);
    view = { ...base, scale, ox: width / 2 - center.x * scale, oy: height / 2 - center.y * scale, illustrated: true };
    return view;
  }

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    wanted = zoom;
    drag = cursor = anchor = null;
  }

  function reset(world) {
    stop();
    zoom = wanted = 1;
    center = { x: world.w / 2, y: world.h / 2 };
  }

  function resize(world, width, height) {
    if (base?.world === world && base.width === width && base.height === height) return view;
    if (base?.world !== world) reset(world);
    else stop();
    base = makeView(world, width, height);
    base.scale = Math.max(base.scale, width / (world.w + 2 * BORDER), height / (world.h + 2 * BORDER));
    return project();
  }

  function zoomFrame() {
    frame = 0;
    zoom = reducedMotion() || Math.abs(wanted - zoom) < .004 ? wanted : zoom + (wanted - zoom) * .31;
    const scale = base.scale * zoom;
    center = {
      x: anchor.x - (cursor.x - base.width / 2) / scale,
      y: anchor.y - (cursor.y - base.height / 2) / scale,
    };
    onChange(project());
    onHover(cursor);
    if (zoom !== wanted) frame = requestAnimationFrame(zoomFrame);
  }

  function point(event) {
    const r = canvas.getBoundingClientRect();
    return { x: event.clientX - r.left, y: event.clientY - r.top };
  }

  canvas.style.touchAction = 'none';
  canvas.addEventListener('wheel', e => {
    if (!view || drag) return;
    e.preventDefault();
    cursor = point(e);
    anchor = toWorld(view, cursor);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? base.height : 1;
    wanted = clamp(wanted * Math.exp(-e.deltaY * unit * .0018), 1, 4);
    if (!frame) frame = requestAnimationFrame(zoomFrame);
  }, { passive: false });

  canvas.addEventListener('pointerdown', e => {
    if (!view || e.button !== 0 || drag) return;
    stop();
    drag = { id: e.pointerId, start: point(e), center: { ...center }, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!view) return;
    const p = point(e);
    if (!drag) { onHover(p); return; }
    if (drag.id !== e.pointerId) return;
    const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    canvas.style.cursor = 'grabbing';
    center = { x: drag.center.x - dx / view.scale, y: drag.center.y - dy / view.scale };
    onChange(project());
    onHover(null);
  });
  canvas.addEventListener('pointerup', e => {
    if (drag?.id !== e.pointerId) return;
    const pick = !drag.moved;
    drag = null;
    canvas.style.cursor = 'grab';
    if (pick) onPick(e); else onHover(point(e));
  });
  canvas.addEventListener('lostpointercapture', () => { drag = null; canvas.style.cursor = 'grab'; });
  canvas.addEventListener('pointerleave', () => onHover(null));
  canvas.addEventListener('keydown', e => {
    if (e.key !== 'Home' || !base) return;
    e.preventDefault();
    reset(base.world);
    onChange(project());
    onHover(null);
  });
  return { resize, stop };
}
