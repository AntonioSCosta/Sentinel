// Javelins: companions throw their three before drawing the falcata; a velite throws ten, then fights with the gladius.
export default async function ({ G, st, check, forcePlay, setGod }) {
  G.setCompanions(3); G.start(1); forcePlay(); setGod(true);
  check('each companion carries 3 javelins, Viriato too', G.allies.every(a => a.jav === 3) && G.P.dardos === 3);
  const e = G.enemies.find(o => o.kind === 'legio' && !o.dead);
  for (const o of G.enemies) if (o !== e) { o.pos.x += 500; o.home.x += 500; }
  e.pos.set(G.P.pos.x, 0, G.P.pos.z - 18); e.pos.y = G.heightAt(e.pos.x, e.pos.z); e.hp = e.maxhp = 9999; e.aware = 99; e.state = 'chase';
  let ally = 0; for (let i = 0; i < 600; i++) { st(1); ally = Math.max(ally, G.projectiles.filter(p => p.owner === 'ally').length); }
  const left = G.allies.map(a => a.jav);
  check(`companions throw javelins at range (${ally} in the air at once; left ${left})`, ally > 0 && left.every(n => n < 3));
  G.setCompanions(0);
  // a velite: ten javelins, then the sword
  G.start(1); forcePlay(); setGod(true);
  const v = G.enemies.find(o => o.kind === 'velite');
  for (const o of G.enemies) if (o !== v) { o.pos.x += 500; o.home.x += 500; }
  check('a velite starts with 10 javelins', v.jav === 10);
  v.pos.set(G.P.pos.x, 0, G.P.pos.z - 20); v.pos.y = G.heightAt(v.pos.x, v.pos.z); v.hp = 9999; v.state = 'skirmish'; v.aware = 1;
  let thrown = 0; const n0 = () => G.projectiles.filter(p => p.owner === 'enemy').length; let prev = n0();
  for (let i = 0; i < 60 * 60 && v.state === 'skirmish'; i++) { v.cd = Math.min(v.cd, .2); st(1); const n = n0(); if (n > prev) thrown += n - prev; prev = n; }
  check(`the velite throws exactly 10 (${thrown}) and then closes in with the sword (${v.state})`, thrown === 10 && v.jav === 0 && v.state === 'chase');
  const gl = v.m.root.getObjectByName('gladius'), pil = v.m.root.getObjectByName('pilum');
  check('he now holds a gladius, not a javelin', gl && gl.visible && pil && !pil.visible);
  let swung = false; for (let i = 0; i < 900 && !swung; i++) { st(1); if (v.f.phase === 'windup' || v.f.phase === 'strike') swung = true; }
  check('and swings it', swung);
}
