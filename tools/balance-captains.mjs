// Equilíbrio dos capitães (fase D.1): joga anos inteiros com a MESMA política dos robôs de tools/balance-bots.mjs e acrescenta
// só as decisões sobre capitães de três perfis de jogador. Só a camada pura (sem DOM nem Three.js); determinista.
//
//   node tools/balance-captains.mjs [--seeds=200] [--bot=atual|variado] [--profiles=negligente,pragmatico,estrategico,sem]
//        [--label=capitaes] [--out=pasta] [--teams] [--traits] [--whatif=fome,batedor,...]
//
// Perfis (comportamento estratégico igual: ordens, recrutamento de homens, fuga ao pretor, defesa de aldeias):
//   sem          nenhum capitão (state.captains = []): o mesmo código, sem a funcionalidade. Tem de coincidir com o `main`.
//   negligente   ignora as decisões dos capitães: não escolhe traços, não responde a crises, não recruta capitães, não gere a reserva.
//   pragmatico   responde às crises conforme os recursos, escolhe o traço que a situação pede, recruta se passar por uma comunidade.
//   estrategico  além disso escolhe traços complementares, gere ativos e reserva, e faz um desvio para recrutar um capitão.
// Ninguém lê o que o jogador não vê: só o estado que a interface mostra (homens, comida, armas, fama, capitães, comunidades) e os
// eventos do Diário. (A política base dos robôs lê a posição real do pretor para fugir; é igual em todos os perfis e no `main`.)
// Limites dos robôs, que o relatório repete: nunca recusam o combate nem fogem, nunca reconhecem e não usam relatos de aldeias.
import { createFlow } from '../src/campaign/flow.js';
import { YEAR_DAYS } from '../src/campaign/clock.js';
import { foodPerDay } from '../src/campaign/state.js';
import { makeRng } from '../src/campaign/rng.js';
import { COMMUNITY_IDS } from '../src/campaign/communities.js';
import { REACH } from '../src/campaign/simulation.js';
import { ensureDoctrine } from '../src/campaign/doctrine.js';
import { intelView } from '../src/campaign/intel.js';
import { finishBalanceBattle } from './balance-battle.mjs';
import { BOTS, dist, nearest, fight, MAX_STEPS } from './balance-bots.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const CAP = await import('../src/campaign/captains-data.js').catch(() => null);   // o `main` não tem capitães
const CAPFN = CAP ? await import('../src/campaign/captains.js') : null;
const RULES = CAP?.RULES, ARCH = CAP?.ARCHETYPES ?? {}, TRAITS = CAP?.TRAITS ?? {}, SCARS = CAP?.SCARS ?? {};
const foodDays = s => Math.floor(s.food / foodPerDay(s.men));
const R = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

// ——— política de capitães de cada perfil ———

/** Estimativa do agente do que um arquétipo vale agora (0–3). É uma heurística de jogador, não uma verdade do jogo. */
const ARCH_VALUE = {
  batedor: () => 1,                       // informação: os robôs não reconhecem, o agente não a sabe usar
  fundibulario: () => 2.5,                // as emboscadas são a tática deste agente
  ferreiro: (s, m) => (s.arms < 12 ? 3 : 1.5),
  saqueador: (s, m) => (foodDays(s) < 20 || s.arms < 12 ? 3 : 2),
  incendiario: () => 1,                   // chama Roma
  veterano: () => 2,
};
/** Valor do traço na situação (o que um jogador atento veria); os robôs não recusam combate nem usam relatos, por isso esses valem 0. */
const TRAIT_VALUE = {
  'duro-de-roer': s => (s.men < 20 ? 3 : 2),
  'olho-no-ouro': s => (foodDays(s) < 25 ? 3 : 2),
  'ladrao-de-galinhas': (s, m) => (m.hunger > 0 || foodDays(s) < 15 ? 3 : 1),
  'emboscador-nato': (s, m) => (m.spotted > 0 ? 3 : 1),
  'conhecedor-dos-trilhos': () => 0,
  vingativo: (s, m) => (m.burnt > 0 ? 2 : 0.5),
  'olhos-de-coruja': () => 0,
  'querido-do-povo': s => (s.men < 25 ? 2 : 1),
};
const EFFECT = { 'olho-no-ouro': 'loot', 'emboscador-nato': 'ambushKeep', 'duro-de-roer': 'lossKeep', 'ladrao-de-galinhas': 'famineSave' };
const ARCH_EFFECT = { saqueador: ['loot'], fundibulario: ['ambushKeep'] };
const covered = (c, team, trait) => EFFECT[trait] && team.some(x => x !== c && (ARCH_EFFECT[x.archetype]?.includes(EFFECT[trait]) || x.traits.some(t => EFFECT[t] === EFFECT[trait])));

