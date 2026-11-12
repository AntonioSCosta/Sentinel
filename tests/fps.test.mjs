import test from 'node:test';
import assert from 'node:assert/strict';
import { newFps, tickFps } from '../src/fps.js';

test('fps is reported once per second, as whole frames', () => {
  const s = newFps();
  let out = null;
  for (let i = 1; i <= 30; i++) out = tickFps(s, i * 20) ?? out;   // 30 frames in 600 ms
  assert.equal(out, null, 'ainda não passou um segundo');
  for (let i = 31; i <= 60; i++) out = tickFps(s, i * 20) ?? out;  // 60 frames in 1200 ms
  assert.equal(typeof out, 'number');
  assert.ok(out >= 45 && out <= 55, `~50 fps, veio ${out}`);
  assert.equal(out, Math.round(out));
});
