import { bindDocumentLanguage } from '../i18n/dom.js';
import { generateWorld } from '../campaign/worldgen.js';
import { readPrototypeSave } from './terrain.js';
import { createCampaignMapScene } from './scene.js';
import { strategicView } from './strategic.js';
import { newCommunities } from '../campaign/communities.js';

const i18n = bindDocumentLanguage(window);
const canvas = document.querySelector('#map-scene');
const status = document.querySelector('#status');
const seedField = document.querySelector('#seed');
const fileInput = document.querySelector('#save-file');

async function start() {
  const output = document.querySelector('#selection');
  let current, selected, statusKey = 'map.preparing', statusParams;
  function setStatus(key, params) {
    statusKey = key;
    statusParams = params;
    status.textContent = i18n.t(key, params);
  }
  function renderSelection(label) {
    if (selected?.type === 'terrain') {
      output.textContent = i18n.t('map.terrain', {
        x: i18n.number(selected.x, true), y: i18n.number(selected.y, true),
      });
    } else if (selected?.type === 'settlement' && current?.comparison) {
      const community = Object.values(current.comparison.communities).find(c => c.settlement === selected.id);
      const situation = { tributada: 'scenarioTribute', castigada: 'scenarioPunished', queimada: 'inactive.queimada' }[community?.situation];
      output.textContent = [label, community && i18n.t('map.issuesCopy.posture.' + community.posture),
        situation && i18n.t('map.' + situation)].filter(Boolean).join(' · ');
    } else output.textContent = label ? `${label} · ${selected.id}` : '';
  }
  const map = createCampaignMapScene(canvas, document.querySelector('#map-labels'), (detail, label) => {
    selected = detail;
    renderSelection(label);
    canvas.dispatchEvent(new CustomEvent('strategic-select', { detail, bubbles: true }));
  }, i18n);
  new ResizeObserver(() => map.resize()).observe(canvas);
  map.resize();

  function renderCounts() {
    if (!current) return;
    for (const kind of ['aldeia', 'castro', 'serra', 'posto']) {
      document.getElementById(`${kind}-count`).textContent = i18n.number(current.world.settlements.filter(place => place.kind === kind).length);
    }
    document.querySelector('#known-count').textContent = i18n.number(current.known);
  }

  i18n.subscribe(() => {
    setStatus(statusKey, statusParams);
    renderCounts();
    renderSelection(map.labelFor(selected));
    map.redraw();
  });

  function show(snapshot, name, issues) {
    const { seed, world } = snapshot;
    const view = strategicView(snapshot);
    if (!issues || current?.world !== world) map.load(seed, world, view);
    if (issues) map.present(view, { party: snapshot.party, issues, campaignLabels: true, showMapDetails: true });
    current = { world, known: view.forces.length, comparison: issues && snapshot };
    selected = null;
    renderSelection('');
    seedField.value = String(seed);
    renderCounts();
    if (issues) setStatus('map.scenarioDay', { day: snapshot.day, seed });
    else setStatus(name ? 'map.imported' : 'map.generated', { name, seed: String(seed) });
  }

  function showGenerated(seed) {
    const world = generateWorld(seed);
    show({ seed, world, communities: newCommunities(world) });
  }

  document.querySelector('#seed-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const seed = Number(seedField.value);
      if (!Number.isSafeInteger(seed)) { setStatus('map.invalidSeed'); return; }
      showGenerated(seed);
    } catch {
      setStatus('map.generateFailed');
    }
  });

  fileInput.addEventListener('change', async () => {
    const [file] = fileInput.files;
    if (!file) return;
    try {
      show(readPrototypeSave(await file.text()), file.name);
    } catch {
      setStatus('map.invalidSave');
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
    setStatus('map.viewerLost');
  });
  const requestedSeed = Number(new URLSearchParams(location.search).get('seed') ?? 1);
  const seed = Number.isSafeInteger(requestedSeed) ? requestedSeed : 1;
  const url = new URL(location.href);
  if (url.searchParams.has('scenario')) {
    const [{ comparisonState, scenarioIds }, { buildIssues }] = await Promise.all([
      import('../../tests/fixtures/valley-comparison.js'), import('../campaign/issues.js'),
    ]);
    const select = document.querySelector('#comparison-scenario');
    document.querySelector('#comparison-controls').hidden = false;
    document.querySelector('#seed-form').hidden = true;
    fileInput.closest('label').hidden = true;
    function switchScenario() {
      const state = comparisonState(select.value);
      const issues = Object.fromEntries(buildIssues(state).filter(i => i.place).map(i => [i.place, i.kind]));
      show(state, null, issues);
      url.searchParams.set('scenario', select.value);
      history.replaceState(null, '', url);
    }
    const requested = url.searchParams.get('scenario');
    select.value = scenarioIds.includes(requested) ? requested : 'start';
    select.addEventListener('change', switchScenario);
    switchScenario();
  } else showGenerated(seed);
  if (new URLSearchParams(location.search).has('benchmark')) {
    map.measure().then(result => {
      canvas.dataset.benchmark = JSON.stringify(result);
    });
  }
}

start().catch(error => {
  console.error(error);
  status.textContent = i18n.t('map.viewerFailed');
  i18n.subscribe(() => { status.textContent = i18n.t('map.viewerFailed'); });
});
