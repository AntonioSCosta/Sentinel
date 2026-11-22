// Simulação da batalha tática: grupos, passo fixo, movimento, combate, rotura e fim.
// Módulo puro (sem DOM nem Three.js) e determinista: a mesma semente e as mesmas ordens dão sempre a mesma batalha.
import { makeRng } from '../campaign/rng.js';
import { DT, SIDES, ROLES, TUNING } from './data.js';
import { dist, bearing, wrap, contactDistance, inContact, disordered, routThreshold, meleeDamage, volleyDamage } from './combat.js';

/** Ordens que um grupo aceita. 'sinal' é do lado inteiro, não de um grupo. */
export const ORDERS = ['atacar', 'manter', 'retirar', 'mover'];
/** Desfechos: vitoria e derrota do ponto de vista dos lusitanos. */
export const OUTCOMES = ['vitoria', 'derrota', 'retirada', 'escapou', 'tempo'];

const enemyOf = side => (side === 'lusitanos' ? 'romanos' : 'lusitanos');
const onField = g => g.left === null;
/** Pode combater: em campo, vivo e sem ter quebrado. */
const able = g => onField(g) && g.state === 'ativo';
const nearest = (from, list) => list.reduce((best, g) => (!best || dist(from, g) < dist(from, best) ? g : best), null);

/**
 * Cria uma batalha.
 * @param {object} setup
 * @param {number} setup.seed
 * @param {{id:string, role:string, men:number, x:number, y:number, facing?:number, hidden?:boolean, order?:object}[]} setup.groups
 *   o lado vem do papel (data.ROLES); `hidden` só para quem espera o sinal
 * @param {{lusitanos:{x:number,y:number}[], romanos:{x:number,y:number}[]}} setup.exits saídas do campo de cada lado
 * @param {(x:number, y:number) => number} [setup.coverAt] cobertura ∈ [0, 1] num ponto (terreno: PR T2)
 * @param {(a:{x,y}, b:{x,y}) => boolean} [setup.los] linha de vista entre dois pontos (terreno: PR T2)
 * @param {number} [setup.maxTime]
 * @returns {object} estado da batalha (dados simples; `env` guarda as funções do terreno)
 */
export function createBattle({ seed, groups, exits, coverAt = () => 0, los = () => true, maxTime = TUNING.maxTime }) {
  const bad = why => { throw new Error(why); };
  const finite = Number.isFinite;
  if (!Array.isArray(groups)) bad('grupos: é preciso uma lista');
  if (typeof coverAt !== 'function') bad('coverAt: é preciso uma função');
  if (typeof los !== 'function') bad('los: é preciso uma função');
  if (!(finite(maxTime) && maxTime > 0)) bad('maxTime: é preciso um número positivo');
  for (const side of SIDES) {
    const list = exits?.[side];
    if (!Array.isArray(list) || !list.length || !list.every(p => finite(p?.x) && finite(p?.y))) bad(`saídas de ${side}: é preciso pelo menos um ponto {x, y} finito`);
  }
  const ids = new Set();
  const list = groups.map(s => {
    const role = ROLES[s?.role];
    if (!role) bad(`papel desconhecido: ${s?.role}`);
    if (typeof s.id !== 'string' || !s.id) bad('id do grupo: é preciso um texto não vazio');
    if (ids.has(s.id)) bad(`grupo repetido: ${s.id}`);
    ids.add(s.id);
    if (!(typeof s.men === 'number' && finite(s.men) && s.men >= 1)) bad(`homens de ${s.id}: é preciso um número ≥ 1`);
    if (!finite(s.x) || !finite(s.y)) bad(`posição de ${s.id}: x e y têm de ser números finitos`);
    if (s.facing !== undefined && !finite(s.facing)) bad(`frente de ${s.id}: tem de ser um número finito`);
    const men = Math.floor(s.men);
    return {
      id: s.id, side: role.side, role: s.role, men, start: men, dead: 0, wounds: 0,
      x: s.x, y: s.y, facing: s.facing ?? 0,
      hidden: !!s.hidden, alerted: role.side === 'lusitanos',   // os romanos começam em marcha, sem alerta
      state: 'ativo', left: null, disorderT: 0, chargeT: 0, run: 0, engaged: false, target: null,
      reloadT: 0, ammo: role.ranged ? role.ranged.ammo : 0,
      order: { type: 'manter' },
    };
  });
  const battle = { seed, t: 0, tick: 0, groups: list, exits: structuredClone(exits), signals: [], over: null, log: [], maxTime,
    rng: makeRng(Math.max(1, Math.floor(seed) || 1)), env: { coverAt, los } };
  groups.forEach((s, i) => {   // as ordens iniciais passam pelas mesmas regras das ordens dadas depois
    if (!s.order) return;
    const r = parseOrder(battle, list[i], s.order);
    if (r.why) bad(`ordem inicial de ${s.id}: ${r.why}`);
    list[i].order = r.order;
  });
  return battle;
}

