// PR 5 — O Vale Vivo: o que a interface lê da campanha sem criar regras próprias.
// Nomes dos lugares, diário gravado, mudanças de postura, ordens de tributo pelo fluxo, pré-visualização das ações,
// fila de assuntos, interrupções e tempo. Tudo puro (sem DOM).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newCampaign, serialize, foodPerDay } from '../src/campaign/state.js';
import { createFlow, loadFlow, STORAGE_KEY } from '../src/campaign/flow.js';
import { stepDay } from '../src/campaign/simulation.js';
import { makeRng } from '../src/campaign/rng.js';
import { ensureDoctrine } from '../src/campaign/doctrine.js';
import { COMMUNITY_IDS, IDENTITY, postureFor, margin } from '../src/campaign/communities.js';
import { punish, burn, ensureRome, TRIBUTE } from '../src/campaign/rome.js';
import { MARCH_SPEED } from '../src/campaign/simulation.js';
import { intelView } from '../src/campaign/intel.js';
import { placeName, POSTURE_LABEL, SITUATION_LABEL } from '../src/campaign/strings.js';
import { postureSnapshot, postureChanges, record, validJournal, JOURNAL_MAX, categoryOf } from '../src/campaign/journal.js';
import { buildIssues, detectInterruptions, foodDays, interruptionText, LOW_FOOD_DAYS, RECENT_DAYS } from '../src/campaign/issues.js';
import { createI18n } from '../src/i18n/index.js';
import { SPEEDS, DAY_MS, SPEED_KEY, loadSpeed, saveSpeed, standingOrder } from '../src/campaign/pace.js';
import { eventText } from '../src/campaign/ui.js';

const fakeStorage = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };
/** Fluxo sem Roma por perto nem capítulos: só o que o teste lá puser. */
const quietFlow = (seed = 3) => {
  const f = createFlow({ storage: fakeStorage(), seed });
  const s = f.state; s.praetor = null; s.patrols = []; s.food = 1e5; s.men = 40; s.arms = 40; s.fame = 50; s.done.push('cativos');
  ensureDoctrine(s).nextSpawn = 1e9;
  return f;
};
const place = (s, id) => s.world.settlements.find(x => x.id === s.communities[id].settlement);
const MARGIN = { comprometida: [70, 10], amiga: [50, 30], neutra: [40, 30], receosa: [20, 50], colabora: [10, 70] };
const be = (c, p) => { [c.trust, c.fear] = MARGIN[p]; c.posture = postureFor(margin(c)); return c; };

// ——— nomes ———

test('nomes: o lugar de uma comunidade mostra o nome da comunidade, não o do mundo gerado', () => {
  const s = newCampaign(1);
  for (const id of COMMUNITY_IDS) assert.equal(placeName(s, s.communities[id].settlement), IDENTITY[id].name, id);
});

test('nomes: um lugar fora do vale com o nome de uma comunidade diz que é de fora do vale (não há dois «Ribeira»)', () => {
  const s = newCampaign(1);
  const names = s.world.settlements.map(x => placeName(s, x.id));
  assert.equal(new Set(names).size, names.length, 'nomes únicos');
  const twin = s.world.settlements.find(x => x.name === 'Aldeia da Ribeira' && x.id !== s.communities.ribeira.settlement);
  assert.ok(twin, 'a semente 1 tem o caso');
  assert.equal(placeName(s, twin.id), 'Aldeia da Ribeira (fora do vale)');
  assert.equal(placeName(s, 'inexistente'), null);
});

test('nomes: os textos de eventos usam o nome da comunidade', () => {
  const s = newCampaign(1), id = s.communities.ribeira.settlement;
  const world = s.world.settlements.find(x => x.id === id).name, t = eventText({ type: 'castigo', id, why: 'apoio' }, s);
  assert.notEqual(world, 'Aldeia da Ribeira', 'na semente 1 o lugar da Ribeira tem outro nome no mundo gerado');
  assert.match(t, /Aldeia da Ribeira/); assert.ok(!t.includes(world), t);
});

