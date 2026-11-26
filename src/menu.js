// Menu inicial: uma lista vertical em que cada entrada abre a sua janela.
// Os botões dentro das janelas continuam ligados em game.js; aqui só se abre e fecha a janela certa e se desenha a Crónica.
import { chronicleEntries } from './campaign/chronicle-view.js';

/**
 * Liga as entradas do menu e devolve `{ open(id), close(), renderChronicle(state) }`.
 * `state` é o estado da campanha gravada (ou null): decide que entradas da Crónica já estão abertas.
 * @param {{ document: Document, i18n: { t: (key: string) => string } }} deps
 */
export function createMenu({ document: doc, i18n }) {
  const root = doc.getElementById('menu');
  const entries = [...root.querySelectorAll('.menu-nav [data-sec]')];
  const win = entry => doc.getElementById(entry.getAttribute('aria-controls'));
  const confirmation = doc.getElementById('camp-confirm');
  const compact = doc.defaultView.matchMedia?.('(max-width:860px), (max-height:560px)');
  let current = null;
  const currentPanel = () => current && doc.getElementById(`sec-${current}`);

  function updatePanelMode(focus = false) {
    const panel = currentPanel();
    if (!panel) return;
    if (compact?.matches) {
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      focus ||= !panel.contains(doc.activeElement);
    } else {
      panel.setAttribute('role', 'region');
      panel.removeAttribute('aria-modal');
    }
    if (focus) panel.querySelector('h2').focus();
  }
  compact?.addEventListener('change', () => updatePanelMode(doc.activeElement === doc.body || doc.activeElement?.hasAttribute('data-close')));

  /** Abre a janela `id` (ou fecha todas, com null). Com `focus`, o foco passa para dentro da janela. */
  function open(id, focus = false) {
    if (id !== 'campaign') confirmation.classList.add('hidden');
    current = id;
    for (const entry of entries) {
      const on = entry.dataset.sec === id;
      entry.setAttribute('aria-expanded', on ? 'true' : 'false');
      win(entry).hidden = !on;
    }
    root.classList.toggle('has-window', !!id);
    updatePanelMode(focus);
  }
  function close() {
    const entry = entries.find(e => e.dataset.sec === current);
    open(null);
    entry?.focus();
  }

  for (const entry of entries) {
    entry.addEventListener('click', e => (current === entry.dataset.sec ? close() : open(entry.dataset.sec, e.detail === 0)));
    entry.addEventListener('keydown', e => {   // setas, Home e End percorrem a lista
      const i = entries.indexOf(entry);
      const j = e.key === 'ArrowDown' ? (i + 1) % entries.length : e.key === 'ArrowUp' ? (i - 1 + entries.length) % entries.length
        : e.key === 'Home' ? 0 : e.key === 'End' ? entries.length - 1 : -1;
      if (j < 0) return;
      e.preventDefault();
      entries[j].focus();
    });
  }
  for (const button of root.querySelectorAll('[data-close]')) button.addEventListener('click', close);
  // Escape fecha a janela aberta; a confirmação de «Começar de novo» trata o seu próprio Escape primeiro (preventDefault).
  root.addEventListener('keydown', e => {
    const panel = currentPanel();
    if (!panel || e.defaultPrevented) return;
    if (e.key === 'Escape' || e.code === 'Escape') {
      e.preventDefault();
      close();
    } else if (compact?.matches && e.key === 'Tab') {
      const stops = [...panel.querySelectorAll('button:enabled, input:enabled, select:enabled, summary')]
        .filter(control => control.getClientRects().length);
      const index = stops.indexOf(doc.activeElement);
      if (!stops.length || (index !== -1 && index !== (e.shiftKey ? 0 : stops.length - 1))) return;
      e.preventDefault();
      (e.shiftKey ? stops.at(-1) : stops[0]).focus();
    }
  });

  let chronicleState = null;
  function renderChronicle(state = chronicleState) {
    chronicleState = state;
    const list = doc.getElementById('menu-chron');
    if (!list) return;
    list.textContent = '';
    for (const entry of chronicleEntries(state, i18n)) {
      const li = doc.createElement('li');
      if (!entry) {
        li.className = 'locked';
        li.textContent = i18n.t('interface.chronicleLocked');
      } else {
        li.dataset.entry = entry.id;
        const details = doc.createElement('details');
        const summary = doc.createElement('summary');
        summary.textContent = entry.title;
        const chip = doc.createElement('span');
        chip.className = 'chip';
        chip.textContent = entry.sourceLabel;
        summary.append(chip);
        const text = doc.createElement('p');
        text.textContent = entry.text;
        details.append(summary, text);
        if (entry.citation) {
          const cit = doc.createElement('p');
          cit.className = 'cit';
          cit.textContent = entry.citation;
          details.append(cit);
        }
        li.append(details);
      }
      list.append(li);
    }
  }

  return { open, close, renderChronicle, get current() { return current; } };
}
