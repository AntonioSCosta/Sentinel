import test from 'node:test';
import assert from 'node:assert/strict';
import { DEAD_SETTLE, poseEvery, shouldPose } from '../src/lod.js';

test('quanto mais longe, menos vezes se recalcula o esqueleto', () => {
  assert.equal(poseEvery(5), 1);
  assert.equal(poseEvery(40), 2);
  assert.equal(poseEvery(100), 4);
  let last = 0;
  for (const d of [0, 10, 25, 26, 60, 61, 200]) { const n = poseEvery(d); assert.ok(n >= last, 'nunca volta a subir de cadência'); last = n; }
});

test('perto, toda a gente é animada em todas as imagens', () => {
  for (let f = 0; f < 4; f++) assert.equal(shouldPose({ dist: 3, frame: f, id: 7 }), true);
});

test('longe, é animado numa imagem em cada quatro — e nem toda a gente na mesma', () => {
  const hits = [0, 1, 2, 3].filter(f => shouldPose({ dist: 100, frame: f, id: 0 }));
  assert.equal(hits.length, 1);
  const other = [0, 1, 2, 3].filter(f => shouldPose({ dist: 100, frame: f, id: 1 }));
  assert.notDeepEqual(hits, other, 'os turnos são repartidos, senão todos caem na mesma imagem');
});

test('um corpo pousado deixa de ser animado, por perto que esteja', () => {
  assert.equal(shouldPose({ dist: 2, frame: 0, id: 0, dead: true, deadT: DEAD_SETTLE - .1 }), true, 'a queda ainda está a decorrer');
  for (let f = 0; f < 8; f++) assert.equal(shouldPose({ dist: 2, frame: f, id: 0, dead: true, deadT: DEAD_SETTLE + 1 }), false);
});