test('nomes: rótulos de postura e situação para as cinco posturas e as seis situações', () => {
  assert.deepEqual(Object.keys(POSTURE_LABEL), ['comprometida', 'amiga', 'neutra', 'receosa', 'colabora']);
  assert.deepEqual(Object.keys(SITUATION_LABEL), ['livre', 'tributada', 'castigada', 'ocupada', 'queimada', 'abandonada']);
});

// ——— diário ———

test('diário: postureChanges devolve uma entrada por comunidade que mudou de postura', () => {
  const s = newCampaign(3), before = postureSnapshot(s);
  assert.deepEqual(postureChanges(before, s), []);
  be(s.communities.souto, 'comprometida');
  assert.deepEqual(postureChanges(before, s), [{ type: 'postura', id: s.communities.souto.settlement, community: 'souto', from: before.souto, to: 'comprometida' }]);
});

test('diário: record guarda só o que conta para a história, com o dia, e não passa de JOURNAL_MAX', () => {
  const j = [];
  record(j, 4, [{ type: 'espera', order: 'acampar' }, { type: 'castigo', id: 'aldeia-1', why: 'apoio' }, { type: 'relato', id: 3 }]);
  assert.deepEqual(j, [{ day: 4, type: 'castigo', id: 'aldeia-1', why: 'apoio' }]);
  for (let i = 0; i < JOURNAL_MAX + 20; i++) record(j, i, [{ type: 'recrutou', id: 'x', men: 1 }]);
  assert.equal(j.length, JOURNAL_MAX); assert.equal(j.at(-1).day, JOURNAL_MAX + 19);
  assert.equal(categoryOf('recrutou'), 'decisao'); assert.equal(categoryOf('castigo'), 'roma'); assert.equal(categoryOf('postura'), 'postura');
});

test('diário: validJournal aceita o que record produz e recusa formas erradas', () => {
  const j = []; record(j, 1, [{ type: 'colheita', season: 'primavera', total: 10, villages: [] }]);
  assert.equal(validJournal(j), true); assert.equal(validJournal([]), true);
  for (const bad of [null, {}, [{ type: 'x' }], [{ day: 'a', type: 'x' }], new Array(JOURNAL_MAX + 1).fill({ day: 0, type: 'x' })]) assert.equal(validJournal(bad), false);
});

test('fluxo: as ordens registam no diário e acrescentam as mudanças de postura aos eventos', () => {
  const f = quietFlow(), s = f.state, p = place(s, 'souto');
  be(s.communities.souto, 'comprometida'); s.party = { x: p.x, y: p.y };
  s.communities.souto.trust = 48; s.communities.souto.fear = 10;   // margem 38: levar 5 de 15 jovens custa −6 e passa abaixo dos 35 (histerese)
  const r = f.order({ kind: 'recrutar', id: p.id });
  assert.ok(r.events.some(e => e.type === 'recrutou'));
  assert.ok(f.journal.some(e => e.type === 'recrutou' && e.day === 0));
  const ch = r.events.filter(e => e.type === 'postura');
  assert.deepEqual(ch.map(e => [e.community, e.from, e.to]), [['souto', 'comprometida', 'amiga']]);
  assert.ok(f.journal.some(e => e.type === 'postura' && e.community === 'souto'));
});

test('fluxo: o diário é gravado com a campanha e volta ao carregar; saves v:1 sem diário carregam com o diário vazio', () => {
  const st = fakeStorage(), f = createFlow({ storage: st, seed: 3 });
  f.state.done.push('cativos'); f.journal.push({ day: 0, type: 'colheita', season: 'primavera', total: 1, villages: [] }); f.save();
  assert.deepEqual(loadFlow(st).journal, f.journal);
  const env = JSON.parse(st.getItem(STORAGE_KEY)); delete env.journal; st.setItem(STORAGE_KEY, JSON.stringify(env));
  const g = loadFlow(st); assert.ok(g); assert.deepEqual(g.journal, []);
  env.journal = 'estragado'; st.setItem(STORAGE_KEY, JSON.stringify(env));
  const h = loadFlow(st); assert.ok(h, 'um diário inválido não deita a campanha fora'); assert.deepEqual(h.journal, []);
});

