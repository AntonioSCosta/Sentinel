// The shield hand grips the scutum from behind: never in front of the board.
export default async function ({ G, THREE, st, check, forcePlay }) {
  const C = await import('../src/combat.js');
  G.start(1); forcePlay();
  const legios = G.enemies.filter(e => e.kind === 'legio').slice(0, 4);
  const handBehind = e => {
    e.m.root.updateMatrixWorld(true);
    const hand = new THREE.Vector3(0, -.28, 0); e.m.elbows[0].localToWorld(hand);
    const sc = e.m.root.userData.scutum; return sc.worldToLocal(hand.clone()).z;
  };
  let worst = -9;
  for (const stance of ['march', 'chase', 'block']) {
    for (const e of legios) {
      e.state = stance === 'march' ? 'guard' : 'chase'; e.aiT = 99;
      if (stance === 'block') C.beginBlock(e.f, 'shield'); else C.endBlock(e.f);
    }
    st(40);
    for (const e of legios) worst = Math.max(worst, handBehind(e));
  }
  check(`legionaries' shield hands stay behind the scutum (worst z ${worst.toFixed(3)} m)`, worst < -.02);
}
