// Ordens recusadas: não gastam o dia nem recursos, e dizem porquê.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newCampaign } from '../src/campaign/state.js';
import { stepDay } from '../src/campaign/simulation.js';
import { makeRng } from '../src/campaign/rng.js';
import { createFlow } from '../src/campaign/flow.js';
import { eventText } from '../src/campaign/ui.js';

const rng = () => makeRng(7);
const fresh = () => newCampaign(3);
const find = (s, kind) => s.world.settlements.find(x => x.kind === kind);
const at = (s, p) => { s.party.x = p.x; s.party.y = p.y; };
const snap = s => JSON.stringify(s);

/** Cada caso devolve [estado preparado, ordem recusada, tipo de evento, motivo]. */
const CASES = {
  'recrutar longe': () => { const s = fresh(), v = find(s, 'aldeia'); return [s, { kind: 'recrutar', id: v.id }, 'ordem-invalida', 'longe']; },
  'recrutar numa aldeia queimada': () => { const s = fresh(), v = find(s, 'aldeia'); at(s, v); s.villages[v.id].burnt = true; return [s, { kind: 'recrutar', id: v.id }, 'ordem-invalida', 'queimada']; },
  'recrutar numa povoação desconhecida': () => [fresh(), { kind: 'recrutar', id: 'nada' }, 'ordem-invalida', 'desconhecido'],
  'recrutar cedo de mais': () => { const s = fresh(), v = find(s, 'aldeia'); at(s, v); s.day = 5; s.villages[v.id].recruitedDay = 2; return [s, { kind: 'recrutar', id: v.id }, 'recrutar-cedo', undefined]; },
  'recrutar sem armas': () => { const s = fresh(), v = find(s, 'aldeia'); at(s, v); s.arms = 0; return [s, { kind: 'recrutar', id: v.id }, 'sem-armas', undefined]; },
  'pedir ajuda longe': () => { const s = fresh(), c = find(s, 'castro'); return [s, { kind: 'pedir-ajuda', id: c.id }, 'ordem-invalida', 'longe']; },
  'pedir ajuda cedo de mais': () => { const s = fresh(), c = find(s, 'castro'); at(s, c); s.day = 10; s.help = { [c.id]: 5 }; return [s, { kind: 'pedir-ajuda', id: c.id }, 'ajuda-recusada', undefined]; },
  'atacar longe': () => { const s = fresh(), p = find(s, 'posto'); return [s, { kind: 'atacar', id: p.id }, 'ordem-invalida', 'longe']; },
  'atacar um posto já atacado': () => { const s = fresh(), p = find(s, 'posto'); at(s, p); s.posts = { [p.id]: { taken: false } }; return [s, { kind: 'atacar', id: p.id }, 'posto-atacado', undefined]; },
  'marchar sem destino': () => [fresh(), { kind: 'marchar', to: { x: NaN, y: 0 } }, 'ordem-invalida', 'destino'],
  'ordem desconhecida': () => [fresh(), { kind: 'dancar' }, 'ordem-invalida', 'desconhecido'],
};

for (const [name, make] of Object.entries(CASES)) {
  test(`ordem recusada (${name}): não passa o dia nem gasta nada`, () => {
    const [s, order, type, why] = make();
    const before = snap(s);
    const r = stepDay(s, order, rng());
    assert.equal(r.refused, true);
    assert.equal(r.encounter, null);
    const ev = r.events.find(e => e.type === type);
    assert.ok(ev, `evento ${type}`);
    if (why) assert.equal(ev.why, why);
    assert.equal(snap(s), before, 'o estado da campanha fica igual (dia, comida, homens, patrulhas, pretor…)');
  });
}

test('ordem válida continua a passar o dia e a gastar comida', () => {
  const s = fresh(), v = find(s, 'aldeia'); at(s, v);
  const day = s.day, food = s.food, men = s.men;
  const r = stepDay(s, { kind: 'recrutar', id: v.id }, rng());
  assert.notEqual(r.refused, true);
  assert.ok(s.men > men);
  assert.equal(s.day, day + 1);
  assert.ok(s.food < food);
  for (const o of [{ kind: 'acampar' }, { kind: 'esperar' }, { kind: 'esconder' }, { kind: 'marchar', to: { x: 0, y: 0 } }]) {
    const t = fresh(), d = t.day;
    assert.notEqual(stepDay(t, o, rng()).refused, true, o.kind);
    assert.equal(t.day, d + 1, o.kind);
  }
});

test('flow: uma ordem recusada não lança acontecimentos, não passa o dia e diz que foi recusada', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const f = createFlow({ seed });
    const v = find(f.state, 'aldeia');
    const before = snap(f.state);
    const r = f.order({ kind: 'recrutar', id: v.id });   // o bando começa longe das aldeias
    assert.equal(r.refused, true);
    assert.equal(r.battle, null);
    assert.equal(f.phase, 'mapa');
    assert.deepEqual(r.events.map(e => e.type), ['ordem-invalida']);
    assert.equal(snap(f.state), before);
  }
});

test('mensagens das recusas dizem o que falta', () => {
  const s = fresh(), v = find(s, 'aldeia');
  const t = ev => eventText(ev, s);
  assert.match(t({ type: 'ordem-invalida', order: 'recrutar', id: v.id, why: 'longe' }), new RegExp(`${v.name}.*marcha até lá`));
  assert.match(t({ type: 'ordem-invalida', order: 'recrutar', id: v.id, why: 'queimada' }), /queimada/);
  assert.match(t({ type: 'ordem-invalida', order: 'marchar', why: 'destino' }), /destino/);
  assert.match(t({ type: 'recrutar-cedo', id: v.id, days: 3 }), /3 dias/);
  assert.match(t({ type: 'recrutar-cedo', id: v.id, days: 1 }), /1 dia\b/);
  assert.match(t({ type: 'ajuda-recusada', id: v.id, days: 7 }), /7 dias/);
  for (const ev of [{ type: 'ordem-invalida', why: 'longe', id: v.id }, { type: 'recrutar-cedo', id: v.id, days: 2 }, { type: 'sem-armas', id: v.id }, { type: 'ajuda-recusada', id: v.id, days: 2 }, { type: 'posto-atacado', id: v.id }])
    assert.match(t(ev), /O dia não passa\./, ev.type);
});

test('recrutar-cedo e ajuda-recusada dizem quantos dias faltam', () => {
  const s = fresh(), v = find(s, 'aldeia'); at(s, v); s.day = 5; s.villages[v.id].recruitedDay = 2;
  assert.equal(stepDay(s, { kind: 'recrutar', id: v.id }, rng()).events.find(e => e.type === 'recrutar-cedo').days, 7);
  const c = find(s, 'castro'); at(s, c); s.day = 10; s.help = { [c.id]: 5 };
  assert.equal(stepDay(s, { kind: 'pedir-ajuda', id: c.id }, rng()).events.find(e => e.type === 'ajuda-recusada').days, 20);
});
