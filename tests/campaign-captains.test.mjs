// Capitães do bando (captains.js): geração determinística, migração de gravações, passivas no mapa com o «mais forte
// ganha» e os tetos, evolução por cartas, lealdade, deserção, traição, reserva, recrutamento e o desertor romano.
// Tudo puro (sem DOM); a interface está em tools/smoke-campaign.mjs e no E2E do arranque normal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newCampaign, serialize, deserialize } from '../src/campaign/state.js';
import { createFlow, loadFlow, STORAGE_KEY } from '../src/campaign/flow.js';
import { stepDay } from '../src/campaign/simulation.js';
import { makeRng } from '../src/campaign/rng.js';
import { buildIssues, detectInterruptions } from '../src/campaign/issues.js';
import { ensureDoctrine } from '../src/campaign/doctrine.js';
import { createI18n } from '../src/i18n/index.js';
import { ARCHETYPES, TRAITS, SCARS, RULES } from '../src/campaign/captains-data.js';
import {
  ensureCaptains, validCaptains, reconRange, reconRadius, sightOf, ambushKeep, recruitArms, lossKeep, legacyBonus,
  famineSave, desertionMen, afterBattle, afterDay, drawCards, chooseCard, setActive, answerCrisis, answerDeserter, captainAt, recruitCaptain,
} from '../src/campaign/captains.js';

const fakeStorage = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };

/** Uma campanha com os capitães pedidos, todos ativos salvo `reserve` (ids, por ordem: cap-1, cap-2…). */
function withCaptains(list, { seed = 7, reserve = [] } = {}) {
  const s = newCampaign(seed);
  s.captains = []; s.captainSeq = 0;
  list.forEach(([archetype, traits = []], i) => {
    s.captainSeq += 1;
    s.captains.push({ id: `cap-${i + 1}`, name: `Capitão ${i + 1}`, archetype, level: 1, xp: 0, loyalty: 60, traits: [...traits],
      activeSkill: ARCHETYPES[archetype].skill, active: !reserve.includes(i) });
  });
  return s;
}
const serraOf = s => s.world.settlements.find(x => x.kind === 'serra');
const ambushSpec = (s, extra = {}) => ({ type: 'emboscada', realMen: s.men, allies: s.men, enemies: { legio: 5, velites: 1, centurion: false },
  bonus: { allies: 0, enemies: 0 }, where: { ...s.party }, ...extra });
const win = (food = 15, arms = 4) => [{ type: 'vitoria', lost: 0, food, arms, fame: 5 }];

// ——— geração e gravação ———

test('a mesma semente dá sempre os mesmos dois capitães iniciais, diferentes e nunca o Veterano', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const a = newCampaign(seed), b = newCampaign(seed);
    ensureCaptains(a); ensureCaptains(b);
    assert.deepEqual(a.captains, b.captains);
    assert.equal(a.captains.length, 2);
    assert.notEqual(a.captains[0].archetype, a.captains[1].archetype);
    assert.notEqual(a.captains[0].name, a.captains[1].name);
    for (const c of a.captains) {
      assert.ok(ARCHETYPES[c.archetype].start, c.archetype);
      assert.ok(c.loyalty >= 55 && c.loyalty <= 65 && c.active && c.level === 1 && c.xp === 0 && c.traits.length === 0);
      seen.add(c.archetype);
    }
  }
  assert.deepEqual([...seen].sort(), Object.keys(ARCHETYPES).filter(k => ARCHETYPES[k].start).sort(), 'todos os arquétipos iniciais aparecem');
});

test('criar os capitães não mexe no resto do estado nem no gerador do dia', () => {
  const plain = newCampaign(11), withC = newCampaign(11);
  ensureCaptains(withC);
  const { captains, captainSeq, ...rest } = withC;
  assert.deepEqual(rest, plain);
  // o mesmo dia com e sem capitães (sem passivas em jogo: acampar) dá os mesmos sorteios
  const a = newCampaign(11), b = newCampaign(11);
  ensureCaptains(b); b.captains.forEach(c => { c.active = false; });
  stepDay(a, { kind: 'acampar' }, makeRng(99)); stepDay(b, { kind: 'acampar' }, makeRng(99));
  const strip = ({ captains, captainSeq, ...x }) => x;
  assert.deepEqual(strip(b), strip(a));
});

