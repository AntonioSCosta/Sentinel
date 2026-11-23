// O que o jogador sabe das forças romanas: avistamentos, relatos e reconhecimento.
// Módulo puro (sem DOM nem Three.js). A simulação continua a usar as posições reais (state.patrols,
// state.praetor); a interface só recebe intelView(state), que é feito apenas de state.intel.
import { makeRng } from './rng.js';
import { communityAt, newsFrom } from './communities.js';

export const SIGHT = 150;            // o bando vê uma força a esta distância (o pretor vê o bando a 140)
export const FORGET = 8;             // dias: um avistamento mais velho do que isto sai do mapa
export const REPORT_DAYS = 6;        // um relato mais velho do que isto é «antigo» e já não se desenha
export const REPORT_LIST = 12;       // relatos mostrados na lista
const REPORT_STORE = 40;             // relatos guardados
export const VILLAGE_SIGHT = 50;     // uma aldeia ou castro dá por uma força a esta distância
export const REPORT_CHANCE = 0.5, REPORT_GAP = 3;   // por força: no máximo um relato de 3 em 3 dias
export const RUMOR_CHANCE = 0.06, RUMOR_ZONE = 130; // rumor: zona larga, pouco fiável
export const ARMY_SIGHT = 90, ARMY_RUMOR = 0.2;     // o exército do pretor dá mais nas vistas do que uma patrulha
export const MESSENGER = 150;        // um dia de atraso por cada 150 de caminho do mensageiro (máx. 3)
export const SCOUTS = 2;             // batedores de um reconhecimento
export const RECON_RANGE = 250;      // até onde vão e voltam num dia
export const RECON_RADIUS = 110;     // o que veem à volta do ponto
const DRIFT = { pretor: 22 }, DRIFT_DEFAULT = 35, DRIFT_MAX = 150;   // a zona provável cresce com a idade do avistamento
const CLOSE = 30;                    // ENCOUNTER_RADIUS (simulation.js): tão perto é batalha, e o painel explica-a
const RELS = ['certa', 'boa', 'fraca'];
export const DIRS = ['norte', 'nordeste', 'este', 'sudeste', 'sul', 'sudoeste', 'oeste', 'noroeste'];

/** Quantos homens um observador conta: exato até 7, arredondado a 5 daí para cima (nunca mais preciso do que isso). */
export const estimateMen = n => (n <= 7 ? n : Math.round(n / 5) * 5);

/** Rumo de um deslocamento (y cresce para sul, como no mapa); null se não houver deslocamento. */
export function compass(dx, dy) {
  if (Math.hypot(dx, dy) < 1) return null;
  const a = Math.atan2(dx, -dy);   // 0 = norte, a rodar para este
  return DIRS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}
const okDir = d => DIRS.includes(d);
const SRCS = ['aldeia', 'rumor', 'fumo', 'inicio', 'batedores'];

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const num = Number.isFinite;
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);

/** Valida state.intel de uma gravação. */
export function validIntel(i) {
  if (!isObj(i) || !isObj(i.known) || !Array.isArray(i.reports) || !num(i.n) || i.reports.length > 500) return false;
  for (const k of Object.values(i.known)) {
    if (!isObj(k) || typeof k.kind !== 'string' || !num(k.x) || !num(k.y) || !num(k.day)) return false;
    if ('men' in k && k.men !== undefined && !(num(k.men) && k.men >= 0)) return false;
    if ('name' in k && k.name !== undefined && typeof k.name !== 'string') return false;
    if ('dir' in k && k.dir !== undefined && !okDir(k.dir)) return false;
  }
  for (const r of i.reports) {
    if (!isObj(r) || !num(r.id) || typeof r.kind !== 'string' || !num(r.x) || !num(r.y) || !(num(r.r) && r.r >= 0)) return false;
    if (!num(r.seen) || !num(r.got) || !RELS.includes(r.rel) || !SRCS.includes(r.src)) return false;
    for (const key of ['place', 'fid', 'name']) if (key in r && r[key] !== undefined && typeof r[key] !== 'string') return false;
    if ('found' in r && !(Array.isArray(r.found) && r.found.every(x => typeof x === 'string'))) return false;
    if ('men' in r && r.men !== undefined && !(num(r.men) && r.men >= 0)) return false;
    if ('dir' in r && r.dir !== undefined && !okDir(r.dir)) return false;
    if ('sizes' in r && !(Array.isArray(r.sizes) && r.sizes.every(x => num(x) && x >= 0))) return false;
    if ('dirs' in r && !(Array.isArray(r.dirs) && r.dirs.every(x => x === '' || okDir(x)))) return false;
  }
  return true;
}

