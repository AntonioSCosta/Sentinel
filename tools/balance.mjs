// Equilíbrio da campanha: joga anos inteiros com ordens automáticas (só a camada pura, sem DOM nem Three.js).
// Uso: npm run balance   (sementes 1..20; BALANCE_SEEDS=50 para mais; VERBOSE=1 mostra as sementes de todos os robôs)
// Robôs: «atual» (a tabela da spec, secção 9), «repetidor» (embosca sempre no mesmo sítio e ignora os relatos)
// e «variado» (muda de troço depois de cada combate e responde aos relatos de Roma). Estes dois só emboscam:
// não saem da estrada para defender aldeias, para a experiência medir a tática e não a sobrevivência. Cada um corre com as contramedidas
// de Roma ligadas e desligadas (state.doctrine.off). Desligar só tira as contramedidas (batedores, escolta, força,
// guarnição, caçadores): a pressão romana (fama e atividade) continua a encurtar os intervalos e a reforçar as colunas.
import { createFlow } from '../src/campaign/flow.js';
import { YEAR_DAYS } from '../src/campaign/clock.js';
import { foodPerDay } from '../src/campaign/state.js';
import { makeRng } from '../src/campaign/rng.js';
import { COMMUNITY_IDS, recruitLimit, communityAt, bandOrigins, diag } from '../src/campaign/communities.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { HELP_GAP } from '../src/campaign/simulation.js';
import { ensureDoctrine, sectorOf, SECTORS } from '../src/campaign/doctrine.js';
import { finishBalanceBattle } from './balance-battle.mjs';

const SEEDS = +(process.env.BALANCE_SEEDS || 20);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const nearest = (list, p) => list.reduce((b, s) => (!b || dist(s, p) < dist(b, p) ? s : b), null);
// Vantagem por tipo: na emboscada e no assalto à coluna é o bando que escolhe o sítio; Viriato vale uns quantos homens.
const EDGE = { emboscada: 1.8, 'assalto-coluna': 1.6, 'defesa-aldeia': 1.2, 'campo-aberto': 1, decisiva: 1, historica: 1.3 };
const VIRIATO = 4;
const FLEE = 80;   // a esta distância o pretor apanha o bando em dois ou três dias
const MAX_STEPS = 2000;

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

/** Regras de sobrevivência: fugir do pretor, comer, recrutar e (só o «atual») defender aldeias ameaçadas. */
function survive(s, mem, defend = true) {
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
  // 3) recrutar de 10 em 10 dias (cadência do bot), se houver armas, numa comunidade do vale que dê homens
  if (s.arms > 0 && s.day - mem.lastRecruit >= 10) {
    const givers = COMMUNITY_IDS.map(id => s.communities[id]).filter(c => recruitLimit(c, s.arms).limit > 0);
    const v = nearest(set.filter(x => givers.some(c => c.settlement === x.id) && !s.villages[x.id]?.burnt), party);
    if (v) { if (at(v)) mem.lastRecruit = s.day; return go(v, { kind: 'recrutar', id: v.id }); }
  }
  // 4) uma patrulha a ameaçar uma aldeia perto: vai defendê-la
  if (!defend) return null;
  const threatened = live.find(v => dist(v, party) < 120 && s.patrols.some(q => !q.hunt && dist(q, v) < 70));
  if (threatened) return go(threatened, { kind: 'acampar' });
  return null;
}

const goTo = (s, to, then) => (dist(to, s.party) <= 20 ? then : { kind: 'marchar', to: { x: to.x, y: to.y } });

/** «atual»: a política da tabela da spec — o ponto da estrada mais próximo, e esperar. */
function atual(s, mem) {
  return survive(s, mem) || goTo(s, nearest(s.world.road, s.party), { kind: 'esperar' });
}

/** Os dois robôs de tática só lutam onde escolheram: a caminho de outro sítio, com uma coluna perto, escondem-se. */
function quiet(s, o) {
  if (o.kind !== 'marchar' || (s.praetor && dist(s.praetor, s.party) <= FLEE)) return o;
  return s.patrols.some(q => dist(q, s.party) < 45) ? { kind: 'esconder' } : o;
}

