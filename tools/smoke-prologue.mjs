// Prologue (Galba's massacre): crowd, ring, betrayal, escape to the forest ends the chapter with a way on to the ambush.
export default async ({ G, doc, st, check, forcePlay, setGod }) => {
  setGod(true); G.start(1, 'prologo'); forcePlay(); st(30);
  check('prologue: 24 disarmed people in three groups and their elder', G.civs.length === 25 && G.chapter === 'prologo');
  check('prologue: the ring has closed in', G.enemies.filter(e => e.group === 'cordon').every(e => Math.hypot(e.pos.x - G.MEADOW.x, e.pos.z - G.MEADOW.z) < 20));
  st(600);
  check('prologue: soldiers hunt Viriato after the betrayal', G.enemies.some(e => e.state === 'chase'));
  check('prologue: the soldiers cut down most of the adults', G.civs.filter(c => c.dead).length >= 10);
  check('prologue: children are never cut down', G.civs.filter(c => c.child && c.dead).length === 0);
  check('prologue: Viriato carries no weapon', doc.getElementById('wname').textContent === 'Desarmado');
  G.P.pos.set(G.ESCAPE.x, G.P.pos.y, G.ESCAPE.z); st(5);
  check('prologue: escaping plays the closing scene', G.state === 'outro');
  check('prologue: men are among the captives', G.civs.some(c => c.prisoner && !c.female && !c.child) && G.civs.some(c => c.prisoner && (c.female || c.child)));
  st(1100);
  check('prologue: reaching the forest wins it', G.state === 'won' && !doc.getElementById('end').classList.contains('hidden'));
  check('prologue: offers the next chapter', !doc.getElementById('next').classList.contains('hidden'));
  setGod(false); G.start(1);
  check('ambush starts in the forest ', G.chapter === 'emboscada' && G.civs.length === 0 && Math.abs(G.P.pos.z - 34) < 2);
};
