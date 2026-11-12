import test from 'node:test';
import assert from 'node:assert/strict';
import { installHook } from '../src/hook.js';

/** A stand-in for the browser and the game, recording what the hook does to them. */
function harness(search = '') {
  const log = [], listeners = {};
  const win = {
    location: { search },
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    dispatchEvent: e => { for (const fn of listeners[e.type] || []) fn(e); return true; },
    KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
  };
  const game = {
    chapter: 'emboscada', state: 'play',
    P: { hp: 80, kills: 2, pos: { x: 1, y: 2, z: 3 } },
    enemies: [{ dead: false }, { dead: true }], allies: [{ dead: false }],
    step: dt => log.push(['step', dt]), render: () => log.push(['render']),
  };
  return { win, game, log, listeners };
}

test('the hook goes on the window with the five members a check calls', () => {
  const h = harness();
  installHook(h.game, h.win);
  for (const k of ['scene', 'state', 'press', 'hold', 'step']) assert.ok(k in h.win.game, k);
  assert.equal(typeof h.win.game.step, 'function');
});

test('scene names the chapter and what the game is doing', () => {
  const h = harness();
  installHook(h.game, h.win);
  assert.equal(h.win.game.scene, 'emboscada/play');
  h.game.state = 'won';
  assert.equal(h.win.game.scene, 'emboscada/won', 'read fresh each time, never a stale copy');
});

test('state is a snapshot a check can read, not the live objects', () => {
  const h = harness();
  installHook(h.game, h.win);
  const s = h.win.game.state;
  assert.equal(s.hp, 80);
  assert.equal(s.kills, 2);
  assert.equal(s.enemiesAlive, 1);
  assert.equal(s.alliesAlive, 1);
  assert.deepEqual(s.pos, { x: 1, y: 2, z: 3 });
  s.pos.x = 99;
  assert.equal(h.game.P.pos.x, 1, 'changing the snapshot does not reach into the game');
});

test('step runs the game n times at a fixed step and draws once', () => {
  const h = harness();
  installHook(h.game, h.win);
  h.win.game.step(3);
  assert.deepEqual(h.log, [['step', 1 / 60], ['step', 1 / 60], ['step', 1 / 60], ['render']]);
});

test('step() with no argument runs one step; draw false skips the draw', () => {
  const h = harness();
  installHook(h.game, h.win);
  h.win.game.step();
  assert.deepEqual(h.log, [['step', 1 / 60], ['render']]);
  h.log.length = 0;
  h.win.game.step(2, false);
  assert.deepEqual(h.log, [['step', 1 / 60], ['step', 1 / 60]]);
});

test('press puts a key down for exactly one step', () => {
  const h = harness();
  installHook(h.game, h.win);
  const seen = [];
  for (const t of ['keydown', 'keyup']) h.win.addEventListener(t, e => seen.push([e.type, e.code]));
  h.win.game.press('KeyW');
  assert.deepEqual(seen, [['keydown', 'KeyW']], 'down before the step, not yet released');
  h.win.game.step();
  assert.deepEqual(seen, [['keydown', 'KeyW'], ['keyup', 'KeyW']]);
  h.win.game.step();
  assert.equal(seen.length, 2, 'released once, not again');
});

test('hold keeps a key down across steps until it is let go', () => {
  const h = harness();
  installHook(h.game, h.win);
  const seen = [];
  for (const t of ['keydown', 'keyup']) h.win.addEventListener(t, e => seen.push([e.type, e.code]));
  h.win.game.hold('ShiftLeft', true);
  h.win.game.step(); h.win.game.step();
  assert.deepEqual(seen, [['keydown', 'ShiftLeft']], 'still held');
  h.win.game.hold('ShiftLeft', false);
  assert.deepEqual(seen, [['keydown', 'ShiftLeft'], ['keyup', 'ShiftLeft']]);
});

test('?manual=1 stops the page loop; without it the loop runs', () => {
  assert.equal(installHook(harness('?manual=1').game, harness('?manual=1').win).manual, true);
  assert.equal(installHook(harness().game, harness().win).manual, false);
});

test('?scene= names the chapter to start in, and nothing else does', () => {
  assert.equal(installHook(harness('?scene=cativos').game, harness('?scene=cativos').win).scene, 'cativos');
  assert.equal(installHook(harness().game, harness().win).scene, null);
});
