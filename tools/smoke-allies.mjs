// Viriato's three companions: follow, stay out of an ambush, join the fight, can fall.
export default async function ({ G, st, key, check, forcePlay, setGod }) {
  G.setCompanions(3); G.start(1); forcePlay(); setGod(true);
  check('three companions start beside Viriato', G.allies.length === 3 && G.allies.every(a => a.pos.distanceTo(G.P.pos) < 6));
  key('KeyW'); st(240); key('KeyW', false); st(90);
  check('they follow him (' + G.allies.map(a => a.pos.distanceTo(G.P.pos).toFixed(1)) + ')', G.allies.every(a => a.pos.distanceTo(G.P.pos) < 7));
  st(300); const start = G.allies.map(a => a.pos.clone()); st(120);
  check('and stand still when he stops (' + G.allies.map((a, i) => a.pos.distanceTo(start[i]).toFixed(2) + ':' + a.state + ':' + a.pos.distanceTo(G.P.pos).toFixed(1)) + ')', G.allies.every((a, i) => a.pos.distanceTo(start[i]) < .3));
  // unaware Romans nearby: companions do not start the fight
  const es = G.enemies.filter(e => e.kind === 'legio' && !e.dead).slice(0, 2);
  for (const o of G.enemies) if (!es.includes(o)) { o.pos.x += 500; o.home.x += 500; }
  es.forEach((e, i) => { e.pos.set(G.P.pos.x + i * 2, 0, G.P.pos.z - 12); e.pos.y = G.heightAt(e.pos.x, e.pos.z); e.state = 'guard'; e.aware = -99; e.home.copy(e.pos); e.wT = 999; });
  st(120);
  check('companions hold back while the Romans are unaware', G.allies.every(a => a.state === 'follow') && es.every(e => e.hp === e.maxhp));
  // the fight starts: they join and Romans fall or bleed without Viriato lifting a hand
  for (const e of es) { e.aware = 99; e.state = 'chase'; }
  let joined = false; for (let i = 0; i < 1500 && es.some(e => !e.dead); i++) { st(1); if (G.allies.some(a => a.state === 'chase')) joined = true; }
  check('companions join the fight', joined);
  check('companions wound or kill Romans on their own', es.some(e => e.dead || e.hp < e.maxhp));
  check('Romans fight the companions too', G.allies.some(a => a.hp < 110) || es.every(e => e.dead));
  const a = G.allies.find(x => !x.dead); G.hurtAllyForTest(a, 999); st(30);
  check('a companion can fall', a.dead && G.allies.filter(x => !x.dead).length <= 2);
  G.setCompanions(0);
}
export async function chargeOnly({ G, st, key, check, forcePlay, setGod }) {
  G.setCompanions(3); G.start(1); forcePlay(); setGod(true);
  for (const o of G.enemies) { o.pos.x += 500; o.home.x += 500; }
  const tap = c => { key(c); key(c, false); };
  // X shows the flag at the crosshair; a click plants it and sends them there (and is not an attack)
  G.P.pitch = -.25; st(5); tap('KeyX'); st(5);
  check('X shows a flag preview where Viriato aims', G.placing && G.flag.visible && G.flag.position.distanceTo(G.P.pos) > 3);
  G.input.mouse(true, false); st(2); G.input.mouse(false, false); st(2);
  check('clicking plants the flag and orders them to it, without swinging', G.order === 'hold' && !G.placing && G.P.f.phase === 'idle');
  const f = G.flagAt; st(600);
  check('companions go to the flag and stay there', G.allies.every(a => Math.hypot(a.pos.x - f.x, a.pos.z - f.z) < 3.5));
  key('KeyW'); st(300); key('KeyW', false); st(60);
  check('they hold the flag while Viriato walks away', G.allies.every(a => Math.hypot(a.pos.x - f.x, a.pos.z - f.z) < 3.5));
  tap('KeyZ'); st(600);
  check('Z calls them back to follow', G.order === 'follow' && !G.flag.visible && G.allies.every(a => a.pos.distanceTo(G.P.pos) < 7));
  // T: they charge a Roman who is not fighting yet
  const e = G.enemies.find(x => x.kind === 'legio' && !x.dead);
  e.pos.set(G.P.pos.x, 0, G.P.pos.z - 28); e.pos.y = G.heightAt(e.pos.x, e.pos.z); e.home.copy(e.pos); e.state = 'guard'; e.aware = -99; e.wT = 999; e.yaw = 0;
  st(120); check('without the order they leave an unaware Roman alone', G.allies.every(a => a.state === 'follow'));
  tap('KeyT'); for (let i = 0; i < 1500 && !e.dead && e.hp === e.maxhp; i++) st(1);
  check('T sends them to attack him', G.order === 'charge' && (e.dead || e.hp < e.maxhp));
  check('companions have different heights', new Set(G.allies.map(a => a.m.root.scale.y)).size === 3);
  G.setCompanions(0);
}
