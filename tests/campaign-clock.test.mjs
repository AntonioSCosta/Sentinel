import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YEAR_DAYS, season, dateLabel, daysLeft, romansCampaign } from '../src/campaign/clock.js';

test('YEAR_DAYS cobre de 1 de março a 31 de outubro', () => {
  assert.equal(YEAR_DAYS, 245);
});

test('dateLabel(0) é 1 de março de 147 a.C.', () => {
  assert.equal(dateLabel(0), '1 de março de 147 a.C.');
});

test('dateLabel(244) é 31 de outubro de 147 a.C.', () => {
  assert.equal(dateLabel(244), '31 de outubro de 147 a.C.');
});

test('dateLabel percorre os limites dos meses', () => {
  assert.equal(dateLabel(30), '31 de março de 147 a.C.');
  assert.equal(dateLabel(31), '1 de abril de 147 a.C.');
  assert.equal(dateLabel(91), '31 de maio de 147 a.C.');
  assert.equal(dateLabel(92), '1 de junho de 147 a.C.');
});

test('season(0) é primavera, season(100) é verão, season(200) é outono', () => {
  assert.equal(season(0), 'primavera');
  assert.equal(season(100), 'verão');
  assert.equal(season(200), 'outono');
});

test('season segue os meses do calendário (março–maio, junho–agosto, setembro–outubro)', () => {
  assert.equal(season(90), 'primavera');   // 31 de maio
  assert.equal(season(92), 'verão');       // 1 de junho
  assert.equal(season(183), 'verão');      // 31 de agosto
  assert.equal(season(184), 'outono');     // 1 de setembro
});

test('daysLeft(0) é 245 e daysLeft(245) é 0', () => {
  assert.equal(daysLeft(0), 245);
  assert.equal(daysLeft(245), 0);
});

test('daysLeft nunca é negativo', () => {
  assert.equal(daysLeft(246), 0);
  assert.equal(daysLeft(1000), 0);
});

test('romansCampaign é verdadeiro em todo o intervalo [0, YEAR_DAYS)', () => {
  for (let d = 0; d < YEAR_DAYS; d++) assert.equal(romansCampaign(d), true, `dia ${d}`);
  assert.equal(romansCampaign(YEAR_DAYS), false);
});
