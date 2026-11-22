// Protótipo M1 — reação romana PROVISÓRIA. Não é a IA do T3: só o mínimo para a coluna resistir de forma credível.
// Dá ordens pela mesma `command()` dos lusitanos e usa `reveal`/`alert` da simulação. Determinista: sem aleatório,
// decide sobre o estado da batalha a intervalos fixos de passos. Puro (sem DOM nem Three.js).
import { command, reveal, alert } from '../sim.js';
import { ROLES } from '../data.js';
import { concealAt, roadAhead } from './field.js';

/** Afinação do controlador provisório. */
export const STUB = {
  every: 5,          // decide de 5 em 5 passos (0,5 s)
  spotOpen: 30,      // metros a que um romano vê um grupo escondido em campo aberto
  spotCover: 6,      // … e um grupo no meio do mato
  alertedSpot: 1.3,  // romanos já alerta veem mais longe
  engage: 18,        // legionários alerta contra-atacam quem estiver a esta distância
  halt: 45,          // e param a marcha se houver inimigos visíveis até aqui
  skirmish: 32,      // vélites com dardos atacam quem estiver até aqui
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const onField = g => g.left === null;
const able = g => onField(g) && g.state === 'ativo';

/**
 * Cria o controlador. `update(battle)` deve ser chamado depois de cada passo; devolve acontecimentos
 * para o ecrã ({type:'descoberto', group, by}). Guarda a última ordem de cada grupo para não repetir ordens.
 */
export function createRomanStub(tuning = STUB) {
  const last = new Map();
  const give = (battle, g, cmd) => {
    const key = JSON.stringify(cmd);
    if (last.get(g.id) === key) return;
    if (command(battle, 'romanos', { group: g.id, ...cmd }).ok) last.set(g.id, key);
  };

  function spot(battle, romans, events) {
    const warn = () => { for (const r of romans) alert(battle, r.id); };   // a coluna inteira fica de sobreaviso (sem surpresa)
    for (const h of battle.groups) {   // quem está à vista e perto da coluna estraga a surpresa
      if (h.side !== 'lusitanos' || !able(h) || h.hidden) continue;
      if (romans.some(r => !r.alerted) && romans.some(r => dist(r, h) <= tuning.spotOpen)) {
        warn();
        events.push({ type: 'avistado', group: h.id });
      }
    }
    for (const h of battle.groups) {
      if (h.side !== 'lusitanos' || !onField(h) || !h.hidden) continue;
      const range = tuning.spotOpen + (tuning.spotCover - tuning.spotOpen) * concealAt(h.x, h.y);
      const seer = romans.find(r => dist(r, h) <= range * (r.alerted ? tuning.alertedSpot : 1));
      if (!seer || !reveal(battle, h.id, seer.id)) continue;
      events.push({ type: 'descoberto', group: h.id, by: seer.id });
      warn();
    }
  }

  function decide(battle, g, threats, legions) {
    if (!g.alerted || g.engaged) return;   // em marcha tranquila, ou já em corpo a corpo: a simulação trata
    const near = threats.reduce((b, t) => (!b || dist(g, t) < dist(g, b) ? t : b), null);
    const d = near ? dist(g, near) : Infinity;
    if (g.role === 'velite') {
      if (!legions.length) return give(battle, g, { type: 'retirar' });   // sem legionários, os vélites fogem
      if (g.ammo > 0 && d <= tuning.skirmish) return give(battle, g, { type: 'atacar', target: near.id });
      const busy = legions.find(l => l.engaged && l.target);
      if (busy) return give(battle, g, { type: 'atacar', target: busy.target });   // ajudar quem está a lutar
    }
    if (d <= tuning.engage) return give(battle, g, { type: 'atacar', target: near.id });
    if (d <= tuning.halt) {   // inimigo à vista: quem ainda está desordenado forma e espera; quem está em ordem avança
      return g.disorderT > 0 ? give(battle, g, { type: 'manter' }) : give(battle, g, { type: 'atacar', target: near.id });
    }
    const ahead = roadAhead(g.x);   // ninguém à vista: retoma a marcha
    if (ahead.length) give(battle, g, { type: 'mover', path: ahead, pace: 'marcha', leave: true });
  }

  return {
    /** Chamado depois de cada passo. Devolve acontecimentos novos do controlador. */
    update(battle) {
      const events = [];
      if (battle.over || battle.tick % tuning.every !== 0) return events;
      const romans = battle.groups.filter(g => g.side === 'romanos' && able(g));
      if (!romans.length) return events;
      spot(battle, romans, events);
      const threats = battle.groups.filter(g => g.side === 'lusitanos' && able(g) && !g.hidden);   // quem foge não é ameaça
      const legions = romans.filter(g => g.role === 'legionario');
      for (const g of romans) if (ROLES[g.role]) decide(battle, g, threats, legions);
      return events;
    },
  };
}