const pragmaticTrait = (s, m, c, options) => options.reduce((best, t) => (!best || TRAIT_VALUE[t](s, m) > TRAIT_VALUE[best](s, m) ? t : best), null);
function strategicTrait(s, m, c, options) {
  const score = t => {
    let v = TRAIT_VALUE[t](s, m);
    if (covered(c, s.captains, t)) v *= 0.2;                                                     // o mesmo efeito não soma
    const cost = { 'olho-no-ouro': 'famine', 'emboscador-nato': 'openBattle' }[t];               // custo que este capitão já sente
    if (cost && ARCH[c.archetype].loyal?.[cost] < 0) v *= 0.5;
    return v + ({ comum: 0, incomum: 0.1, rara: 0.2 }[TRAITS[t].rarity] ?? 0);
  };
  return options.reduce((best, t) => (!best || score(t) > score(best) ? t : best), null);
}
const value = (s, c) => ARCH_VALUE[c.archetype](s) + 0.5 * (c.level - 1) + 0.3 * c.traits.length;
const canShare = s => s.food - RULES.loyalty.share.food >= foodPerDay(s.men) * 8 && s.arms >= RULES.loyalty.share.arms;
const canRecruit = (s, extra = 0) => s.food >= RULES.recruit.food + foodPerDay(s.men) * 15 + extra && s.arms >= RULES.recruit.arms + 6;

/** Escolhe e executa as decisões do perfil sobre os capitães; nenhuma gasta o dia. Devolve os eventos que as ordens deram. */
function manage(profile, flow, mem, fixed = false) {
  if (profile === 'negligente' || profile === 'sem' || !CAPFN) return [];
  const s = flow.state, out = [], strategic = profile === 'estrategico';
  const run = r => { if (r.ok) out.push(...r.events); return r; };
  const pick = strategic ? strategicTrait : pragmaticTrait;
  for (const c of [...s.captains]) {
    if (c.offer) {
      const key = `${c.id}:${c.lastCard}`;
      if (!mem.offered.has(key)) { mem.offered.add(key); for (const t of c.offer.options) mem.cap.offered[t] = (mem.cap.offered[t] || 0) + 1; }
      const card = pick(s, mem, c, c.offer.options);
      if (card) { run(flow.chooseCard(c.id, card)); mem.cap.chosen[card] = (mem.cap.chosen[card] || 0) + 1; }
    }
    if (c.crisis) {
      const pay = canShare(s) && (!strategic || value(s, c) >= 1.5);
      if (run(flow.answerCrisis(c.id, pay ? 'parte' : 'partir')).ok) mem.cap[pay ? 'paid' : 'letGo']++;
    }
  }
  if (s.captainOffer) { mem.cap.desertorSeen += 1; if (!fixed && s.captains.length < RULES.max && run(flow.answerDeserter(true)).ok) mem.cap.desertorAccepted++; else flow.answerDeserter(false); }
  // recrutar um capitão se o bando está ao pé de uma comunidade que o dá (e, no estratégico, vale a pena)
  if (!fixed && s.captains.length < RULES.max && canRecruit(s)) for (const id of COMMUNITY_IDS) {
    const k = CAPFN.captainAt(s, id, { inReach: dist(s.world.settlements.find(p => p.id === s.communities[id].settlement), s.party) <= REACH });
    if (k.why || (strategic && ARCH_VALUE[k.archetype](s) < 1.5)) continue;
    if (run(flow.recruitCaptain(s.communities[id].settlement)).ok) break;
  }
  if (strategic && s.day - mem.lastReserve >= 5) { mem.lastReserve = s.day; reserve(flow, mem); }
  return out;
}

