// Protótipo M1 — uma partida: preparação → batalha (simulação + reação romana provisória) → relatório para o playtest.
// Puro (sem DOM nem Three.js): o ecrã só lê o estado e chama `tick`, `order` e `report`.
import { createBattle, command, step, summary, groupOf } from '../sim.js';
import { ROLES } from '../data.js';
import { routThreshold } from '../combat.js';
import { createRomanStub, spotRange } from './roman-stub.js';
import { EXITS, FIELD, coverAt, canPlace, nearestPlaceable } from './field.js';
import { defaultPlacement, startsHidden, columnVariant, marchingColumn, PROTO_VERSION } from './setup.js';
export { defaultPlacement, startsHidden, columnVariant, PROTO_VERSION } from './setup.js';

/** Segundos de jogo como «m:ss». */
export const clockText = secs => { const n = Math.max(0, Math.floor(secs)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };

/** Causa de uma descoberta, em inglês (relatório copiado; o ecrã usa o catálogo). */
const causeText = k => k.cause === 'open' ? `they were in the open (seen from ${k.d} m)`
  : k.cause === 'cover' ? `the column passed ${k.d} m from their cover` : 'an enemy walked into them';

/** Texto em inglês de um momento-chave, para o relatório copiado (o ecrã usa o catálogo de traduções). */
export function momentText(k) {
  const at = k.t === undefined ? '' : `${clockText(k.t)} — `;
  switch (k.code) {
    case 'noSignal': return `${at}You never gave the signal.`;
    case 'seen': return `${at}The column saw the ${k.group}: ${causeText(k)}. No surprise was possible after this.`;
    case 'signalLate': return `${at}Signal at ${k.percent}% of the column, but Rome was already on guard: no unit surprised.`;
    case 'signal': return `${at}Signal at ${k.percent}% of the column: ${k.count} Roman units caught by surprise.`;
    case 'woods': return `${at}The ${k.group} followed you into the woods and lost formation.`;
    case 'fallBack': return `${at}You pulled the ${k.group} back to the woods.`;
    case 'support': return `${at}The ${k.group} moved to support the ${k.ally}.`;
    case 'hold': return `${at}The ${k.group} halted to hold the road.`;
    case 'lost': return `${at}The ${k.group} broke${k.foes > 1 ? `, fighting ${k.foes} Roman units at once` : ''}.`;
    case 'romanBroke': return `${at}The ${k.group} broke${k.flanked ? ' after being attacked from the flank or rear' : k.foes > 1 ? ` under attack from ${k.foes} bands` : ''}.`;
    case 'escaped': return `${at}The column marched on: it was never forced to fight.`;
    default: return `${at}${k.code}`;
  }
}

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
export function createSession({ seed, placement = defaultPlacement(), column = marchingColumn(seed) }) {
  for (const p of placement) if (!canPlace(p.x, p.y)) throw new Error(`colocação inválida: ${p.id}`);
  const variant = columnVariant(seed);
  const band = placement.map(p => ({ id: p.id, role: p.role, men: p.men, x: p.x, y: p.y, facing: p.y < 55 ? Math.PI / 2 : -Math.PI / 2, hidden: startsHidden(p.x, p.y) }));
  const battle = createBattle({ seed, groups: [...column, ...band], exits: EXITS, coverAt });
  const stub = createRomanStub();
  const stats = { orders: 0, refused: 0, signalAt: null, signalProgress: null, signalSurprised: 0, firstBloodAt: null, discovered: [], charges: 0, volleys: 0,
    flanks: { lusitanos: 0, romanos: 0 }, fallBacks: 0, fallBackLog: [], broke: [], drawnIntoWoods: [], responses: [], seen: [], flankedOn: {} };
  const placementLog = placement.map(p => ({ id: p.id, role: p.role, men: p.men, x: Math.round(p.x), y: Math.round(p.y), hidden: startsHidden(p.x, p.y) }));

  /**
   * Os momentos que explicam o resultado (no máximo 5), por ordem cronológica, cada um com o tempo `t`.
   * Escolhem-se pela importância e mostram-se pela ordem em que aconteceram. Só entra o que a simulação registou:
   * quem viu quem e porquê, quando foi o sinal e quantos apanhou de surpresa, quem quebrou e contra quantos lutava.
   */
  function keyMoments(s) {
    const cands = [], first = type => stats.responses.find(r => r.type === type);
    const seen = stats.seen.find(x => stats.signalAt === null || x.t <= stats.signalAt);
    if (seen) cands.push({ p: 1, code: 'seen', t: seen.t, group: seen.group, cause: seen.cause, d: seen.d });
    if (stats.signalAt === null) cands.push({ p: 1, code: 'noSignal', t: s.t });
    else cands.push({ p: 1, code: stats.signalSurprised ? 'signal' : 'signalLate', t: stats.signalAt, percent: Math.round(stats.signalProgress * 100), count: stats.signalSurprised });
    const lost = stats.broke.find(b => b.side === 'lusitanos');
    if (lost) cands.push({ p: 2, code: 'lost', t: lost.t, group: lost.group, foes: lost.foes });
    const romanBroke = stats.broke.find(b => b.side === 'romanos');
    if (romanBroke) cands.push({ p: 2, code: 'romanBroke', t: romanBroke.t, group: romanBroke.group, foes: romanBroke.foes, flanked: !!stats.flankedOn[romanBroke.group] });
    if (s.outcome === 'escapou') cands.push({ p: 2, code: 'escaped', t: s.t });
    for (const w of stats.drawnIntoWoods) cands.push({ p: 3, code: 'woods', t: w.t, group: w.group });
    const fb = stats.fallBackLog[0]; if (fb) cands.push({ p: 3, code: 'fallBack', t: fb.t, group: fb.group });
    const resp = [first('apoio'), first('segura')].filter(Boolean).sort((a, b) => a.t - b.t)[0];   // uma só reação romana, a primeira
    if (resp) cands.push({ p: 4, code: resp.type === 'apoio' ? 'support' : 'hold', t: resp.t, group: resp.group, ...(resp.ally ? { ally: resp.ally } : {}) });
    return cands.map((c, i) => ({ c, i })).sort((a, b) => a.c.p - b.c.p || a.i - b.i).slice(0, 5)
      .map(x => x.c).sort((a, b) => a.t - b.t).map(({ p, ...k }) => ({ ...k, t: Math.round(k.t * 10) / 10 }));
  }

  const columnAlerted = () => battle.groups.some(g => g.side === 'romanos' && g.left === null && g.alerted);
  function exposureOf(id) {
    const g = groupOf(battle, id);
    if (!g || g.side !== 'lusitanos') return null;
    if (g.hidden) return 'hidden';
    return stats.seen.some(x => x.group === id) || columnAlerted() ? 'seen' : 'exposed';
  }

  /** Romanos (ou lusitanos) em corpo a corpo com o grupo `id` agora. */
  const foesOn = id => battle.groups.filter(o => o.left === null && o.state === 'ativo' && o.engaged && o.target === id);

  return {
    battle, seed, stats, variant,
    /** Avança um passo (0,1 s) e devolve os acontecimentos da simulação e da reação romana. */
    tick() {
      if (battle.over) return [];
      const events = step(battle);
      events.push(...stub.update(battle));
      for (const e of events) {
        if (e.type === 'baixas' && stats.firstBloodAt === null) stats.firstBloodAt = battle.t;
        if (e.type === 'descoberto') stats.discovered.push({ group: e.group, t: battle.t });
        const cause = e.type === 'avistado' ? 'open' : e.type === 'descoberto' ? 'cover' : e.type === 'revelado' && e.by ? 'contact' : null;
        if (cause && groupOf(battle, e.group)?.side === 'lusitanos' && !stats.seen.some(x => x.group === e.group)) {
          stats.seen.push({ group: e.group, t: battle.t, cause, d: e.d ?? 0, by: e.by ?? null });
          e.cause = cause;   // para o ecrã dizer porquê
        }
        if (e.type === 'carga') stats.charges++;
        if (e.type === 'salva' && groupOf(battle, e.group)?.side === 'lusitanos') stats.volleys++;
        if (e.type === 'flanco') { stats.flanks[groupOf(battle, e.group).side]++; stats.flankedOn[e.target] = (stats.flankedOn[e.target] || 0) + 1; }
        if (e.type === 'quebrou') { const g = groupOf(battle, e.group); stats.broke.push({ group: g.id, side: g.side, t: battle.t, rough: !!g.rough, foes: foesOn(g.id).length }); }
        if (e.type === 'terreno' && e.rough && groupOf(battle, e.group)?.side === 'romanos' && !stats.drawnIntoWoods.some(w => w.group === e.group)) stats.drawnIntoWoods.push({ group: e.group, t: battle.t });
        if (['apoio', 'persegue', 'segura', 'cerra'].includes(e.type)) stats.responses.push({ type: e.type, group: e.group, target: e.target ?? e.ally ?? e.behind ?? null, ally: e.ally ?? null, t: battle.t });
      }
      return events;
    },
    /** Ordem do jogador (lado lusitano). Regista o momento do sinal e a posição da coluna nesse momento. */
    order(cmd) {
      const r = command(battle, 'lusitanos', cmd);
      if (!r.ok) { stats.refused++; return r; }
      if (cmd.type === 'sinal') {
        stats.signalAt = battle.t; stats.signalProgress = columnProgress(battle);
        stats.signalSurprised = battle.groups.filter(g => g.side === 'romanos' && g.left === null && g.disorderT > 0).length;
      } else stats.orders++;
      if (cmd.type === 'retirar' && cmd.x !== undefined) { stats.fallBacks++; stats.fallBackLog.push({ group: cmd.group, t: battle.t }); }
      return r;
    },
    /** Intenção atual de um grupo romano (provisório), para o ecrã. */
    intentOf: id => stub.intentOf(id),
    /** Temperamento de um grupo de legionários (provisório): 'agressivo' ou 'cauteloso'. */
    temperOf: id => stub.temperOf(id),
    /** Progresso atual da coluna (0–1). */
    progress: () => columnProgress(battle),
    /** Estado da marcha romana para o ecrã: { mode: 'marching'|'halted'|'moving'|'fighting'|'gone', resumeIn }. */
    march: () => stub.march(battle),
    /** A coluna já está de sobreaviso (alguém foi visto)? Depois disto o sinal já não surpreende ninguém. */
    columnAlerted,
    /**
     * Exposição de um grupo lusitano: 'hidden' (escondido), 'exposed' (à vista; a coluna vê-o a `spotRange` metros)
     * ou 'seen' (a coluna já o viu; não volta a esconder-se).
     */
    exposureOf,
    /** Alcance a que a coluna vê agora o grupo `id` (metros), ou null se já foi visto ou saiu. */
    detectionRange(id) {
      const g = groupOf(battle, id);
      if (!g || g.left !== null || exposureOf(id) === 'seen') return null;
      return spotRange(g.x, g.y, g.hidden, columnAlerted());
    },
    /**
     * Perigo de um grupo em combate: `foes` = ids dos inimigos em corpo a corpo com ele; `nearBreak` = mais uma baixa
     * e quebra (pela mesma regra da simulação). null se não está em campo e capaz de combater.
     */
    dangerOf(id) {
      const g = groupOf(battle, id);
      if (!g || g.left !== null || g.state !== 'ativo') return null;
      return { foes: foesOn(id).map(o => o.id), nearBreak: g.men > 0 && (g.dead + 1) / g.start >= routThreshold(g) };
    },
    /** Relatório para o playtest: objeto e texto em inglês simples (copiável para a folha de registo). */
    report(meta = {}) {
      const s = summary(battle), lus = s.lusitanos, rom = s.romanos;
      const combat = stats.signalAt ?? stats.firstBloodAt;
      const data = {
        version: PROTO_VERSION, seed, columnOrder: variant, outcome: s.outcome, time: s.t,
        signalAt: stats.signalAt, signalColumnProgress: stats.signalProgress === null ? null : Math.round(stats.signalProgress * 100) / 100,
        combatSeconds: combat === null ? 0 : Math.round((s.t - combat) * 10) / 10,
        orders: stats.orders, refusedOrders: stats.refused, charges: stats.charges, slingVolleys: stats.volleys,
        discovered: stats.discovered, seen: stats.seen, placement: placementLog,
        flanks: stats.flanks, fallBacks: stats.fallBacks, romanResponses: stats.responses, keyMoments: keyMoments(s),
        lusitanians: lus, romans: rom, ...meta,
      };
      const pct = data.signalColumnProgress === null ? 'never' : `${data.signalAt}s (column at ${Math.round(data.signalColumnProgress * 100)}%)`;
      const text = [
        `Sentinel ambush prototype ${PROTO_VERSION} — seed ${seed}`,
        `Outcome: ${s.outcome} after ${s.t}s (combat ${data.combatSeconds}s)`,
        `Signal: ${pct}; orders after signal: ${data.orders}; charges: ${data.charges}; sling volleys: ${data.slingVolleys}`,
        `Your band: ${lus.start} men, ${lus.dead} dead, ${lus.fled} fled, ${lus.withdrawn} withdrew`,
        `Romans: ${rom.start} men, ${rom.dead} dead, ${rom.fled} fled, ${rom.escaped} escaped`,
        `Seen by the column: ${stats.seen.length ? stats.seen.map(d => `${d.group} at ${d.t}s (${d.cause})`).join(', ') : 'none'}`,
        `Flank and rear attacks: yours ${stats.flanks.lusitanos}, Roman ${stats.flanks.romanos}`,
        ...data.keyMoments.map(k => `Why: ${momentText(k)}`),
        `Placement: ${placementLog.map(p => `${p.id}(${p.role} ${p.men}) ${p.hidden ? 'hidden' : 'exposed'} @${p.x},${p.y}`).join('; ')}`,
      ].join('\n');
      return { data, text: `${text}\n\n${JSON.stringify(data)}` };
    },
  };
}

export { ROLES };
