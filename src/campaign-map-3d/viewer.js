import { generateWorld } from '../campaign/worldgen.js';
import { readPrototypeSave } from './terrain.js';
import { createCampaignMapScene } from './scene.js';
import { strategicView } from './strategic.js';
import { newCommunities } from '../campaign/communities.js';

const canvas = document.querySelector('#map-scene');
const status = document.querySelector('#status');
const seedField = document.querySelector('#seed');
const fileInput = document.querySelector('#save-file');

function start() {
  const output = document.querySelector('#selection');
  const map = createCampaignMapScene(canvas, document.querySelector('#map-labels'), (detail, label) => {
    output.textContent = detail?.type === 'terrain' ? `Terreno · ${detail.x.toFixed(1)}, ${detail.y.toFixed(1)}`
      : label ? `${label} · ${detail.id}` : '';
    canvas.dispatchEvent(new CustomEvent('strategic-select', { detail, bubbles: true }));
  });
  new ResizeObserver(() => map.resize()).observe(canvas);
  map.resize();

  function show(snapshot, name) {
    const { seed, world } = snapshot;
    const view = strategicView(snapshot);
    map.load(seed, world, view);
    output.textContent = '';
    seedField.value = String(seed);
    for (const kind of ['aldeia', 'castro', 'serra', 'posto']) {
      document.getElementById(`${kind}-count`).textContent = world.settlements.filter(place => place.kind === kind).length;
    }
    document.querySelector('#known-count').textContent = view.forces.length;
    status.textContent = name ? `${name} · Seed ${seed}` : `Seed ${seed} · Mundo gerado`;
  }

  function showGenerated(seed) {
    const world = generateWorld(seed);
    show({ seed, world, communities: newCommunities(world) });
  }

  document.querySelector('#seed-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const seed = Number(seedField.value);
      if (!Number.isSafeInteger(seed)) throw new Error('Indica uma seed inteira válida.');
      showGenerated(seed);
    } catch (error) {
      status.textContent = error.message;
    }
  });

  fileInput.addEventListener('change', async () => {
    const [file] = fileInput.files;
    if (!file) return;
    try {
      show(readPrototypeSave(await file.text()), file.name);
    } catch (error) {
      status.textContent = `Erro ao abrir a gravação: ${error.message}`;
    } finally {
      fileInput.value = '';
    }
  });

  document.querySelector('#zoom-in').addEventListener('click', () => map.zoomBy(1.3));
  document.querySelector('#zoom-out').addEventListener('click', () => map.zoomBy(1 / 1.3));
  document.querySelector('#reset').addEventListener('click', map.reset);
  document.querySelector('#rotate-left').addEventListener('click', () => map.rotate(-Math.PI / 12));
  document.querySelector('#rotate-right').addEventListener('click', () => map.rotate(Math.PI / 12));
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    map.zoomBy(Math.exp(-Math.max(-160, Math.min(160, event.deltaY)) * 0.003));
  }, { passive: false });

  let drag;
  canvas.addEventListener('pointerdown', event => {
    if (drag || event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    map.pan(dx, dy);
    drag.x = event.clientX;
    drag.y = event.clientY;
  });
  canvas.addEventListener('pointerup', event => {
    if (drag?.id !== event.pointerId || drag.moved) return;
    const bounds = canvas.getBoundingClientRect();
    map.pick(event.clientX - bounds.left, event.clientY - bounds.top);
  });
  canvas.addEventListener('lostpointercapture', event => {
    if (drag?.id === event.pointerId) drag = undefined;
  });
  canvas.addEventListener('keydown', event => {
    const offsets = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
    if (offsets[event.key]) map.pan(...offsets[event.key]);
    else if (event.key === '+' || event.key === '=') map.zoomBy(1.3);
    else if (event.key === '-') map.zoomBy(1 / 1.3);
    else if (event.key.toLowerCase() === 'q') map.rotate(-Math.PI / 12);
    else if (event.key.toLowerCase() === 'e') map.rotate(Math.PI / 12);
    else if (event.key === 'Home') map.reset();
    else return;
    event.preventDefault();
  });

  canvas.addEventListener('webglcontextlost', () => {
    status.textContent = 'A ligação ao WebGL perdeu-se. Recarrega a página para voltar ao mapa.';
  });
  const requestedSeed = Number(new URLSearchParams(location.search).get('seed') ?? 1);
  const seed = Number.isSafeInteger(requestedSeed) ? requestedSeed : 1;
  showGenerated(seed);
  if (new URLSearchParams(location.search).has('benchmark')) {
    map.measure().then(result => {
      canvas.dataset.benchmark = JSON.stringify(result);
    });
  }
}

try {
  start();
} catch (error) {
  status.textContent = `Não foi possível iniciar o mapa 3D: ${error.message}`;
}
