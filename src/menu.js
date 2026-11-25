// Menu inicial: uma lista vertical (campanha, missões, controlos, crónica, idioma) em que cada entrada abre a sua janela.
// Os botões dentro das janelas continuam ligados em game.js; aqui só se abre e fecha a janela certa e se desenha a Crónica.
import { CHRONICLE, isUnlocked } from './campaign/chronicle.js';

/**
 * Liga as entradas do menu e devolve `{ open(id), close(), renderChronicle(state) }`.
 * `state` é o estado da campanha gravada (ou null): decide que entradas da Crónica já estão abertas.
 * @param {{ document: Document, i18n: { t: (key: string) => string } }} deps
 */
export function createMenu({ document: doc, i18n }) {
  const root = doc.getElementById('menu');
  const entries = [...root.querySelectorAll('.menu-nav [data-sec]')];
  const win = entry => doc.getElementById(entry.getAttribute('aria-controls'));
  let current = null;

  /** Abre a janela `id` (ou fecha todas, com null). Com `focus`, o foco passa para dentro da janela. */
  function open(id, focus = false) {
    current = id;
    for (const entry of entries) {
      const on = entry.dataset.sec === id;
      entry.setAttribute('aria-expanded', on ? 'true' : 'false');
      win(entry).hidden = !on;
      if (on && focus) win(entry).querySelector('h2')?.focus();
    }
    root.classList.toggle('has-window', !!id);
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
    if ((e.key === 'Escape' || e.code === 'Escape') && current && !e.defaultPrevented) { e.preventDefault(); close(); }
  });

  let chronicleState = null;
  function renderChronicle(state = chronicleState) {
    chronicleState = state;
    const list = doc.getElementById('menu-chron');
    if (!list) return;
    list.textContent = '';
    for (const [id, entry] of Object.entries(CHRONICLE)) {
      const li = doc.createElement('li');
      li.dataset.entry = id;
      if (!isUnlocked(id, state)) {
        li.className = 'locked';
        li.textContent = entry.title;
        const note = doc.createElement('small');
        note.textContent = i18n.t('interface.chronicleLocked');
        li.append(note);
      } else {
        const details = doc.createElement('details');
        const summary = doc.createElement('summary');
        summary.textContent = entry.title;
        const chip = doc.createElement('span');
        chip.className = 'chip';
        chip.textContent = i18n.t(`interface.chronicleSource.${entry.source}`);
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
