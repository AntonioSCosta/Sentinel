import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { catalogs } from '../src/i18n/index.js';

// Verificação estática da página do protótipo: todos os textos existem em inglês e em português de Portugal.
const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('tactical-proto.html: cada data-t tem tradução em inglês e em português', () => {
  const keys = [...read('tactical-proto.html').matchAll(/data-t="([^"]+)"/g)].map(m => m[1]);
  assert.ok(keys.length > 10);
  for (const locale of ['en', 'pt-PT']) for (const k of keys) assert.ok(Object.hasOwn(catalogs[locale].tactical, k), `${locale}: ${k}`);
});

test('main.js: cada chave fixa usada com t() tem tradução nos dois idiomas', () => {
  const src = read('src/tactical/proto/main.js');
  const keys = [...src.matchAll(/\bt\('([^'`]+)'/g)].map(m => m[1]);
  assert.ok(keys.length > 10);
  for (const locale of ['en', 'pt-PT']) for (const k of keys) assert.ok(Object.hasOwn(catalogs[locale].tactical, k), `${locale}: ${k}`);
  // chaves compostas: nomes de grupos, papéis, estados de saída e desfechos
  for (const locale of ['en', 'pt-PT']) {
    const c = catalogs[locale].tactical;
    for (const id of ['lobos', 'javalis', 'corvos', 'fundeiros', 'vanguarda', 'velites', 'retaguarda']) assert.ok(c[`group.${id}`], `${locale}: group.${id}`);
    for (const r of ['guerreiro', 'fundeiro', 'legionario', 'velite']) assert.ok(c[`role.${r}`]);
    for (const s of ['morto', 'fugiu', 'retirou', 'escapou']) assert.ok(c[`state.${s}`]);
    for (const o of ['vitoria', 'derrota', 'retirada', 'escapou', 'tempo']) assert.ok(c[`result.${o}`] && c[`result.text.${o}`]);
  }
});

test('a página do protótipo não toca nas gravações da campanha', () => {
  for (const f of ['src/tactical/proto/main.js', 'src/tactical/proto/session.js', 'src/tactical/proto/view.js']) assert.ok(!read(f).includes('viriato.campaign'), f);
});
