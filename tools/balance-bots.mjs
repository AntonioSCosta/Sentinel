// Os robôs do equilíbrio (tabela da spec, secção 9), partilhados por tools/balance.mjs e tools/balance-captains.mjs:
// quem joga é sempre a mesma política, para que as comparações isolem o que se muda. Só a camada pura (sem DOM nem Three.js).
import { foodPerDay } from '../src/campaign/state.js';
import { COMMUNITY_IDS, recruitLimit } from '../src/campaign/communities.js';
import { HELP_GAP } from '../src/campaign/simulation.js';
import { ensureDoctrine, sectorOf, SECTORS } from '../src/campaign/doctrine.js';

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const nearest = (list, p) => list.reduce((b, s) => (!b || dist(s, p) < dist(b, p) ? s : b), null);
// Vantagem por tipo: na emboscada e no assalto à coluna é o bando que escolhe o sítio; Viriato vale uns quantos homens.
const EDGE = { emboscada: 1.8, 'assalto-coluna': 1.6, 'defesa-aldeia': 1.2, 'campo-aberto': 1, decisiva: 1, historica: 1.3 };
const VIRIATO = 4;
export const FLEE = 80;   // a esta distância o pretor apanha o bando em dois ou três dias
export const MAX_STEPS = 2000;

/** Probabilidade de vitória (Lanchester ao quadrado) e um resultado sorteado com baixas proporcionais. */
export function fight(spec, rng) {
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

export const BOTS = { atual, repetidor, variado };
