import { createCampaignMapScene } from './scene.js';
import { strategicView } from './strategic.js';

/** Bind a presentation-only map to the campaign UI callbacks. */
export function createCampaignMapView(stage, { window, onPick, onHover, onError }) {
  const canvas = stage.querySelector('canvas');
  const labels = stage.querySelector('.map-labels');
  const error = stage.querySelector('.map-error');
  const preview = stage.querySelector('.map-preview');
  const controls = stage.querySelector('.map-controls');
  let scene, world, seed, drag, frame, pendingFrame = 0, pendingHover = 0, live = false;

  function fail(message) {
    stage.dataset.status = 'error';
    error.hidden = false;
    error.textContent = message;
    canvas.hidden = labels.hidden = controls.hidden = preview.hidden = true;
    suspend();
    onError();
  }

  canvas.addEventListener('webglcontextlost', () =>
    fail('Perdeu-se a ligação ao WebGL. Recarrega a página para continuar a campanha.'));

  function coordinates(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  canvas.addEventListener('pointerdown', event => {
    if (!live || drag || event.button !== 0) return;
    drag = { id: event.pointerId, ...coordinates(event), moved: false };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (!live) return;
    const at = coordinates(event);
    if (drag?.id === event.pointerId) {
      const dx = at.x - drag.x, dy = at.y - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag = { ...drag, ...at, moved: true };
      scene.pan(dx, dy);
    } else if (!pendingHover) {
      pendingHover = window.requestAnimationFrame(() => {
        pendingHover = 0;
        if (live) onHover(scene.hit(at.x, at.y));
      });
    }
  });
  canvas.addEventListener('pointerup', event => {
    if (!live || drag?.id !== event.pointerId || drag.moved) return;
    const at = coordinates(event);
    scene.pick(at.x, at.y, event);
  });
  canvas.addEventListener('lostpointercapture', event => {
    if (drag?.id === event.pointerId) drag = undefined;
  });
  canvas.addEventListener('pointerleave', () => {
    if (pendingHover) window.cancelAnimationFrame(pendingHover);
    pendingHover = 0;
    if (live) onHover(null);
  });
  canvas.addEventListener('wheel', event => {
    if (!live) return;
    event.preventDefault();
    scene.zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });

  const actions = {
    in: () => scene.zoomBy(1.3), out: () => scene.zoomBy(1 / 1.3), reset: () => scene.reset(),
    left: () => scene.rotate(-Math.PI / 12), right: () => scene.rotate(Math.PI / 12),
  };
  controls.addEventListener('click', event => {
    const action = actions[event.target.closest('button')?.dataset.camera];
    if (live && action) action();
  });

  function suspend() {
    live = false;
    drag = undefined;
    if (pendingFrame) window.cancelAnimationFrame(pendingFrame);
    if (pendingHover) window.cancelAnimationFrame(pendingHover);
    pendingFrame = pendingHover = 0;
    frame = null;
  }

  function paint(state, fx) {
    if (stage.dataset.status === 'error') return;
    live = true;
    if (!scene) {
      try {
        scene = createCampaignMapScene(canvas, labels, (selection, _label, event) => { if (live) onPick(selection, event); });
      } catch {
        fail('O mapa da campanha precisa de WebGL. Ativa a aceleração gráfica ou abre o jogo num navegador compatível.');
        return;
      }
    }
    frame = { state, fx };
    if (pendingFrame) return;
    pendingFrame = window.requestAnimationFrame(() => {
      pendingFrame = 0;
      if (!live) return;
      const { state, fx } = frame;
      frame = null;
      try {
        const view = strategicView(state);
        scene.resize();
        if (world !== state.world || seed !== state.seed) {
          scene.load(state.seed, state.world, view);
          world = state.world;
          seed = state.seed;
        }
        preview.textContent = fx.route?.label ?? fx.hover?.label ?? '';
        scene.present(view, fx);
        stage.dataset.status = 'ready';
      } catch (cause) {
        window.console.error('Erro ao desenhar o mapa da campanha', cause);
        fail('Não foi possível desenhar o mapa estratégico 3D. Recarrega a página para tentar novamente.');
      }
    });
  }

  return { paint, suspend, get failed() { return stage.dataset.status === 'error'; } };
}
