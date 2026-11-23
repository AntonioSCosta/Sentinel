const outside = ' (fora do vale)';
const descriptors = { aldeia: 'Aldeia', castro: 'Castro', posto: 'Posto', serra: 'Serra' };

/** Translate geographical descriptors while keeping the proper name and stored world intact. */
export function mapPlaceName(i18n, canonical, kind) {
  if (i18n.locale === 'pt-PT' || !canonical) return canonical;
  const isOutside = canonical.endsWith(outside);
  const name = isOutside ? canonical.slice(0, -outside.length) : canonical;
  const prefix = descriptors[kind];
  const match = prefix && name.match(new RegExp(`^${prefix} (?:da|das|do|dos|de) (.+)$`));
  const localized = match ? i18n.t(`map.place.${kind}`, { name: match[1] }) : name;
  return isOutside ? i18n.t('map.outsideValley', { name: localized }) : localized;
}

const knownKinds = new Set(['pretor', 'patrulha', 'comboio', 'cacadores']);

/** Format a known force record without changing its identity. */
export function mapForceName(i18n, force) {
  return force.name || i18n.t(`map.force.${knownKinds.has(force.kind) ? force.kind : 'unknown'}`);
}

/** Format a date from the fixed campaign calendar. */
export function mapDate(i18n, { month, dayOfMonth, year }) {
  return i18n.t('map.eraDate', { day: dayOfMonth, month: i18n.t(`map.month.${month}`), year });
}
