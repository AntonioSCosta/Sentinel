// A ferramenta de equilíbrio dos capitães (tools/balance-captains.mjs): jogos deterministas e perfis que fazem o que dizem.
// Poucos jogos (cada um corre um ano inteiro): o que se mede em centenas de sementes está no relatório da ferramenta.
import test from 'node:test';
import assert from 'node:assert/strict';
import { play, summarize } from '../tools/balance-captains.mjs';

const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
const run = (profile, opts = {}) => seeds.map(seed => { const { ever, ...r } = play(seed, { profile, ...opts }); return r; });

test('o mesmo perfil e a mesma semente dão sempre o mesmo jogo', () => {
  assert.deepEqual(play(3, { profile: 'estrategico' }), play(3, { profile: 'estrategico' }));
});

test('o perfil «sem» joga sem capitães e o «negligente» nunca escolhe traços nem responde às decisões', () => {
  for (const r of run('sem')) assert.deepEqual([r.cap.recruited, r.cap.levelUps, r.cap.endCaptains.length, r.cap.crises], [0, 0, 0, 0]);
  const neg = run('negligente');
  assert.ok(neg.every(r => Object.keys(r.cap.chosen).length === 0 && r.cap.paid === 0 && r.cap.letGo === 0 && r.cap.recruited === 0));
  assert.ok(neg.some(r => r.cap.levelUps > 0), 'os capitães ganham experiência mesmo ignorados');
});

test('o pragmático escolhe traços e responde às crises, e uma equipa fixa não recruta', () => {
  const prag = run('pragmatico');
  assert.ok(prag.some(r => Object.keys(r.cap.chosen).length > 0));
  const chosen = prag.reduce((n, r) => n + Object.values(r.cap.chosen).reduce((a, b) => a + b, 0), 0), offered = prag.reduce((n, r) => n + Object.values(r.cap.offered).reduce((a, b) => a + b, 0), 0);
  assert.ok(chosen > 0 && offered >= chosen * 3, 'cada escolha vem de três opções');
  const fixed = run('pragmatico', { team: [['batedor'], ['ferreiro']], fixed: true });
  assert.ok(fixed.every(r => r.cap.recruited === 0 && r.cap.desertorAccepted === 0));
});

test('o resumo conta vitórias, causas e capitães sem inventar números', () => {
  const m = summarize(run('estrategico'));
  assert.equal(m.n, seeds.length);
  assert.equal(m.won, m.decisiva + m.ano);
  assert.equal(Object.values(m.causes).reduce((a, b) => a + b, 0) + m.won, m.n);
});