test('fluxo: um save v:1 antigo, sem comunidades, sem rome e sem diário, carrega', () => {
  const st = fakeStorage(), f = createFlow({ storage: st, seed: 3 });
  const env = JSON.parse(st.getItem(STORAGE_KEY));
  delete env.state.communities; delete env.state.rome; delete env.state.intel; delete env.journal;
  st.setItem(STORAGE_KEY, JSON.stringify(env));
  const g = loadFlow(st); assert.ok(g); assert.equal(g.phase, 'mapa'); assert.ok(g.state.communities.ribeira);
  assert.ok(buildIssues(g.state, g.journal).length >= 0);
});

// ——— tributo pelo fluxo ———

const owe = (f, id = 'souto', food = 20) => { const c = be(f.state.communities[id], 'amiga'); c.situation = 'tributada'; c.due = { food, day: f.state.day + 5 }; c.food = 100; return c; };

test('fluxo: payTribute e refuseTribute usam rome.js, gravam, vão ao diário e não passam o dia', () => {
  const f = quietFlow(), c = owe(f);
  const r = f.payTribute('souto');
  assert.equal(r.refused, false); assert.equal(f.state.day, 0); assert.equal(c.situation, 'livre'); assert.equal(c.food, 80);
  assert.ok(f.journal.some(e => e.type === 'tributo-pago' && e.auto === false));
  const g = quietFlow(), d = owe(g);
  const q = g.refuseTribute('souto');
  assert.equal(q.refused, false); assert.equal(d.situation, 'castigada');
  assert.ok(g.journal.some(e => e.type === 'tributo-recusado') && g.journal.some(e => e.type === 'castigo'));
});

test('fluxo: pagar sem comida é recusado (com o motivo), sem mexer em nada; fora do mapa também', () => {
  const f = quietFlow(), c = owe(f, 'souto', 200);
  const before = serialize(f.state);
  const r = f.payTribute('souto');
  assert.equal(r.refused, true); assert.equal(r.events[0].type, 'tributo-sem-comida'); assert.equal(serialize(f.state), before);
  assert.equal(f.refuseTribute('ribeira').refused, true, 'sem pedido pendente');
  f.phase = 'batalha'; assert.equal(f.payTribute('souto').refused, true);
  assert.equal(c.situation, 'tributada');
});

test('fluxo: preview mostra o resultado de uma ordem ou do tributo sem mexer no estado', () => {
  const f = quietFlow(), s = f.state, p = place(s, 'souto');
  be(s.communities.souto, 'comprometida'); s.party = { x: p.x, y: p.y };
  const before = serialize(s), journal = JSON.stringify(f.journal);
  const pv = f.preview({ kind: 'recrutar', id: p.id });
  assert.equal(pv.refused, false); assert.ok(pv.events.find(e => e.type === 'recrutou').men > 0);
  assert.ok(pv.state.communities.souto.away > 0);
  assert.equal(serialize(s), before); assert.equal(JSON.stringify(f.journal), journal);
  const far = f.preview({ kind: 'recrutar', id: place(s, 'fonte').id });
  assert.equal(far.refused, true); assert.equal(far.events[0].why, 'longe');
  owe(f, 'vau', 10);
  const pay = f.previewTribute('pagar', 'vau');
  assert.equal(pay.events[0].type, 'tributo-pago'); assert.equal(pay.state.communities.vau.food, 90); assert.equal(s.communities.vau.food, 100);
});

test('fluxo: preview e ordem dão o mesmo resultado (a pré-visualização não mente)', () => {
  const f = quietFlow(), s = f.state, p = place(s, 'souto');
  be(s.communities.souto, 'amiga'); s.party = { x: p.x, y: p.y };
  const pv = f.preview({ kind: 'recrutar', id: p.id });
  const r = f.order({ kind: 'recrutar', id: p.id });
  assert.deepEqual(r.events.find(e => e.type === 'recrutou'), pv.events.find(e => e.type === 'recrutou'));
  assert.equal(s.communities.souto.trust, pv.state.communities.souto.trust);
});

// ——— assuntos ———

