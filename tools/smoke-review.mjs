// Final-review fixes: resume waits for pointer lock; restart clears physics bodies; start button gated on load.
export default async function ({ G, win, doc, st, check, setGod }) {
  check('COMEÇAR is enabled once the game has loaded', !doc.getElementById('start').disabled);
  // restart clears physics bodies
  G.start(1); if (G.state === 'pause') G.resume(); setGod(true);
  const e = G.enemies.find(x => x.kind === 'legio');
  G.damageEnemyForTest(e, 999); st(5);
  G.spawnEnemyJavelin(G.P.pos.clone().add(new G.V3(0, 30, -5)), G.P.pos.clone());
  check('a corpse body exists after a kill', G.physCounts().corpses >= 1);
  G.start(1); if (G.state === 'pause') G.resume();
  check('restart removes corpse and projectile bodies', G.physCounts().corpses === 0 && G.physCounts().projectiles === 0);
  setGod(false);
  // resume must wait for pointer lock to be granted
  const cv = doc.getElementById('gl');
  cv.requestPointerLock = () => Promise.reject(new Error('denied'));
  doc.dispatchEvent(new win.Event('pointerlockchange')); // pause
  G.resume(); st(2); await new Promise(r => setTimeout(r, 0));
  check('resume stays paused while pointer lock is refused', G.state === 'pause');
  Object.defineProperty(doc, 'pointerLockElement', { get: () => cv, configurable: true });
  doc.dispatchEvent(new win.Event('pointerlockchange'));
  check('game resumes once pointer lock is granted', G.state === 'play');
  delete doc.pointerLockElement; delete cv.requestPointerLock;
}