/** As forças romanas tal como estão na simulação. Só para este módulo: a interface nunca as recebe. */
function realForces(state) {
  const road = state.world?.road || [];
  // `to`: para onde vai (o próximo ponto da estrada, ou o alvo dos caçadores); quem a vê percebe o rumo
  const out = (state.patrols || []).map(p => ({ id: String(p.id), kind: p.kind, x: p.x, y: p.y, men: p.men,
    to: p.hunt ? p.target : road[p.i] }));
  const p = state.praetor;
  if (p) out.push({ id: String(p.id ?? 'pretor'), kind: 'pretor', x: p.x, y: p.y, men: p.men, name: p.name });
  return out;
}

/** O rumo de uma força: para onde vai, ou, sem isso (o pretor), de onde a viste da última vez para onde está. */
function headingOf(f, prev, day) {
  if (f.to && num(f.to.x) && num(f.to.y)) { const d = compass(f.to.x - f.x, f.to.y - f.y); if (d) return d; }
  if (prev && day - prev.day <= 3 && Math.hypot(f.x - prev.x, f.y - prev.y) > 5) return compass(f.x - prev.x, f.y - prev.y);
  return null;
}
const see = (it, f, day) => {
  const prev = it.known[f.id];
  const k = { kind: f.kind, x: f.x, y: f.y, day };
  if (num(f.men)) k.men = f.men;
  if (f.name) k.name = f.name;
  const dir = headingOf(f, prev, day);
  if (dir) k.dir = dir;
  it.known[f.id] = k;
};
const addReport = (it, r) => { it.n += 1; const rep = { id: it.n, ...r }; it.reports.push(rep); return rep; };

/**
 * Cria state.intel se faltar (campanha nova ou gravação antiga): o que está à vista fica confirmado e,
 * havendo pretor fora da vista, um relato de onde está — no dia 0 sabe-se que junta o exército no posto.
 */
export function ensureIntel(state) {
  if (state.intel) return state.intel;
  const it = state.intel = { known: {}, reports: [], n: 0 };
  const real = realForces(state);
  for (const f of real) if (state.party && dist(f, state.party) <= SIGHT) see(it, f, state.day);
  const p = real.find(f => f.kind === 'pretor');
  if (p && !it.known[p.id]) {
    if (state.day === 0) addReport(it, { kind: 'pretor', x: p.x, y: p.y, r: 30, seen: 0, got: 0, rel: 'boa', src: 'inicio', fid: p.id, name: p.name });
    else rumor(it, state, p, makeRng(intelSeed(state)), state.day);
  }
  return it;
}

const intelSeed = state => ((state.seed | 0) * 31 + state.day * 104729 + 17) >>> 0;   // sorteio próprio: não mexe no do dia

function rumor(it, state, f, rng, got) {
  const w = state.world?.w ?? 1000, h = state.world?.h ?? 700, off = RUMOR_ZONE * 0.6;
  const x = Math.min(w, Math.max(0, f.x + rng.range(-off, off))), y = Math.min(h, Math.max(0, f.y + rng.range(-off, off)));
  const r = { kind: f.kind, x, y, r: RUMOR_ZONE, seen: state.day, got, rel: 'fraca', src: 'rumor', fid: f.id };
  if (f.name) r.name = f.name;
  return addReport(it, r);
}

/** O jogador venceu esta força: sabe que já não existe (nem ela nem os relatos dela). */
export function forgetForce(state, id) {
  if (!state.intel || id === undefined) return;
  const sid = String(id);
  delete state.intel.known[sid];
  state.intel.reports = (state.intel.reports || []).filter(r => String(r.fid) !== sid);
}

