/**
 * The game-state hook the studio framework's checks drive the game through (`window.game`).
 *
 * A canvas shows nothing to a page snapshot, so a scripted check needs a way in: this is it.
 * Players never see any of it, and the game does not read it — it is an adapter over the object
 * `boot()` already builds, wired to the keyboard events the game already listens for.
 *
 *   window.game.scene        the chapter and what the game is doing, e.g. "emboscada/play"
 *   window.game.state        a snapshot: hp, stamina, kills, position, who is still standing
 *   window.game.press(code)  a key down for exactly one step
 *   window.game.hold(code, on)  a key held, or let go
 *   window.game.step(n, draw)   runs n steps of the game, then draws unless draw is false
 *   ?manual=1                the page loop does not run; only step() moves the game
 *   ?scene=<name>            start in that chapter
 *
 * `?seed=` is not supported: this game seeds each area separately from fixed numbers
 * (`setSeed` in game.js), so there is no one seed to set. Same-seed replays read NOT ASSESSED.
 */

const STEP = 1 / 60;   // the fixed step a check drives the game at, whatever the page's frame rate

export function installHook(game, win) {
  const params = new URLSearchParams(win.location.search || '');
  const held = new Set(), tapped = new Set();

  const key = (type, code) => win.dispatchEvent(new win.KeyboardEvent(type, { code, bubbles: true }));
  const snapshot = () => {
    const P = game.P || {}, pos = P.pos || {};
    return {
      hp: P.hp, stamina: P.f && P.f.stamina, kills: P.kills,
      pos: { x: pos.x, y: pos.y, z: pos.z },           // a copy: a check must not reach into the game
      enemiesAlive: (game.enemies || []).filter(e => !e.dead).length,
      alliesAlive: (game.allies || []).filter(a => !a.dead).length,
    };
  };

  const hook = {
    get scene() { return `${game.chapter}/${game.state}`; },
    get state() { return snapshot(); },
    press(code) { if (!held.has(code)) { key('keydown', code); tapped.add(code); } },
    hold(code, on) {
      if (on) { if (!held.has(code)) { key('keydown', code); held.add(code); } }
      else if (held.delete(code)) key('keyup', code);
    },
    step(n = 1, draw = true) {
      for (let i = 0; i < n; i++) game.step(STEP);
      if (draw) game.render();
      for (const code of tapped) if (!held.has(code)) key('keyup', code);   // a tap lasts one step
      tapped.clear();
    },
  };

  win.game = hook;
  return { hook, manual: params.get('manual') === '1', scene: params.get('scene') };
}
