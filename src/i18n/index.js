import interfacePT from './catalogs/pt-PT/interface.js';
import mapPT from './catalogs/pt-PT/map.js';
import interfaceEN from './catalogs/en/interface.js';
import mapEN from './catalogs/en/map.js';

export const LANGUAGE_KEY = 'viriato.language';
export const REFERENCE_LOCALE = 'pt-PT';
export const catalogs = {
  'pt-PT': { interface: interfacePT, map: mapPT },
  en: { interface: interfaceEN, map: mapEN },
};

const placeholder = /\{([A-Za-z][\w]*)\}/g;
const has = (object, key) => Object.hasOwn(object, key);

function entry(catalog, key) {
  const dot = key.indexOf('.');
  const domain = catalog?.[key.slice(0, dot)];
  const id = key.slice(dot + 1);
  return dot > 0 && domain && has(domain, id) ? domain[id] : undefined;
}

/** Create a presentation-only translator with independent language preferences. */
export function createI18n({ languages = ['pt-PT'], storage, messages = catalogs, onMissing } = {}) {
  const supports = locale => typeof locale === 'string' && has(messages, locale);
  let preferred;
  try { preferred = storage?.getItem(LANGUAGE_KEY); } catch { /* Storage can be disabled. */ }
  let locale = supports(preferred) ? preferred : /^pt(?:-|$)/i.test(languages[0] ?? '') ? 'pt-PT' : 'en';
  const listeners = new Set(), missing = new Set(), formats = new Map();
  function formatters(language = locale) {
    if (!formats.has(language)) formats.set(language, {
      number: new Intl.NumberFormat(language),
      decimal: new Intl.NumberFormat(language, { maximumFractionDigits: 1, minimumFractionDigits: 1 }),
      plural: new Intl.PluralRules(language),
    });
    return formats.get(language);
  }
  function number(value, decimals = false) {
    const formatter = decimals ? formatters().decimal : formatters().number;
    return formatter.format(value);
  }
  function t(key, params = {}) {
    const active = entry(messages[locale], key);
    if (active === undefined) {
      const id = `${locale}:${key}`;
      if (!missing.has(id)) { missing.add(id); onMissing?.({ locale, key }); }
    }
    const message = active ?? entry(messages[REFERENCE_LOCALE], key);
    const category = typeof message === 'object' ? formatters(active === undefined ? REFERENCE_LOCALE : locale).plural.select(params.count) : null;
    const template = category ? message[category] ?? message.other : message;
    return typeof template === 'string' ? template.replace(placeholder, (literal, name) => {
      if (!has(params, name)) return literal;
      const value = params[name];
      return typeof value === 'number' ? number(value) : String(value);
    }) : key;
  }
  function setLocale(next) {
    if (!supports(next)) return false;
    try { storage?.setItem(LANGUAGE_KEY, next); } catch { /* Apply this session anyway. */ }
    if (next !== locale) {
      locale = next;
      for (const listener of listeners) listener();
    }
    return true;
  }
  return { t, number, setLocale, get locale() { return locale; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
}