/** «repetidor»: escolhe um ponto da estrada no primeiro dia e embosca sempre lá, venha o que vier. */
function repetidor(s, mem) {
  const r = survive(s, mem, false);
  if (r) return quiet(s, r);
  if (!mem.home) mem.home = nearest(s.world.road, s.party);
  return quiet(s, goTo(s, mem.home, { kind: 'esperar' }));
}

/** «variado»: muda de troço depois de cada combate, evita o troço guarnecido e não embosca o que Roma já espera. */
function variado(s, mem) {
  const r = survive(s, mem, false);
  if (r) return quiet(s, r);
  const d = ensureDoctrine(s), road = s.world.road;
  if (!mem.home || s.battles !== mem.seenBattles || d.garrison === sectorOf(s.world, mem.home)) {
    mem.seenBattles = s.battles;
    mem.sector = ((mem.sector ?? sectorOf(s.world, s.party)) + 1) % SECTORS;
    if (d.garrison === mem.sector) mem.sector = (mem.sector + 1) % SECTORS;
    const pts = road.filter(q => sectorOf(s.world, q) === mem.sector);
    mem.home = nearest(pts.length ? pts : road, s.party);
  }
  if (dist(mem.home, s.party) > 20) return quiet(s, { kind: 'marchar', to: { x: mem.home.x, y: mem.home.y } });
  // o que vem aí? caçadores à vista: esconder; patrulha com batedores ou coluna com escolta e poucos homens: deixar passar
  const near = s.patrols.filter(q => dist(q, s.party) < 75);
  if (near.some(q => q.hunt)) return { kind: 'esconder' };
  if (near.some(q => (q.kind === 'patrulha' && d.active.batedores) || (q.kind === 'comboio' && d.active.escolta && s.men < 20))) return { kind: 'esconder' };
  return { kind: 'esperar' };
}

const BOTS = { atual, repetidor, variado };