test('uma gravação antiga sem capitães ganha os dois da semente, seja qual for o dia em que é carregada', () => {
  const mk = day => {
    const s = newCampaign(23); s.day = day;
    const store = fakeStorage();
    store.setItem(STORAGE_KEY, JSON.stringify({ v: 1, phase: 'mapa', state: JSON.parse(serialize(s)), battle: null, journal: [] }));
    return loadFlow(store).state.captains;
  };
  const early = mk(0), late = mk(57);
  assert.equal(early.length, 2);
  assert.deepEqual(late, early);
  const fresh = newCampaign(23); ensureCaptains(fresh);
  assert.deepEqual(early, fresh.captains);
});

test('os capitães gravam e carregam sem perder nada; uma gravação com capitães inválidos é rejeitada', () => {
  const store = fakeStorage(), f = createFlow({ storage: store, seed: 5 });
  f.state.captains[0].traits.push('duro-de-roer'); f.state.captains[0].xp = 12; f.save();
  assert.deepEqual(loadFlow(store).state.captains, f.state.captains);
  const bad = mutate => { const s = JSON.parse(serialize(f.state)); mutate(s); return deserialize(JSON.stringify(s)); };
  assert.equal(bad(s => { s.captains[0].archetype = 'mago'; }), null);
  assert.equal(bad(s => { s.captains[0].traits = ['inventado']; }), null);
  assert.equal(bad(s => { s.captains[0].loyalty = 140; }), null);
  assert.equal(bad(s => { s.captains = [1, 2, 3, 4, 5].map(i => ({ ...s.captains[0], id: `c${i}`, active: false })); }), null);
  assert.equal(bad(s => { s.captains = [1, 2, 3, 4].map(i => ({ ...s.captains[0], id: `c${i}`, active: true })); }), null, 'no máximo três ativos');
  assert.ok(validCaptains({ captains: [] }));
});

// ——— passivas ———

test('só os capitães ativos dão passivas: o Batedor na reserva não muda o reconhecimento', () => {
  const on = withCaptains([['batedor']]), off = withCaptains([['batedor']], { reserve: [0] });
  assert.equal(reconRange(on, 250), 300); assert.equal(reconRadius(on, 110), 150);
  assert.equal(reconRange(off, 250), 250); assert.equal(reconRadius(off, 110), 110);
  assert.equal(sightOf(on, 150, true), 190); assert.equal(sightOf(on, 150, false), 150, 'só escondido');
});

test('emboscadas: vale o efeito mais forte (não o produto), e o Fundibulário só conta junto à serra', () => {
  const s = withCaptains([['fundibulario'], ['batedor', ['emboscador-nato']]]);
  s.party = { ...serraOf(s) };
  assert.equal(ambushKeep(s).keep, 0.5, 'mais forte: 0,5, não 0,5 × 0,75');
  assert.equal(ambushKeep(s).by.id, 'cap-1');
  s.party = { x: -1e4, y: -1e4 };
  assert.equal(ambushKeep(s).keep, 0.75, 'longe da serra só o Emboscador Nato');
  assert.ok(ambushKeep(s).keep >= RULES.caps.ambushKeep);
});

