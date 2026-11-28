// PR #10 — qualidade da campanha: diário de espera, avistamentos, emboscada contra defesa de aldeia,
// painel de batalha, recusar o combate, relatos com efetivos e sentido de marcha, e o início da campanha.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newCampaign, foodPerDay } from '../src/campaign/state.js';
import { stepDay, HELP_FOOD } from '../src/campaign/simulation.js';
import { makeRng } from '../src/campaign/rng.js';
import { battleSpec } from '../src/campaign/battles.js';
import { createFlow } from '../src/campaign/flow.js';
import { ensureIntel, updateIntel, intelView, validIntel, estimateMen, REPORT_DAYS } from '../src/campaign/intel.js';
import { eventText, reportText, battleBrief, EPISODES, goalLines } from '../src/campaign/ui.js';
import { FIRST_SPAWN, FIRST_SPAWN_MIN } from '../src/campaign/doctrine.js';
import { makePraetor } from '../src/campaign/praetor.js';

const rng = () => makeRng(7);
const OFF = () => ({ mem: { emboscada: 0, coluna: 0, campo: 0, defesa: 0 }, sectors: [0, 0, 0, 0], activity: 0, active: {}, garrison: null, lastSeen: null, nextSpawn: 1e9, hunterAt: -999, off: true });
/**
 * Campanha controlada: estrada reta de (100,350) a (900,350) com pontos de 50 em 50, bando em (500,350),
 * sem pretor, sem colunas a sair, aldeias queimadas e sem castros (ninguém manda relatos).
 */
function quiet() {
  const s = newCampaign(3);
  s.food = 1000; s.praetor = null; s.patrols = []; s.party = { x: 500, y: 350 };
  s.world.road = Array.from({ length: 17 }, (_, k) => ({ x: 100 + 50 * k, y: 350 }));
  for (const v of Object.values(s.villages)) v.burnt = true;
  s.world.settlements = s.world.settlements.filter(x => x.kind !== 'castro');
  s.doctrine = OFF();
  return s;
}
/** Uma patrulha na estrada, a 35 (um dia) antes do bando, a caminho dele: amanhã está em cima do bando. */
const coming = (id = 'patrulha-1', kind = 'patrulha') => ({ id, kind, x: 465, y: 350, i: 8, dir: 1, men: 6 });
/** Uma aldeia intacta a 20 do bando. */
function villageNextTo(s, x = 500, y = 370) {
  const v = s.world.settlements.find(z => z.kind === 'aldeia');
  v.x = x; v.y = y; s.villages[v.id].burnt = false;
  return v;
}
const praetorAt = (x, y) => ({ id: 'vetilio', name: 'Caio Vetílio', x, y, men: 60, speed: 22, traits: { pursuit: 0, scorch: .5 }, rest: 99 });
const types = r => r.events.map(e => e.type);

// --- 3.1 esperar e esconder ---

test('esperar sem encontro escreve uma linha no diário, com a estrada e a comida gasta', () => {
  const s = quiet();
  const r = stepDay(s, { kind: 'esperar' }, rng());
  const ev = r.events.find(e => e.type === 'espera');
  assert.ok(ev, 'há um evento de espera');
  assert.deepEqual([ev.order, ev.road, ev.food], ['esperar', true, 2]);
  const t = eventText(ev, s);
  assert.match(t, /estrada/);
  assert.match(t, /Comida: −2/);
});

test('esperar longe da estrada avisa que assim não há emboscada', () => {
  const s = quiet(); s.party = { x: 500, y: 600 };
  const ev = stepDay(s, { kind: 'esperar' }, rng()).events.find(e => e.type === 'espera');
  assert.equal(ev.road, false);
  assert.match(eventText(ev, s), /longe da estrada/);
});

test('esconder também escreve no diário; acampar e marchar não', () => {
  const s = quiet();
  const ev = stepDay(s, { kind: 'esconder' }, rng()).events.find(e => e.type === 'espera');
  assert.equal(ev.order, 'esconder');
  assert.match(eventText(ev, s), /escond/i);
  assert.equal(types(stepDay(quiet(), { kind: 'acampar' }, rng())).includes('espera'), false);
  assert.equal(types(stepDay(quiet(), { kind: 'marchar', to: { x: 520, y: 350 } }, rng())).includes('espera'), false);
});