/** Estratégico: os três de maior valor e lealdade ficam ativos; quem está a perder lealdade descansa na reserva. */
function reserve(flow, mem) {
  const s = flow.state, rank = c => value(s, c) + (c.loyalty - 50) / 20 - (c.crisis ? 3 : 0);
  const best = [...s.captains].sort((a, b) => rank(b) - rank(a)).slice(0, RULES.active);
  for (const c of s.captains) if (c.active && !best.includes(c)) { flow.setCaptainActive(c.id, false); mem.cap.swaps++; }
  for (const c of best) if (!c.active) { flow.setCaptainActive(c.id, true); mem.cap.swaps++; }
}

/** Estratégico: com lugar livre e provisões, faz um desvio até uma comunidade que lhe dê um capitão (só sem forças à vista). */
function detour(profile, s, mem, o) {
  if (profile !== 'estrategico' || !CAPFN || s.captains.length >= RULES.max || !canRecruit(s, 10) || s.day < 5 || s.day - mem.lastDetour < 12) return o;
  if (intelView(s).forces.some(f => f.status === 'confirmada' && dist(f, s.party) < 100)) return o;
  const spots = COMMUNITY_IDS.filter(id => { const k = CAPFN.captainAt(s, id); return !k.why && ARCH_VALUE[k.archetype](s) >= 1.5; })
    .map(id => s.world.settlements.find(p => p.id === s.communities[id].settlement)).filter(p => dist(p, s.party) < 260);
  const to = nearest(spots, s.party);
  if (!to) return o;
  mem.lastDetour = s.day;
  return { kind: 'marchar', to: { x: to.x, y: to.y } };
}

// ——— cenários what-if: alterações de valores SÓ em memória (o repositório não muda), para avaliar propostas de afinação ———
/** Cada cenário muda uma ou mais constantes de captains-data.js durante este processo e descreve o porquê. */
export const WHATIF = {
  antes: { why: 'os valores de antes da fase D.2: fome Saqueador −3, Ferreiro −2, Olho no Ouro −4 e deserção sem limite (leva o nível)', apply() {
    ARCH.saqueador.loyal.famine = -3; ARCH.ferreiro.loyal.famine = -2; TRAITS['olho-no-ouro'].loyal.famine = -4;
    RULES.loyalty.desert = { share: 10, max: 99 }; } },
  fome: { why: 'já consolidado na D.2 (a fome tira menos lealdade); aplicar outra vez não muda nada', apply() {
    ARCH.saqueador.loyal.famine = -1; ARCH.ferreiro.loyal.famine = -1; TRAITS['olho-no-ouro'].loyal.famine = -2; } },
  semlimite: { why: 'só a deserção sem limite (como antes da D.2), com a fome já afinada', apply() { RULES.loyalty.desert = { share: 10, max: 99 }; } },
  batedor: { why: 'o Batedor irrita-se menos com o campo aberto (−4→−2) e ganha mais com um reconhecimento útil (+2→+3)', apply() {
    ARCH.batedor.loyal.openBattle = -2; ARCH.batedor.loyal.reconFound = 3; } },
  armas: { why: 'o Ferreiro sente menos as armas perdidas num acontecimento que não controla (−3→−1)', apply() { ARCH.ferreiro.loyal.armsLost = -1; } },
  prazo: { why: 'a crise dá 6 dias em vez de 3, e a parte custa menos (comida 8→5, armas 3→2)', apply() {
    RULES.loyalty.crisisDays = 6; RULES.loyalty.share = { ...RULES.loyalty.share, food: 5, arms: 2 }; } },
  emboscador: { why: 'o Emboscador Nato deixa de perder lealdade no campo aberto (−2→0) e descobre-se menos (×0,75→×0,6)', apply() {
    delete TRAITS['emboscador-nato'].loyal; TRAITS['emboscador-nato'].fx.ambushKeep = 0.6; } },
  coruja: { why: 'Olhos de Coruja: relatos 2 dias mais cedo (1→2) e as vigias comem 1 de comida a cada 14 dias em vez de 7', apply() {
    TRAITS['olhos-de-coruja'].fx.reportsFaster = 2; TRAITS['olhos-de-coruja'].fx.watchFood = { every: 14, food: 1 }; } },
};
WHATIF.veterano3d = { why: 'o motor 3D só converte o bónus em +2% de vida e dano por homem (forceMultipliers): +2 de bónus valem ~0,6 homens, não os 2 que o robô conta', apply() {
  ARCH.veterano.fx.legacyBonus = 0.6; } };
