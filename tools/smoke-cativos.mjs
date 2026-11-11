// 'Os Cativos': alone to the Roman halt, guards silenced, ropes cut, the men arm themselves, away to the woods.
export default async function ({ G, THREE, st, key, check, forcePlay, setGod }) {
  const go = (x, z) => { G.P.pos.set(x, G.heightAt(x, z), z); G.P.vel.x = G.P.vel.z = 0; };
  G.start(1, 'cativos'); forcePlay(); setGod(true);
  const H = G.halt, guards = () => G.enemies.filter(e => e.group === 'halt' && !e.dead);
  check('Viriato starts alone, with 3 javelins', G.allies.length === 0 && G.P.dardos === 3);
  check(`three groups of four captives, roped and on their knees (${G.civs.length})`, H.groups.length === 3 && G.civs.length === 12 && G.civs.every(c => c.bound && c.crouch));
  check(`seven Romans on guard, none aware (${guards().length})`, guards().length === 7 && guards().every(e => e.state === 'guard'));
  check('he starts out of sight, ~45 m from the halt', Math.hypot(G.P.pos.x - G.HALT.x, G.P.pos.z - G.HALT.z) > 40);
  st(120); check('the guards keep their posts while he stays hidden', guards().every(e => e.state === 'guard') && !G.alarm);
  // leaving with nobody freed is refused
  go(G.WOODS.x, G.WOODS.z); st(10); check('he cannot slip away before freeing anyone', G.state === 'play');
  // E far from a stake does nothing; ropes cannot be cut in an instant
  go(G.CSTART.x, G.CSTART.z); key('KeyE'); key('KeyE', false); st(5); check('E away from the stakes does nothing', !H.cut && H.freed === 0);
  // a guard cut down unawares is not heard by the next group
  const g0 = H.groups[0], near = guards().filter(e => Math.hypot(e.home.x - g0.x, e.home.z - g0.z) < 8), far = guards().filter(e => !near.includes(e));
  G.damageEnemyForTest(near[0], 999); st(3);
  check('a silent kill does not rouse the other groups', far.every(e => e.state === 'guard'));
  for (const e of guards()) { G.damageEnemyForTest(e, 999); st(1); }
  check('with every guard dead no alarm was given', guards().length === 0 && !G.alarm);
  go(g0.x + 1.6, g0.z); st(2); key('KeyE'); key('KeyE', false); st(20);
  check('cutting the ropes takes a moment', H.cut === g0 && g0.bound);
  st(110);
  check(`the group is free: the men become companions, the others run (${G.allies.length} men, freed ${H.freed})`, !g0.bound && H.freed === 4 && G.allies.length === 2 && G.allies.every(a => a.unarmed));
  let crouched = false; for (let i = 0; i < 900 && G.allies.some(a => a.unarmed); i++) { st(1); if (G.allies.some(a => a.crouch && a.unarmed)) crouched = true; }
  check('the freed men crouch by dead Romans and come up armed', crouched && G.allies.every(a => !a.unarmed) && G.enemies.filter(e => e.stripped).length === 2);
  for (let i = 0; i < 1500 && G.civs.some(c => c.fleeTo && !c.gone); i++) st(1);
  check('the women, children and old run to the woods and are gone', G.civs.filter(c => c.fleeTo).length === 2 && G.civs.filter(c => c.fleeTo).every(c => c.gone));
  go(G.WOODS.x + 2, G.WOODS.z); st(5);
  check('reaching the woods with freed captives wins the mission', G.state === 'won' && G.nextChapter === 'emboscada');
  check(`the men who took up arms go on to the ambush (${G.companions})`, G.companions === 2);
  // the alarm: a guard who sees him and lives sounds it, and reinforcements come after the delay
  G.start(1, 'cativos'); forcePlay(); setGod(true);
  const e = G.enemies.find(x => x.group === 'halt'); go(e.pos.x + 2, e.pos.z); G.alertForTest(e); 
  for (let i = 0; i < 300 && !G.alarm; i++) st(1);
  check('a guard left alive gives the alarm', G.alarm && G.enemies.filter(x => x.group === 'halt' && !x.dead).every(x => x.state === 'chase'));
  const n0 = G.enemies.length; G.halt.reinfT = .5; st(60);
  check(`reinforcements arrive after the delay (${G.enemies.length - n0} more)`, G.enemies.filter(x => x.group === 'relief').length === 6);
  G.setCompanions(3);
}
