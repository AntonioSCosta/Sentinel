// Protótipo M1 — uma partida: preparação → batalha (simulação + reação romana provisória) → relatório para o playtest.
// Puro (sem DOM nem Three.js): o ecrã só lê o estado e chama `tick`, `order` e `report`.
import { createBattle, command, step, summary, groupOf } from '../sim.js';
import { ROLES } from '../data.js';
import { createRomanStub } from './roman-stub.js';
import { BAND, COLUMN, EXITS, FIELD, ROAD, coverAt, concealAt, canPlace, nearestPlaceable, roadPoint } from './field.js';

/** Versão do protótipo, para os relatórios de playtest. */
export const PROTO_VERSION = 'm1-proto-1';

/** Colocação inicial do bando (cópia, para a preparação poder mexer). */
export const defaultPlacement = () => BAND.map(g => ({ ...g }));

/** Move um grupo na preparação para o ponto válido mais próximo de (x, y). */
export function placeGroup(placement, id, x, y) {
  const g = placement.find(p => p.id === id);
  if (!g) return false;
  const p = nearestPlaceable(x, y);
  g.x = p.x; g.y = p.y;
  return true;
}

/** Troca o papel de um grupo na preparação (guerreiros ⇄ fundeiros). */
export function toggleRole(placement, id) {
  const g = placement.find(p => p.id === id);
  if (!g) return false;
  g.role = g.role === 'guerreiro' ? 'fundeiro' : 'guerreiro';
  return true;
}

/** Um grupo nesta posição começa escondido (está em mato ou rocha, não em campo aberto). */
export const startsHidden = (x, y) => concealAt(x, y) > 0.5;

/** Progresso da coluna ao longo do campo, de 0 (entrada) a 1 (saída), pela vanguarda (ou quem ainda estiver). */
function columnProgress(battle) {
  const rom = battle.groups.filter(g => g.side === 'romanos' && g.left === null);
  if (!rom.length) return 1;
  return Math.max(0, Math.min(1, Math.max(...rom.map(g => g.x)) / FIELD.w));
}

/**
 * Cria a partida a partir da colocação feita na preparação.
 * Os grupos colocados em mato ou rocha começam escondidos; os outros estão à vista e a coluna pode vê-los.
 */
export function createSession({ seed, placement = defaultPlacement() }) {
  for (const p of placement) if (!canPlace(p.x, p.y)) throw new Error(`colocação inválida: ${p.id}`);
  const column = COLUMN.map(c => {
    const at = roadPoint(c.along);
    return { id: c.id, role: c.role, men: c.men, x: at.x, y: at.y, facing: at.facing,
      order: { type: 'mover', path: ROAD.filter(p => p.x > at.x + 1), pace: 'marcha', leave: true } };
  });
  const band = placement.map(p => ({ id: p.id, role: p.role, men: p.men, x: p.x, y: p.y, facing: p.y < 55 ? Math.PI / 2 : -Math.PI / 2, hidden: startsHidden(p.x, p.y) }));
  const battle = createBattle({ seed, groups: [...column, ...band], exits: EXITS, coverAt });
  const stub = createRomanStub();
  const stats = { orders: 0, refused: 0, signalAt: null, signalProgress: null, firstBloodAt: null, discovered: [], charges: 0, volleys: 0 };
  const placementLog = placement.map(p => ({ id: p.id, role: p.role, men: p.men, x: Math.round(p.x), y: Math.round(p.y), hidden: startsHidden(p.x, p.y) }));

  return {
    battle, seed, stats,
    /** Avança um passo (0,1 s) e devolve os acontecimentos da simulação e da reação romana. */
    tick() {
      if (battle.over) return [];
      const events = step(battle);
      events.push(...stub.update(battle));
      for (const e of events) {
        if (e.type === 'baixas' && stats.firstBloodAt === null) stats.firstBloodAt = battle.t;
        if (e.type === 'descoberto') stats.discovered.push({ group: e.group, t: battle.t });
        if (e.type === 'carga') stats.charges++;
        if (e.type === 'salva' && groupOf(battle, e.group)?.side === 'lusitanos') stats.volleys++;
      }
      return events;
    },
    /** Ordem do jogador (lado lusitano). Regista o momento do sinal e a posição da coluna nesse momento. */
    order(cmd) {
      const r = command(battle, 'lusitanos', cmd);
      if (!r.ok) { stats.refused++; return r; }
      if (cmd.type === 'sinal') { stats.signalAt = battle.t; stats.signalProgress = columnProgress(battle); } else stats.orders++;
      return r;
    },
    /** Progresso atual da coluna (0–1). */
    progress: () => columnProgress(battle),
    /** Relatório para o playtest: objeto e texto em inglês simples (copiável para a folha de registo). */
    report(meta = {}) {
      const s = summary(battle), lus = s.lusitanos, rom = s.romanos;
      const combat = stats.signalAt ?? stats.firstBloodAt;
      const data = {
        version: PROTO_VERSION, seed, outcome: s.outcome, time: s.t,
        signalAt: stats.signalAt, signalColumnProgress: stats.signalProgress === null ? null : Math.round(stats.signalProgress * 100) / 100,
        combatSeconds: combat === null ? 0 : Math.round((s.t - combat) * 10) / 10,
        orders: stats.orders, refusedOrders: stats.refused, charges: stats.charges, slingVolleys: stats.volleys,
        discovered: stats.discovered, placement: placementLog,
        lusitanians: lus, romans: rom, ...meta,
      };
      const pct = data.signalColumnProgress === null ? 'never' : `${data.signalAt}s (column at ${Math.round(data.signalColumnProgress * 100)}%)`;
      const text = [
        `Sentinel ambush prototype ${PROTO_VERSION} — seed ${seed}`,
        `Outcome: ${s.outcome} after ${s.t}s (combat ${data.combatSeconds}s)`,
        `Signal: ${pct}; orders after signal: ${data.orders}; charges: ${data.charges}; sling volleys: ${data.slingVolleys}`,
        `Your band: ${lus.start} men, ${lus.dead} dead, ${lus.fled} fled, ${lus.withdrawn} withdrew`,
        `Romans: ${rom.start} men, ${rom.dead} dead, ${rom.fled} fled, ${rom.escaped} escaped`,
        `Ambushers spotted early: ${stats.discovered.length ? stats.discovered.map(d => `${d.group} at ${d.t}s`).join(', ') : 'none'}`,
        `Placement: ${placementLog.map(p => `${p.id}(${p.role} ${p.men}) ${p.hidden ? 'hidden' : 'exposed'} @${p.x},${p.y}`).join('; ')}`,
      ].join('\n');
      return { data, text: `${text}\n\n${JSON.stringify(data)}` };
    },
  };
}

export { ROLES };
