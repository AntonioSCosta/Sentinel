import test from 'node:test';
import assert from 'node:assert/strict';
import { CHRONICLE, entryFor } from '../src/campaign/chronicle.js';
import { PRAETORS } from '../src/campaign/praetor.js';
import { SCHEDULED, DECK } from '../src/campaign/events.js';

const KINDS = ['aldeia', 'castro', 'serra', 'posto'];
const SOURCES = ['fontes', 'invenção', 'inspirado'];

test('todo o pretor, capítulo agendado, acontecimento e tipo de lugar tem entrada', () => {
  for (const p of Object.values(PRAETORS)) assert.ok(CHRONICLE[p.chronicleId], p.chronicleId);
  for (const e of [...SCHEDULED, ...DECK]) assert.ok(CHRONICLE[e.id], e.id);
  for (const k of KINDS) assert.ok(CHRONICLE[k], k);
  for (const id of ['galba', 'traicao']) assert.ok(CHRONICLE[id], id);
});

test('toda a entrada tem título, texto e origem válida', () => {
  for (const [id, e] of Object.entries(CHRONICLE)) {
    assert.ok(e.title?.trim(), `${id} título`);
    assert.ok(e.text?.trim(), `${id} texto`);
    assert.ok(SOURCES.includes(e.source), `${id} origem`);
  }
});

test('toda a entrada «fontes» tem citação', () => {
  for (const [id, e] of Object.entries(CHRONICLE)) if (e.source === 'fontes') assert.ok(e.citation?.trim(), id);
});

test('baralho e lugares são invenção', () => {
  for (const e of DECK) assert.equal(CHRONICLE[e.id].source, 'invenção', e.id);
  for (const k of KINDS) assert.equal(CHRONICLE[k].source, 'invenção', k);
});

test('cativos é inspirado e menciona 149 e 147', () => {
  const c = CHRONICLE.cativos;
  assert.equal(c.source, 'inspirado');
  assert.match(c.text, /149/);
  assert.match(c.text, /147/);
});

test('entryFor devolve a entrada e rejeita ids desconhecidos', () => {
  assert.equal(entryFor('galba'), CHRONICLE.galba);
  assert.throws(() => entryFor('inexistente'), /inexistente/);
});
