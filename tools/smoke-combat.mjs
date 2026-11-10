// Task 4 combat scenarios, run by tools/smoke.mjs.
export default async function ({ G, THREE, st, key, check, forcePlay, setGod }) {
  const C = await import('../src/combat.js');
  const fresh = () => { G.start(1); forcePlay(); setGod(true); for (const o of G.enemies) { o.pos.x += 400; o.state = 'guard'; } };
  const legioAhead = (dist = 1.9) => {
    const e = G.enemies.find(x => x.kind === 'legio' && !x.dead); e.pos.x -= 400; e.pos.y = G.heightAt(e.pos.x, e.pos.z);
    G.P.pos.set(e.pos.x, G.heightAt(e.pos.x, e.pos.z + dist), e.pos.z + dist); G.P.yaw = 0; // player looks toward -z, at the enemy
    return e;
  };
  // (a) charged overhead from behind kills an unaware legionary
  fresh();
  let e = legioAhead(); e.state = 'guard'; e.yaw = Math.PI; e.wander = null; e.wT = 99; // facing away (+z is away? enemy faces +z when yaw=0) -> yaw=PI faces -z, away from player
  key('KeyC'); st(15); key('Digit1'); G.input.mouse(true, false); st(1); G.input.mouseMove(0, -30); st(48); G.input.mouse(false, false); st(60);
  key('KeyC', false);
  check('charged overhead from behind kills unaware legionary', e.dead);
  // (b) perfect parry with Q staggers the attacker
  fresh(); e = legioAhead(); e.state = 'chase'; e.yaw = 0; e.aiT = 99;
  C.beginAttack(e.f, 'left'); e.releaseAt = 0; C.releaseAttack(e.f);
  st(Math.round((C.WINDUP.left - .1) * 60)); key('KeyQ'); st(12); key('KeyQ', false);
  check('Q just before impact parries and staggers the legionary', e.f.phase === 'staggered' && G.P.lastDefense === 'parried');
  // (c) shield blocks a frontal blow: no damage, shield wears
  fresh(); setGod(false); e = legioAhead(); e.state = 'chase'; e.yaw = 0; e.aiT = 99; G.P.hp = 100;
  G.input.mouse(false, true); st(20);
  C.beginAttack(e.f, 'up'); e.releaseAt = 0; C.releaseAttack(e.f); st(40);
  check('shield blocks frontal blow without damage', G.P.hp === 100 && G.P.f.shieldHP < 100 && G.P.lastDefense === 'blocked');
  G.input.mouse(false, false);
  // (d) three velite javelins stick in the shield and show on it
  fresh(); G.input.mouse(false, true); st(10);
  for (let i = 0; i < 3; i++) {
    const from = G.P.pos.clone().add(new THREE.Vector3(0, 1.4, -8));
    G.spawnEnemyJavelin(from, G.P.pos.clone().add(new THREE.Vector3(0, 1.1, 0)));
    st(40);
  }
  check('three javelins stuck in the shield', G.P.f.stuckJavelins === 3 && G.vm.stuckVisible() === 3);
  G.input.mouse(false, false);
  // (e) shield bash (F) cancels an enemy windup
  fresh(); e = legioAhead(1.6); e.state = 'chase'; e.yaw = 0; e.aiT = 99;
  C.beginAttack(e.f, 'up'); e.releaseAt = 99; st(6); key('KeyF'); st(2); key('KeyF', false);
  check('F bash cancels enemy windup', e.f.phase !== 'windup');
  setGod(false);
}