/**
 * Lê uma ordem para o grupo `g`: devolve { order } normalizada (cópia) ou { why } com o motivo da recusa.
 * Só se ataca um grupo inimigo que está em campo e que o lado vê (os escondidos não se veem).
 */
function parseOrder(battle, g, cmd) {
  if (!ORDERS.includes(cmd?.type)) return { why: 'ordem' };
  const finite = Number.isFinite;
  if (cmd.type === 'atacar') {
    if (cmd.target !== undefined) {
      const t = groupOf(battle, cmd.target);
      if (!t || t.side === g.side || !onField(t) || t.hidden) return { why: 'alvo' };
      return { order: { type: 'atacar', target: t.id } };
    }
    if (finite(cmd.x) && finite(cmd.y)) return { order: { type: 'atacar', x: cmd.x, y: cmd.y } };
    return { why: 'alvo' };
  }
  if (cmd.type === 'mover') {
    const path = cmd.path;
    if (!Array.isArray(path) || !path.length || !path.every(p => finite(p?.x) && finite(p?.y))) return { why: 'caminho' };
    return { order: { type: 'mover', path: path.map(p => ({ x: p.x, y: p.y })), pace: cmd.pace === 'marcha' ? 'marcha' : 'corrida', leave: !!cmd.leave } };
  }
  return { order: { type: cmd.type } };
}

/** Procura um grupo pelo id. */
export const groupOf = (battle, id) => battle.groups.find(g => g.id === id) || null;

/**
 * Dá uma ordem. `cmd.type`: 'sinal' (do lado) ou uma de ORDERS com `cmd.group`.
 * atacar: `target` (id de grupo inimigo) ou `x`,`y`; mover: `path` [{x,y}…], `pace` 'marcha'|'corrida', `leave` (sai no fim).
 * Um grupo escondido aceita a ordem mas só a cumpre depois do sinal (ou de ser descoberto).
 * @returns {{ok:true} | {ok:false, why:string}}
 */
export function command(battle, side, cmd) {
  const no = why => ({ ok: false, why });
  if (battle.over) return no('acabou');
  if (!SIDES.includes(side)) return no('lado');
  if (cmd?.type === 'sinal') {
    if (battle.signals.includes(side)) return no('sinal-dado');
    battle.signals.push(side);
    battle.log.push({ t: battle.t, side, type: 'sinal' });
    signal(battle, side);
    return { ok: true };
  }
  if (!ORDERS.includes(cmd?.type)) return no('ordem');
  const g = groupOf(battle, cmd.group);
  if (!g || g.side !== side) return no('grupo');
  if (!able(g)) return no('indisponivel');
  const { order, why } = parseOrder(battle, g, cmd);
  if (why) return no(why);
  g.order = order;
  battle.log.push({ t: battle.t, side, ...cmd });
  return { ok: true };
}

/** O sinal: os escondidos do lado aparecem, e todo o inimigo ainda sem alerta é apanhado de surpresa. */
function signal(battle, side, events = null) {
  for (const g of battle.groups) {
    if (!onField(g)) continue;
    if (g.side === side && g.hidden) { g.hidden = false; events?.push({ type: 'revelado', group: g.id }); }
    if (g.side !== side) surprise(battle, g);
  }
}