/** O jogador voltou a ver esta força (por exemplo, no fim de uma batalha que ela sobreviveu). */
export function rememberForce(state, id) {
  if (!state.intel || id === undefined) return;
  const f = realForces(state).find(x => x.id === String(id));
  if (f) see(state.intel, f, state.day);
}

/**
 * Atualiza o que o jogador sabe, no fim do dia (depois de tudo se mover). Não altera mais nada no estado.
 * `recon` é o ponto de um reconhecimento ordenado hoje; `dayEvents` são os eventos do dia (fumo de aldeias).
 * Devolve os eventos novos: { type: 'reconhecimento', … } e { type: 'relato', id } por cada relato que chega.
 */
export function updateIntel(state, { recon = null, dayEvents = [] } = {}) {
  const it = ensureIntel(state), day = state.day, events = [], real = realForces(state);
  const scouted = new Set(recon ? real.filter(f => dist(f, recon) <= RECON_RADIUS).map(f => f.id) : []);
  // 1. observação direta; quem entra na vista hoje (ontem não se via) tem uma linha no diário
  for (const f of real) {
    const d = dist(f, state.party);
    if (d > SIGHT) continue;
    const before = it.known[f.id], fresh = !before || before.day < day - 1;
    see(it, f, day);
    if (!fresh || d <= CLOSE || scouted.has(f.id)) continue;
    const ev = { type: 'avistamento', id: f.id, kind: f.kind, bearing: compass(f.x - state.party.x, f.y - state.party.y), far: Math.round(d) };
    if (num(f.men)) ev.men = estimateMen(f.men);
    if (it.known[f.id].dir) ev.dir = it.known[f.id].dir;
    if (f.name) ev.name = f.name;
    events.push(ev);
  }
  // 2. reconhecimento: confirma o que há na zona e apaga o que lá se julgava estar
  if (recon) {
    const found = real.filter(f => scouted.has(f.id));
    for (const f of found) see(it, f, day);
    for (const [id, k] of Object.entries(it.known)) if (k.day !== day && dist(k, recon) <= RECON_RADIUS) delete it.known[id];
    addReport(it, { kind: found.length ? 'forcas' : 'livre', x: recon.x, y: recon.y, r: RECON_RADIUS, seen: day, got: day, rel: 'certa', src: 'batedores',
      found: found.map(f => f.kind), sizes: found.map(f => (num(f.men) ? estimateMen(f.men) : 0)), dirs: found.map(f => it.known[f.id].dir || '') });
    events.push({ type: 'reconhecimento', found: found.map(f => f.kind), to: { x: recon.x, y: recon.y } });
  }
  // 3. avistamentos velhos de mais saem do mapa
  for (const [id, k] of Object.entries(it.known)) if (day - k.day > FORGET) delete it.known[id];
  // 4. fumo: uma aldeia queimada pelo pretor vê-se de longe
  for (const ev of dayEvents) {
    if (ev.type !== 'aldeia-queimada') continue;
    const v = state.world.settlements.find(s => s.id === ev.id), p = real.find(f => f.kind === 'pretor');
    if (v && p && !(it.known[p.id]?.day === day)) addReport(it, { kind: 'pretor', x: v.x, y: v.y, r: 25, seen: day, got: day, rel: 'boa', src: 'fumo', place: v.id, fid: p.id, name: p.name });
  }
  // 5. relatos de aldeias e castros, e rumores (sorteio próprio, determinista por semente e dia)
  const rng = makeRng(intelSeed(state));
  // Só dão relatos os lugares de pé e, nas comunidades do vale, as que a postura deixa (communities.newsFrom).
  const news = s => { const c = communityAt(state, s.id); return c ? newsFrom(c) : { delay: null, chance: 1 }; };
  const eyes = state.world.settlements.filter(s => (s.kind === 'castro' || (s.kind === 'aldeia' && !state.villages?.[s.id]?.burnt)) && news(s));
  for (const f of real) {
    if (it.known[f.id]?.day === day) continue;   // já a vês
    if (it.reports.some(r => r.fid === f.id && day - r.seen < REPORT_GAP)) continue;
    let near = null, nd = Infinity;
    const army = f.kind === 'pretor', sight = army ? ARMY_SIGHT : VILLAGE_SIGHT;
    for (const s of eyes) { const d = dist(s, f); if (d <= sight && d < nd) { nd = d; near = s; } }
    if (near) {
      if (!rng.chance(REPORT_CHANCE)) continue;
      const rule = news(near);
      if (rule.chance < 1 && !rng.chance(rule.chance)) continue;   // a neutra só às vezes
      const base = Math.min(3, Math.floor(dist(near, state.party) / MESSENGER));
      const delay = rule.delay === null ? base : rule.delay === 0 ? 0 : Math.max(rule.delay, base);   // a comprometida no próprio dia; a amiga com pelo menos um dia
      // A zona tem de conter qualquer posição em que a aldeia podia ter visto a força: o raio é o
      // próprio alcance da deteção (50; 90 para o exército do pretor). Um raio menor faria o relato mentir.
      const r = { kind: f.kind, x: near.x, y: near.y, r: sight, seen: day, got: day + delay, rel: 'boa', src: 'aldeia', place: near.id, fid: f.id };
      if (f.name) r.name = f.name;
      if (num(f.men)) r.men = estimateMen(f.men);   // contaram-nos de longe: uma estimativa, não o número
      const dir = headingOf(f, null, day);
      if (dir) r.dir = dir;
      addReport(it, r);
    } else if (rng.chance(army ? ARMY_RUMOR : RUMOR_CHANCE)) rumor(it, state, f, rng, day + 1);
  }
  // 6. relatos que chegam hoje (os de reconhecimento e de fumo já têm a sua linha no diário)
  for (const r of it.reports) if (r.got === day && r.src !== 'batedores' && r.src !== 'fumo') events.push({ type: 'relato', id: r.id });
  if (it.reports.length > REPORT_STORE) it.reports.splice(0, it.reports.length - REPORT_STORE);
  return events;
}

