// Viriato's three companions: follow, stay out of an ambush, join the fight, can fall.
export default async function ({ G, st, key, check, forcePlay, setGod }) {
  G.setCompanions(3); G.start(1); forcePlay(); setGod(true);
  check('three companions start beside Viriato', G.allies.length === 3 && G.allies.every(a => a.pos.distanceTo(G.P.pos) < 6));
  key('KeyW'); st(240); key('KeyW', false); st(90);
  check('they follow him (' + G.allies.map(a => a.pos.distanceTo(G.P.pos).toFixed(1)) + ')', G.allies.every(a => a.pos.distanceTo(G.P.pos) < 7));
  st(300); const start = G.allies.map(a => a.pos.clone()); st(120);
  check('and stand still when he stops', G.allies.every((a, i) => a.pos.distanceTo(start[i]) < .3));
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
