import { mountCameraExperiment } from './camera-experiment.js';

export function mountHybridPreview({ view, initialTroops, ...options }) {
  const controls = mountCameraExperiment(options);
  const select = document.createElement('select');
  select.id = 'preview-troops';
  const stock = new Option('M1.2', 'm1');
  const hybrid = new Option('', 'c');
  select.append(stock, hybrid);
  const error = document.createElement('output');
  error.hidden = true;
  error.id = 'preview-troops-error';
  error.setAttribute('role', 'status');
  controls.panel.prepend(select, error);
  function localize() {
    const t = key => options.i18n.t(`tactical.preview.${key}`);
    select.setAttribute('aria-label', t('troops'));
    hybrid.textContent = t('hybrid');
    error.textContent = t('failed');
  }
  async function change() {
    const style = select.value;
    error.hidden = true;
    select.disabled = true;
    try {
      const factory = style === 'c' ? (await import('../visual/hybrid-troops.js')).createHybridTroops : null;
      view.setTroops(factory);
    } catch {
      view.setTroops(null);
      select.value = 'm1';
      error.hidden = false;
    } finally { select.disabled = false; }
  }
  options.i18n.subscribe(localize);
  localize();
  select.addEventListener('change', change);
  if (initialTroops === 'c') { select.value = 'c'; void change(); }
  return controls;
}
