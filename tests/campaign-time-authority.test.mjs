// A autoridade do relógio da campanha: só passa tempo com uma atividade, sem pausa e sem nada a suspendê-lo (pace.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { activityOf, clockRuns, standingOrder, STANCES, SPEEDS } from '../src/campaign/pace.js';

const AT = { x: 120, y: 80 };

test('parado, sem destino, postura nem tecla: sem atividade e o relógio não corre', () => {
  assert.equal(activityOf({}), null);
  assert.equal(activityOf({ dest: null, stance: null, holding: false }), null);
  assert.equal(clockRuns({ activity: activityOf({}) }), false);
});

test('um destino é marcha; a marcha vence a postura e a tecla', () => {
  assert.equal(activityOf({ dest: AT }), 'marchar');
  assert.equal(activityOf({ dest: AT, stance: 'acampar', holding: true }), 'marchar');
  assert.equal(activityOf({ dest: { x: NaN, y: 1 } }), null, 'um destino inválido não é marcha');
});

test('acampar, emboscar e esconder são atividades paradas; esperar ao relento só enquanto a tecla está premida', () => {
  for (const stance of STANCES) assert.equal(activityOf({ stance }), stance);
  assert.equal(activityOf({ stance: 'outra' }), null);
  assert.equal(activityOf({ holding: true }), 'aguardar');
  assert.equal(activityOf({ stance: 'esconder', holding: true }), 'esconder', 'a postura ligada manda');
});

test('o relógio corre só com atividade, sem pausa e sem bloqueio', () => {
  for (const activity of ['marchar', 'acampar', 'esperar', 'esconder', 'aguardar']) {
    assert.equal(clockRuns({ activity }), true, activity);
    assert.equal(clockRuns({ activity, paused: true }), false, `${activity} em pausa`);
    assert.equal(clockRuns({ activity, blocked: true }), false, `${activity} com painel aberto`);
  }
  assert.equal(clockRuns({ activity: null, paused: false, blocked: false }), false);
});

test('a velocidade não liga o relógio: clockRuns não depende dela', () => {
  for (const speed of SPEEDS) assert.equal(clockRuns({ activity: null, paused: false, blocked: false, speed }), false);
});

test('acampar e esperar ao relento dão o mesmo dia na simulação (acampar); a marcha e as posturas mantêm a ordem', () => {
  assert.deepEqual(standingOrder({ stance: 'acampar' }), { kind: 'acampar' });
  assert.deepEqual(standingOrder({ holding: true }), { kind: 'acampar' });
  assert.deepEqual(standingOrder({ stance: 'esperar' }), { kind: 'esperar' });
  assert.deepEqual(standingOrder({ stance: 'esconder' }), { kind: 'esconder' });
  assert.deepEqual(standingOrder({ dest: AT, stance: 'acampar' }), { kind: 'marchar', to: AT });
});