test('a espera que acaba em batalha não escreve a linha de espera (a batalha explica-se no painel)', () => {
  const s = quiet(); s.patrols = [coming()];
  const r = stepDay(s, { kind: 'esperar' }, rng());
  assert.ok(r.encounter);
  assert.equal(types(r).includes('espera'), false);
});

test('a linha de espera diz o que está à vista, mas só o que o jogador vê', () => {
  const s = quiet(); s.patrols = [{ id: 'patrulha-2', kind: 'patrulha', x: 330, y: 350, i: 5, dir: 1, men: 6 }];   // entra na vista e segue pela estrada
  ensureIntel(s);
  const r1 = stepDay(s, { kind: 'esperar' }, rng());
  const ev1 = r1.events.find(e => e.type === 'espera');
  assert.doesNotMatch(eventText(ev1, s, r1.events), /À vista/, 'no dia em que é avistada, a linha de avistamento chega');
  const r2 = stepDay(s, { kind: 'esperar' }, rng());
  const ev = r2.events.find(e => e.type === 'espera');
  assert.match(eventText(ev, s, r2.events), /À vista: uma patrulha/);
  const t = quiet(); t.patrols = [{ id: 'longe', kind: 'patrulha', x: 100, y: 350, i: 0, dir: -1, men: 6 }];
  t.patrols[0].x = 150; t.patrols[0].i = 1;   // fora da vista
  const ev2 = stepDay(t, { kind: 'esperar' }, rng()).events.find(e => e.type === 'espera');
  assert.doesNotMatch(eventText(ev2, t), /À vista/);
});

// --- 3.2 avistamentos ---

test('uma força que entra na vista dá uma linha de avistamento, uma só vez', () => {
  const s = quiet(); s.patrols = [{ id: 'patrulha-3', kind: 'patrulha', x: 680, y: 350, i: 11, dir: -1, men: 6 }];   // vem para o bando
  ensureIntel(s);
  const r1 = stepDay(s, { kind: 'acampar' }, rng());
  const av = r1.events.find(e => e.type === 'avistamento');
  assert.ok(av, 'avistamento no primeiro dia');
  assert.deepEqual([av.id, av.kind, av.dir], ['patrulha-3', 'patrulha', 'oeste']);
  assert.equal(av.bearing, 'este');
  const t = eventText(av, s);
  assert.match(t, /patrulha/); assert.match(t, / a este/); assert.match(t, /para oeste/);
  const r2 = stepDay(s, { kind: 'acampar' }, rng());
  assert.equal(types(r2).includes('avistamento'), false, 'continua à vista: não se repete');
});

test('uma força que nunca entra na vista não dá avistamento', () => {
  const s = quiet(); s.patrols = [{ id: 'p', kind: 'patrulha', x: 150, y: 350, i: 1, dir: -1, men: 6 }];
  ensureIntel(s);
  assert.equal(types(stepDay(s, { kind: 'acampar' }, rng())).includes('avistamento'), false);
});

test('o que os batedores encontram não dá também uma linha de avistamento', () => {
  const s = quiet(); s.party = { x: 500, y: 600 }; s.patrols = [{ id: 'p', kind: 'patrulha', x: 500, y: 350, i: 8, dir: -1, men: 6 }];
  ensureIntel(s);
  const r = stepDay(s, { kind: 'reconhecer', to: { x: 500, y: 380 } }, rng());
  assert.ok(types(r).includes('reconhecimento'));
  assert.equal(types(r).includes('avistamento'), false);
});

// --- 4. emboscada contra defesa de aldeia ---

test('à espera na estrada junto a uma aldeia, a patrulha que passa é emboscada (não é defesa da aldeia)', () => {
  const s = quiet(); villageNextTo(s); s.patrols = [coming()];
  const r = stepDay(s, { kind: 'esperar' }, rng());
  assert.equal(r.encounter.kind, 'patrulha');
  assert.equal(r.encounter.waiting, true);
  assert.equal(battleSpec(r.encounter, s, rng()).type, 'emboscada');
});