test('assuntos: um tributo pendente é uma decisão com prazo, consequência real e ações pagar/recusar', () => {
  const f = quietFlow(), s = f.state; s.day = 10;
  const c = be(s.communities.ribeira, 'neutra'); c.situation = 'tributada'; c.due = { food: 12, day: 18 }; c.food = 50;
  const [i] = buildIssues(s, f.journal);
  assert.equal(i.kind, 'decisao'); assert.equal(i.type, 'tributo'); assert.equal(i.community, 'ribeira'); assert.equal(i.place, c.settlement);
  assert.equal(i.deadline, 8);
  assert.match(i.title, /tributo.*Aldeia da Ribeira/);
  assert.match(i.consequence, /castigada/); assert.match(i.consequence, new RegExp(`${25}`));
  assert.deepEqual(i.actions.map(a => a.id), ['pagar', 'recusar']);
});

test('assuntos: decisões primeiro, por prazo; depois o que merece atenção', () => {
  const f = quietFlow(), s = f.state; s.day = 10;
  for (const [id, day] of [['ribeira', 19], ['vau', 13]]) { const c = s.communities[id]; c.situation = 'tributada'; c.due = { food: 5, day }; }
  s.food = 3;   // menos de cinco dias de comida
  const all = buildIssues(s, f.journal);
  assert.deepEqual(all.slice(0, 2).map(i => i.community), ['vau', 'ribeira']);
  assert.equal(all[2].type, 'comida'); assert.equal(all[2].kind, 'atencao');
  assert.equal(foodDays(s), Math.floor(3 / Math.ceil(40 / 12)));
  assert.ok(foodDays(s) < LOW_FOOD_DAYS);
});

test('assuntos: acontecimentos recentes (castigo, postura, colheita) ficam RECENT_DAYS na coluna e podem ser dispensados', () => {
  const f = quietFlow(), s = f.state;
  record(f.journal, 0, [{ type: 'castigo', id: s.communities.vau.settlement, why: 'apoio' }]);
  s.day = RECENT_DAYS - 1;
  let all = buildIssues(s, f.journal);
  const k = all.find(i => i.type === 'castigo');
  assert.ok(k); assert.equal(k.community, 'vau'); assert.equal(k.deadline, null);
  assert.equal(buildIssues(s, f.journal, { dismissed: new Set([k.key]) }).some(i => i.type === 'castigo'), false);
  s.day = RECENT_DAYS; all = buildIssues(s, f.journal);
  assert.equal(all.some(i => i.type === 'castigo'), false);
});

test('assuntos: uma força romana só aparece se o jogador a conhece', () => {
  const f = quietFlow(), s = f.state, p = place(s, 'souto');
  s.patrols = [{ id: 'p9', kind: 'patrulha', x: p.x + 5, y: p.y, i: 1, dir: 1, men: 6 }];
  assert.equal(buildIssues(s, f.journal).some(i => i.type === 'ameaca' || i.type === 'patrulha'), false, 'ainda não vista');
  s.intel.known.p9 = { kind: 'patrulha', x: p.x + 5, y: p.y, day: s.day, men: 6 };
  const t = buildIssues(s, f.journal).find(i => i.type === 'ameaca');
  assert.ok(t); assert.equal(t.community, 'souto');
});

test('o idioma muda os textos da decisão e da mesma interrupção sem mudar o estado ou as opções', () => {
  const { state, journal } = quietFlow();
  const { vau } = state.communities;
  Object.assign(vau, { situation: 'tributada', due: { day: 4, food: 6 } });
  const before = JSON.stringify({ state, journal });
  const locale = createI18n({ languages: ['en'] });
  const events = [{ type: 'tributo-exigido', id: vau.settlement, food: 6, day: 4 }, { type: 'colheita', season: 'outono', total: 9 }];
  const reasons = detectInterruptions({ state, events });
  const harvest = { type: 'colheita', event: events[1] };   // a colheita já não interrompe, mas o registo usa o mesmo texto
  const [en] = buildIssues(state, journal, { i18n: locale });
  assert.match(en.title, /Rome demands tribute from Vau Village/);
  assert.match(interruptionText(reasons[0], state, locale), /Rome has demanded tribute from Vau Village/);
  assert.match(interruptionText(harvest, state, locale), /autumn harvest added 9 food/);
  locale.setLocale('pt-PT');
  const [pt] = buildIssues(state, journal, { i18n: locale });
  assert.match(pt.title, /Roma exige tributo a Aldeia do Vau/);
  assert.match(interruptionText(harvest, state, locale), /colheita de outono acrescentou 9/);
  assert.deepEqual([en.key, en.deadline, en.actions.map(a => a.id)], [pt.key, pt.deadline, pt.actions.map(a => a.id)]);
  assert.equal(JSON.stringify({ state, journal }), before);
});