/**
 * O que a interface pode mostrar. Feito só de state.intel e do dia: nunca das posições reais.
 * forces: avistamentos (confirmada = vista hoje; estimada = última posição conhecida, com idade e zona provável r).
 * zones: relatos recentes para desenhar como zona (o mais novo por força, se não houver avistamento mais recente).
 * reports: os últimos relatos já recebidos, do mais novo para o mais velho.
 * recent: só os que ainda não são antigos; archive: os antigos (todos os guardados).
 */
export function intelView(state) {
  const it = state.intel, day = state.day;
  if (!it) return { forces: [], zones: [], reports: [] };
  const forces = [];
  for (const [id, k] of Object.entries(it.known)) {
    const age = Math.max(0, day - k.day);
    if (age > FORGET) continue;
    forces.push({ id, kind: k.kind, x: k.x, y: k.y, men: k.men, name: k.name, dir: k.dir, age, status: age === 0 ? 'confirmada' : 'estimada',
      r: age === 0 ? 0 : Math.min(DRIFT_MAX, age * (DRIFT[k.kind] ?? DRIFT_DEFAULT)) });
  }
  const reports = it.reports.filter(r => r.got <= day).map(r => {
    const age = Math.max(0, day - r.seen);
    return { id: r.id, kind: r.kind, x: r.x, y: r.y, r: r.r, age, old: age > REPORT_DAYS, rel: r.rel, src: r.src, place: r.place, name: r.name, found: r.found, fid: r.fid, got: r.got,
      men: r.men, dir: r.dir, sizes: r.sizes, dirs: r.dirs };
  }).reverse();
  const zones = [], done = new Set();
  for (const r of reports) {
    if (r.old) continue;
    if (r.src === 'batedores') { if (r.age === 0) zones.push(r); continue; }
    const key = r.fid ?? `r${r.id}`;
    if (done.has(key)) continue;
    done.add(key);
    const k = r.fid !== undefined ? it.known[r.fid] : null;
    if (k && day - k.day <= r.age) continue;   // há um avistamento tão ou mais recente
    zones.push(r);
  }
  // recent: o que serve para decidir hoje; archive: os antigos, guardados para consulta (nada se apaga)
  return { forces, zones, reports: reports.slice(0, REPORT_LIST), recent: reports.filter(r => !r.old).slice(0, REPORT_LIST), archive: reports.filter(r => r.old) };
}
