// Soldier animation follows motion and the blade arc.
export default async function ({ G, THREE, st, check, forcePlay }) {
  const C = await import('../src/combat.js');
  G.start(1); forcePlay();
  const w = G.enemies.find(e => e.group === 'patrol');
  let maxHip = 0, maxKnee = 0;
  for (let i = 0; i < 90; i++) { st(1); maxHip = Math.max(maxHip, Math.abs(w.m.legs[0].rotation.x)); maxKnee = Math.max(maxKnee, w.m.knees[0].rotation.x); }
  check(`marching legs swing and knees bend (hip ${maxHip.toFixed(2)}, knee ${maxKnee.toFixed(2)})`, maxHip > .12 && maxKnee > .1);
  // overhead windup raises the sword hand above the head
  const e = G.enemies.find(x => x.kind === 'legio' && x !== w);
  G.P.pos.set(e.pos.x, G.heightAt(e.pos.x, e.pos.z + 1.6), e.pos.z + 1.6);
  e.state = 'chase'; e.aiT = 99; e.yaw = 0;
  C.beginAttack(e.f, 'up'); e.releaseAt = 99; st(30);
  const hand = new THREE.Vector3(); e.m.elbows[1].children.at(-1).getWorldPosition(hand);
  check(`overhead windup lifts the sword hand above the head (${(hand.y - e.pos.y).toFixed(2)} m)`, hand.y - e.pos.y > 1.85);
  C.feint(e.f); st(20);
  C.beginAttack(e.f, 'left'); e.releaseAt = 99; st(25);
  check(`a cut from the left twists the torso (${e.m.spine.rotation.y.toFixed(2)})`, e.m.spine.rotation.y > .25);
  // first-person falcata sweeps through the arc during the player's cut
  C.feint(e.f); e.state = 'guard'; e.pos.x += 300;
  G.input.mouse(true, false); st(1); G.input.mouseMove(-30, 0); st(20); G.input.mouse(false, false);
  let q0 = null, maxAng = 0;
  for (let i = 0; i < 40; i++) { st(1); if (G.P.f.phase === 'strike') { const q = G.vm.fal.quaternion.clone(); if (!q0) q0 = q; maxAng = Math.max(maxAng, q0.angleTo(q)); } }
  check(`first-person falcata sweeps through its arc (${maxAng.toFixed(2)} rad)`, maxAng > .8);
}