test('saque: Saqueador (+40 %) com Olho no Ouro (+20 %) noutro capitão dá +40 %, não +60 %', () => {
  const s = withCaptains([['saqueador'], ['ferreiro', ['olho-no-ouro']]]);
  const food = s.food, arms = s.arms, trust = s.communities.ribeira.trust + s.communities.penedo.trust + s.communities.souto.trust + s.communities.vau.trust + s.communities.fonte.trust;
  const events = afterBattle(s, ambushSpec(s), win(15, 5));
  const loot = events.find(e => e.what === 'saque');
  assert.deepEqual([loot.food, loot.arms], [6, 2]);
  assert.equal(s.food - food, 6); assert.equal(s.arms - arms, 2);
  const after = Object.values(s.communities).reduce((n, c) => n + c.trust, 0);
  assert.ok(after < trust, 'o saque a mais custa confiança a uma comunidade');
});

test('o Ferreiro arma um em cada três recrutas; sem ele cada recruta custa uma arma', () => {
  const s = withCaptains([['ferreiro']]), none = withCaptains([['batedor']]);
  assert.deepEqual([1, 2, 3, 4, 6].map(n => recruitArms(s, n)), [1, 2, 2, 3, 4]);
  assert.deepEqual([1, 2, 3].map(n => recruitArms(none, n)), [1, 2, 3]);
});

test('Ladrão de Galinhas: com fome à porta o bando come menos, nunca menos de 1, e uma aldeia paga a confiança', () => {
  const s = withCaptains([['batedor', ['ladrao-de-galinhas']]]);
  s.men = 30; s.food = 5;   // 3 por dia: menos de 3 dias
  const save = famineSave(s, 1);
  assert.equal(save.save, 1);
  assert.equal(famineSave(s, 3), null, 'com 3 dias de comida não poupa');
  const trust = Object.values(s.communities).reduce((n, c) => n + c.trust, 0);
  stepDay(s, { kind: 'acampar' }, makeRng(1));
  assert.equal(s.food, 3, '5 − (3 − 1)');
  assert.ok(Object.values(s.communities).reduce((n, c) => n + c.trust, 0) < trust);
  const tiny = withCaptains([['batedor', ['ladrao-de-galinhas']]]); tiny.men = 10; tiny.food = 1;   // 1 por dia: nada a poupar
  stepDay(tiny, { kind: 'acampar' }, makeRng(1));
  assert.equal(tiny.food, 0, 'o consumo mínimo é 1');
});

test('Duro de Roer corta as perdas das derrotas até ao teto; o Veterano só ajuda em campo aberto e na decisiva', () => {
  const s = withCaptains([['veterano', ['duro-de-roer']]]);
  assert.equal(lossKeep(s), 0.8);
  assert.equal(legacyBonus(s, 'campo-aberto'), 2); assert.equal(legacyBonus(s, 'decisiva'), 2); assert.equal(legacyBonus(s, 'emboscada'), 0);
  assert.ok(lossKeep(withCaptains([['batedor', ['duro-de-roer']], ['ferreiro', ['duro-de-roer']]])) >= RULES.caps.lossKeep);
});

test('nenhuma combinação dispensa comer, reconhecer, recrutar com armas ou cuidar das aldeias', () => {
  const all = withCaptains([['batedor', ['ladrao-de-galinhas', 'olhos-de-coruja']], ['ferreiro', ['querido-do-povo']], ['saqueador', ['emboscador-nato']]]);
  all.men = 13; all.food = 1;
  stepDay(all, { kind: 'acampar' }, makeRng(2));
  assert.equal(all.food, 0, 'come sempre pelo menos 1');
  assert.ok(reconRange(all, 250) <= RULES.caps.reconRange);
  assert.ok(recruitArms(all, 3) >= 2, 'recrutar continua a gastar armas');
  for (const locale of ['en', 'pt-PT']) {
    const i18n = createI18n({ languages: [locale] });
    for (const id of Object.keys({ ...TRAITS, ...SCARS })) {
      for (const k of ['trait', 'traitGain', 'traitCost']) assert.notEqual(i18n.t(`map.captains.${k}.${id}`), `map.captains.${k}.${id}`, `${locale} ${k}.${id}`);
    }
  }
});

// ——— evolução ———

