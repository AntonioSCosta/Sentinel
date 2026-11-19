const variables = text => [...new Set([...text.matchAll(/\{([A-Za-z][\w]*)\}/g)].map(match => match[1]))].sort().join(',');

/** Report missing or invalid messages and incompatible placeholders against the reference. */
export function validateCatalogs(catalogs, reference = 'pt-PT') {
  const flatten = catalog => new Map(Object.entries(catalog).flatMap(([domain, messages]) =>
    Object.entries(messages).map(([key, value]) => [`${domain}.${key}`, value])));
  const baseline = flatten(catalogs[reference]);
  const errors = [];
  for (const [locale, catalog] of Object.entries(catalogs)) {
    const messages = flatten(catalog);
    for (const [key, original] of baseline) {
      const translated = messages.get(key);
      const where = `${locale}:${key}`;
      if (translated === undefined) { errors.push(`${where}: missing key`); continue; }
      if (typeof original === 'string') {
        if (typeof translated !== 'string' || !translated.trim()) errors.push(`${where}: expected text`);
        else if (variables(original) !== variables(translated)) errors.push(`${where}: different parameters`);
        continue;
      }
      const forms = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
      for (const form of forms) {
        const translation = translated?.[form];
        const source = original?.[form] ?? original?.other;
        if (typeof translation !== 'string' || !translation.trim()) errors.push(`${where}: missing plural ${form}`);
        else if (typeof source !== 'string' || variables(source) !== variables(translation) || !variables(translation).split(',').includes('count')) {
          errors.push(`${where}:${form}: different parameters`);
        }
      }
      for (const form of Object.keys(translated ?? {})) {
        if (!forms.includes(form)) errors.push(`${where}: unexpected plural ${form}`);
      }
    }
    for (const key of messages.keys()) if (!baseline.has(key)) errors.push(`${locale}:${key}: unexpected key`);
  }
  return errors;
}
