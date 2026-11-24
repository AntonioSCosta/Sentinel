// Auditoria de arquitetura da campanha: testes isolados para demonstrar mitigacoes e lacunas.
// Nao altera codigo de producao. Alguns casos documentam comportamento atual (nao uma correcao).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newCampaign, serialize, deserialize } from '../src/campaign/state.js';
import { createFlow, loadFlow, STORAGE_KEY } from '../src/campaign/flow.js';
import { makeRng } from '../src/campaign/rng.js';
import { battleSpec } from '../src/campaign/battles.js';
import { withdrawFrom } from '../src/campaign/battles.js';
import { makePraetor } from '../src/campaign/praetor.js';

test('finishBattle recusado duas vezes seguidas (mitigacao de aplicacao dupla)', () => {
  const f = createFlow({ seed: 5 }), s = f.state;
  const p = { id: 'p1', kind: 'patrulha', x: s.party.x + 40, y: s.party.y, i: 1, dir: 1, men: 6 };
  s.patrols = [p];
  f.phase = 'batalha';
  f.battle = { type: 'campo-aberto', seed: 1, site: 'campo', allies: Math.min(s.men, 25), realMen: s.men,
    enemies: { legio: 4, velites: 2, centurion: false }, bonus: { allies: 0, enemies: 0 }, foeId: 'p1', retreat: { possible: false } };
  const r1 = f.finishBattle({ won: true, alliesLost: 0, enemiesKilled: 6 });
  const r2 = f.finishBattle({ won: true, alliesLost: 0, enemiesKilled: 6 });
  assert.equal(r1.refused, undefined);
  assert.equal(r2.refused, true);
});

test('withdrawFrom sem serra possivel devolve null e nao muda o estado', () => {
  const s = newCampaign(3);
  s.food = 1e6; s.praetor = null; s.patrols = [];
  const before = JSON.stringify(s);
  const spec = { type: 'campo-aberto', withdraw: { possible: false, why: 'sem-serra' } };
  const r = withdrawFrom(s, spec);
  assert.equal(r, null);
  assert.equal(JSON.stringify(s), before);
});

test('loadFlow com phase batalha e battle minimo carrega (recuperacao parcial)', () => {
  const storage = { _v: null, getItem(k) { return this._v; }, setItem(k, v) { this._v = v; }, removeItem() { this._v = null; } };
  const f = createFlow({ storage, seed: 7 });
  const s = f.state;
  const p = { id: 'p2', kind: 'patrulha', x: s.party.x + 40, y: s.party.y, i: 1, dir: 1, men: 6 };
  s.patrols = [p];
  f.phase = 'batalha';
  f.battle = { type: 'campo-aberto', seed: 1, site: 'campo', allies: Math.min(s.men, 25), realMen: s.men,
    enemies: { legio: 4, velites: 2, centurion: false }, bonus: { allies: 0, enemies: 0 }, foeId: 'p2', retreat: { possible: false } };
  f.save();
  const loaded = loadFlow(storage);
  assert.ok(loaded, 'a campanha carrega');
  assert.equal(loaded.phase, 'batalha');
});

test('deserialize aceita state.day acima de YEAR_DAYS (lacuna documentada)', () => {
  const s = newCampaign(3);
  s.day = 9999;
  const text = serialize(s);
  const o = deserialize(text);
  // Comportamento atual: nao rejeita. Documentado como lacuna em campaign-architecture-audit.md.
  assert.ok(o, 'comportamento atual: aceita dia elevado (lacuna)');
});