test('uma vitória dá experiência só aos ativos; aos 20 sobe de nível e oferece 3 traços diferentes, sorteados sempre igual', () => {
  const s = withCaptains([['saqueador'], ['batedor']], { reserve: [1] });
  afterBattle(s, ambushSpec(s), win());
  assert.equal(s.captains[0].xp, 10); assert.equal(s.captains[1].xp, 0, 'a reserva não aprende');
  const events = afterBattle(s, ambushSpec(s), win());
  const c = s.captains[0];
  assert.equal(c.level, 2);
  assert.ok(events.some(e => e.what === 'nivel' && e.level === 2));
  assert.equal(c.offer.options.length, 3);
  assert.equal(new Set(c.offer.options).size, 3);
  assert.ok(!c.offer.options.includes('olho-no-ouro'), 'ao Saqueador não se oferece o Olho no Ouro');
  const again = withCaptains([['saqueador'], ['batedor']], { reserve: [1] });
  afterBattle(again, ambushSpec(again), win()); afterBattle(again, ambushSpec(again), win());
  assert.deepEqual(again.captains[0].offer, c.offer, 'determinístico');
});

test('escolher um traço oferecido acrescenta-o e fecha a escolha; um traço que não foi oferecido é recusado', () => {
  const s = withCaptains([['ferreiro']]);
  s.captains[0].offer = { options: drawCards(s, s.captains[0]), why: 'nivel' };
  const [pick] = s.captains[0].offer.options, other = Object.keys(TRAITS).find(t => !s.captains[0].offer.options.includes(t));
  assert.equal(chooseCard(s, 'cap-1', other).ok, false);
  assert.ok(chooseCard(s, 'cap-1', pick).ok);
  assert.deepEqual(s.captains[0].traits, [pick]);
  assert.equal(s.captains[0].offer, undefined);
});

test('uma batalha difícil sobrevivida oferece um traço (no máximo um por 20 dias); com três traços já não oferece', () => {
  const hard = s => ambushSpec(s, { enemies: { legio: 30, velites: 0, centurion: false } });
  const s = withCaptains([['fundibulario']]);
  Object.assign(s.captains[0], { level: 4, xp: 200 });   // no nível máximo: só a batalha difícil oferece
  afterBattle(s, hard(s), [{ type: 'derrota', lost: 1 }]);
  assert.equal(s.captains[0].offer?.why, 'batalha');
  delete s.captains[0].offer;
  afterBattle(s, hard(s), [{ type: 'derrota', lost: 1 }]);
  assert.equal(s.captains[0].offer, undefined, 'menos de 20 dias depois');
  const full = withCaptains([['fundibulario', ['duro-de-roer', 'vingativo', 'olhos-de-coruja']]]);
  afterBattle(full, hard(full), [{ type: 'derrota', lost: 1 }]);
  assert.equal(full.captains[0].offer, undefined);
});

test('cicatrizes: só depois de uma derrota difícil, sorteadas sempre igual, no máximo duas', () => {
  let scarred = 0;
  for (let seed = 1; seed <= 80; seed++) {
    const s = withCaptains([['batedor']], { seed }), spec = ambushSpec(s, { enemies: { legio: 30, velites: 0, centurion: false } });
    const t = structuredClone(s);
    afterBattle(s, spec, [{ type: 'derrota', lost: 2 }]); afterBattle(t, spec, [{ type: 'derrota', lost: 2 }]);
    assert.deepEqual(s.captains, t.captains);
    if (s.captains[0].traits.some(x => SCARS[x])) scarred++;
  }
  assert.ok(scarred > 8 && scarred < 35, `cerca de 25 % (${scarred}/80)`);
  const s = withCaptains([['batedor', ['mao-ferida', 'rancor-a-roma']]]);
  for (let i = 0; i < 6; i++) { s.day += 30; afterBattle(s, ambushSpec(s, { enemies: { legio: 30, velites: 0, centurion: false } }), [{ type: 'derrota', lost: 2 }]); }
  assert.equal(s.captains[0].traits.filter(x => SCARS[x]).length, 2);
});

