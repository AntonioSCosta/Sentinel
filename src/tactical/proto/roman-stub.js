// Protótipo M1.1 — reação romana PROVISÓRIA. Não é a IA do T3: só o mínimo para a coluna responder de forma legível.
// Dá ordens pela mesma `command()` dos lusitanos e usa `reveal`/`alert` da simulação. Determinista: as escolhas que
// variam (o temperamento de cada grupo) vêm de um gerador com a semente da batalha; decide a intervalos fixos de passos.
// Cada resposta deixa uma janela de contra-jogo e é anunciada como acontecimento para o ecrã.
import { command, reveal, alert } from '../sim.js';
import { sideOf } from '../combat.js';
import { makeRng } from '../../campaign/rng.js';
import { concealAt, coverAt, roadAhead } from './field.js';
import { TUNING } from '../data.js';

/** Afinação do controlador provisório. */
export const STUB = {
  every: 5,          // decide de 5 em 5 passos (0,5 s)
  spotOpen: 30,      // metros a que um romano vê um grupo escondido em campo aberto
  spotCover: 6,      // … e um grupo no meio do mato
  alertedSpot: 1.3,  // romanos já alerta veem mais longe
  engage: 18,        // legionários alerta atacam quem estiver a esta distância
  halt: 45,          // inimigos visíveis até aqui fazem a coluna parar
  skirmish: 32,      // vélites com dardos atacam quem estiver até aqui
  support: 40,       // um grupo livre vai apoiar um aliado atacado até esta distância
  pursue: 40,        // os agressivos perseguem quem recua, foge ou está fraco até aqui, mesmo para o mato
  weak: 0.5,         // «fraco»: com metade dos homens ou menos
  aggressive: 0.5,   // probabilidade (por semente) de um grupo de legionários ser agressivo
  holdFor: 15,       // os cautelosos seguram a estrada no máximo este tempo sem combate; depois retomam a marcha
  closeRanks: 0.5,   // probabilidade (por semente) de a coluna cerrar fileiras ao ser atacada (vélites atrás dos legionários)
  sortieFor: 8,      // abrigados, os vélites saem a lançar dardos: a surtida dura até dispararem ou, no máximo, estes segundos
  sortieRest: 5,     // … e depois ficam abrigados pelo menos este tempo antes de voltarem a sair (a recarga dos dardos)
  coverHysteresis: 1.25,   // abrigados, só deixam o abrigo com o inimigo a mais de halt × isto
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Distância (m) a que a coluna vê um grupo lusitano nesta posição: à vista, `spotOpen`; escondido, entre `spotOpen`
 * (campo aberto) e `spotCover` (miolo do mato), conforme a ocultação; romanos já alerta veem `alertedSpot` vezes mais longe.
 * É a mesma conta que decide a descoberta, para o ecrã mostrar exatamente o alcance que conta.
 */
export function spotRange(x, y, hidden, alerted = false, tuning = STUB) {
  if (!hidden) return tuning.spotOpen;
  return (tuning.spotOpen + (tuning.spotCover - tuning.spotOpen) * concealAt(x, y)) * (alerted ? tuning.alertedSpot : 1);
}
const onField = g => g.left === null;
const able = g => onField(g) && g.state === 'ativo';
const nearestOf = (g, list) => list.reduce((b, t) => (!b || dist(g, t) < dist(g, b) ? t : b), null);
/** O grupo está em terreno difícil (mato), onde a formação romana se desfaz? */
const inRough = g => coverAt(g.x, g.y) >= TUNING.roughCover;

/**
 * Cria o controlador. `update(battle)` deve ser chamado depois de cada passo; devolve acontecimentos para o ecrã:
 * descoberto/avistado (a emboscada foi vista), apoio (um grupo vai ajudar um aliado), persegue (vai atrás de um grupo
 * vulnerável), segura (cautelosos param na estrada). `temperOf(id)` diz o temperamento de um grupo de legionários.
 */
export function createRomanStub(tuning = STUB) {
  const last = new Map(), tempers = new Map(), holding = new Map(), waited = new Set(), chasing = new Map(), intents = new Map();
  const sorties = new Map(), rested = new Map(), sheltered = new Set(), covering = new Set();   // vélites: surtida em curso, fim da última, já anunciaram o abrigo, estão abrigados agora
  let rng = null, doctrine = null;
  /** Dá a ordem se for nova; devolve true se a deu. */
  const give = (battle, g, cmd) => {
    const key = JSON.stringify(cmd);
    if (last.get(g.id) === key) return false;
    if (!command(battle, 'romanos', { group: g.id, ...cmd }).ok) return false;
    last.set(g.id, key);
    intents.set(g.id, cmd.intent ?? null);
    return true;
  };

  function spot(battle, romans, events) {
    const warn = () => { for (const r of romans) alert(battle, r.id); };   // a coluna inteira fica de sobreaviso (sem surpresa)
    for (const h of battle.groups) {   // quem está à vista e perto da coluna estraga a surpresa
      if (h.side !== 'lusitanos' || !able(h) || h.hidden || !romans.some(r => !r.alerted)) continue;
      const seer = nearestOf(h, romans);
      if (seer && dist(seer, h) <= tuning.spotOpen) {
        warn();
        events.push({ type: 'avistado', group: h.id, by: seer.id, d: Math.round(dist(seer, h)) });
      }
    }
    for (const h of battle.groups) {
      if (h.side !== 'lusitanos' || !onField(h) || !h.hidden) continue;
      const seer = romans.find(r => dist(r, h) <= spotRange(h.x, h.y, true, r.alerted, tuning));
      if (!seer) continue;
      const d = Math.round(dist(seer, h));
      if (!reveal(battle, h.id, seer.id)) continue;
      events.push({ type: 'descoberto', group: h.id, by: seer.id, d, cover: Math.round(concealAt(h.x, h.y) * 100) / 100 });
      warn();
    }
  }

  /** Grupo lusitano a atacar um aliado romano, de preferência pelo flanco ou pelas costas. */
  function attackerOf(battle, g, romans) {
    let best = null, bestScore = -1;
    for (const ally of romans) {
      if (ally.id === g.id || !ally.engaged || dist(g, ally) > tuning.support) continue;
      for (const l of battle.groups) {
        if (l.side !== 'lusitanos' || !able(l) || l.target !== ally.id || !l.engaged) continue;
        const score = (sideOf(ally, l) === 'frente' ? 1 : 2) + 1 / (1 + dist(g, l));
        if (score > bestScore) { best = { attacker: l, ally }; bestScore = score; }
      }
    }
    return best;
  }

  function decide(battle, g, threats, romans, legions, events) {
    if (!g.alerted || g.engaged) { holding.delete(g.id); return; }   // em marcha tranquila, ou já em corpo a corpo: a simulação trata
    const near = nearestOf(g, threats);
    const d = near ? dist(g, near) : Infinity;
    if (g.role === 'velite') {
      if (!legions.length) return give(battle, g, { type: 'retirar' });   // sem legionários, os vélites fogem
      // histerese: quem já está abrigado só sai do abrigo com o inimigo bem mais longe (senão alterna no limite dos `halt` metros)
      const zone = covering.has(g.id) ? tuning.halt * tuning.coverHysteresis : tuning.halt;
      if (doctrine === 'cerrar' && near && d <= zone) {   // a coluna cerra fileiras: os vélites abrigam-se atrás dos legionários
        covering.add(g.id);
        // e saem em surtidas curtas para lançar dardos. Cada surtida vai até ao fim (disparar ou desistir), para não alternarem
        // a cada decisão entre o abrigo e o ataque (o bug do M1.1: dezenas de ordens e nenhum dardo).
        const out = sorties.get(g.id);
        if (out) {
          const prey = battle.groups.find(l => l.id === out.target);
          if (g.ammo < out.ammo || battle.t - out.t >= tuning.sortieFor || !prey || !able(prey) || prey.hidden) { sorties.delete(g.id); rested.set(g.id, battle.t); }
          else return give(battle, g, { type: 'atacar', target: out.target });
        }
        if (g.ammo > 0 && d <= tuning.skirmish && battle.t - (rested.get(g.id) ?? -Infinity) >= tuning.sortieRest) {
          sorties.set(g.id, { target: near.id, t: battle.t, ammo: g.ammo });
          if (give(battle, g, { type: 'atacar', target: near.id })) intents.set(g.id, 'skirmish');
          return;
        }
        const shield = nearestOf(g, legions), away = Math.atan2(shield.y - near.y, shield.x - near.x);
        const spot = { x: shield.x + Math.cos(away) * 3, y: shield.y + Math.sin(away) * 3 };
        if (dist(g, spot) > 3) {
          if (give(battle, g, { type: 'retirar', x: Math.round(spot.x), y: Math.round(spot.y) })) {
            intents.set(g.id, 'shelter');
            if (!sheltered.has(g.id)) { sheltered.add(g.id); events.push({ type: 'cerra', group: g.id, behind: shield.id }); }
          }
        }
        return;   // abrigados: parados, lançam a quem chegar ao alcance (a simulação dispara sozinha)
      }
      covering.delete(g.id); sorties.delete(g.id);
      if (g.ammo > 0 && d <= tuning.skirmish) return give(battle, g, { type: 'atacar', target: near.id });
      const busy = legions.find(l => l.engaged && l.target);
      if (busy) return give(battle, g, { type: 'atacar', target: busy.target });   // ajudar quem está a lutar
    }
    const temper = tempers.get(g.id);
    // ninguém entra no mato atrás de quem lá espera: só se ataca quem está a descoberto (os agressivos perseguem, abaixo)
    const open = threats.filter(t => !inRough(t));
    const nearOpen = nearestOf(g, open), dOpen = nearOpen ? dist(g, nearOpen) : Infinity;
    if (dOpen <= tuning.engage) return give(battle, g, { type: 'atacar', target: nearOpen.id });
    if (g.disorderT > 0) return give(battle, g, { type: 'manter' });   // ainda a recompor-se da surpresa
    // apoio: ir sobre quem está a flanquear um aliado
    let help = g.role === 'legionario' ? attackerOf(battle, g, romans) : null;
    if (help && temper === 'cauteloso' && inRough(help.attacker)) help = null;   // nem para ajudar entram no mato
    if (help) {
      if (give(battle, g, { type: 'atacar', target: help.attacker.id })) { intents.set(g.id, 'support'); events.push({ type: 'apoio', group: g.id, ally: help.ally.id, target: help.attacker.id }); }
      return;
    }
    if (temper === 'agressivo') {   // perseguir um grupo vulnerável, mesmo para dentro do mato; uma vez lançados, vão até ao fim
      const was = chasing.has(g.id) ? battle.groups.find(l => l.id === chasing.get(g.id)) : null;
      const keep = was && onField(was) && dist(g, was) <= tuning.pursue * 1.5 ? was : null;
      const prey = keep || nearestOf(g, battle.groups.filter(l => l.side === 'lusitanos' && onField(l) && !l.hidden && dist(g, l) <= tuning.pursue
        && (l.state === 'debandada' || l.order.type === 'retirar' || l.men / l.start <= tuning.weak)));
      if (prey) chasing.set(g.id, prey.id); else chasing.delete(g.id);
      if (prey) {
        if (give(battle, g, { type: 'atacar', target: prey.id })) { intents.set(g.id, 'pursue'); events.push({ type: 'persegue', group: g.id, target: prey.id }); }
        return;
      }
      if (dOpen <= tuning.halt) return give(battle, g, { type: 'atacar', target: nearOpen.id });
    }
    if (d <= tuning.halt && !waited.has(g.id)) {   // inimigo no mato, ou cautela: segura a estrada em formação, uma vez e não para sempre
      const since = holding.get(g.id) ?? battle.t;
      holding.set(g.id, since);
      if (battle.t - since >= tuning.holdFor) waited.add(g.id);
      else {
        if (give(battle, g, { type: 'manter' }) && g.role === 'legionario') { intents.set(g.id, 'hold'); events.push({ type: 'segura', group: g.id }); }
        return;
      }
    }
    holding.delete(g.id);
    const ahead = roadAhead(g.x);   // ninguém à vista (ou cansados de esperar): retoma a marcha
    if (ahead.length) give(battle, g, { type: 'mover', path: ahead, pace: 'marcha', leave: true });
  }

  return {
    /** Chamado depois de cada passo. Devolve acontecimentos novos do controlador. */
    update(battle) {
      const events = [];
      if (!rng) {   // o temperamento de cada grupo de legionários sai da semente da batalha
        rng = makeRng(((battle.seed | 0) ^ 0x5eed1) >>> 0 || 1);
        for (const g of battle.groups) if (g.role === 'legionario') tempers.set(g.id, rng.chance(tuning.aggressive) ? 'agressivo' : 'cauteloso');
        doctrine = rng.chance(tuning.closeRanks) ? 'cerrar' : 'espalhar';   // a coluna cerra fileiras, ou cada grupo luta por si
      }
      if (battle.over || battle.tick % tuning.every !== 0) return events;
      const romans = battle.groups.filter(g => g.side === 'romanos' && able(g));
      if (!romans.length) return events;
      spot(battle, romans, events);
      const threats = battle.groups.filter(g => g.side === 'lusitanos' && able(g) && !g.hidden);   // quem foge não é ameaça
      const legions = romans.filter(g => g.role === 'legionario');
      for (const g of romans) decide(battle, g, threats, romans, legions, events);
      return events;
    },
    /**
     * Estado da marcha da coluna, para o ecrã: 'marching' (em marcha, sem alerta), 'halted' (parada a segurar a estrada;
     * `resumeIn` = segundos até o primeiro grupo retomar a marcha), 'fighting' (algum grupo em corpo a corpo),
     * 'moving' (alerta, em movimento: a marchar outra vez, a apoiar ou a perseguir), 'gone' (ninguém em campo).
     */
    march(battle) {
      const romans = battle.groups.filter(g => g.side === 'romanos' && able(g));
      if (!romans.length) return { mode: 'gone', resumeIn: null };
      if (romans.some(g => g.engaged)) return { mode: 'fighting', resumeIn: null };
      if (!romans.some(g => g.alerted)) return { mode: 'marching', resumeIn: null };
      const holds = romans.filter(g => holding.has(g.id) && !waited.has(g.id) && g.order.type === 'manter');
      if (holds.length) return { mode: 'halted', resumeIn: Math.max(0, Math.ceil(Math.min(...holds.map(g => tuning.holdFor - (battle.t - holding.get(g.id)))))) };
      return { mode: romans.some(g => g.order.type !== 'manter') ? 'moving' : 'halted', resumeIn: null };
    },
    /** Intenção atual de um grupo romano para o ecrã: 'support' | 'pursue' | 'hold' | 'shelter' | 'skirmish' | null. */
    intentOf: id => intents.get(id) ?? null,
    /** Doutrina da coluna: 'cerrar' ou 'espalhar' (null antes do primeiro passo). */
    get doctrine() { return doctrine; },
    /** Temperamento de um grupo de legionários: 'agressivo' ou 'cauteloso' (null antes do primeiro passo). */
    temperOf: id => tempers.get(id) ?? null,
  };
}