WHATIF.pacote = { why: 'batedor, armas, prazo, emboscador e coruja juntos (propostos e NÃO aprovados)', apply() { for (const k of Object.keys(WHATIF)) if (!['pacote', 'veterano3d', 'antes', 'fome', 'semlimite'].includes(k)) WHATIF[k].apply(); } };

// ——— um jogo ———

function setTeam(s, team) {
  s.captains = team.map(([archetype, traits = []], i) => ({ id: `cap-${i + 1}`, name: `Capitão ${i + 1}`, archetype, level: 1, xp: 0,
    loyalty: ARCH[archetype].loyalty ?? RULES.loyalty.start, traits: [...traits], activeSkill: ARCH[archetype].skill, active: i < RULES.active }));
  s.captainSeq = team.length;
}

/**
 * Joga uma campanha. `team` (opcional) substitui os capitães iniciais: [[arquétipo, [traços]], …].
 * `fixed`: a equipa não muda (sem recrutar nem aceitar o desertor), para as experiências controladas.
 * @returns {object} o registo do jogo (resultado, recursos, aldeias e tudo o que os capitães fizeram)
 */
export function play(seed, { bot = 'atual', profile = 'negligente', team = null, fixed = false } = {}) {
  let saved = null;
  const storage = { getItem: () => saved, setItem: (_key, value) => { saved = value; } };
  const flow = createFlow({ seed, storage }), s = flow.state, rng = makeRng(seed * 101 + 7);
  ensureDoctrine(s).off = false;
  if (team && CAP) setTeam(s, team);
  if (profile === 'sem' && CAP) s.captains = [];
  const policy = BOTS[bot], mem = { lastRecruit: -99, lastReserve: -99, lastDetour: -99, hunger: 0, burnt: 0, spotted: 0, offered: new Set(), sigs: new Set(),
    cap: { recruited: 0, levelUps: 0, crises: 0, calmed: 0, deserted: 0, betrayed: 0, letGo: 0, paid: 0, menLostDesertion: 0, scars: 0, swaps: 0, desertorSeen: 0,
      desertorAccepted: 0, levelDays: {}, loyBy: {}, crisisBy: {}, lostBy: {}, saqueFood: 0, saqueArms: 0, forja: 0, encoberta: 0, chosen: {}, offered: {}, firstCrisis: null, firstLoss: null, menAtFirstLoss: null } };
  const cap = mem.cap, seen = {}, samples = { n: 0, men: 0, food: 0, arms: 0, trust: 0, captains: 0, reserve: 0, active: 0 };
  const opp = { lowFoodDays: 0, hungerDays: 0, villageDead: 0 };   // oportunidades de cada efeito: quantas vezes a situação que o ativa acontece
  const types = {}, losses = [];   // { day, fome, batalha, desercao }: homens perdidos, para atribuir a causa da ruína
  const tally = events => {
    for (const e of events) {
      if (e.type === 'fome') { opp.hungerDays++; mem.hunger++; losses.push({ day: s.day, fome: e.mortos, batalha: 0, desercao: 0 }); }
      if (e.type === 'aldeia-queimada') mem.burnt++;
      if (e.type === 'emboscada-descoberta') mem.spotted++;
      if (e.type !== 'capitao') continue;
      const w = e.what;
      if (w === 'juntou') cap.recruited++;
      if (w === 'nivel') { cap.levelUps++; (cap.levelDays[e.level] ??= []).push(s.day); }
      if (w === 'crise') { cap.crises++; cap.firstCrisis ??= s.day; const a = seen[e.id]?.archetype ?? '?'; cap.crisisBy[a] = (cap.crisisBy[a] || 0) + 1; }
      if (w === 'acalmou') cap.calmed++;
      if (w === 'cicatriz') cap.scars++;
      if (w === 'saque') { cap.saqueFood += e.food; cap.saqueArms += e.arms; }
      if (w === 'forja') cap.forja += e.arms;
      if (w === 'encoberta') cap.encoberta++;
      if (['desertou', 'traiu', 'partiu'].includes(w)) {
        if (w === 'desertou') cap.deserted++; else if (w === 'traiu') cap.betrayed++;
        { const a = e.archetype ?? seen[e.id]?.archetype ?? '?'; cap.lostBy[`${a}:${w}`] = (cap.lostBy[`${a}:${w}`] || 0) + 1; }
        cap.menLostDesertion += e.men ?? 0; losses.push({ day: s.day, fome: 0, batalha: 0, desercao: e.men ?? 0 });
        cap.firstLoss ??= s.day; cap.menAtFirstLoss ??= s.men;
      }
    }
  };
  const remember = () => {
    for (const c of s.captains ?? []) for (const n of c.notes ?? []) {   // de onde vem e para onde vai a lealdade: cada nota nova, por arquétipo e causa
      const sig = `${c.id}|${n.day}|${n.why}|${n.d}`;
      if (mem.sigs.has(sig)) continue;
      mem.sigs.add(sig);
      const k = `${c.archetype}:${n.why}`, e = (cap.loyBy[k] ??= { n: 0, sum: 0 });
      e.n++; e.sum += n.d;
    }
    for (const c of s.captains ?? []) seen[c.id] = { archetype: c.archetype, level: c.level, xp: c.xp, loyalty: c.loyalty, traits: [...c.traits], active: c.active }; };
  let guard = 0;
  while (flow.phase !== 'fim' && guard++ < MAX_STEPS) {
    if (flow.phase === 'batalha') {
      const { type } = flow.battle, m0 = s.men, a0 = CAPFN ? CAPFN.awayOf(s) : 0;
      const evB = finishBalanceBattle(flow, fight(flow.battle, rng).result);
      if (evB.refused || flow.phase === 'batalha') throw new Error(`Resultado recusado no dia ${s.day} (${type}, semente ${seed}, perfil ${profile})`);
      types[type] = (types[type] || 0) + 1;
      losses.push({ day: s.day, fome: 0, batalha: m0 - s.men, desercao: 0 });
      if (CAPFN) opp.villageDead += Math.max(0, a0 - CAPFN.awayOf(s));
      tally(evB.events); remember();
      continue;
    }
    if (foodPerDay(s.men) > 1 && foodDays(s) < 3) opp.lowFoodDays++;
    samples.n++; samples.men += s.men; samples.food += s.food; samples.arms += s.arms;
    samples.trust += COMMUNITY_IDS.reduce((n, id) => n + s.communities[id].trust, 0) / COMMUNITY_IDS.length;
    if (s.captains) { samples.captains += s.captains.length; samples.reserve += s.captains.filter(c => !c.active).length; samples.active += s.captains.filter(c => c.active).length; }
    remember();
    tally(manage(profile, flow, mem, fixed));
    let o = policy(s, mem);
    o = detour(profile, s, mem, o);
    let { events, refused } = flow.order(o);
    if (refused) events = [...events, ...flow.order({ kind: 'acampar' }).events];
    tally(events); remember();
  }
  if (flow.phase !== 'fim') throw new Error(`Campanha sem desfecho (dia ${s.day}, semente ${seed}, perfil ${profile})`);
  const recent = losses.filter(l => l.day > s.day - 30), sum = k => recent.reduce((a, l) => a + Math.max(0, l[k]), 0);   // como em balance.mjs, mais a deserção
  const cause = s.over === 'vitoria' ? (s.decisivaWon ? 'decisiva' : 'ano')
    : s.day >= YEAR_DAYS ? 'ano' : s.fame <= 0 ? 'fama' : sum('desercao') > Math.max(sum('fome'), sum('batalha')) ? 'desercao' : sum('fome') > sum('batalha') ? 'fome' : 'homens';
  const endCaps = (s.captains ?? []).map(c => ({ archetype: c.archetype, level: c.level, loyalty: c.loyalty, traits: [...c.traits], active: c.active }));
  const n = Math.max(1, samples.n);
  return { seed, profile, bot, result: s.over, cause, days: Math.min(s.day, YEAR_DAYS), battles: s.battles || 0, types,
    men: s.men, food: s.food, arms: s.arms, fame: s.fame, avgMen: samples.men / n, avgFood: samples.food / n, avgArms: samples.arms / n,
    trustEnd: Object.fromEntries(COMMUNITY_IDS.map(id => [id, s.communities[id].trust])), trustAvg: samples.trust / n,
    burnt: Object.values(s.villages).filter(v => v.burnt).length, opp: { ...opp, spotted: mem.spotted, ambushes: types.emboscada || 0, columns: types['assalto-coluna'] || 0, open: types['campo-aberto'] || 0, decisive: types.decisiva || 0, defense: types['defesa-aldeia'] || 0 },
    cap: { ...cap, endCaptains: endCaps, everArch: [...new Set(Object.values(seen).map(c => c.archetype))],
      levelsEnd: endCaps.reduce((a, c) => a + c.level, 0), maxLevel: Math.max(1, ...Object.values(seen).map(c => c.level)),
      avgCaptains: samples.captains / n, reserveDays: samples.reserve, activeDays: samples.active },
    ever: seen };
}