// ——— interrupções ———

test('interrupções: só o tributo exigido para o tempo; postura, colheita e comida não interrompem', () => {
  const f = quietFlow(), s = f.state, id = s.communities.vau.settlement;
  const mem = {};
  const r = detectInterruptions({ state: s, events: [{ type: 'tributo-exigido', id, food: 5, day: 10 }, { type: 'postura', id, community: 'vau', from: 'amiga', to: 'neutra' }, { type: 'colheita', season: 'primavera', total: 9, villages: [] }, { type: 'espera' }], memory: mem });
  assert.deepEqual(r.map(x => x.type), ['pedido']);
  assert.deepEqual(detectInterruptions({ state: s, events: [{ type: 'postura', id, community: 'vau', from: 'amiga', to: 'neutra' }, { type: 'colheita', season: 'primavera', total: 9, villages: [] }], memory: {} }), [], 'postura e colheita são informação: não param o tempo');
  for (const what of ['crise', 'desertor']) {
    assert.deepEqual(detectInterruptions({ state: s, events: [{ type: 'capitao', what, id: 'c1', name: 'Caturo' }], memory: {} }).map(x => x.type), ['capitao'], `decisão obrigatória do capitão (${what}) para o tempo`);
  }
  s.food = foodPerDay(s.men) * 2; // 2 dias de comida: baixa, mas não esgotada.
  assert.equal(foodDays(s), 2);
  assert.deepEqual(detectInterruptions({ state: s, events: [], memory: mem }).map(x => x.type), [], 'comida baixa nunca interrompe');
  assert.equal(mem.lowFood, true);
  assert.equal(mem.emptyFood, false);
  s.food = 0;
  assert.deepEqual(detectInterruptions({ state: s, events: [], memory: mem }), [], 'comida esgotada também não interrompe');
  assert.equal(mem.emptyFood, true);
  s.food = 1e4;
  detectInterruptions({ state: s, events: [], memory: mem });
  assert.equal(mem.lowFood, false);
  assert.equal(mem.emptyFood, false);
  s.food = foodPerDay(s.men) * 2;
  assert.deepEqual(detectInterruptions({ state: s, events: [], memory: mem }), [], 'nova quebra não interrompe');
});

test('interrupções: uma força avistada perto do bando ou de uma aldeia amiga não para o tempo (fica no mapa)', () => {
  const f = quietFlow(), s = f.state;
  s.intel.known = { p1: { kind: 'patrulha', x: s.party.x + MARCH_SPEED - 1, y: s.party.y, day: s.day, men: 6 } };
  assert.deepEqual(detectInterruptions({ state: s, events: [{ type: 'avistamento', id: 'p1', kind: 'patrulha' }], memory: {} }), []);
  assert.ok(intelView(s).forces.some(x => x.id === 'p1'), 'a força continua no mapa');
  const g = quietFlow(), t = g.state, v = place(t, 'vau'); t.party = { x: 0, y: 0 };
  be(t.communities.vau, 'amiga');
  t.intel.known = { p2: { kind: 'patrulha', x: v.x + 10, y: v.y, day: t.day, men: 6 } };
  assert.deepEqual(detectInterruptions({ state: t, events: [], memory: {} }), []);
});

test('interrupções: uma batalha pedida interrompe', () => {
  const f = quietFlow();
  assert.deepEqual(detectInterruptions({ state: f.state, events: [], memory: {}, battle: { type: 'emboscada' } }).map(x => x.type), ['batalha']);
});

// ——— tempo ———