// ——— lealdade, crise, deserção e traição ———

test('cada capitão reage à sua maneira: recusar o combate irrita o Fundibulário, a fome o Saqueador', () => {
  const s = withCaptains([['fundibulario'], ['saqueador'], ['ferreiro']]);
  afterBattle(s, ambushSpec(s, { type: 'campo-aberto' }), [{ type: 'retirada', lost: 1, withdrew: true }]);
  assert.deepEqual(s.captains.map(c => c.loyalty), [57, 60, 60]);
  afterDay(s, [{ type: 'fome', mortos: 1 }]);
  assert.deepEqual(s.captains.map(c => c.loyalty), [57, 59, 59], 'a fome tira 1 ao Saqueador e ao Ferreiro (D.2)');
  assert.equal(s.captains[1].notes[0].why, 'fome');
});

test('lealdade baixa abre um assunto com prazo de 3 dias que para o tempo; a parte paga-se com comida e armas', () => {
  const s = withCaptains([['saqueador'], ['batedor']]);
  s.captains[0].loyalty = 24;
  const events = afterDay(s, []);
  assert.ok(events.some(e => e.what === 'crise'));
  const issue = buildIssues(s).find(i => i.type === 'capitao-crise');
  assert.equal(issue.kind, 'decisao'); assert.equal(issue.deadline, 3); assert.equal(issue.captain, 'cap-1');
  assert.ok(detectInterruptions({ state: s, events }).some(r => r.type === 'capitao'));
  s.food = 5;
  assert.equal(answerCrisis(s, 'cap-1', 'parte').why, 'sem-parte');
  s.food = 50; s.arms = 10;
  assert.ok(answerCrisis(s, 'cap-1', 'parte').ok);
  assert.deepEqual([s.food, s.arms, s.captains[0].loyalty, s.captains[0].crisis], [42, 7, 44, undefined]);
});

test('ignorada a crise, o capitão deserta e leva um homem por nível; o Veterano trai e Roma fica a saber onde está o bando', () => {
  const s = withCaptains([['saqueador'], ['veterano']]);
  s.captains[0].level = 2; s.captains[0].loyalty = 10; s.captains[1].loyalty = 10;
  afterDay(s, []);
  const men = s.men, attention = s.rome?.attention ?? 0;
  s.day += 3;
  const events = afterDay(s, []);
  assert.deepEqual(events.filter(e => e.type === 'capitao').map(e => e.what).sort(), ['desertou', 'traiu']);
  assert.equal(s.captains.length, 0);
  assert.equal(s.men, men - 2 - 1);
  assert.equal(s.rome.attention, attention + ARCHETYPES.veterano.betrays.attention);
  assert.deepEqual(ensureDoctrine(s).lastSeen, { x: s.party.x, y: s.party.y, day: s.day });
});

test('deixá-lo ir não leva ninguém; uma crise fecha-se sozinha se a lealdade voltar a subir', () => {
  const s = withCaptains([['saqueador'], ['batedor']]);
  s.captains[0].loyalty = 20; s.captains[1].loyalty = 20;
  afterDay(s, []);
  const men = s.men;
  assert.ok(answerCrisis(s, 'cap-1', 'partir').ok);
  assert.equal(s.men, men); assert.equal(s.captains.length, 1);
  s.captains[0].loyalty = 40;
  assert.ok(afterDay(s, []).some(e => e.what === 'acalmou'));
  assert.equal(s.captains[0].crisis, undefined);
});

// ——— reserva, recrutamento e o desertor ———

test('reserva: no máximo três ativos; quem espera na reserva perde lealdade de dez em dez dias', () => {
  const s = withCaptains([['batedor'], ['ferreiro'], ['saqueador'], ['incendiario']], { reserve: [3] });
  assert.equal(setActive(s, 'cap-4', true).why, 'cheio');
  assert.ok(setActive(s, 'cap-1', false).ok);
  assert.ok(setActive(s, 'cap-4', true).ok);
  for (let d = 1; d <= 20; d++) { s.day = d; afterDay(s, []); }
  assert.equal(s.captains[0].loyalty, 58);
});