// ——— estatística e relatório ———

const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const wilson = (k, n) => { const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; };
const pct = (k, n) => `${R(100 * k / n, 1)}% [${wilson(k, n).map(v => R(100 * v, 0)).join('–')}]`;

/** Resumo de um conjunto de jogos (as mesmas sementes). */
export function summarize(rows) {
  const n = rows.length, won = rows.filter(r => r.result === 'vitoria'), lost = rows.filter(r => r.result === 'derrota');
  const causes = {}; for (const r of lost) causes[r.cause] = (causes[r.cause] || 0) + 1;
  const sum = k => rows.reduce((a, r) => a + (r.cap[k] ?? 0), 0);
  const traits = (k) => rows.reduce((a, r) => { for (const [t, v] of Object.entries(r.cap[k])) a[t] = (a[t] || 0) + v; return a; }, {});
  const cr = rows.filter(r => r.cap.firstCrisis !== null);
  return { n, won: won.length, decisiva: won.filter(r => r.cause === 'decisiva').length, ano: won.filter(r => r.cause === 'ano').length, causes,
    men: mean(rows.map(r => r.men)), avgMen: mean(rows.map(r => r.avgMen)), food: mean(rows.map(r => r.food)), avgFood: mean(rows.map(r => r.avgFood)),
    arms: mean(rows.map(r => r.arms)), avgArms: mean(rows.map(r => r.avgArms)), fame: mean(rows.map(r => r.fame)), days: mean(rows.map(r => r.days)),
    recruited: sum('recruited') / n, maxLevel: mean(rows.map(r => r.cap.maxLevel)), levelUps: sum('levelUps') / n, levelsEnd: mean(rows.map(r => r.cap.levelsEnd)),
    crises: sum('crises') / n, gamesWithCrisis: cr.length, firstCrisis: mean(cr.map(r => r.cap.firstCrisis)), calmed: sum('calmed') / n,
    deserted: sum('deserted') / n, betrayed: sum('betrayed') / n, letGo: sum('letGo') / n, paid: sum('paid') / n, menLostDesertion: sum('menLostDesertion') / n,
    scars: sum('scars') / n, swaps: sum('swaps') / n, reserveShare: mean(rows.map(r => r.cap.reserveDays / Math.max(1, r.cap.reserveDays + r.cap.activeDays))),
    avgCaptains: mean(rows.map(r => r.cap.avgCaptains)), endCaptains: mean(rows.map(r => r.cap.endCaptains.length)),
    saqueFood: sum('saqueFood') / n, saqueArms: sum('saqueArms') / n, forja: sum('forja') / n, encoberta: sum('encoberta') / n,
    chosen: traits('chosen'), offered: traits('offered'), trustEnd: Object.fromEntries(COMMUNITY_IDS.map(id => [id, mean(rows.map(r => r.trustEnd[id]))])),
    trustAvg: mean(rows.map(r => r.trustAvg)), burnt: mean(rows.map(r => r.burnt)), battles: mean(rows.map(r => r.battles)) };
}

