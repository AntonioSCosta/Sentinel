// Roma aprende: memória dos padrões de combate do bando, contramedidas e pressão romana.
// Módulo puro (sem DOM nem Three.js). O estado vive em state.doctrine e é criado na primeira utilização,
// por isso campanhas gravadas antes desta mecânica continuam a carregar.
//
// Ideia: cada combate deixa um rasto (o padrão e o troço da estrada). Um hábito repetido passa o limiar
// de uma contramedida e Roma adota-a; a memória decai e, se o bando mudar de método, Roma esquece-a.
// Cada contramedida tem resposta: quase sempre, fazer outra coisa ou noutro sítio.

const okNum = x => typeof x === 'number' && Number.isFinite(x);
const okObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const okPoint = p => okObj(p) && okNum(p.x) && okNum(p.y);

/** Uma doutrina gravada é utilizável? (deserialize recusa a gravação se não for.) */
export function validDoctrine(d) {
  if (!okObj(d) || !okObj(d.mem) || !okObj(d.active)) return false;
  if (!['emboscada', 'coluna', 'campo', 'defesa'].every(k => okNum(d.mem[k]) && d.mem[k] >= 0)) return false;
  if (!Array.isArray(d.sectors) || d.sectors.length !== SECTORS || !d.sectors.every(v => okNum(v) && v >= 0)) return false;
  if (!okNum(d.activity) || d.activity < 0 || !okNum(d.hunterAt)) return false;
  if (!Object.values(d.active).every(v => typeof v === 'boolean')) return false;
  if (d.garrison !== null && !(Number.isInteger(d.garrison) && d.garrison >= 0 && d.garrison < SECTORS)) return false;
  if (d.lastSeen !== null && !okPoint(d.lastSeen)) return false;
  if (d.nextSpawn !== null && !okNum(d.nextSpawn)) return false;
  return typeof d.off === 'boolean';
}

/** Um caçador gravado tem posição, alvo e dias válidos (os outros destacamentos não mudaram). */
export const validHunter = p => !p?.hunt || (okPoint(p) && okPoint(p.target) && okNum(p.left) && okNum(p.men));

/** Padrões que Roma distingue, a partir do tipo de batalha. As batalhas impostas (decisiva, capítulos) não contam. */
const PATTERN = { emboscada: 'emboscada', 'assalto-coluna': 'coluna', 'campo-aberto': 'campo', 'defesa-aldeia': 'defesa' };
export const SECTORS = 4;          // a estrada dividida em troços, para saber se o bando repete o sítio
export const HALF_LIFE = 60;       // dias para a memória de um padrão cair para metade
export const ACT_HALF_LIFE = 20;   // dias para a atividade recente cair para metade
export const FAME_PER_PRESSURE = 25;   // cada 25 de fama vale 1 de pressão: a fama recruta, mas chama Roma
export const FIRST_SPAWN = 6;      // o primeiro destacamento sai do posto a partir deste dia
export const HUNT_DAYS = 12, HUNT_SPEED = 32, HUNT_SIGHT = 90, HUNT_GAP = 15, HUNT_MEN = 10;

/**
 * Contramedidas: `on` liga, `off` desliga (histerese, para não piscar no limite).
 * Os valores vêm do npm run balance (secção «Roma aprende» da especificação da campanha).
 */