/** Alerta um grupo; se ainda não estava alerta, fica desordenado `TUNING.surprise` segundos. */
function surprise(battle, g) {
  if (g.alerted) return;
  g.alerted = true;
  g.disorderT = TUNING.surprise;
}

/**
 * Revela um grupo escondido que o inimigo descobriu (por exemplo, a IA romana a ver alguém fora do mato).
 * `by`: id do grupo inimigo que o viu, que fica alerta sem surpresa. Devolve true se o grupo estava escondido.
 */
export function reveal(battle, id, by = null) {
  const g = groupOf(battle, id);
  if (!g || !onField(g) || !g.hidden) return false;
  g.hidden = false;
  const finder = by === null ? null : groupOf(battle, by);
  if (finder && finder.side !== g.side && onField(finder)) finder.alerted = true;
  return true;
}

/** Põe um grupo em alerta sem o desordenar (viu o inimigo antes de ser atacado). Devolve true se mudou. */
export function alert(battle, id) {
  const g = groupOf(battle, id);
  if (!g || !onField(g) || g.alerted) return false;
  g.alerted = true;
  return true;
}

/** Saída mais próxima do lado do grupo. */
const exitOf = (battle, g) => nearest(g, battle.exits[g.side]);

/** Avança o grupo para `to` à velocidade `speed`; devolve true se chegou. Atualiza a frente e o caminho corrido (`charging`: conta para a carga). */
function moveTo(g, to, speed, charging = true) {
  const d = dist(g, to), step = speed * DT, moved = Math.min(d, step);
  if (d > 1e-9) g.facing = bearing(g, to);
  if (d <= step) { g.x = to.x; g.y = to.y; } else { g.x += (to.x - g.x) / d * step; g.y += (to.y - g.y) / d * step; }
  g.run = charging ? g.run + moved : 0;   // só a correr se ganha balanço para a carga; em marcha, não
  return dist(g, to) <= TUNING.arrive;
}

/** Roda a frente do grupo para `to`, à velocidade TUNING.turnRate. */
function turnTo(g, to) {
  const want = bearing(g, to), d = wrap(want - g.facing), max = TUNING.turnRate * DT;
  g.facing = wrap(g.facing + Math.max(-max, Math.min(max, d)));
}

/** O grupo deixa o campo: `how` = 'retirou' | 'fugiu' | 'escapou'. */
function leave(g, how, events) {
  g.left = how;
  events.push({ type: 'saiu', group: g.id, how, men: g.men });
}

/** Inimigos visíveis e em campo de `g` (os escondidos não se veem). */
const foesOf = (battle, g) => battle.groups.filter(o => o.side !== g.side && onField(o) && !o.hidden);

