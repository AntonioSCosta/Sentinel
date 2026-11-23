import { Vector3 } from 'three';
import { canFollow, createCameraRig } from './camera-rig.js';
import { FIELD } from './field.js';
import { heightAt } from './view.js';

const steering = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export function mountCameraExperiment({ canvas, i18n, nameOf, selected, endTerrainDrag }) {
  const rig = createCameraRig({ heightAt, width: FIELD.w, depth: FIELD.h,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches });
  const t = (key, params) => i18n.t(`tactical.camera.${key}`, params);
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = new URL('./camera-experiment.css', import.meta.url).href;
  document.head.append(style);

  const panel = document.createElement('section');
  panel.id = 'camera-experiment';
  panel.className = 'panel';
  const button = (id, shortcut) => {
    const el = document.createElement('button');
    el.type = 'button'; el.id = `camera-${id}`;
    el.setAttribute('aria-keyshortcuts', shortcut);
    return el;
  };
  const strategy = button('strategic', 'C Escape');
  const ground = button('immersive', 'C');
  const follow = button('follow', 'G');
  const groups = document.createElement('select');
  groups.id = 'camera-group';
  const status = document.createElement('output');
  status.id = 'camera-status';
  status.setAttribute('aria-live', 'polite');
  panel.append(strategy, ground, groups, follow, status);
  document.body.append(panel);

  const keys = new Set(), forward = new Vector3();
  let activeGroups = [], groupListKey, drag, pose, defaultFov;
  const candidate = () => activeGroups.find(g => g.id === (groups.value || selected()) && canFollow(g));
  const mode = () => rig.mode;
  const toggle = () => setMode(mode() === 'strategic' ? 'immersive' : 'strategic', selected());

  function updateControls() {
    const available = activeGroups.filter(canFollow);
    const groupKey = `${i18n.locale}:${available.map(g => g.id).join(',')}`;
    if (groupKey !== groupListKey) {
      groupListKey = groupKey;
      const old = groups.value;
      groups.replaceChildren(new Option(t('selected'), ''), ...available.map(g => new Option(nameOf(g.id), g.id)));
      if (available.some(g => g.id === old)) groups.value = old;
    }
    strategy.setAttribute('aria-pressed', String(mode() === 'strategic'));
    ground.setAttribute('aria-pressed', String(mode() === 'immersive'));
    follow.setAttribute('aria-pressed', String(mode() === 'follow'));
    follow.disabled = !candidate();
    const message = mode() === 'follow' ? t('following', { group: nameOf(rig.targetId) }) : t(mode() === 'immersive' ? 'groundHelp' : 'strategyHelp');
    if (status.textContent !== message) status.textContent = message;
    canvas.dataset.closeCamera = String(rig.busy);
  }
  function setMode(next, id) {
    rig.select(next, id);
    endTerrainDrag();
    drag = null;
    keys.clear();
    updateControls();
  }
  function followGroup() {
    const group = candidate();
    if (group) setMode('follow', group.id);
  }
  function localize() {
    panel.setAttribute('aria-label', t('title'));
    groups.setAttribute('aria-label', t('group'));
    strategy.textContent = t('strategic');
    ground.textContent = t('immersive');
    follow.textContent = t('follow');
    updateControls();
  }
  strategy.addEventListener('click', () => setMode('strategic'));
  ground.addEventListener('click', () => setMode('immersive', selected()));
  follow.addEventListener('click', followGroup);
  groups.addEventListener('change', updateControls);
  i18n.subscribe(localize);
  localize();

  function stop(event) { event.preventDefault(); event.stopImmediatePropagation(); }
  window.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Escape' && rig.busy) { stop(event); setMode('strategic'); return; }
    if (event.target.matches?.('input, select, textarea, [contenteditable]')) return;
    if (event.code === 'KeyC' || event.code === 'KeyG') {
      stop(event);
      if (!event.repeat) { if (event.code === 'KeyC') toggle(); else followGroup(); }
    } else if (rig.busy && steering.has(event.code)) { stop(event); keys.add(event.code); }
  }, true);
  window.addEventListener('keyup', event => keys.delete(event.code));
  window.addEventListener('blur', () => { drag = null; keys.clear(); });

  canvas.addEventListener('pointerdown', event => {
    if (!rig.busy) return;
    stop(event);
    if (mode() === 'strategic' || drag || event.button > 2) return;
    drag = { id: event.pointerId, button: event.button, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  }, true);
  canvas.addEventListener('pointermove', event => {
    if (!rig.busy) return;
    stop(event);
    if (drag?.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    drag.x = event.clientX; drag.y = event.clientY;
    if (drag.button === 0) rig.look(-dx * 0.005, -dy * 0.004);
    else if (mode() === 'immersive') rig.move(-dx * 0.032, dy * 0.032);
    else rig.look(-dx * 0.005, -dy * 0.004);
  }, true);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, event => {
    if (drag?.id === event.pointerId) drag = null;
    if (rig.busy) stop(event);
  }, true);
  canvas.addEventListener('wheel', event => {
    if (!rig.busy) return;
    stop(event);
    rig.zoom(-Math.sign(event.deltaY) * 2.4);
  }, { capture: true, passive: false });

  const axis = (positive, negative) => Number(keys.has(positive)) - Number(keys.has(negative));
  const orientation = (camera, frame) => {
    const c = Math.cos(frame.pitch);
    camera.position.set(frame.x, frame.y, frame.z);
    camera.lookAt(frame.x + c * Math.sin(frame.yaw), frame.y + Math.sin(frame.pitch), frame.z + c * Math.cos(frame.yaw));
  };
  let controlsKey;
  function effect(dt, visibleGroups) {
    activeGroups = visibleGroups;
    return camera => {
      defaultFov ??= camera.fov;
      camera.getWorldDirection(forward);
      const base = { x: camera.position.x, y: camera.position.y, z: camera.position.z, fov: defaultFov,
        yaw: Math.atan2(forward.x, forward.z), pitch: Math.asin(Math.max(-1, Math.min(1, forward.y))) };
      if (rig.busy) {
        const rotate = axis('KeyQ', 'KeyE') + axis('ArrowLeft', 'ArrowRight');
        rig.look(rotate * dt * 1.05, axis('ArrowUp', 'ArrowDown') * dt * 0.7);
        rig.move(axis('KeyD', 'KeyA') * dt * 8, axis('KeyW', 'KeyS') * dt * 8);
      }
      const override = rig.update(dt, base, visibleGroups);
      if (override) orientation(camera, override);
      pose = override ?? base;
      if (camera.fov !== pose.fov) { camera.fov = pose.fov; camera.updateProjectionMatrix(); }

      const key = `${mode()}:${rig.targetId}:${rig.busy}:${selected()}:${activeGroups.filter(canFollow).map(g => g.id).join(',')}`;
      if (key !== controlsKey) { controlsKey = key; updateControls(); }
    };
  }
  return { effect, get busy() { return rig.busy; }, snapshot: () => ({ mode: mode(), targetId: rig.targetId, busy: rig.busy,
    pose: pose && { ...pose }, clearance: pose && pose.y - heightAt(pose.x, pose.z) }) };
}