test('sem esperar, a mesma patrulha junto à aldeia continua a dar defesa da aldeia', () => {
  const s = quiet(); villageNextTo(s); s.patrols = [coming()];
  const r = stepDay(s, { kind: 'acampar' }, rng());
  assert.equal(r.encounter.kind, 'defesa');
});

test('o pretor a chegar a uma aldeia tem prioridade sobre a emboscada: é uma ameaça real', () => {
  const s = quiet(); villageNextTo(s); s.patrols = [coming()]; s.praetor = praetorAt(500, 395);
  const r = stepDay(s, { kind: 'esperar' }, rng());
  assert.equal(r.encounter.kind, 'defesa');
  assert.equal(r.encounter.foe.id, 'vetilio');
});

test('emboscada descoberta junto a uma aldeia: a luta é a defesa da aldeia, e o diário diz porquê', () => {
  const s = quiet(); villageNextTo(s); s.patrols = [coming()]; s.doctrine.off = false; s.doctrine.mem.emboscada = 5;   // Roma já conhece as emboscadas: batedores
  const r = stepDay(s, { kind: 'esperar' }, rng());
  assert.equal(r.encounter.kind, 'defesa');
  assert.ok(types(r).includes('emboscada-descoberta'));
});

// --- 5. painel de batalha ---

test('a especificação da batalha diz que força é, quantos são e o contexto do encontro', () => {
  const s = quiet(); s.patrols = [coming()];
  const r = stepDay(s, { kind: 'esperar' }, rng());
  const spec = battleSpec(r.encounter, s, rng());
  assert.deepEqual([spec.foeKind, spec.context], ['patrulha', 'emboscada']);
  const t = quiet(); t.patrols = [coming()];
  const spec2 = battleSpec(stepDay(t, { kind: 'acampar' }, rng()).encounter, t, rng());
  assert.deepEqual([spec2.type, spec2.context], ['campo-aberto', 'encontro']);
  const u = quiet(); u.party = { x: 500, y: 380 }; u.patrols = [coming()];   // a 30 da estrada: não serve para emboscar
  const enc = stepDay(u, { kind: 'esperar' }, rng()).encounter;
  assert.equal(battleSpec(enc, u, rng()).context, 'fora-estrada');
});

test('o texto do painel nomeia a força, o tamanho, o motivo e o que está em jogo', () => {
  const s = quiet(); s.patrols = [coming()];
  const spec = battleSpec(stepDay(s, { kind: 'acampar' }, rng()).encounter, s, rng());
  const t = battleBrief(spec, s);
  assert.match(t, /patrulha/i); assert.match(t, /6 romanos/); assert.match(t, /esbarr|deu convosco|encontr/i);
  const v = quiet(); const vil = villageNextTo(v); v.praetor = praetorAt(500, 395);
  const sv = battleSpec(stepDay(v, { kind: 'acampar' }, rng()).encounter, v, rng());
  const tv = battleBrief(sv, v);
  assert.match(tv, new RegExp(vil.name)); assert.match(tv, /Vetílio/); assert.match(tv, /arde/);
});

test('recusar a batalha decisiva: o bando recua para a serra, perde a retaguarda e o pretor reagrupa', () => {
  const f = createFlow({ seed: 11 });
  const s = f.state, serra = s.world.settlements.find(x => x.kind === 'serra');
  s.party = { x: serra.x + 40, y: serra.y }; s.praetor.x = s.party.x + 10; s.praetor.y = s.party.y;
  const r = f.order({ kind: 'acampar' });
  assert.equal(r.battle.type, 'decisiva');
  assert.equal(r.battle.withdraw.possible, true);
  const men = s.men, battles = s.battles || 0;
  const w = f.withdraw();
  assert.equal(f.phase, 'mapa');
  const ev = w.events.find(e => e.type === 'retirada');
  assert.ok(ev && ev.withdrew, 'evento de retirada sem combate');
  assert.ok(ev.lost >= 1 && s.men === men - ev.lost, 'a retaguarda paga');
  assert.deepEqual([s.party.x, s.party.y], [serra.x, serra.y]);
  assert.ok(s.praetor.rest > 0);
  assert.equal(s.battles || 0, battles, 'não conta como batalha');
  assert.match(eventText(ev, s), /retaguarda/);
});