/** Movimento e escolha do alvo de um grupo. Devolve o alvo corpo a corpo, o alvo de uma salva, ou nada. */
function act(battle, g, events) {
  const role = ROLES[g.role];
  if (g.state === 'debandada') {   // foge para a saída, sem combater
    if (moveTo(g, exitOf(battle, g), role.speed * TUNING.routed.speed)) leave(g, 'fugiu', events);
    return null;
  }
  if (g.hidden) return null;
  if (g.order.type === 'retirar') {   // retirada em ordem: não combate, sai pela saída mais próxima
    g.engaged = false;
    if (moveTo(g, exitOf(battle, g), role.speed)) leave(g, 'retirou', events);
    return null;
  }
  const foes = foesOf(battle, g);
  const touching = foes.filter(o => inContact(g, o));
  const wasEngaged = g.engaged;
  g.engaged = touching.some(able);
  if (touching.length) {   // em corpo a corpo: pára e luta; primeiro contra quem ainda luta (o alvo que tinha, se é um deles), só depois contra quem foge
    const fighting = touching.filter(able), pool = fighting.length ? fighting : touching;
    const t = pool.find(o => o.id === g.target) || nearest(g, pool);
    if (!wasEngaged && g.run >= TUNING.charge.minRun) { g.chargeT = TUNING.charge.time; events.push({ type: 'carga', group: g.id, target: t.id }); }
    g.run = 0;
    g.target = t.id;
    turnTo(g, t);
    return { melee: t };
  }
  const o = g.order;
  if (o.type === 'atacar' && o.target !== undefined) {
    const t = groupOf(battle, o.target);
    if (!t || !onField(t)) { g.order = { type: 'manter' }; return fire(battle, g, foes); }
    if (t.hidden) return fire(battle, g, foes);
    g.target = t.id;
    if (role.ranged && g.ammo > 0 && dist(g, t) <= role.ranged.range * 0.95 && battle.env.los(g, t)) { turnTo(g, t); return fire(battle, g, [t]); }   // sem linha de vista, aproxima-se
    const stop = contactDistance(g, t) - 0.05, d = dist(g, t);
    if (d > stop) moveTo(g, { x: t.x + (g.x - t.x) / d * stop, y: t.y + (g.y - t.y) / d * stop }, role.speed);
    return null;
  }
  if (o.type === 'atacar' || o.type === 'mover') {
    const path = o.type === 'atacar' ? [{ x: o.x, y: o.y }] : o.path;
    const speed = o.pace === 'marcha' ? role.march : role.speed;
    if (moveTo(g, path[0], speed, o.pace !== 'marcha')) {
      if (path.length > 1 && o.type === 'mover') path.shift();
      else if (o.type === 'mover' && o.leave) leave(g, g.side === 'romanos' ? 'escapou' : 'retirou', events);
      else g.order = { type: 'manter' };
    }
    return null;
  }
  g.run = 0;   // parado
  return fire(battle, g, foes);
}

/** Um grupo parado com armas de arremesso escolhe o alvo mais perto, ao alcance e à vista. */
function fire(battle, g, foes) {
  const r = ROLES[g.role].ranged;
  if (!r || g.ammo <= 0 || g.reloadT > 0) return null;
  const inRange = foes.filter(o => dist(g, o) <= r.range && battle.env.los(g, o));
  const t = inRange.find(o => o.id === g.target) || nearest(g, inRange);
  if (!t) return null;
  turnTo(g, t);
  return { volley: t };
}

/**
 * Avança a batalha um passo de DT segundos.
 * @returns {object[]} acontecimentos do passo (revelado, carga, salva, baixas, quebrou, saiu, fim)
 */
export function step(battle) {
  if (battle.over) return [];
  const events = [], { rng } = battle;
  battle.tick++;
  battle.t = Math.round(battle.tick * DT * 1000) / 1000;
  for (const g of battle.groups) {
    if (!onField(g)) continue;
    g.disorderT = Math.max(0, g.disorderT - DT);
    g.chargeT = Math.max(0, g.chargeT - DT);
    g.reloadT = Math.max(0, g.reloadT - DT);
  }
  // escondidos tocados por um inimigo são descobertos (quem os encontra fica alerta, sem surpresa)
  for (const g of battle.groups) {
    if (!onField(g) || !g.hidden) continue;
    const finder = battle.groups.find(o => o.side !== g.side && able(o) && !o.hidden && inContact(g, o));
    if (finder) { g.hidden = false; finder.alerted = true; events.push({ type: 'revelado', group: g.id, by: finder.id }); }
  }
  // movimento e alvos: tudo decidido sobre o mesmo instante, o dano é aplicado depois, de uma vez
  const hits = new Map();
  const hit = (t, dmg) => hits.set(t.id, (hits.get(t.id) || 0) + dmg);
  const jitter = () => 1 + (rng.next() * 2 - 1) * TUNING.jitter;
  for (const g of battle.groups) {
    if (!onField(g)) continue;
    const a = act(battle, g, events);
    if (!a || !able(g)) continue;
    if (a.melee) {
      hit(a.melee, meleeDamage(g, a.melee, DT) * jitter());
      surprise(battle, a.melee);
    } else if (a.volley) {
      const t = a.volley, r = ROLES[g.role].ranged;
      const dmg = volleyDamage(g, t, battle.env.coverAt(t.x, t.y)) * jitter();
      hit(t, dmg);
      g.reloadT = r.reload; g.ammo--;
      events.push({ type: 'salva', group: g.id, target: t.id });
      surprise(battle, t);
    }
  }
  for (const g of battle.groups) {
    const dmg = hits.get(g.id);
    if (!(dmg > 0) || !Number.isFinite(dmg) || !onField(g)) continue;   // nunca deixar um NaN entrar nas contas
    const hp = ROLES[g.role].hp;
    g.wounds += dmg;
    const deaths = Math.min(g.men, Math.floor(g.wounds / hp));
    if (!deaths) continue;
    g.wounds -= deaths * hp; g.men -= deaths; g.dead += deaths;
    events.push({ type: 'baixas', group: g.id, n: deaths });
    if (g.men === 0) { g.state = 'destruido'; g.left = 'morto'; g.wounds = 0; events.push({ type: 'destruido', group: g.id }); }
  }
  for (const g of battle.groups) {
    if (!able(g) || g.dead / g.start < routThreshold(g)) continue;
    g.state = 'debandada'; g.engaged = false;
    events.push({ type: 'quebrou', group: g.id });
  }
  const end = outcomeOf(battle);
  if (end) finish(battle, end, events);
  return events;
}

