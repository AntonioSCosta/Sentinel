// Os textos da ficha dos capitães (passivas, custos, traços, cicatrizes) em linhas curtas: cada número tem de coincidir com
// os valores de captains-data.js (e as bases de intel.js), nos dois idiomas. Apanha descrições desatualizadas depois de uma afinação.
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogs } from '../src/i18n/index.js';
import { ARCHETYPES as A, TRAITS, SCARS } from '../src/campaign/captains-data.js';
import { RECON_RANGE, RECON_RADIUS, SIGHT } from '../src/campaign/intel.js';

const pct = x => Math.round(x * 100), abs = Math.abs;
const T = { ...TRAITS, ...SCARS };

/** Os números que cada lista de linhas deve mostrar, tirados dos dados (sem ordem). */
const EXPECT = {
  'passive.batedor': [A.batedor.fx.reconRange, RECON_RANGE, A.batedor.fx.reconRadius, RECON_RADIUS, A.batedor.fx.hiddenSight, SIGHT],
  'costs.batedor': [A.batedor.fx.reconFood, abs(A.batedor.loyal.openBattle)],
  'passive.fundibulario': [A.fundibulario.fx.serraRange, pct(1 - A.fundibulario.fx.ambushKeep), A.fundibulario.fx.ambushFame],
  'costs.fundibulario': [A.fundibulario.loyal.farFromSerra.range, A.fundibulario.loyal.farFromSerra.after, A.fundibulario.loyal.farFromSerra.every,
    abs(A.fundibulario.loyal.farFromSerra.loss), abs(A.fundibulario.loyal.withdraw)],
  'passive.ferreiro': [A.ferreiro.fx.recruitFreeEvery, A.ferreiro.fx.seasonArms],
  'costs.ferreiro': [abs(A.ferreiro.loyal.armsLost), abs(A.ferreiro.loyal.famine)],
  'passive.saqueador': [pct(A.saqueador.fx.loot)],
  'costs.saqueador': [abs(A.saqueador.fx.lootTrust), abs(A.saqueador.loyal.famine), abs(A.saqueador.loyal.tribute)],
  'passive.incendiario': [pct(1 - A.incendiario.fx.doctrineWeight), A.incendiario.fx.postFame],
  'costs.incendiario': [A.incendiario.fx.winAttention, abs(A.incendiario.fx.fearfulTrust), abs(A.incendiario.loyal.idle.loss), A.incendiario.loyal.idle.every],
  'passive.veterano': [A.veterano.fx.legacyBonus],
  'costs.veterano': [A.veterano.loyalty, abs(A.veterano.loyal.flee), abs(A.veterano.loyal.burnt), A.veterano.betrays.attention],
  'traitGain.duro-de-roer': [pct(1 - T['duro-de-roer'].fx.lossKeep)],
  'traitCost.duro-de-roer': [abs(T['duro-de-roer'].loyal.withdraw)],
  'traitGain.olho-no-ouro': [pct(T['olho-no-ouro'].fx.loot)],
  'traitCost.olho-no-ouro': [abs(T['olho-no-ouro'].loyal.famine)],
  'traitGain.ladrao-de-galinhas': [T['ladrao-de-galinhas'].fx.famineDays, T['ladrao-de-galinhas'].fx.famineSave],
  'traitCost.ladrao-de-galinhas': [abs(T['ladrao-de-galinhas'].fx.famineTrust)],
  'traitGain.emboscador-nato': [pct(1 - T['emboscador-nato'].fx.ambushKeep)],
  'traitCost.emboscador-nato': [abs(T['emboscador-nato'].loyal.openBattle)],
  'traitGain.conhecedor-dos-trilhos': [pct(1 - T['conhecedor-dos-trilhos'].fx.withdrawKeep)],
  'traitCost.conhecedor-dos-trilhos': [T['conhecedor-dos-trilhos'].fx.withdrawFame],
  'traitGain.vingativo': [T.vingativo.fx.vengeance.days, T.vingativo.fx.vengeance.fame],
  'traitCost.vingativo': [abs(T.vingativo.fx.vengeance.loss)],
  'traitGain.olhos-de-coruja': [T['olhos-de-coruja'].fx.reportsFaster],
  'traitCost.olhos-de-coruja': [T['olhos-de-coruja'].fx.watchFood.food, T['olhos-de-coruja'].fx.watchFood.every],
  'traitGain.querido-do-povo': [T['querido-do-povo'].fx.volunteer],
  'traitCost.querido-do-povo': [abs(T['querido-do-povo'].loyal.villageDead.each), abs(T['querido-do-povo'].loyal.villageDead.max)],
  'traitGain.mao-ferida': [T['mao-ferida'].gain],
  'traitCost.mao-ferida': [pct(1 - T['mao-ferida'].fx.xpRate)],
  'traitGain.rancor-a-roma': [T['rancor-a-roma'].fx.winFame],
  'traitCost.rancor-a-roma': [abs(T['rancor-a-roma'].loyal.withdraw)],
};

const numbers = line => (line.match(/\d+/g) ?? []).map(Number);
const linesOf = (locale, key) => String(catalogs[locale].map[`captains.${key}`] ?? '').split('\n');

for (const locale of ['en', 'pt-PT']) {
  test(`${locale}: os números das linhas da ficha coincidem com os dados`, () => {
    for (const [key, expected] of Object.entries(EXPECT)) {
      const shown = linesOf(locale, key).flatMap(numbers).sort((a, b) => a - b);
      assert.deepEqual(shown, [...expected].sort((a, b) => a - b), `${locale} captains.${key}: ${linesOf(locale, key).join(' | ')}`);
    }
  });
}

test('todo o arquétipo, traço e cicatriz tem linhas curtas nos dois idiomas, com o mesmo número de linhas', () => {
  const keys = [...Object.keys(A).flatMap(id => [`passive.${id}`, `costs.${id}`]), ...Object.keys(T).flatMap(id => [`traitGain.${id}`, `traitCost.${id}`])];
  assert.deepEqual(keys.slice().sort(), Object.keys(EXPECT).sort(), 'a tabela cobre tudo o que existe nos dados');
  for (const key of keys) {
    const en = linesOf('en', key), pt = linesOf('pt-PT', key);
    assert.equal(en.length, pt.length, `${key}: mesmas linhas em EN e PT`);
    for (const line of [...en, ...pt]) assert.ok(line.length > 0 && line.length <= 72, `${key}: linha curta («${line}»)`);
  }
});

test('a ficha não fala de habilidades que ainda não existem', () => {
  for (const locale of ['en', 'pt-PT']) {
    assert.equal(catalogs[locale].map['captains.skillSoon'], undefined);
    assert.equal(catalogs[locale].map['captains.inBattle'], undefined);
  }
});
