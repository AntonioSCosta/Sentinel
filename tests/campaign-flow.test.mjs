import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlow, loadFlow, clearSave, STORAGE_KEY } from '../src/campaign/flow.js';
import { YEAR_DAYS } from '../src/campaign/clock.js';

const fakeStorage = () => { const m = new Map(); return {
  getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };
const ACAMPAR = { kind: 'acampar' };
const WON = { won: true, alliesLost: 1, enemiesKilled: 6 };
const sane = s => { for (const k of ['men', 'food', 'arms', 'fame', 'day']) assert.ok(Number.isFinite(s[k]) && s[k] >= 0, k); };

function placeEncounter(f) { // grupo junto a um posto: atacar-lo provoca batalha
  const posto = f.state.world.settlements.find(x => x.kind === 'posto');
  f.state.party.x = posto.x; f.state.party.y = posto.y;
  f.state.praetor = null; f.state.done.push('cativos');
  return { kind: 'atacar', id: posto.id };
}

test('createFlow: campanha nova no mapa, com pretor', () => {
  const f = createFlow({ storage: fakeStorage(), seed: 5 });
  assert.equal(f.phase, 'mapa'); assert.equal(f.battle, null);
  assert.equal(f.state.praetor.id, 'vetilio'); assert.equal(f.state.seed, 5);
});

test('ordem sem encontro continua em mapa', () => {
  const f = createFlow({ storage: fakeStorage(), seed: 5 });
  const r = f.order(ACAMPAR);
  assert.equal(f.phase, 'mapa'); assert.equal(r.battle, null); assert.equal(f.state.day, 1);
});

test('encontro passa a batalha; finishBattle volta ao mapa e o encontro não re-dispara 2 dias', () => {
  const f = createFlow({ storage: fakeStorage(), seed: 5 });
  const atk = placeEncounter(f);
  const r = f.order(atk);
  assert.equal(f.phase, 'batalha'); assert.ok(f.battle); assert.equal(r.battle, f.battle);
  assert.equal(f.battle.chapter, 'acampamento');
  f.finishBattle({ won: false, retreated: true, alliesLost: 0 }); // a patrulha fica
  assert.equal(f.phase, 'mapa'); assert.equal(f.battle, null);
  assert.equal(f.state.cooldown, 2);
  for (let i = 0; i < 2; i++) { f.order(ACAMPAR); assert.equal(f.phase, 'mapa', `dia ${i}`); }
});

test('ordem recusada em batalha e finishBattle recusado no mapa', () => {
  const f = createFlow({ storage: fakeStorage(), seed: 5 });
  assert.equal(f.finishBattle(WON).refused, true);
  f.order(placeEncounter(f));
  const day = f.state.day;
  const r = f.order(ACAMPAR);
  assert.deepEqual(r, { events: [], battle: null, refused: true });
  assert.equal(f.state.day, day);
});

test('cativos dispara uma só vez como historica entre os dias 10 e 20', () => {
  for (const seed of [1, 2, 3]) {
    const f = createFlow({ storage: fakeStorage(), seed });
    f.state.praetor = null; f.state.patrols = [];
    let seen = 0, day = -1;
    for (let i = 0; i < 40 && f.phase !== 'fim'; i++) {
      f.state.food = 500; f.state.men = 14; f.state.fame = 20;
      if (f.phase === 'batalha') { if (f.battle.chapter === 'cativos') { seen++; day = f.state.day; assert.equal(f.battle.type, 'historica'); } f.finishBattle(WON); continue; }
      f.order(ACAMPAR);
      if (f.phase === 'batalha' && f.battle.chapter === 'cativos') { seen++; day = f.state.day; assert.equal(f.battle.type, 'historica'); f.finishBattle(WON); }
      else if (f.phase === 'batalha') f.finishBattle(WON);
    }
    assert.equal(seen, 1, `seed ${seen}`);
    assert.ok(day >= 10 && day <= 20, `dia ${day}`);
    assert.ok(f.state.done.includes('cativos'));
  }
});

test('over passa a fim e a ordem seguinte é recusada', () => {
  const f = createFlow({ storage: fakeStorage(), seed: 5 });
  f.state.food = 0; f.state.men = 1; f.state.praetor = null;
  for (let i = 0; i < 5 && f.phase !== 'fim'; i++) f.order(ACAMPAR);
  assert.equal(f.phase, 'fim'); assert.equal(f.state.over, 'derrota');
  assert.equal(f.order(ACAMPAR).refused, true);
});

test('fim do ano: vitoria com men>=10 e fame>=30, senão derrota', () => {
  for (const [men, fame, want] of [[12, 40, 'vitoria'], [9, 40, 'derrota'], [12, 29, 'derrota']]) {
    const f = createFlow({ storage: fakeStorage(), seed: 5 });
    f.state.praetor = null; f.state.patrols = []; f.state.done.push('cativos');
    f.state.day = YEAR_DAYS - 1; f.state.men = men; f.state.fame = fame; f.state.food = 500;
    f.order(ACAMPAR);
    if (f.phase === 'batalha') continue; // acaso raro
    assert.equal(f.phase, 'fim'); assert.equal(f.state.over, want);
  }
});

test('save/load a meio do mapa retoma dia e recursos', () => {
  const st = fakeStorage();
  const f = createFlow({ storage: st, seed: 9 });
  f.order(ACAMPAR); f.order(ACAMPAR);
  const g = loadFlow(st);
  assert.equal(g.phase, 'mapa'); assert.equal(g.state.day, f.state.day);
  for (const k of ['men', 'food', 'arms', 'fame']) assert.equal(g.state[k], f.state[k]);
  // continua de forma reproduzível
  f.order(ACAMPAR); g.order(ACAMPAR);
  assert.deepEqual(g.state, f.state);
});

test('save/load a meio de batalha preserva fase e batalha', () => {
  const st = fakeStorage();
  const f = createFlow({ storage: st, seed: 9 });
  f.order(placeEncounter(f));
  assert.equal(f.phase, 'batalha');
  const g = loadFlow(st);
  assert.equal(g.phase, 'batalha'); assert.deepEqual(g.battle, f.battle);
  g.finishBattle(WON); assert.equal(g.phase, 'mapa');
});

test('loadFlow: vazio ou corrompido devolve null; clearSave apaga', () => {
  const st = fakeStorage();
  assert.equal(loadFlow(st), null);
  st.setItem(STORAGE_KEY, '{lixo'); assert.equal(loadFlow(st), null);
  st.setItem(STORAGE_KEY, JSON.stringify({ v: 1, phase: 'xx', battle: null, state: {} })); assert.equal(loadFlow(st), null);
  const f = createFlow({ storage: st, seed: 1 }); f.save();
  assert.ok(loadFlow(st));
  clearSave(st); assert.equal(st.getItem(STORAGE_KEY), null);
});

test('storage ausente não rebenta', () => {
  const f = createFlow({ seed: 3 }); f.order(ACAMPAR); f.save();
  assert.equal(f.state.day, 1);
});

test('partida automática de 10 sementes termina em fim sem NaN', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const f = createFlow({ storage: fakeStorage(), seed });
    const east = f.state.world.settlements.filter(s => s.kind === 'posto').reduce((a, b) => (b.x > a.x ? b : a));
    let n = 0;
    while (f.phase !== 'fim' && n++ < 400) {
      if (f.phase === 'batalha') f.finishBattle(WON);
      else f.order({ kind: 'marchar', to: { x: east.x, y: east.y } });
      sane(f.state);
    }
    assert.equal(f.phase, 'fim', `seed ${seed}`);
    assert.ok(f.state.over === 'vitoria' || f.state.over === 'derrota');
  }
});

