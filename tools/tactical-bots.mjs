// Robôs de estratégia do protótipo da emboscada, nas sementes 1–20. Serve para comparar revisões:
//   node tools/tactical-bots.mjs [--root <checkout>] [--json]
// `--root` aponta para outro checkout (por exemplo uma worktree da revisão anterior) e importa o código de lá.
// Os robôs jogam pior do que uma pessoa: só mostram se a mesma situação muda de resultado entre revisões.
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL, fileURLToPath } from 'node:url';

const { values } = parseArgs({ options: { root: { type: 'string' }, json: { type: 'boolean', default: false } } });
const root = path.resolve(values.root || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const load = rel => import(pathToFileURL(path.join(root, rel)).href);
const { groupOf } = await load('src/tactical/sim.js');
const { WOODS } = await load('src/tactical/proto/field.js');
const { createSession, defaultPlacement, placeGroup } = await load('src/tactical/proto/session.js');

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const until = (s, pred) => { while (!s.battle.over && !pred()) s.tick(); };
const mine = s => s.battle.groups.filter(g => g.side === 'lusitanos' && g.left === null && g.state === 'ativo' && !g.hidden);
const nearestWood = g => WOODS.reduce((b, w) => (!b || Math.hypot(g.x - w.x, g.y - w.y) < Math.hypot(g.x - b.x, g.y - b.y) ? w : b), null);
const placed = spots => { const p = defaultPlacement(); for (const [id, x, y] of spots) placeGroup(p, id, x, y); return p; };
const PINCER = [['lobos', 82, 35], ['javalis', 70, 73], ['corvos', 100, 79], ['fundeiros', 110, 42]];

function pincer(seed) {
  const s = createSession({ seed, placement: placed(PINCER) });
  until(s, () => groupOf(s.battle, 'velites').x >= 76);
  s.order({ type: 'sinal' });
  s.order({ group: 'lobos', type: 'atacar', target: 'velites' });
  s.order({ group: 'javalis', type: 'atacar', target: 'retaguarda' });
  s.order({ group: 'corvos', type: 'atacar', target: 'retaguarda' });
  s.order({ group: 'fundeiros', type: 'atacar', target: 'vanguarda' });
  return s;
}
function rear(seed) {
  const s = createSession({ seed, placement: placed([['lobos', 50, 31], ['javalis', 70, 73], ['corvos', 82, 35], ['fundeiros', 100, 79]]) });
  until(s, () => groupOf(s.battle, 'retaguarda').x >= 62);
  s.order({ type: 'sinal' });
  for (const id of ['lobos', 'javalis', 'corvos']) s.order({ group: id, type: 'atacar', target: 'retaguarda' });
  s.order({ group: 'fundeiros', type: 'atacar', target: 'velites' });
  return s;
}
function frontal(seed) {
  const s = createSession({ seed });
  s.order({ type: 'sinal' });
  for (const id of ['lobos', 'javalis', 'corvos', 'fundeiros']) s.order({ group: id, type: 'atacar', target: 'vanguarda' });
  return s;
}
function exposed(seed) {
  const p = defaultPlacement();
  for (const g of p) placeGroup(p, g.id, g.x, 42);
  const s = createSession({ seed, placement: p });
  until(s, () => groupOf(s.battle, 'velites').x >= 76);
  s.order({ type: 'sinal' });
  s.order({ group: 'lobos', type: 'atacar', target: 'velites' });
  s.order({ group: 'javalis', type: 'atacar', target: 'retaguarda' });
  s.order({ group: 'corvos', type: 'atacar', target: 'retaguarda' });
  s.order({ group: 'fundeiros', type: 'atacar', target: 'vanguarda' });
  return s;
}
function turtle(seed) {
  const s = createSession({ seed, placement: placed([['lobos', 82, 35], ['javalis', 78, 30], ['corvos', 86, 38], ['fundeiros', 80, 40]]) });
  until(s, () => groupOf(s.battle, 'velites').x >= 76);
  s.order({ type: 'sinal' });
  return s;
}
/** Os Wolves ficam na orla norte (como na Batalha 2 da auditoria); os outros escondidos; sinal tardio e ataque geral. */
function lateSignalExposedWolves(seed) {
  const s = createSession({ seed, placement: placed([['javalis', 82, 35], ['corvos', 50, 35], ['fundeiros', 110, 42]]) });
  until(s, () => s.battle.t >= 9);
  s.order({ group: 'lobos', type: 'atacar', x: 50, y: 28 });
  until(s, () => s.progress() >= 0.68);
  s.order({ type: 'sinal' });
  for (const id of ['lobos', 'javalis', 'corvos', 'fundeiros']) s.order({ group: id, type: 'atacar', target: 'retaguarda' });
  return s;
}

/** Depois do início: de 1 em 1 s, quem é apanhado por dois romanos recua para o bosque mais perto; os livres atacam quem entra no mato. */
function react(s) {
  while (!s.battle.over) {
    const t1 = s.battle.t; until(s, () => s.battle.t >= t1 + 1);
    const rom = s.battle.groups.filter(g => g.side === 'romanos' && g.left === null && g.state === 'ativo');
    const inWoods = rom.find(g => g.rough);
    for (const g of mine(s)) {
      if (g.order.type === 'retirar') continue;
      if (rom.filter(r => r.engaged && r.target === g.id).length >= 2) { const w = nearestWood(g); s.order({ group: g.id, type: 'retirar', x: w.x, y: w.y }); }
      else if (!g.engaged && inWoods) s.order({ group: g.id, type: 'atacar', target: inWoods.id });
    }
  }
}
/** Aos `secs` segundos todos recuam para o bosque w2 e esperam; quem estiver livre ataca um romano que entre no mato. */
const fallBackToWoods = secs => s => {
  const t0 = s.battle.t, w = WOODS[1];
  until(s, () => s.battle.t >= t0 + secs);
  for (const g of mine(s)) s.order({ group: g.id, type: 'retirar', x: w.x, y: w.y });
  while (!s.battle.over) {
    const t1 = s.battle.t; until(s, () => s.battle.t >= t1 + 1);
    const inWoods = s.battle.groups.find(g => g.side === 'romanos' && g.left === null && g.state === 'ativo' && g.rough);
    for (const g of mine(s)) {
      if (g.engaged || g.order.type === 'retirar') continue;
      if (inWoods) s.order({ group: g.id, type: 'atacar', target: inWoods.id });
      else if (g.order.type === 'atacar' && g.order.target) s.order({ group: g.id, type: 'retirar', x: w.x, y: w.y });
    }
  }
};

const STRATEGIES = [
  ['Tenaz, sem ordens depois do sinal', pincer],
  ['Tenaz, a reagir', pincer, react],
  ['Ataque à retaguarda', rear],
  ['Carga frontal, sem ordens', frontal],
  ['Carga frontal, recuo para o bosque aos 10 s', frontal, fallBackToWoods(10)],
  ['Grupos à vista, sem ordens', exposed],
  ['Todos no mato à espera depois do sinal', turtle],
  ['Wolves expostos, sinal a 68 % (Batalha 2)', lateSignalExposedWolves],
];

const rows = STRATEGIES.map(([name, make, after]) => {
  const out = {}; let losses = 0, combat = 0;
  for (const seed of SEEDS) {
    const s = make(seed);
    if (after) after(s);
    until(s, () => false);
    const r = s.report().data;
    out[r.outcome] = (out[r.outcome] || 0) + 1;
    losses += r.lusitanians.dead; combat += r.combatSeconds;
  }
  return { name, outcomes: out, meanLosses: Math.round(losses / SEEDS.length * 10) / 10, meanCombat: Math.round(combat / SEEDS.length) };
});

if (values.json) console.log(JSON.stringify(rows, null, 1));
else for (const r of rows) console.log(`${r.name.padEnd(48)} ${JSON.stringify(r.outcomes).padEnd(44)} baixas ${String(r.meanLosses).padStart(4)}  combate ${r.meanCombat} s`);