function argv() {
  const o = {};
  for (const a of process.argv.slice(2)) { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (m) o[m[1]] = m[2] ?? true; }
  return o;
}

function runMain() {
  const a = argv(), seeds = Array.from({ length: +(a.seeds || 100) }, (_, i) => i + 1), bot = a.bot || 'atual', label = a.label || 'capitaes';
  const profiles = (a.profiles || 'negligente,pragmatico,estrategico,sem').split(',');
  const out = a.out ? (mkdirSync(a.out, { recursive: true }), a.out) : null;
  for (const w of String(a.whatif || '').split(',').filter(Boolean)) { if (!WHATIF[w]) throw new Error(`cenário desconhecido: ${w}`); WHATIF[w].apply(); }
  const save = (name, rows) => out && writeFileSync(`${out}/${name}.json`, JSON.stringify(rows.map(({ ever, ...r }) => r)));
  for (const profile of profiles) {
    const rows = seeds.map(seed => play(seed, { bot, profile }));
    save(`${label}-${profile}-${bot}`, rows);
    const m = summarize(rows);
    console.log(`${label.padEnd(10)} ${profile.padEnd(12)} ${bot.padEnd(7)} vitórias ${pct(m.won, m.n)} (decisiva ${m.decisiva}, ano ${m.ano}) · causas ${JSON.stringify(m.causes)} · homens ${R(m.men)} · capitães recrutados ${R(m.recruited, 2)} · crises ${R(m.crises, 2)} · deserções ${R(m.deserted, 2)} · traições ${R(m.betrayed, 2)}`);
  }
  if (a.teams && CAP) {   // equipas forçadas: os 10 pares de arquétipos iniciais, sem recrutar mais (perfil pragmático)
    const starts = Object.keys(ARCH).filter(k => ARCH[k].start), pairs = [];
    for (let i = 0; i < starts.length; i++) for (let j = i + 1; j < starts.length; j++) pairs.push([starts[i], starts[j]]);
    const rows = [];
    for (const pair of pairs) for (const seed of seeds) rows.push({ ...play(seed, { bot, profile: 'pragmatico', team: pair.map(x => [x]), fixed: true }), pair: pair.join('+'), ever: undefined });
    save(`${label}-equipas-${bot}`, rows);
    console.log(`equipas forçadas: ${rows.length} jogos`);
  }
  if (a.traits && CAP) {   // traços: a equipa-tipo [saqueador, ferreiro] com e sem o traço no primeiro capitão (mesmas sementes)
    const rows = [];
    const variants = [['nenhum', null], ...Object.keys(TRAITS).map(t => [t, t])];
    for (const [name, t] of variants) for (const seed of seeds) {
      for (const pair of [['saqueador', 'ferreiro'], ['fundibulario', 'batedor'], ['incendiario', 'ferreiro']]) {
        const team = pair.map((x, i) => [x, i === 0 && t && !(TRAITS[t].not?.includes(x)) ? [t] : []]);
        rows.push({ ...play(seed, { bot, profile: 'pragmatico', team, fixed: true }), trait: name, pair: pair.join('+'), ever: undefined });
      }
    }
    save(`${label}-tracos-${bot}`, rows);
    console.log(`traços: ${rows.length} jogos`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runMain();