test('recusar a defesa de uma aldeia: a aldeia arde', () => {
  const f = createFlow({ seed: 11 }); const s = f.state;
  const v = s.world.settlements.find(x => x.kind === 'aldeia'), serra = s.world.settlements.find(x => x.kind === 'serra');
  v.x = serra.x + 30; v.y = serra.y;
  s.party = { x: v.x, y: v.y + 10 }; s.praetor.x = v.x + 10; s.praetor.y = v.y - 25; s.praetor.rest = 99; s.day = 1;
  const r = f.order({ kind: 'acampar' });
  assert.equal(r.battle.type, 'defesa-aldeia');
  const w = f.withdraw();
  assert.equal(s.villages[v.id].burnt, true);
  assert.ok(w.events.some(e => e.type === 'aldeia-queimada'));
});

test('não se recusa uma emboscada nem um ataque escolhido, nem sem serra perto', () => {
  const s = quiet(); s.patrols = [coming()];
  const spec = battleSpec(stepDay(s, { kind: 'esperar' }, rng()).encounter, s, rng());
  assert.equal(spec.withdraw.possible, false);
  assert.equal(spec.withdraw.why, 'escolhida');
  const t = quiet(); t.world.settlements = t.world.settlements.filter(x => x.kind !== 'serra'); t.patrols = [coming()];
  const spec2 = battleSpec(stepDay(t, { kind: 'acampar' }, rng()).encounter, t, rng());
  assert.deepEqual([spec2.withdraw.possible, spec2.withdraw.why], [false, 'sem-serra']);
  const f = createFlow({ seed: 11 }); f.battle = spec; f.phase = 'batalha';
  const before = JSON.stringify(f.state);
  assert.equal(f.withdraw().refused, true);
  assert.equal(JSON.stringify(f.state), before, 'recusa sem mexer em nada');
  assert.equal(f.phase, 'batalha');
});

// --- 7. relatos com efetivos e sentido de marcha ---

test('estimativa de efetivos: exata até 7, arredondada a 5 a partir daí', () => {
  assert.deepEqual([4, 6, 7, 8, 12, 14, 60].map(estimateMen), [4, 6, 7, 10, 10, 15, 60]);
});

test('relato de aldeia traz uma estimativa e o sentido de marcha; o rumor não traz nenhum', () => {
  const s = quiet(); const v = villageNextTo(s, 300, 330); s.party = { x: 900, y: 650 };
  s.patrols = [{ id: 'c', kind: 'comboio', x: 310, y: 350, i: 5, dir: 1, men: 14 }];
  let rep = null;
  for (let d = 0; d < 20 && !rep; d++) { s.day = d; updateIntel(s); rep = s.intel.reports.find(r => r.src === 'aldeia'); }
  assert.ok(rep, 'a aldeia acaba por mandar relato');
  assert.deepEqual([rep.men, rep.dir, rep.place], [15, 'este', v.id]);
  assert.match(reportText(rep, s), /uns 15/); assert.match(reportText(rep, s), /este/);
  const r = quiet(); r.party = { x: 900, y: 650 }; r.patrols = [{ id: 'z', kind: 'patrulha', x: 300, y: 100, i: 0, dir: 1, men: 6 }];
  let rum = null;
  for (let d = 0; d < 200 && !rum; d++) { r.day = d; updateIntel(r); rum = r.intel.reports.find(x => x.src === 'rumor'); }
  assert.ok(rum);
  assert.equal(rum.men, undefined); assert.equal(rum.dir, undefined);
  assert.doesNotMatch(reportText(rum, r), /uns \d/);
  const p = { ...rum, kind: 'pretor' };
  assert.match(reportText(p, r), /fala-se do exército do pretor/, 'sem «de o»');
});

test('os batedores trazem o tamanho e o rumo do que viram', () => {
  const s = quiet(); s.party = { x: 500, y: 600 }; s.patrols = [{ id: 'p', kind: 'patrulha', x: 500, y: 350, i: 8, dir: 1, men: 9 }];
  ensureIntel(s);
  stepDay(s, { kind: 'reconhecer', to: { x: 500, y: 360 } }, rng());
  const rep = s.intel.reports.find(r => r.src === 'batedores');
  assert.deepEqual(rep.sizes, [10]); assert.deepEqual(rep.dirs, ['este']);
  assert.match(reportText(rep, s), /uns 10/);
});

