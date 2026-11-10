// Mid-Republican (Polybian, c. 147 BC) kit — no lorica segmentata, no rectangular scutum.
export default async function ({ G, check, forcePlay }) {
  G.start(1); forcePlay();
  const names = root => { const s = new Set(); root.traverse(o => { if (o.name) s.add(o.name); }); return s; };
  const legios = G.enemies.filter(e => e.kind === 'legio');
  const all = legios.map(e => names(e.m.root));
  check('no lorica segmentata bands on any legionary', all.every(n => !n.has('segmentata')));
  check('every legionary wears a Montefortino helmet with a knob and feathers', all.every(n => n.has('montefortino') && n.has('knob') && n.has('feathers')));
  check('every legionary has a single greave, on the left leg', legios.every(e => { let g = 0, left = false; e.m.root.traverse(o => { if (o.name === 'greave') { g++; let p = o; while (p && p !== e.m.legs[0]) p = p.parent; left = !!p; } }); return g === 1 && left; }));
  check('every legionary carries an oval scutum with spina and umbo', all.every(n => n.has('scutum-oval') && n.has('spina') && n.has('umbo')));
  const kinds = new Set(legios.map(e => e.m.root.userData.armour));
  check(`body armour mixes pectorale and mail (${[...kinds].join(', ')})`, kinds.has('pectorale') && kinds.has('hamata'));
  check('the gladius is a long-pointed hispaniensis (blade ≥ 0.6 m)', legios.every(e => (e.m.root.userData.bladeLength || 0) >= .6));
}