test('recrutar um capitão: só em comunidade amiga ou comprometida, ao alcance, uma vez, com comida e armas', () => {
  const s = withCaptains([['batedor'], ['ferreiro'], ['saqueador']]);
  const souto = s.communities.souto;
  souto.posture = 'neutra';
  assert.equal(captainAt(s, 'souto').why, 'postura');
  souto.posture = 'amiga';
  assert.equal(captainAt(s, 'souto', { inReach: false }).why, 'longe');
  assert.equal(captainAt(s, 'ribeira').why, 'tem', 'já há um Batedor');
  s.food = 50; s.arms = 20;
  const r = recruitCaptain(s, 'souto');
  assert.ok(r.ok);
  assert.deepEqual([s.food, s.arms], [40, 16]);
  const c = s.captains.at(-1);
  assert.equal(c.archetype, 'fundibulario'); assert.equal(c.active, false, 'com três ativos fica na reserva');
  assert.equal(captainAt(s, 'souto').why, 'cheio');
});

test('o desertor romano aparece uma vez, por sorteio próprio, e junta-se como Veterano se for aceite', () => {
  let found = null;
  for (let day = RULES.deserter.from; day < 400 && !found; day++) {
    const s = withCaptains([['batedor'], ['ferreiro']]); s.day = day;
    if (afterDay(s, []).some(e => e.what === 'desertor')) found = s;
  }
  assert.ok(found, 'aparece em algum dia');
  const again = withCaptains([['batedor'], ['ferreiro']]); again.day = found.day;
  afterDay(again, []);
  assert.deepEqual(again.captainOffer, found.captainOffer, 'determinístico');
  assert.ok(buildIssues(found).some(i => i.type === 'capitao-desertor'));
  assert.ok(answerDeserter(found, true).ok);
  const v = found.captains.at(-1);
  assert.equal(v.archetype, 'veterano'); assert.ok(v.loyalty >= 35 && v.loyalty <= 45);
  found.day += 1;
  assert.ok(!afterDay(found, []).some(e => e.what === 'desertor'), 'só uma vez');
});

// ——— no fluxo ———

test('no fluxo: uma batalha ganha dá experiência, regista o capitão no Diário e sobrevive a gravar e carregar', () => {
  const store = fakeStorage(), f = createFlow({ storage: store, seed: 9 });
  f.state.captains.forEach(c => { c.xp = 15; });
  f.battle = { type: 'campo-aberto', seed: 1, site: 'campo', allies: 14, realMen: 14, enemies: { legio: 5, velites: 1, centurion: false },
    bonus: { allies: 0, enemies: 0 }, where: { ...f.state.party } };
  f.phase = 'batalha';
  f.finishBattle({ won: true, alliesLost: 0, enemiesKilled: 6 });
  assert.ok(f.state.captains.every(c => c.level === 2 && c.offer));
  assert.ok(f.journal.some(e => e.type === 'capitao' && e.what === 'nivel'));
  const c = f.state.captains[0];
  assert.ok(f.chooseCard(c.id, c.offer.options[0]).ok);
  assert.deepEqual(loadFlow(store).state.captains, f.state.captains);
  assert.equal(f.chooseCard(c.id, 'duro-de-roer').ok, false, 'já escolheu');
});

// ——— deserção: o que leva um capitão que sai (D.2) ———

/** O capitão `archetype` de nível `level` em crise num bando de `men` homens; devolve os homens perdidos quando a crise não é atendida. */
function desertWith(men, level, archetype = 'saqueador') {
  const s = withCaptains([[archetype], ['batedor']]);
  s.men = men; s.captains[0].level = level; s.captains[0].loyalty = 10; s.captains[1].loyalty = 90;
  afterDay(s, []);
  s.day += RULES.loyalty.crisisDays;
  const events = afterDay(s, []), left = events.find(e => e.type === 'capitao' && ['desertou', 'traiu'].includes(e.what));
  return { s, left, lost: men - s.men };
}