function play(seed, bot = 'atual', off = false) {
  // Tactical reconciliation commits to storage before returning to the map.
  let saved = null;
  const storage = { getItem: () => saved, setItem: (_key, value) => { saved = value; } };
  const flow = createFlow({ seed, storage }), s = flow.state, rng = makeRng(seed * 101 + 7);
  ensureDoctrine(s).off = off;
  const mem = { lastRecruit: -99 }, policy = BOTS[bot];
  const tally = { spotted: 0, counters: {}, hunters: 0, ambushes: 0, lostInBattle: 0 };
  let burnt30 = 0, guard = 0;
  const losses = [];   // { day, fome, batalha } homens perdidos, para atribuir a causa da ruína
  const types = {};
  const rows = [];   // diagnóstico de recrutamento: uma linha por aldeia e por dia em que algo aconteceu
  const gains = { recruits: 0, lossBattle: 0, lossOther: 0 };
  const eq = { rec: 0, bat: 0, fome: 0, help: 0 };   // equação de homens (comparável com versões sem comunidades)
  const snapshot = () => Object.fromEntries(COMMUNITY_IDS.map(id => [id, s.communities[id].trust]));
  /** Junta o que aconteceu hoje a uma aldeia numa só linha (recrutas, recusa e motivo, limite efetivo, baixas, confiança). */
  const record = (day, pre, events, lost) => {
    const by = {}, row = id => (by[id] ??= { bot, off, seed, day, village: id, recruits: 0, refused: 0, why: '', closed: '', limit: '', byPosture: '', avail: '', lossBattle: 0, lossOther: 0, trust: '' });
    for (const e of events) {
      const id = COMMUNITY_IDS.find(k => s.communities[k].settlement === e.id);
      if (e.type === 'recrutou' && id) { row(id).recruits += e.men; gains.recruits += e.men; }
      if ((e.type === 'recrutar-recusado' || e.type === 'sem-armas') && e.id) { const r = row(id ?? 'fora-do-vale'); r.refused++; r.why = e.type === 'sem-armas' ? 'sem-armas' : e.why; }
    }
    if (pre.lim && pre.id) Object.assign(row(pre.id), { limit: pre.lim.limit, byPosture: pre.lim.byPosture, avail: pre.lim.avail });
    for (const l of lost) for (const [k, n] of Object.entries(l.out)) {
      row(k)[l.grieve ? 'lossBattle' : 'lossOther'] += n; gains[l.grieve ? 'lossBattle' : 'lossOther'] += n;
    }
    for (const r of Object.values(by)) if (r.village in s.communities) r.trust = s.communities[r.village].trust;
    for (const id of COMMUNITY_IDS) if (s.communities[id].trust !== pre.trust[id] && !by[id]) row(id).trust = s.communities[id].trust;   // só a confiança mudou
    rows.push(...Object.values(by));
  };
  while (flow.phase !== 'fim' && guard++ < MAX_STEPS) {
    if (flow.phase === 'batalha') {
      diag.loss = [];
      const preB = { trust: snapshot() };
      const { type } = flow.battle;
      const m0 = s.men;
      const evB = finishBalanceBattle(flow, fight(flow.battle, rng).result);
      const battleLosses = diag.loss;
      diag.loss = null;
      if (evB.refused || flow.phase === 'batalha') {
        throw new Error(`Resultado recusado no dia ${s.day} (${type}, semente ${seed}, robô ${bot}, contramedidas ${!off})`);
      }
      types[type] = (types[type] || 0) + 1;
      if (type === 'emboscada' || type === 'assalto-coluna') tally.ambushes++;
      record(s.day, preB, evB.events, battleLosses);
      losses.push({ day: s.day, batalha: m0 - s.men, fome: 0 });
      tally.lostInBattle += Math.max(0, m0 - s.men); eq.bat += Math.max(0, m0 - s.men);
      continue;
    }
    const o = policy(s, mem);
    if (s.arms > 0 && s.day - mem.lastRecruit >= 10) for (const id of COMMUNITY_IDS) {   // o robô quer recrutar: quem estaria fechado hoje, e porquê
      const l = recruitLimit(s.communities[id], s.arms);
      if (l.limit === 0) rows.push({ bot, off, seed, day: s.day, village: id, recruits: 0, refused: 0, why: '', closed: l.why, limit: 0, byPosture: l.byPosture, avail: l.avail, lossBattle: 0, lossOther: 0, trust: s.communities[id].trust });
    }
    const cm = o.kind === 'recrutar' ? communityAt(s, o.id) : null;
    const pre = { trust: snapshot(), id: cm?.id, lim: cm ? recruitLimit(cm, s.arms) : null };
    diag.loss = [];
    const day0 = s.day;
    let { events, refused } = flow.order(o);
    // uma ordem recusada já não gasta o dia: o robô fica nesse dia acampado, como antes acontecia
    if (refused) events = [...events, ...flow.order({ kind: 'acampar' }).events];
    record(day0, pre, events, diag.loss); diag.loss = null;
    if (process.env.TRACE == seed) console.log(s.day, o.kind, o.id || '', `men ${s.men} food ${s.food} arms ${s.arms} fame ${s.fame}`, s.praetor ? `pd ${Math.round(dist(s.praetor, s.party))}` : '', events.map(e => e.type).join(','));
    for (const e of events) {
      if (e.type === 'fome') { losses.push({ day: s.day, fome: e.mortos, batalha: 0 }); eq.fome += e.mortos; }
      if (e.type === 'recrutou') eq.rec += e.men;
      if (e.type === 'ajuda') eq.help += e.men;
      if (e.type === 'emboscada-descoberta') tally.spotted++;
      if (e.type === 'doutrina' && e.on) tally.counters[e.id] = (tally.counters[e.id] || 0) + 1;
      if (e.type === 'cacadores') tally.hunters++;
    }
    if (s.day <= 30) burnt30 = Object.values(s.villages).filter(v => v.burnt).length;
  }
  if (flow.phase !== 'fim') throw new Error(`Campanha sem desfecho após ${MAX_STEPS} passos (dia ${s.day}, semente ${seed}, robô ${bot}, contramedidas ${!off})`);
  const burnt = Object.values(s.villages).filter(v => v.burnt).length;
  const recent = losses.filter(l => l.day > s.day - 30), sum = k => recent.reduce((a, l) => a + Math.max(0, l[k]), 0);
  const cause = s.over === 'vitoria' ? (s.decisivaWon ? 'decisiva' : 'ano')
    : s.day >= YEAR_DAYS ? 'ano' : s.fame <= 0 ? 'fama' : sum('fome') > sum('batalha') ? 'fome' : 'homens';
  return { seed, days: Math.min(s.day, YEAR_DAYS), battles: s.battles || 0, result: s.over, cause, burnt, burnt30, men: s.men, fame: s.fame, types, ...tally, rows, gains, eq,
    trustEnd: Object.fromEntries(COMMUNITY_IDS.map(id => [id, s.communities[id].trust])), away: Object.fromEntries(COMMUNITY_IDS.map(id => [id, s.communities[id].away])) };
}

