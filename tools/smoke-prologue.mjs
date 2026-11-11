// Prologue (Galba's massacre): crowd, ring, betrayal, escape to the forest ends the chapter with a way on to the ambush.
export default async ({ G, doc, st, check, forcePlay, setGod }) => {
  setGod(true); G.start(1, 'prologo'); forcePlay(); st(30);
  check('prologue: 24 disarmed people in three groups', G.civs.length === 24 && G.chapter === 'prologo');
  check('prologue: the ring has closed in', G.enemies.filter(e => e.group === 'cordon').every(e => Math.hypot(e.pos.x - G.MEADOW.x, e.pos.z - G.MEADOW.z) < 20));
  check('prologue: soldiers hunt Viriato after the betrayal', G.enemies.some(e => e.state === 'chase'));
  st(200);
  check('prologue: the people flee outward', G.civs.filter(c => Math.hypot(c.pos.x - G.MEADOW.x, c.pos.z - G.MEADOW.z) > 15).length > 12);
  G.P.pos.set(G.ESCAPE.x, G.P.pos.y, G.ESCAPE.z); st(240);
  check('prologue: reaching the forest wins it', G.state === 'won' && !doc.getElementById('end').classList.contains('hidden'));
  check('prologue: offers the next chapter', !doc.getElementById('next').classList.contains('hidden'));
  setGod(false); G.start(1);
  check('ambush starts in the forest ', G.chapter === 'emboscada' && G.civs.length === 0 && Math.abs(G.P.pos.z - 34) < 2);
};