test('quem deserta leva o seu nível, mas nunca mais de 20 % do bando (por excesso) nem de 4 homens', () => {
  const expected = (men, level) => Math.max(0, Math.min(level, Math.ceil(men * 0.2), 4, men - 1));
  for (const men of [1, 2, 3, 4, 5, 6, 7, 10, 11, 14, 20, 21, 25, 40, 100]) for (const level of [1, 2, 3, 4]) {
    const { lost, left, s } = desertWith(men, level);
    assert.equal(lost, expected(men, level), `${men} homens, nível ${level}`);
    assert.equal(left.what, 'desertou');
    assert.equal(s.captains.some(c => c.archetype === 'saqueador'), false, 'o capitão sai sempre');
  }
});

test('bandos pequenos: com 1 homem não perde ninguém, com 2 perde no máximo 1, e o bando nunca fica vazio', () => {
  assert.equal(desertWith(1, 4).lost, 0);
  assert.equal(desertWith(2, 4).lost, 1);
  assert.equal(desertWith(3, 4).lost, 1);
  assert.equal(desertWith(5, 4).lost, 1, '20 % de 5 = 1');
  assert.equal(desertWith(6, 4).lost, 2, '20 % de 6 = 1,2, por excesso 2');
  assert.equal(desertWith(6, 1).lost, 1, 'nunca mais do que o nível');
  for (let men = 1; men <= 30; men++) for (let level = 1; level <= 4; level++) assert.ok(desertWith(men, level).s.men >= 1, `${men}/${level}`);
});

test('a traição leva o mesmo limite e continua a distinguir-se: Roma sabe onde está o bando e a atenção sobe', () => {
  const s = withCaptains([['veterano'], ['batedor']]);
  s.men = 8; s.captains[0].level = 4; s.captains[0].loyalty = 10; s.captains[1].loyalty = 90;
  afterDay(s, []);
  const attention = s.rome?.attention ?? 0;
  s.day += RULES.loyalty.crisisDays;
  const events = afterDay(s, []);
  assert.equal(events.find(e => e.what === 'traiu').men, 2, '20 % de 8 = 1,6, por excesso 2');
  assert.equal(s.men, 6);
  assert.equal(s.rome.attention, attention + ARCHETYPES.veterano.betrays.attention);
  assert.deepEqual(ensureDoctrine(s).lastSeen, { x: s.party.x, y: s.party.y, day: s.day });
});

test('deixar o capitão ir em paz continua a não levar ninguém, e o aviso da crise mostra os homens que de facto leva', () => {
  const s = withCaptains([['saqueador'], ['batedor']]);
  s.men = 6; s.captains[0].level = 4; s.captains[0].loyalty = 10;
  afterDay(s, []);
  assert.equal(desertionMen(s, s.captains[0]), 2);
  assert.match(buildIssues(s).find(i => i.type === 'capitao-crise').consequence, /2 homens/);
  assert.ok(answerCrisis(s, 'cap-1', 'partir').ok);
  assert.equal(s.men, 6);
});

test('a fome tira menos lealdade: Saqueador −1, Ferreiro −1 e Olho no Ouro −2 (D.2)', () => {
  assert.equal(ARCHETYPES.saqueador.loyal.famine, -1);
  assert.equal(ARCHETYPES.ferreiro.loyal.famine, -1);
  assert.equal(TRAITS['olho-no-ouro'].loyal.famine, -2);
  const s = withCaptains([['saqueador', ['olho-no-ouro']], ['ferreiro']]);
  afterDay(s, [{ type: 'fome', mortos: 1 }]);
  assert.deepEqual(s.captains.map(c => c.loyalty), [57, 59]);
});
