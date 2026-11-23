import { createView } from '../proto/view.js';

const params = new URLSearchParams(location.search);
const soldiers = params.get('n') === '200' ? 200 : 100;
const view = createView(document.getElementById('view'), { troopCapacity: soldiers / 2 });
const select = document.getElementById('troop-style');
const count = document.getElementById('count');
count.textContent = `${soldiers} visual instances`;
const roles = ['guerreiro', 'fundeiro', 'legionario', 'velite'];
const cohorts = Array.from({ length: soldiers / 10 }, (_, i) => ({
  id: `cohort-${i}`, role: roles[i % 4], side: i % 4 < 2 ? 'lusitanos' : 'romanos', men: 10,
  x: 25 + i % 5 * 24, y: 29 + Math.floor(i / 5) * 17, facing: 0,
  order: { type: 'mover', pace: 'marcha', path: [] }, left: null,
}));

async function change() {
  select.disabled = true;
  try {
    const factory = select.value === 'c' ? (await import('./hybrid-troops.js')).createHybridTroops : null;
    view.setTroops(factory);
  } finally { select.disabled = false; }
}
select.addEventListener('change', change);
if (params.get('troops') === 'c') { select.value = 'c'; await change(); }
Object.assign(view.camera, { tx: 74, ty: 54, dist: 108 });
let last = performance.now();
function frame(now) {
  view.sync(cohorts, Math.min(0.1, (now - last) / 1000));
  last = now;
  view.render();
  requestAnimationFrame(frame);
}
window.__troopBench = { info: view.info };
requestAnimationFrame(frame);