test('tempo: velocidades 1×, 2×, 4×; guardada à parte da gravação; valores estranhos voltam a 1', () => {
  assert.deepEqual(SPEEDS, [1, 2, 4]); assert.ok(DAY_MS > 0);
  const st = fakeStorage();
  assert.equal(loadSpeed(st), 1);
  saveSpeed(st, 4); assert.equal(loadSpeed(st), 4); assert.equal(st.getItem(SPEED_KEY), '4');
  assert.equal(st.getItem(STORAGE_KEY), null, 'não toca na gravação da campanha');
  st.setItem(SPEED_KEY, '3'); assert.equal(loadSpeed(st), 1);
  assert.equal(loadSpeed(null), 1);
  assert.doesNotThrow(() => saveSpeed({ setItem() { throw new Error('quota'); } }, 2));
});

test('tempo: a ordem de cada dia vem do destino ou da postura do bando; sem nada, acampa', () => {
  const s = newCampaign(3);
  assert.deepEqual(standingOrder({}, s), { kind: 'acampar' });
  assert.deepEqual(standingOrder({ stance: 'esperar' }, s), { kind: 'esperar' });
  assert.deepEqual(standingOrder({ stance: 'esconder' }, s), { kind: 'esconder' });
  assert.deepEqual(standingOrder({ dest: { x: 10, y: 20 } }, s), { kind: 'marchar', to: { x: 10, y: 20 } });
});

test('a interface não muda a simulação: os mesmos dias pelo fluxo dão o mesmo estado que stepDay direto', () => {
  const a = createFlow({ storage: fakeStorage(), seed: 9 }), b = createFlow({ storage: fakeStorage(), seed: 9 });
  for (const f of [a, b]) { f.state.done.push('cativos'); f.state.food = 1e4; }
  for (let i = 0; i < 60 && a.phase === 'mapa'; i++) {
    a.preview({ kind: 'acampar' }); buildIssues(a.state, a.journal); detectInterruptions({ state: a.state, events: [], memory: {} });
    a.order({ kind: 'acampar' });
    b.order({ kind: 'acampar' });
  }
  assert.equal(serialize(a.state), serialize(b.state));
});

// ——— revisão do PR 5: a pré-visualização respeita as batalhas agendadas; o Diário guarda o dia certo ———
import { CATIVOS_FROM, CATIVOS_TO } from '../src/campaign/events.js';

/** Fluxo calmo SEM «Os Cativos» já vividos: o capítulo agendado está em jogo entre os dias 10 e 20. */
const scheduledFlow = (day, seed = 3) => {
  const st = fakeStorage(), f = createFlow({ storage: st, seed }), s = f.state;
  s.praetor = null; s.patrols = []; s.food = 1e5; s.men = 40; s.arms = 40; s.fame = 50; ensureDoctrine(s).nextSpawn = 1e9;
  s.day = day;
  const p = place(s, 'souto'); be(s.communities.souto, 'amiga'); s.party = { x: p.x, y: p.y };
  f.save();
  return { f, st, p };
};

for (const day of [CATIVOS_FROM, CATIVOS_FROM + 1, CATIVOS_TO]) {
  test(`preview no dia ${day}: «Os Cativos» estão agendados — a ordem não se cumpre, e a pré-visualização diz o mesmo que a execução`, () => {
    const { f, st, p } = scheduledFlow(day), s = f.state, o = { kind: 'recrutar', id: p.id };
    const before = serialize(s), journal = JSON.stringify(f.journal), saved = st.getItem(STORAGE_KEY);
    const pv = f.preview(o);
    assert.equal(pv.executes, false, 'a ordem não se cumpre');
    assert.equal(pv.scheduled?.id, 'cativos'); assert.equal(pv.battle?.chapter, 'cativos'); assert.equal(pv.battle?.type, 'historica');
    assert.deepEqual(pv.events, [], 'sem ganhos nem custos de uma ação que não acontece');
    assert.equal(pv.state.communities.souto.away, 0); assert.equal(pv.state.men, s.men);
    assert.equal(serialize(s), before, 'o estado real não muda'); assert.equal(JSON.stringify(f.journal), journal, 'nem o Diário');
    assert.equal(st.getItem(STORAGE_KEY), saved, 'nem a gravação');
    const r = f.order(o);
    assert.equal(f.phase, 'batalha'); assert.deepEqual(r.battle, pv.battle, 'a batalha prevista é a que começa');
    assert.deepEqual(r.events, []); assert.equal(s.men, 40, 'não recrutou'); assert.equal(s.day, day, 'o dia não passou');
  });
}

