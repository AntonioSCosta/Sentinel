import { CHRONICLE, entryFor, isUnlocked } from './chronicle.js';

export function localizedChronicleEntry(id, i18n) {
  const { source, citation } = entryFor(id);
  const key = `interface.chronicle.${id}`;
  return {
    id,
    title: i18n.t(`${key}.title`),
    text: i18n.t(`${key}.text`),
    citation: citation && i18n.t(`${key}.citation`),
    sourceLabel: i18n.t(`interface.chronicleSource.${source}`),
  };
}

/** View data shared by the main menu and the campaign. A locked row carries no entry metadata. */
export function chronicleEntries(state, i18n) {
  return Object.entries(CHRONICLE)
    .filter(([, entry]) => entry.source !== 'invenção')
    .map(([id]) => isUnlocked(id, state) ? localizedChronicleEntry(id, i18n) : null);
}
