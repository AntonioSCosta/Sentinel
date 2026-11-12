// Equilíbrio da campanha: joga anos inteiros com ordens automáticas (só a camada pura, sem DOM nem Three.js).
// Uso: npm run balance   (sementes 1..20; BALANCE_SEEDS=50 para mais)
import { createFlow } from '../src/campaign/flow.js';
import { YEAR_DAYS } from '../src/campaign/clock.js';
import { foodPerDay } from '../src/campaign/state.js';

import { makeRng } from '../src/campaign/rng.js';
import { HELP_GAP } from '../src/campaign/simulation.js';

const SEEDS = +(process.env.BALANCE_SEEDS || 20);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const nearest = (list, p) => list.reduce((b, s) => (!b || dist(s, p) < dist(b, p) ? s : b), null);
// Vantagem por tipo: na emboscada e no assalto à coluna é o bando que escolhe o sítio; Viriato vale uns quantos homens.
const EDGE = { emboscada: 1.8, 'assalto-coluna': 1.6, 'defesa-aldeia': 1.2, 'campo-aberto': 1, decisiva: 1, historica: 1.3 };
const VIRIATO = 4;
const FLEE = 80;   // a esta distância o pretor apanha o bando em dois ou três dias

/** Probabilidade de vitória (Lanchester ao quadrado) e um resultado sorteado com baixas proporcionais. */
function fight(spec, rng) {
  const mine = (spec.allies + (spec.bonus?.allies || 0) + VIRIATO) * (EDGE[spec.type] ?? 1);
  const theirs = spec.enemies.legio + spec.enemies.velites + (spec.enemies.centurion ? 1 : 0) + (spec.bonus?.enemies || 0);
  const p = mine * mine / (mine * mine + theirs * theirs);
  const won = rng.chance(p);
  const ratio = Math.min(1, theirs / mine);
  const lostFrac = won ? 0.25 * ratio : 0.25 + 0.25 * ratio;
  const alliesLost = Math.round(spec.allies * lostFrac * rng.range(0.6, 1.4));
  const shown = spec.enemies.legio + spec.enemies.velites + (spec.enemies.centurion ? 1 : 0);
  return { p, result: { won, alliesLost, enemiesKilled: won ? shown : Math.round(shown * 0.3), cartsCaptured: 2, cartsTotal: 3 } };
}

/** Uma ordem para o dia, a partir do estado (sem ver o futuro). Prioridades fixas, sem alternar alvos. */
function policy(s, mem) {
  const { world, party } = s, set = world.settlements;
  const live = set.filter(x => x.kind === 'aldeia' && !s.villages[x.id].burnt);
  const p = s.praetor;
  const at = (x, r = 20) => dist(x, party) <= r;
  const go = (to, then) => (at(to) ? then : { kind: 'marchar', to: { x: to.x, y: to.y } });
  // 1) o pretor à vista: foge, para o ponto a um dia de marcha mais longe dele (dentro do mapa)
  if (p && dist(p, party) <= FLEE) {
    let best = null;
    for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2, q = { x: Math.min(world.w, Math.max(0, party.x + Math.cos(a) * 45)), y: Math.min(world.h, Math.max(0, party.y + Math.sin(a) * 45)) };
      if (!best || dist(q, p) > dist(best, p)) best = q;
    }
    return { kind: 'marchar', to: best };
  }
  // 2) comida para menos de 12 dias: castro mais próximo que ainda dê ajuda
  if (s.food < foodPerDay(s.men) * 12) {
    const c = nearest(set.filter(x => x.kind === 'castro' && !(s.help && x.id in s.help && s.day - s.help[x.id] < HELP_GAP)), party);
    if (c) return go(c, { kind: 'pedir-ajuda', id: c.id });
  }
  // 3) recrutar de 10 em 10 dias, se houver armas
  if (s.arms > 0 && s.day - mem.lastRecruit >= 10) {
    const v = nearest(live.filter(x => s.day - s.villages[x.id].recruitedDay >= 10), party);
    if (v) { if (at(v)) mem.lastRecruit = s.day; return go(v, { kind: 'recrutar', id: v.id }); }
  }
  // 4) uma patrulha a ameaçar uma aldeia perto: vai defendê-la
  const threatened = live.find(v => dist(v, party) < 120 && s.patrols.some(q => dist(q, v) < 70));
  if (threatened) return go(threatened, { kind: 'acampar' });
  // 5) emboscada: o ponto da estrada mais próximo, e esperar
  return go(nearest(world.road, party), { kind: 'esperar' });
}