test('preview fora da janela dos Cativos (dias 9 e 21): a ordem cumpre-se e a pré-visualização bate com a execução', () => {
  for (const day of [CATIVOS_FROM - 1, CATIVOS_TO + 1]) {
    const { f, p } = scheduledFlow(day), o = { kind: 'recrutar', id: p.id };
    const pv = f.preview(o);
    assert.equal(pv.executes, true, `dia ${day}`); assert.equal(pv.scheduled, null);
    const r = f.order(o);
    assert.equal(f.phase, 'mapa');
    assert.deepEqual(r.events.find(e => e.type === 'recrutou'), pv.events.find(e => e.type === 'recrutou'), `dia ${day}`);
    assert.equal(f.state.men, pv.state.men);
  }
});

test('preview fora do mapa (batalha em curso): não se cumpre nada, como em flow.order', () => {
  const { f, p } = scheduledFlow(5); f.phase = 'batalha';
  const pv = f.preview({ kind: 'recrutar', id: p.id });
  assert.equal(pv.executes, false); assert.equal(pv.refused, true); assert.deepEqual(pv.events, []);
});

test('Diário: um tributo exigido no dia X fica no dia X, com o vencimento à parte', () => {
  const f = quietFlow(), s = f.state, c = be(s.communities.ribeira, 'neutra');   // neutra: fica tributada (não paga sozinha)
  c.food = 120; s.day = 91;
  const r = f.order({ kind: 'acampar' });
  const ev = r.events.find(e => e.type === 'tributo-exigido');
  assert.ok(ev, 'Roma exigiu tributo no início do verão'); assert.equal(s.day, 92); assert.equal(ev.day, 102, 'o evento da simulação não muda');
  const j = f.journal.find(e => e.type === 'tributo-exigido');
  assert.equal(j.day, 92, 'no Diário, o dia em que foi exigido'); assert.equal(j.dueDay, 102, 'o prazo fica guardado');
  assert.equal(c.due.day - j.day, TRIBUTE.days, 'dez dias de prazo, como a regra');
  assert.equal(f.journal.find(e => e.type === 'colheita').day, 92, 'a colheita do fim da primavera também é do dia 92');
});

test('Diário: o que a ordem faz fica no dia em que se deu a ordem; o que vem depois da viragem do dia, no dia seguinte', () => {
  const f = quietFlow(), s = f.state, p = place(s, 'souto'); be(s.communities.souto, 'amiga'); s.party = { x: p.x, y: p.y }; s.day = 91;
  f.order({ kind: 'recrutar', id: p.id });
  assert.equal(f.journal.find(e => e.type === 'recrutou').day, 91);
  assert.equal(f.journal.find(e => e.type === 'colheita').day, 92);
});

test('Diário: record nunca deixa o «day» de um evento tapar o dia em que aconteceu', () => {
  const j = []; record(j, 7, [{ type: 'tributo-exigido', id: 'aldeia-1', food: 5, day: 17 }]);
  assert.deepEqual(j, [{ type: 'tributo-exigido', id: 'aldeia-1', food: 5, day: 7, dueDay: 17 }]);
  assert.equal(validJournal(j), true);
});

test('preview de uma ordem que leva a combate: prevê a mesma batalha que a execução começa', () => {
  const f = quietFlow(), s = f.state, posto = s.world.settlements.find(x => x.kind === 'posto');
  s.party = { x: posto.x, y: posto.y };
  const o = { kind: 'atacar', id: posto.id }, pv = f.preview(o), r = f.order(o);
  assert.equal(pv.executes, true); assert.ok(pv.battle);
  assert.equal(r.battle.type, pv.battle.type); assert.deepEqual(r.battle.enemies, pv.battle.enemies);   // a semente não é da pré-visualização: sai do sorteio do dia
});
