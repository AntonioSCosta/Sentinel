import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { campaignDateParts, dateLabel } from '../src/campaign/clock.js';
import { catalogs, createI18n, LANGUAGE_KEY } from '../src/i18n/index.js';
import { bindDocumentLanguage } from '../src/i18n/dom.js';
import { mapDate, mapPlaceName } from '../src/i18n/map-text.js';
import { validateCatalogs } from '../src/i18n/validate.js';

test('browser locale is selected first unless the independent preference exists', () => {
  const values = new Map([['viriato.campaign', '{"v":1}']]);
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.equal(createI18n({ storage, languages: ['pt-BR'] }).locale, 'pt-PT');
  assert.equal(createI18n({ storage, languages: ['de', 'pt-PT'] }).locale, 'en');
  const i18n = createI18n({ storage, languages: ['en-GB'] });
  let notifications = 0;
  i18n.subscribe(() => notifications++);
  assert.equal(i18n.setLocale('pt-PT'), true);
  assert.equal(i18n.setLocale('pt-PT'), true);
  assert.equal(i18n.setLocale('es'), false);
  assert.equal(notifications, 1);
  assert.equal(values.get(LANGUAGE_KEY), 'pt-PT');
  assert.equal(values.get('viriato.campaign'), '{"v":1}');
  assert.equal(createI18n({ storage, languages: ['en'] }).locale, 'pt-PT');
  const blocked = createI18n({ languages: ['en'], storage: {
    getItem() { throw new Error(); }, setItem() { throw new Error(); },
  } });
  assert.equal(blocked.setLocale('pt-PT'), true);
  assert.equal(blocked.locale, 'pt-PT');
});

test('localized interpolation, plurals, decimal numbers, and missing key fallback', () => {
  const missing = [];
  const messages = { ...catalogs, en: { ...catalogs.en, interface: {} } };
  const i18n = createI18n({ messages, languages: ['en-GB'], onMissing: ({ key }) => missing.push(key) });
  assert.equal(i18n.t('map.days', { count: 1 }), '1 day');
  assert.equal(i18n.t('map.days', { count: 0 }), '0 days');
  assert.equal(i18n.t('map.days', { count: 1250 }), '1,250 days');
  assert.equal(i18n.number(5.2, true), '5.2');
  assert.equal(i18n.t('interface.start'), 'COMEÇAR');
  assert.equal(i18n.t('interface.start'), 'COMEÇAR');
  assert.equal(i18n.t('map.missing'), 'map.missing');
  assert.deepEqual(missing, ['interface.start', 'map.missing']);
  i18n.setLocale('pt-PT');
  assert.equal(i18n.number(5.2, true), '5,2');
  assert.equal(i18n.t('map.days', { count: 2 }), '2 dias');
});

test('catalog validation checks keys, parameter names and required plural variants', () => {
  assert.deepEqual(validateCatalogs(catalogs), []);
  const errors = validateCatalogs({
    'pt-PT': { map: { days: { one: '{count} dia', other: '{count} dias' }, welcome: 'Olá {person}' } },
    en: { map: { days: { one: '{total} day' }, stray: 'extra' } },
  });
  assert.ok(errors.some(error => error.includes('different parameters')));
  assert.ok(errors.some(error => error.includes('missing plural other')));
  assert.ok(errors.some(error => error.includes('welcome: missing key')));
  assert.ok(errors.some(error => error.includes('stray: unexpected key')));
});

test('the historical calendar and canonical names are unchanged by presentation', () => {
  const pt = createI18n(), en = createI18n({ languages: ['en'] });
  for (const [day, expected] of [[0, '1 March 147 BC'], [244, '31 October 147 BC'], [245, '1 November 147 BC']]) {
    assert.equal(mapDate(pt, campaignDateParts(day)), dateLabel(day));
    assert.equal(mapDate(en, campaignDateParts(day)), expected);
  }
  assert.equal(mapPlaceName(en, 'Castro do Penedo', 'castro'), 'Penedo Hillfort');
  assert.equal(mapPlaceName(en, 'Aldeia da Ribeira (fora do vale)', 'aldeia'), 'Ribeira Village (outside the valley)');
  assert.equal(mapPlaceName(en, 'Nome de Búcia', 'aldeia'), 'Nome de Búcia');
  assert.equal(mapPlaceName(pt, 'Castro do Penedo', 'castro'), 'Castro do Penedo');
});

for (const file of ['index.html', 'campaign-map-3d.html']) {
  test(`${file} binds all declared translations and accessible labels`, () => {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const dom = new JSDOM(source, { url: 'http://sentinel.test' });
    const { window } = dom, doc = window.document;
    const i18n = bindDocumentLanguage(window);
    for (const locale of ['en', 'pt-PT']) {
      i18n.setLocale(locale);
      const reference = createI18n({ languages: [locale], onMissing: ({ key }) => assert.fail(key) });
      assert.equal(doc.documentElement.lang, locale);
      for (const element of doc.querySelectorAll('[data-i18n]')) {
        assert.equal(element.textContent, reference.t(element.dataset.i18n));
      }
      for (const element of doc.querySelectorAll('[data-i18n-aria]')) {
        assert.equal(element.getAttribute('aria-label'), reference.t(element.dataset.i18nAria));
      }
    }
    dom.window.close();
  });
}

test('the language is chosen only in the main menu: no other selector in the game or the tactical prototype', () => {
  const read = file => new JSDOM(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')).window.document;
  const game = read('index.html');
  assert.equal(game.querySelectorAll('[data-language], select[id*="lang"]').length, 0, 'no language select in the game');
  const menuButtons = [...game.querySelectorAll('[data-menu-language]')];
  assert.equal(menuButtons.length, 2);
  assert.ok(menuButtons.every(button => button.closest('#menu-language')), 'the only language buttons live in the main menu');
  const proto = read('tactical-proto.html');
  assert.equal(proto.querySelectorAll('#lang, [data-language], select').length, 0, 'no language select in the tactical prototype');
});