function play(seed) {
  const flow = createFlow({ seed }), s = flow.state, rng = makeRng(seed * 101 + 7);
  const mem = { lastRecruit: -99, flip: false };
  let burnt30 = 0, guard = 0;
  const losses = [];   // { day, fome, batalha } homens perdidos, para atribuir a causa da ruína
  const types = {};
  while (flow.phase !== 'fim' && guard++ < 2000) {
    if (flow.phase === 'batalha') {
      types[flow.battle.type] = (types[flow.battle.type] || 0) + 1;
      const m0 = s.men;
      flow.finishBattle(fight(flow.battle, rng).result);
      losses.push({ day: s.day, batalha: m0 - s.men, fome: 0 });
      continue;
    }
    const o = policy(s, mem);
    const { events } = flow.order(o);
    if (process.env.TRACE == seed) console.log(s.day, o.kind, o.id || '', `men ${s.men} food ${s.food} arms ${s.arms} fame ${s.fame}`, s.praetor ? `pd ${Math.round(dist(s.praetor, s.party))}` : '', events.map(e => e.type).join(','));
    for (const e of events) if (e.type === 'fome') losses.push({ day: s.day, fome: e.mortos, batalha: 0 });
    if (s.day <= 30) burnt30 = Object.values(s.villages).filter(v => v.burnt).length;
  }
  const burnt = Object.values(s.villages).filter(v => v.burnt).length;
  const recent = losses.filter(l => l.day > s.day - 30), sum = k => recent.reduce((a, l) => a + Math.max(0, l[k]), 0);
  const cause = s.over === 'vitoria' ? (s.decisivaWon ? 'decisiva' : 'ano')
    : s.day >= YEAR_DAYS ? 'ano' : s.fame <= 0 ? 'fama' : sum('fome') > sum('batalha') ? 'fome' : 'homens';
  return { seed, days: Math.min(s.day, YEAR_DAYS), battles: s.battles || 0, result: s.over, cause, burnt, burnt30, men: s.men, fame: s.fame, types };
}

const rows = [];
for (let seed = 1; seed <= SEEDS; seed++) rows.push(play(seed));
const pad = (v, n) => String(v).padStart(n);
console.log('seed  dias  bat  resultado  causa     queimadas(d30/fim)  homens  fama  tipos');
for (const r of rows) console.log(`${pad(r.seed, 4)}  ${pad(r.days, 4)}  ${pad(r.battles, 3)}  ${r.result.padEnd(9)}  ${r.cause.padEnd(8)}  ${pad(r.burnt30, 9)}/${pad(r.burnt, 2)}       ${pad(r.men, 6)}  ${pad(r.fame, 4)}  ${Object.entries(r.types).map(([k, v]) => `${k}:${v}`).join(' ')}`);
const won = rows.filter(r => r.result === 'vitoria').length, inBand = rows.filter(r => r.battles >= 12 && r.battles <= 25).length;
const causes = {}; for (const r of rows.filter(r => r.result === 'derrota')) causes[r.cause] = (causes[r.cause] || 0) + 1;
const med = a => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
console.log(`\nResumo (${SEEDS} sementes): vitórias ${won}/${SEEDS} (decisiva ${rows.filter(r => r.cause === 'decisiva').length}, ano ${rows.filter(r => r.result === 'vitoria' && r.cause === 'ano').length})`
  + ` · batalhas 12–25 em ${inBand}/${SEEDS} (mediana ${med(rows.map(r => r.battles))})`
  + ` · dias (mediana) ${med(rows.map(r => r.days))} · derrotas por causa ${JSON.stringify(causes)}`
  + ` · aldeias queimadas até ao dia 30: máx ${Math.max(...rows.map(r => r.burnt30))}, mediana ${med(rows.map(r => r.burnt30))}`);
