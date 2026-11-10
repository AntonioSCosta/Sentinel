// Task 9: losing pointer lock mid-charge / mid-block must not leave anything stuck.
export default async function ({ G, win, doc, st, key, check }) {
  G.start(1); if (G.state === 'pause') G.resume();
  key('Digit1'); G.input.mouse(true, false); st(15);          // charging a falcata blow
  key('KeyQ'); st(3);                                         // and holding the sword guard
  key('KeyW'); st(2);
  doc.dispatchEvent(new win.Event('pointerlockchange'));     // focus lost → pause
  check('losing pointer lock pauses the game', G.state === 'pause');
  G.resume(); st(5);
  check('after resume no charge is held', G.P.f.phase === 'idle' && !G.P.charging);
  check('after resume no block is held', G.P.f.blocking === null);
  const z0 = G.P.pos.z; st(30);
  check('after resume no movement key is stuck', Math.abs(G.P.pos.z - z0) < .01);
}
export async function chargeOnly({ G, win, doc, st, key, check }) {
  G.start(1); if (G.state === 'pause') G.resume();
  key('Digit1'); G.input.mouse(true, false); st(20);          // charging only
  doc.dispatchEvent(new win.Event('pointerlockchange'));
  G.resume(); st(2);
  check('charge cancelled by pause (no blow lands after resume)', G.P.f.phase === 'idle' && !G.P.charging);
  G.input.mouse(false, true); st(5);                          // shield only
  doc.dispatchEvent(new win.Event('pointerlockchange'));
  check('shield lowered the moment the game pauses', G.P.f.blocking === null);
  G.resume(); st(2);
  check('shield still down after resume', G.P.f.blocking === null);
}