test('validIntel aceita os campos novos e recusa valores estranhos', () => {
  const base = () => ({ known: { a: { kind: 'patrulha', x: 1, y: 1, day: 0, dir: 'norte' } }, reports: [{ id: 1, kind: 'patrulha', x: 0, y: 0, r: 50, seen: 0, got: 0, rel: 'boa', src: 'aldeia', men: 10, dir: 'sul' }], n: 1 });
  assert.equal(validIntel(base()), true);
  const bad1 = base(); bad1.reports[0].dir = 'cima'; assert.equal(validIntel(bad1), false);
  const bad2 = base(); bad2.reports[0].men = -3; assert.equal(validIntel(bad2), false);
  const bad3 = base(); bad3.known.a.dir = 7; assert.equal(validIntel(bad3), false);
  const bad4 = base(); bad4.reports[0].sizes = ['x']; assert.equal(validIntel(bad4), false);
});

// --- 6. arquivo de relatos ---

test('os relatos antigos saem da lista principal para o arquivo, sem se perderem', () => {
  const s = quiet(); const it = ensureIntel(s);
  for (let k = 0; k < 5; k++) it.reports.push({ id: ++it.n, kind: 'patrulha', x: 100 * k, y: 100, r: 50, seen: 0, got: 0, rel: 'boa', src: 'aldeia' });
  it.reports.push({ id: ++it.n, kind: 'comboio', x: 300, y: 300, r: 50, seen: REPORT_DAYS + 3, got: REPORT_DAYS + 3, rel: 'boa', src: 'aldeia' });
  s.day = REPORT_DAYS + 4;
  const v = intelView(s);
  assert.deepEqual(v.recent.map(r => r.kind), ['comboio']);
  assert.equal(v.reports.length, 6, 'a lista completa continua a existir');
  assert.equal(v.archive.length, 5);
  assert.ok(v.archive.every(r => r.old));
});

// --- 8. início da campanha ---

test('o primeiro destacamento sai num dia sorteado entre o mínimo e o habitual, determinista pela semente', () => {
  const firstDay = seed => {
    const s = newCampaign(seed);
    s.praetor = makePraetor('vetilio', makeRng(seed), s.world);
    for (let d = 0; d < 12; d++) { const day = s.day; stepDay(s, { kind: 'acampar' }, makeRng(seed + d)); if (s.patrols.length) return day; }
    return null;
  };
  const days = Array.from({ length: 40 }, (_, k) => firstDay(k + 1));
  assert.ok(days.every(d => d !== null && d >= FIRST_SPAWN_MIN && d <= FIRST_SPAWN), JSON.stringify(days));
  assert.ok(days.some(d => d < FIRST_SPAWN), 'há campanhas que começam mais cedo');
  assert.ok(new Set(days).size >= 3, 'e variam');
  assert.deepEqual(Array.from({ length: 40 }, (_, k) => firstDay(k + 1)), days, 'mesma semente, mesmo dia');
});

test('as gravações com o primeiro destacamento já marcado continuam iguais', () => {
  const s = newCampaign(5); s.doctrine = OFF(); s.doctrine.nextSpawn = 9; s.doctrine.off = false; s.praetor = null;
  for (let d = 0; d < 9; d++) stepDay(s, { kind: 'acampar' }, makeRng(d));
  assert.equal(s.patrols.length, 0, 'nada sai antes do dia marcado');
  stepDay(s, { kind: 'acampar' }, makeRng(99));
  assert.equal(s.patrols.length, 1);
});


// --- 6. legibilidade das zonas ---

