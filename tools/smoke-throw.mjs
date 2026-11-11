// Throws come out of Viriato's hand toward the crosshair after a visible wind-up; blades leave a trail.
export default async function ({ G, THREE, st, key, check, forcePlay }) {
  G.start(1); forcePlay(); for (const e of G.enemies) e.pos.x += 400;
  key('Digit2'); key('Digit2', false); st(30);
  const before = G.projectiles.length;
  G.input.mouse(true, false); st(1); G.input.mouse(false, false);
  check('the javelin is not released instantly (wind-up first)', G.projectiles.length === before);
  let n = 0; while (G.projectiles.length === before && n++ < 30) st(1);
  const p = G.projectiles.at(-1), hand = G.avatarHand();
  check('a javelin is released after the wind-up', G.projectiles.length === before + 1 && p);
  if (p) {
    check(`it leaves from Viriato's hand (${p.spawn.distanceTo(hand).toFixed(2)} m)`, p.spawn.distanceTo(hand) < .45);
    const camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(G.camera.quaternion);
    check(`it flies toward the crosshair (dot ${p.vel0.clone().normalize().dot(camFwd).toFixed(2)})`, p.vel0.clone().normalize().dot(camFwd) > .93);
  }
  st(30);
  // holding the button longer throws harder (up to a limit)
  const fly = hold => { const b = G.projectiles.length; G.input.mouse(true, false); st(hold); G.input.mouse(false, false); let k = 0; while (G.projectiles.length === b && k++ < 30) st(1); const q = G.projectiles.at(-1); st(40); return q ? q.vel0.length() : 0; };
  G.P.dardos = 5; const quick = fly(1), long = fly(70), longer = fly(140);
  check(`a held javelin flies faster (${quick.toFixed(1)} → ${long.toFixed(1)} m/s), capped (${longer.toFixed(1)})`, long > quick + 8 && Math.abs(longer - long) < .5);
  key('Digit1'); key('Digit1', false); st(5);
  G.input.mouse(true, false); st(1); G.input.mouseMove(-30, 0); st(20); G.input.mouse(false, false);
  let seen = 0; for (let i = 0; i < 30; i++) { st(1); seen = Math.max(seen, G.trailCount()); }
  check(`a cut leaves a visible blade trail (${seen} segments)`, seen > 3);
}
