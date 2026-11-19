import { createI18n } from './index.js';

/** Bind the document and language settings before the game or map starts. */
export function bindDocumentLanguage(win) {
  const doc = win.document;
  let storage;
  try { storage = win.localStorage; } catch { /* Private storage may be unavailable. */ }
  const i18n = createI18n({
    storage, languages: win.navigator.languages?.length ? win.navigator.languages : [win.navigator.language],
    onMissing: ({ locale, key }) => win.console.warn(`Missing translation [${locale}] ${key}`),
  });
  const texts = [...doc.querySelectorAll('[data-i18n]')];
  const accessible = [...doc.querySelectorAll('[data-i18n-aria]')];
  const inputs = [...doc.querySelectorAll('[data-language]')];
  function refresh() {
    doc.documentElement.lang = i18n.locale;
    for (const element of texts) element.textContent = i18n.t(element.dataset.i18n);
    for (const element of accessible) element.setAttribute('aria-label', i18n.t(element.dataset.i18nAria));
    for (const input of inputs) input.value = i18n.locale;
  }
  for (const input of inputs) input.addEventListener('change', () => i18n.setLocale(input.value));
  i18n.subscribe(refresh);
  refresh();
  return i18n;
}