export const COUNTERS = {
  // emboscadas a patrulhas: passam a levar batedores a cavalo à frente e a emboscada é descoberta
  batedores: { pattern: 'emboscada', on: 1.8, off: 0.8 },
  // assaltos a colunas: escolta reforçada
  escolta: { pattern: 'coluna', on: 1.8, off: 0.8, men: 6 },
  // combates em campo aberto: as patrulhas andam em força
  forca: { pattern: 'campo', on: 3, off: 1.5, men: 3 },
  // o mesmo troço da estrada, seja qual for o alvo: Roma guarnece-o e nenhuma emboscada lá passa despercebida
  guarnicao: { sector: true, on: 3.5, off: 1.8 },
  // muita pressão (fama e atividade): sai uma coluna de caçadores atrás do último sítio onde o bando foi visto
  cacadores: { pressure: true, on: 7, off: 4 },
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const decay = (v, half) => v * Math.pow(0.5, 1 / half);

/** O estado da doutrina, criado na primeira vez (campanhas antigas não o têm). */
export function ensureDoctrine(state) {
  if (!state.doctrine) state.doctrine = {
    mem: { emboscada: 0, coluna: 0, campo: 0, defesa: 0 }, sectors: new Array(SECTORS).fill(0),
    activity: 0, active: {}, garrison: null, lastSeen: null, nextSpawn: null, hunterAt: -999, off: false,
  };
  return state.doctrine;
}

/** O padrão que Roma regista de uma batalha, ou null. */
export const patternOf = spec => (spec && PATTERN[spec.type]) || null;

/** Troço (0..SECTORS-1) da estrada mais próximo de p. */
export function sectorOf(world, p) {
  const road = world.road;
  let best = 0, bd = Infinity;
  for (let i = 0; i < road.length; i++) { const d = dist(road[i], p); if (d < bd) { bd = d; best = i; } }
  return Math.min(SECTORS - 1, Math.floor(best * SECTORS / road.length));
}

/** Regista um combate: o padrão, o troço e a atividade, e onde o bando foi visto. */
export function observe(state, spec) {
  const d = ensureDoctrine(state);
  d.activity += 1;
  const where = spec?.where;
  if (where && Number.isFinite(where.x) && Number.isFinite(where.y)) d.lastSeen = { x: where.x, y: where.y, day: state.day };
  const pat = patternOf(spec);
  if (!pat) return;
  d.mem[pat] += 1;
  if (where && Number.isFinite(where.x) && Number.isFinite(where.y) && (pat === 'emboscada' || pat === 'coluna')) d.sectors[sectorOf(state.world, where)] += 1;
}

/** Pressão romana na região: fama (permanente) mais atividade recente (decai). */
export function pressure(state) {
  const d = state.doctrine, fame = Number.isFinite(state.fame) ? Math.max(0, state.fame) : 0;
  return fame / FAME_PER_PRESSURE + (d && Number.isFinite(d.activity) ? d.activity : 0);
}

export const isActive = (state, id) => !!state.doctrine?.active?.[id];

/** Valor que decide cada contramedida, para o estado atual da memória. */
function level(state, d, id) {
  const c = COUNTERS[id];
  if (c.pattern) return d.mem[c.pattern];
  if (c.sector) return Math.max(...d.sectors);
  return pressure(state);
}

/** Um dia: liga ou desliga contramedidas (com relato), lança caçadores e deixa a memória decair. */
export function tickDoctrine(state) {
  const d = ensureDoctrine(state), events = [];
  for (const id of Object.keys(COUNTERS)) {
    const c = COUNTERS[id], v = level(state, d, id), was = !!d.active[id];
    const now = d.off ? false : was ? v >= c.off : v >= c.on;
    if (now !== was) { d.active[id] = now; events.push({ type: 'doutrina', id, on: now }); }
  }
  d.garrison = d.active.guarnicao ? d.sectors.indexOf(Math.max(...d.sectors)) : null;
  if (d.active.cacadores && d.lastSeen && !state.patrols.some(p => p.hunt) && state.day - d.hunterAt >= HUNT_GAP) {
    const postos = state.world.settlements.filter(s => s.kind === 'posto');
    if (postos.length) {
      const from = postos.reduce((a, b) => (dist(b, d.lastSeen) < dist(a, d.lastSeen) ? b : a));
      const men = HUNT_MEN + Math.min(10, Math.floor(pressure(state)));
      state.patrols.push({ id: `cacadores-${state.day}`, kind: 'cacadores', hunt: true, x: from.x, y: from.y, men,
        target: { x: d.lastSeen.x, y: d.lastSeen.y }, left: HUNT_DAYS });
      d.hunterAt = state.day;
      events.push({ type: 'cacadores', men });
    }
  }
  for (const k of Object.keys(d.mem)) d.mem[k] = decay(d.mem[k], HALF_LIFE);
  d.sectors = d.sectors.map(v => decay(v, HALF_LIFE));
  d.activity = decay(d.activity, ACT_HALF_LIFE);
  return events;
}

/** Os caçadores andam para o último sítio onde viram o bando; se o virem (sem estar escondido), seguem-no. Somem ao fim de HUNT_DAYS. */
export function moveHunter(state, h, hidden) {
  if (!hidden && dist(state.party, h) <= HUNT_SIGHT) h.target = { x: state.party.x, y: state.party.y };
  const d = dist(h, h.target);
  if (d <= HUNT_SPEED) { h.x = h.target.x; h.y = h.target.y; } else { h.x += (h.target.x - h.x) / d * HUNT_SPEED; h.y += (h.target.y - h.y) / d * HUNT_SPEED; }
  h.left -= 1;
  return h.left > 0;
}

/** Uma emboscada na estrada é descoberta? Devolve a razão ('batedores' | 'guarnicao') ou null. */
export function spottedAmbush(state, foe) {
  const d = state.doctrine;
  if (!d) return null;
  if (d.active.batedores && foe?.kind === 'patrulha') return 'batedores';
  if (d.active.guarnicao && d.garrison !== null && sectorOf(state.world, state.party) === d.garrison) return 'guarnicao';
  return null;
}

/** Homens a mais num destacamento que sai agora: escolta ou força, mais a pressão (até +6). */
export function escortBonus(state, kind) {
  const d = state.doctrine;
  let n = Math.min(6, Math.floor(pressure(state) / 3));
  if (d?.active?.escolta && kind === 'comboio') n += COUNTERS.escolta.men;
  if (d?.active?.forca && kind === 'patrulha') n += COUNTERS.forca.men;
  return n;
}

/** Dias até ao destacamento seguinte: 6–9 em sossego, 3–5 com muita pressão. */
export function nextSpawnGap(state, rng) {
  const p = pressure(state);
  const lo = Math.max(3, Math.min(6, Math.round(6 - p / 2)));
  const hi = Math.max(lo + 1, Math.min(9, Math.round(9 - p / 2)));
  return rng.int(lo, hi);
}