test('as notas de zonas vizinhas não se sobrepõem no mapa', async () => {
  const { makeView, drawMap } = await import('../src/campaign/map-view.js');
  const s = quiet(); const it = ensureIntel(s);
  for (const [k, x] of [['patrulha', 300], ['comboio', 306], ['patrulha', 312]]) it.reports.push({ id: ++it.n, kind: k, x, y: 200, r: 50, seen: 0, got: 0, rel: 'boa', src: 'aldeia', fid: `${k}${x}` });
  const calls = [];
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, ...a]); }), set: (t, k, v) => { t[k] = v; return true; } });
  drawMap(ctx, makeView(s.world, 1000, 700), s);
  const notes = calls.filter(c => c[0] === 'fillText' && / · /.test(String(c[1])));
  assert.ok(notes.length >= 2, 'há notas');
  const box = c => ({ x: c[2] - String(c[1]).length * 2.5, y: c[3] - 10, w: String(c[1]).length * 5, h: 12 });
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (let i = 0; i < notes.length; i++) for (let j = i + 1; j < notes.length; j++) assert.equal(hit(box(notes[i]), box(notes[j])), false, `${notes[i][1]} / ${notes[j][1]}`);
});

test('o relato pouco fiável desenha-se com outro traço', async () => {
  const { makeView, drawMap } = await import('../src/campaign/map-view.js');
  const dashes = rel => {
    const s = quiet(); const it = ensureIntel(s);
    it.reports.push({ id: ++it.n, kind: 'patrulha', x: 300, y: 200, r: 130, seen: 0, got: 0, rel, src: rel === 'fraca' ? 'rumor' : 'aldeia', fid: 'z' });
    const calls = [];
    const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, ...a]); }), set: (t, k, v) => { t[k] = v; return true; } });
    drawMap(ctx, makeView(s.world, 1000, 700), s);
    return calls.filter(c => c[0] === 'setLineDash').map(c => JSON.stringify(c[1]));
  };
  assert.notDeepEqual(dashes('fraca'), dashes('boa'));
});

test('capítulo III no painel de batalha: diz o objetivo, sem instruções de teclas nem conselhos', () => {
  const t = EPISODES.acampamento[1];
  assert.doesNotMatch(t, /agacha|\(C\)/i, t);
  assert.match(t, /Queima os três depósitos e derruba o centurião/, t);
  assert.match(t, /Invenção do jogo/, 'continua a dizer que o episódio é invenção');
});

test('painel «Objetivo»: a comida vem dos castros e do saque, nunca «das aldeias»; o texto bate com a simulação real', () => {
  const s = newCampaign(11);
  const text = goalLines(s).join(' ');
  assert.match(text, /Comida: pede ajuda nos castros e obtém mantimentos como saque nas vitórias em combate/);
  assert.doesNotMatch(text, /pede-a nas aldeias|pede comida .*aldeia|comida.{0,40}aldeias? e saqueia/i, 'a indicação errada não pode voltar');
  assert.doesNotMatch(text, /Primeiros dias|clica numa/, 'sem conselhos de tutorial no Objetivo');
  // as mecânicas reais por trás do texto
  const at = (st, p) => { st.party.x = p.x; st.party.y = p.y; };
  const castro = s.world.settlements.find(x => x.kind === 'castro'), aldeia = s.world.settlements.find(x => x.kind === 'aldeia');
  at(s, castro); const f0 = s.food, need = foodPerDay(s.men);
  const help = stepDay(s, { kind: 'pedir-ajuda', id: castro.id }, makeRng(1)).events.filter(e => e.type === 'ajuda');
  assert.equal(help.length, 1, 'pedir ajuda num castro gera um evento «ajuda»');
  assert.equal(help[0].food, HELP_FOOD, 'o evento regista exatamente HELP_FOOD de comida');
  assert.equal(s.food, f0 + HELP_FOOD - need, 'o saldo sobe exatamente HELP_FOOD, menos o consumo do dia');
  const t = newCampaign(11), a2 = t.world.settlements.find(x => x.id === t.communities.souto.settlement);
  at(t, a2); const m0 = t.men, g0 = t.food;
  const ev = stepDay(t, { kind: 'recrutar', id: a2.id }, makeRng(1)).events;
  assert.ok(ev.some(e => e.type === 'recrutou') && t.men > m0, 'a aldeia dá homens');
  assert.ok(t.food <= g0, 'a aldeia não dá comida');
  assert.match(text, /Fama: sobe com vitórias, desce com derrotas e recuos/);
});
