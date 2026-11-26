import { chronicleEntries } from './campaign/chronicle-view.js';

/** Selects a section of the persistent menu surface and renders the saved Chronicle. */
export function createMenu({ document: doc, i18n }) {
  const tablist = doc.querySelector('#menu .menu-nav');
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  const panelFor = tab => doc.getElementById(tab.getAttribute('aria-controls'));
  const confirmation = doc.getElementById('camp-confirm');
  const narrow = doc.defaultView.matchMedia?.('(max-width:700px)');
  const setOrientation = () => tablist.setAttribute('aria-orientation', narrow?.matches ? 'horizontal' : 'vertical');
  narrow?.addEventListener('change', setOrientation);
  setOrientation();

  function open(id = 'campaign') {
    if (id !== 'campaign') confirmation.classList.add('hidden');
    for (const tab of tabs) {
      const selected = tab.dataset.sec === id;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panelFor(tab).hidden = !selected;
    }
  }

  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => open(tab.dataset.sec));
    tab.addEventListener('keydown', event => {
      const prev = narrow?.matches ? 'ArrowLeft' : 'ArrowUp';
      const next = narrow?.matches ? 'ArrowRight' : 'ArrowDown';
      const target = event.key === prev ? tabs[(index + tabs.length - 1) % tabs.length]
        : event.key === next ? tabs[(index + 1) % tabs.length]
          : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : null;
      if (!target) return;
      event.preventDefault();
      open(target.dataset.sec);
      target.focus();
    });
  }

  const languages = [...doc.querySelectorAll('#menu-language [data-menu-language]')];
  for (const button of languages) button.addEventListener('click', () => i18n.setLocale(button.dataset.menuLanguage));
  function renderLanguage() {
    for (const button of languages) button.setAttribute('aria-pressed', String(button.dataset.menuLanguage === i18n.locale));
  }
  i18n.subscribe(renderLanguage);
  renderLanguage();

  let chronicleState = null;
  function renderChronicle(state = chronicleState) {
    chronicleState = state;
    const list = doc.getElementById('menu-chron');
    list.textContent = '';
    for (const entry of chronicleEntries(state, i18n)) {
      if (!entry) continue;
      const row = doc.createElement('li');
      row.dataset.entry = entry.id;
      const details = doc.createElement('details');
      details.setAttribute('name', 'menu-chronicle');
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
        const citation = doc.createElement('p');
        citation.className = 'cit';
        citation.textContent = entry.citation;
        details.append(citation);
      }
      row.append(details);
      list.append(row);
    }
  }

  return { open, renderChronicle };
}