const pad = (v, n) => String(v).padStart(n);
const med = a => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const perSeed = rows => {
  console.log('seed  dias  bat  resultado  causa     queimadas(d30/fim)  homens  fama  tipos');
  for (const r of rows) console.log(`${pad(r.seed, 4)}  ${pad(r.days, 4)}  ${pad(r.battles, 3)}  ${r.result.padEnd(9)}  ${r.cause.padEnd(8)}  ${pad(r.burnt30, 9)}/${pad(r.burnt, 2)}       ${pad(r.men, 6)}  ${pad(r.fame, 4)}  ${Object.entries(r.types).map(([k, v]) => `${k}:${v}`).join(' ')}`);
};
const summary = rows => {
  const won = rows.filter(r => r.result === 'vitoria').length, inBand = rows.filter(r => r.battles >= 12 && r.battles <= 25).length;
  const causes = {}; for (const r of rows.filter(r => r.result === 'derrota')) causes[r.cause] = (causes[r.cause] || 0) + 1;
  return { won, inBand, causes, medBattles: med(rows.map(r => r.battles)), medDays: med(rows.map(r => r.days)),
    burnt30: Math.max(...rows.map(r => r.burnt30)), medBurnt30: med(rows.map(r => r.burnt30)),
    lossPerBattle: mean(rows.map(r => r.lostInBattle / Math.max(1, r.battles))), ambushShare: mean(rows.map(r => r.ambushes / Math.max(1, r.battles))),
    spotted: mean(rows.map(r => r.spotted)), hunters: mean(rows.map(r => r.hunters)), menEnd: mean(rows.map(r => r.men)),
    counters: Object.fromEntries(['batedores', 'escolta', 'forca', 'guarnicao', 'cacadores'].map(id => [id, rows.filter(r => r.counters[id]).length])) };
};

const seeds = Array.from({ length: SEEDS }, (_, i) => i + 1);
const runs = {};
for (const bot of Object.keys(BOTS)) for (const off of [false, true]) runs[`${bot}${off ? ' (sem contramedidas)' : ''}`] = seeds.map(seed => play(seed, bot, off));

// 1) a tabela da spec (robô «atual», com as contramedidas)
perSeed(runs.atual);
const a = summary(runs.atual);
console.log(`\nResumo (${SEEDS} sementes): vitórias ${a.won}/${SEEDS} (decisiva ${runs.atual.filter(r => r.cause === 'decisiva').length}, ano ${runs.atual.filter(r => r.result === 'vitoria' && r.cause === 'ano').length})`
  + ` · batalhas 12–25 em ${a.inBand}/${SEEDS} (mediana ${a.medBattles})`
  + ` · dias (mediana) ${a.medDays} · derrotas por causa ${JSON.stringify(a.causes)}`
  + ` · aldeias queimadas até ao dia 30: máx ${a.burnt30}, mediana ${a.medBurnt30}`);
if (process.env.VERBOSE) for (const [k, rows] of Object.entries(runs)) { console.log(`\n== ${k}`); perSeed(rows); }

// 2) Roma aprende: os três robôs, com e sem contramedidas
console.log('\nRoma aprende — robôs com e sem contramedidas (médias por ano)');
console.log('«sem contramedidas»: state.doctrine.off; a pressão romana (intervalos e reforços) mantém-se. Não é a versão anterior do jogo.');
console.log('robô                            vitórias  dias(med)  batalhas(med)  emboscadas%  descobertas  baixas/batalha  homens no fim  caçadores  anos com: batedores escolta força guarnição caçadores');
for (const [k, rows] of Object.entries(runs)) {
  const m = summary(rows), c = m.counters;
  console.log(`${k.padEnd(31)} ${pad(`${m.won}/${SEEDS}`, 8)}  ${pad(m.medDays, 9)}  ${pad(m.medBattles, 13)}  ${pad((100 * m.ambushShare).toFixed(0) + '%', 11)}  ${pad(m.spotted.toFixed(1), 11)}  ${pad(m.lossPerBattle.toFixed(2), 14)}  ${pad(m.menEnd.toFixed(1), 13)}  ${pad(m.hunters.toFixed(1), 9)}  ${pad(c.batedores, 19)} ${pad(c.escolta, 7)} ${pad(c.forca, 5)} ${pad(c.guarnicao, 9)} ${pad(c.cacadores, 9)}`);
}