/** Corre a batalha até acabar ou até `seconds` segundos de jogo. Devolve todos os acontecimentos. */
export function run(battle, seconds = Infinity) {
  const out = [], until = battle.t + seconds;
  while (!battle.over && battle.t < until - 1e-9) out.push(...step(battle));
  return out;
}

/** Homens de um lado por destino: em campo, mortos, fugidos, retirados, escapados. */
function tally(battle, side) {
  const s = { start: 0, alive: 0, dead: 0, fled: 0, withdrawn: 0, escaped: 0 };
  for (const g of battle.groups) {
    if (g.side !== side) continue;
    s.start += g.start; s.dead += g.dead;
    if (g.left === null) s.alive += g.men;
    else if (g.left === 'fugiu') s.fled += g.men;
    else if (g.left === 'retirou') s.withdrawn += g.men;
    else if (g.left === 'escapou') s.escaped += g.men;
  }
  return s;
}

/**
 * O desfecho, se a batalha acabou neste instante; senão null.
 * - Nenhum romano pode combater: «escapou» se saíram em ordem mais romanos do que os mortos e fugidos; senão «vitoria».
 * - Nenhum lusitano pode combater: «retirada» se ninguém quebrou nem morreu tudo (só saíram em ordem); senão «derrota».
 * - Passou o tempo máximo: «tempo».
 */
export function outcomeOf(battle) {
  const lus = battle.groups.filter(g => g.side === 'lusitanos'), rom = battle.groups.filter(g => g.side === 'romanos');
  if (!lus.some(able)) return lus.some(g => g.left === 'retirou') && !lus.some(g => g.state === 'debandada' || g.left === 'fugiu') ? 'retirada' : 'derrota';
  if (!rom.some(able)) {
    const r = tally(battle, 'romanos'), broken = r.dead + r.fled + rom.filter(g => g.left === null).reduce((n, g) => n + g.men, 0);
    return r.escaped > broken ? 'escapou' : 'vitoria';
  }
  return battle.t >= battle.maxTime - 1e-9 ? 'tempo' : null;
}

/** Fecha a batalha: quem ainda estava em debandada no campo conta como fugido. */
function finish(battle, outcome, events) {
  for (const g of battle.groups) if (g.left === null && g.state === 'debandada') leave(g, 'fugiu', events);
  battle.over = outcome;
  events.push({ type: 'fim', outcome, t: battle.t });
}

/**
 * Resumo da batalha: desfecho (ou null), tempo e contas de homens por lado.
 * Em cada lado: start = alive + dead + fled + withdrawn + escaped, sempre.
 */
export function summary(battle) {
  return { outcome: battle.over, t: battle.t, lusitanos: tally(battle, 'lusitanos'), romanos: tally(battle, 'romanos') };
}

export { enemyOf, disordered };