// --- ronda de correções ---
function patrolMeeting(f) { // patrulha que, depois de andar, fica a menos de 30 do grupo
  const road = f.state.world.road;
  let k = 1; while (Math.hypot(road[k + 1].x - road[k].x, road[k + 1].y - road[k].y) < 45) k++;
  const a = road[k], b = road[k + 1], d = Math.hypot(b.x - a.x, b.y - a.y);
  f.state.party.x = a.x + (b.x - a.x) / d * 35; f.state.party.y = a.y + (b.y - a.y) / d * 35;
  f.state.patrols = [{ id: 'p1', kind: 'patrulha', x: a.x, y: a.y, i: k + 1, men: 6 }];
  f.state.praetor = null; f.state.done.push('cativos'); f.state.food = 500;
}

test('patrulha real: vitoria remove-a, cooldown 2, sem novo disparo', () => {
  const f = createFlow({ storage: fakeStorage(), seed: 5 });
  patrolMeeting(f); f.order(ACAMPAR);
  assert.equal(f.phase, 'batalha'); assert.equal(f.battle.foeId, 'p1');
  f.finishBattle(WON);
  assert.equal(f.state.patrols.length, 0); assert.equal(f.state.cooldown, 2);
  for (let i = 0; i < 3; i++) { f.order(ACAMPAR); assert.equal(f.phase, 'mapa'); }
});

test('patrulha real: retirada mantém-na, cooldown 2, sem disparo nas ordens seguintes', () => {
  const f = createFlow({ storage: fakeStorage(), seed: 5 });
  patrolMeeting(f); f.order(ACAMPAR);
  assert.equal(f.phase, 'batalha');
  f.finishBattle({ retreated: true, alliesLost: 0 });
  assert.equal(f.state.patrols.length, 1); assert.equal(f.state.cooldown, 2);
  for (let i = 0; i < 2; i++) { f.order(ACAMPAR); assert.equal(f.phase, 'mapa', `dia ${i}`); }
});

test('loadFlow rejeita fim sem over e batalha malformada', () => {
  const st = fakeStorage();
  const f = createFlow({ storage: st, seed: 3 });
  const base = JSON.parse(st.getItem(STORAGE_KEY));
  const put = o => st.setItem(STORAGE_KEY, JSON.stringify({ ...base, ...o }));
  put({ phase: 'fim' }); assert.equal(loadFlow(st), null);
  for (const battle of [{}, { type: 'x', realMen: 5, allies: 5, enemies: {} }, { type: 'historica', allies: 5, enemies: {} },
    { type: 'historica', realMen: 5, allies: 'a', enemies: {} }, { type: 'historica', realMen: 5, allies: 5 }]) {
    put({ phase: 'batalha', battle }); assert.equal(loadFlow(st), null, JSON.stringify(battle));
  }
  assert.ok(f);
});

test('setItem a lançar não rebenta nem createFlow, nem order, nem finishBattle', () => {
  const st = { getItem: () => null, setItem() { throw new Error('quota'); }, removeItem() {} };
  const f = createFlow({ storage: st, seed: 5 });
  f.order(ACAMPAR); f.save();
  f.order(placeEncounter(f));
  assert.equal(f.phase, 'batalha');
  f.finishBattle(WON);
  assert.equal(f.phase, 'mapa');
});

test('Flow expõe só a interface do contrato', () => {
  const f = createFlow({ seed: 1 });
  assert.equal('rng' in f, false); assert.equal('storage' in f, false);
});