// 3) diagnóstico de recrutamento: porque é que o bando chega ao fim com os homens que chega
const COLS = ['bot', 'off', 'seed', 'day', 'village', 'recruits', 'refused', 'why', 'closed', 'limit', 'byPosture', 'avail', 'lossBattle', 'lossOther', 'trust'];
const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
function diagnostics(botRuns) {
  const out = [];
  for (const [name, rows] of Object.entries(botRuns)) {
    const R = rows.flatMap(r => r.rows), n = rows.length, sum = (f, xs = R) => xs.reduce((t, x) => t + f(x), 0);
    const g = k => mean(rows.map(r => r.gains[k]));
    out.push(`### ${name} (${n} jogos; médias por jogo)`, '',
      `Homens: 14 iniciais + ${f1(mean(rows.map(r => r.eq.rec)))} recrutados − ${f1(mean(rows.map(r => r.eq.bat)))} mortos em batalha − ${f1(mean(rows.map(r => r.eq.fome)))} de fome + ${f1(mean(rows.map(r => r.men - (14 + r.eq.rec - r.eq.bat - r.eq.fome))))} (ajuda dos castros ${f1(mean(rows.map(r => r.eq.help)))}, voluntários e traidores) = ${f1(mean(rows.map(r => r.men)))} no fim.`, '',
      '| aldeia | visitas c/ recrutas | recrutas | dias fechada quando o robô quis recrutar (postura/jovens/sem-armas) | limite efetivo médio nas visitas | baixas (batalha/outras) | confiança final |', '|---|---|---|---|---|---|---|');
    for (const id of [...COMMUNITY_IDS, 'sem']) {
      const A = R.filter(x => x.village === id), v = A.filter(x => x.recruits > 0), why = w => A.filter(x => x.closed === w).length / n;
      const lim = A.filter(x => x.limit !== '' && x.recruits > 0);
      out.push(`| ${id === 'sem' ? 'sem aldeia (bando inicial, ajudas)' : id} | ${f1(v.length / n)} | ${f1(sum(x => x.recruits, A) / n)} | ${f1(why('postura'))}/${f1(why('jovens'))}/${f1(why('sem-armas'))} | ${lim.length ? f1(mean(lim.map(x => x.limit))) : '—'} | ${f1(sum(x => x.lossBattle, A) / n)}/${f1(sum(x => x.lossOther, A) / n)} | ${id === 'sem' ? '—' : f1(mean(rows.map(r => r.trustEnd[id])))} |`);
    }
    out.push('');
  }
  return out.join('\n');
}
const botRuns = { 'atual': runs.atual, 'repetidor': runs.repetidor, 'variado': runs.variado };
const report = diagnostics(botRuns);
console.log('\nDiagnóstico de recrutamento (ver BALANCE_DIAG=<pasta> para as linhas por aldeia e dia)\n\n' + report);
if (process.env.BALANCE_DIAG) {
  const dir = process.env.BALANCE_DIAG; mkdirSync(dir, { recursive: true });
  const all = Object.values(runs).flat().flatMap(r => r.rows);
  writeFileSync(`${dir}/recrutamento-dias.csv`, [COLS.join(','), ...all.map(r => COLS.map(c => r[c]).join(','))].join('\n') + '\n');
  writeFileSync(`${dir}/recrutamento-resumo.md`, `# Diagnóstico de recrutamento (${SEEDS} sementes)\n\n${report}\n`);
  console.log(`\nEscrito em ${dir}/: recrutamento-dias.csv (${all.length} linhas) e recrutamento-resumo.md`);
}
