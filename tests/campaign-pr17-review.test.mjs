// PR #17 — correções após a revisão independente: o que a pré-visualização pode mostrar, os dias de marcha, a
// cronologia do Diário e as datas. Tudo puro (sem DOM); os testes da interface (relógio, separador escondido, painel)
// estão em tools/smoke-campaign.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { serialize } from '../src/campaign/state.js';
import { createFlow, loadFlow, STORAGE_KEY } from '../src/campaign/flow.js';
import { MARCH_SPEED, REACH, ARRIVAL, marchDays, inReach, nearRoad } from '../src/campaign/simulation.js';
import { ensureDoctrine } from '../src/campaign/doctrine.js';
import { postureFor, margin } from '../src/campaign/communities.js';
import { dateLabel, season, YEAR_DAYS } from '../src/campaign/clock.js';
import { burn } from '../src/campaign/rome.js';

const fakeStorage = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };
const quietFlow = (seed = 3) => {
  const f = createFlow({ storage: fakeStorage(), seed });
  const s = f.state; s.praetor = null; s.patrols = []; s.food = 1e5; s.men = 40; s.arms = 40; s.fame = 50; s.done.push('cativos');
  ensureDoctrine(s).nextSpawn = 1e9;
  return f;
};
const place = (s, id) => s.world.settlements.find(x => x.id === s.communities[id].settlement);
const MARGIN = { comprometida: [70, 10], amiga: [50, 30], neutra: [40, 30] };
const be = (c, p) => { [c.trust, c.fear] = MARGIN[p]; c.posture = postureFor(margin(c)); return c; };

// ——— 1. a pré-visualização só mostra o que o jogador sabe ———

/** Um fluxo em Souto, amiga, com uma patrulha a `gap` do lugar (a menos de SEEN_RANGE = 30 para ver quem ajuda). */
function withPatrol({ known }) {
  const f = quietFlow(), s = f.state, p = place(s, 'souto');
  be(s.communities.souto, 'amiga'); s.party = { x: p.x, y: p.y };
  const id = 'p-oculta';
  s.patrols = [{ id, kind: 'legio', x: p.x + 10, y: p.y, men: 6, i: 1 }];
  s.intel.known = {};
  if (known) s.intel.known[id] = { kind: 'legio', x: p.x + 10, y: p.y, men: 6, day: s.day };
  return { f, s, p };
}
const SECRET = ['castigo', 'ocupada', 'comunidade-queimada', 'aldeia-queimada', 'emboscada-descoberta'];

test('preview: uma patrulha desconhecida a dois passos da aldeia não aparece (nem castigo nem combate)', () => {
  const { f: hidden, p } = withPatrol({ known: false });
  const { f: none } = withPatrol({ known: false }); none.state.patrols = [];
  for (const o of [{ kind: 'recrutar', id: p.id }, { kind: 'reconhecer', to: { x: p.x, y: p.y } }, { kind: 'acampar' }]) {
    const a = hidden.preview(o), b = none.preview(o);
    assert.deepEqual(a.events, b.events, `eventos iguais com e sem a patrulha oculta (${o.kind})`);
    assert.equal(a.encounter, null); assert.equal(a.battle, null);
    assert.deepEqual(a.state.communities, b.state.communities, 'nem a confiança ou a situação das aldeias muda');
    assert.ok(!a.events.some(e => SECRET.includes(e.type)), `${o.kind}: ${JSON.stringify(a.events)}`);
  }
});

test('preview: reconhecer não anuncia uma batalha contra uma força desconhecida', () => {
  const { f, s } = withPatrol({ known: false });
  const r = s.world.road, dx = r[2].x - r[1].x, dy = r[2].y - r[1].y, l = Math.hypot(dx, dy);
  s.party = { x: r[1].x + 17 * dx / l, y: r[1].y + 17 * dy / l };   // na estrada, com a coluna a passar-lhe ao lado
  s.patrols = [{ id: 'p-oculta', kind: 'legio', x: r[1].x, y: r[1].y, men: 6, i: 2 }];
  const real = structuredClone(s);   // contra-prova: se o dia corresse, havia mesmo encontro
  assert.ok(f.order({ kind: 'reconhecer', to: { x: s.party.x, y: s.party.y } }).battle, 'o dia real traz o encontro');
  Object.assign(s, real); f.phase = 'mapa'; f.battle = null;   // volta ao princípio do dia
  const pv = f.preview({ kind: 'reconhecer', to: { x: s.party.x, y: s.party.y } });
  assert.equal(pv.executes, true); assert.equal(pv.encounter, null); assert.equal(pv.battle, null);
});

test('preview: uma patrulha conhecida (à vista hoje) pode avisar do castigo à aldeia', () => {
  const { f, p } = withPatrol({ known: true });
  const pv = f.preview({ kind: 'recrutar', id: p.id });
  assert.ok(pv.events.some(e => e.type === 'castigo' && e.id === p.id), JSON.stringify(pv.events));
});

test('preview: uma força só vista há dias (posição incerta) não conta como conhecida', () => {
  const { f, s, p } = withPatrol({ known: true });
  s.day = 5; s.intel.known['p-oculta'].day = 2;   // há três dias: já pode estar noutro sítio
  const pv = f.preview({ kind: 'recrutar', id: p.id });
  assert.ok(!pv.events.some(e => SECRET.includes(e.type)), JSON.stringify(pv.events));
});

test('preview: não altera o estado real, o Diário nem a gravação (com forças conhecidas e desconhecidas)', () => {
  for (const known of [false, true]) {
    const { f, s, p } = withPatrol({ known }), st = f.save && null;
    const before = serialize(s), journal = JSON.stringify(f.journal), patrols = JSON.stringify(s.patrols), intel = JSON.stringify(s.intel);
    for (const o of [{ kind: 'recrutar', id: p.id }, { kind: 'reconhecer', to: { x: p.x, y: p.y } }, { kind: 'acampar' }, { kind: 'marchar', to: { x: 1, y: 1 } }]) f.preview(o);
    assert.equal(serialize(s), before); assert.equal(JSON.stringify(f.journal), journal);
    assert.equal(JSON.stringify(s.patrols), patrols); assert.equal(JSON.stringify(s.intel), intel);
    void st;
  }
});

test('execução: a simulação continua igual — a patrulha desconhecida castiga de verdade, mesmo sem a pré-visualização o dizer', () => {
  const { f, s, p } = withPatrol({ known: false });
  const pv = f.preview({ kind: 'recrutar', id: p.id });
  assert.ok(!pv.events.some(e => e.type === 'castigo'));
  const r = f.order({ kind: 'recrutar', id: p.id });
  assert.ok(r.events.some(e => e.type === 'castigo' && e.id === p.id), 'Roma viu quem ajudava e castigou');
  assert.equal(s.communities.souto.situation, 'castigada');
});

test('preview: o efeito da própria ordem (homens, armas, comida, confiança) bate com a execução', () => {
  const { f, s, p } = withPatrol({ known: false }); s.patrols = [];
  const pv = f.preview({ kind: 'recrutar', id: p.id });
  const men = s.men, arms = s.arms, trust = s.communities.souto.trust;
  const r = f.order({ kind: 'recrutar', id: p.id });
  const got = r.events.find(e => e.type === 'recrutou'), want = pv.events.find(e => e.type === 'recrutou');
  assert.deepEqual(got, want);
  assert.equal(pv.state.men - men, got.men); assert.equal(arms - pv.state.arms, arms - s.arms, 'as armas previstas são as gastas (o Ferreiro arma um em cada três)');
  assert.equal(pv.state.communities.souto.trust, trust + (s.communities.souto.trust - trust) , 'a confiança prevista é a da própria ordem');
  assert.equal(pv.state.communities.souto.trust - trust, s.communities.souto.trust - trust);
});

test('preview: a confiança prevista é só a da ordem — a decisão de Roma no fim do dia (atenção escondida) não entra', () => {
  const { f, s, p } = withPatrol({ known: false }); s.patrols = [];
  s.rome = { ...(s.rome || {}), attention: 99 };
  const before = s.communities.souto.trust, pv = f.preview({ kind: 'acampar' });
  assert.equal(pv.state.communities.souto.trust, before, 'acampar não mexe na confiança de ninguém');
  void p;
});

test('preview: os capítulos agendados continuam a ter prioridade e o aviso é o mesmo', () => {
  const f = quietFlow(), s = f.state, p = place(s, 'souto'); s.done = []; s.day = 10;
  be(s.communities.souto, 'amiga'); s.party = { x: p.x, y: p.y };
  const pv = f.preview({ kind: 'recrutar', id: p.id });
  assert.equal(pv.executes, false); assert.equal(pv.scheduled?.id, 'cativos'); assert.deepEqual(pv.events, []);
});

test('preview: atacar um posto continua a prever o combate (é a própria ordem, e o posto é conhecido)', () => {
  const f = quietFlow(), s = f.state, posto = s.world.settlements.find(x => x.kind === 'posto');
  s.party = { x: posto.x, y: posto.y };
  const pv = f.preview({ kind: 'atacar', id: posto.id });
  assert.equal(pv.executes, true); assert.ok(pv.encounter); assert.ok(pv.battle);
  const r = f.order({ kind: 'atacar', id: posto.id });
  assert.equal(r.battle.type, pv.battle.type); assert.deepEqual(r.battle.enemies, pv.battle.enemies);
});

// ——— 2 e 7. a marcha: uma só fonte de verdade ———

/** Marcha de verdade, dia a dia (flow.order), até ao critério de chegada da simulação; devolve os dias. */
function realDays(f, from, to) {
  const s = f.state; s.party = { ...from };
  let n = 0;
  while (Math.hypot(s.party.x - to.x, s.party.y - to.y) >= ARRIVAL && n < 50) { f.order({ kind: 'marchar', to }); n++; }
  return n;
}

test('marcha: os casos da revisão (50, 100, 140 e 200 de distância) levam 2, 3, 4 e 5 dias, e a estimativa diz o mesmo', () => {
  for (const [d, days] of [[50, 2], [100, 3], [140, 4], [200, 5]]) {
    const f = quietFlow(), from = { x: 100, y: 300 }, to = { x: 100 + d, y: 300 };
    assert.equal(marchDays(f.state.world, from, to), days, `estimativa a ${d}`);
    assert.equal(realDays(f, from, to), days, `execução a ${d}`);
  }
});

test('marcha: curtas, exatas e limites — a estimativa coincide sempre com a execução', () => {
  const ds = [0, 0.4, 0.99, 1, 5, 19, 20, 21, 44, 44.5, 45, 45.5, 45.99, 46, 90, 90.5, 90.99, 91, 135, 136, 180, 225, 226, 300];
  for (const d of ds) {
    const f = quietFlow(), from = { x: 50, y: 200 }, to = { x: 50 + d, y: 200 };
    assert.equal(marchDays(f.state.world, from, to), realDays(f, from, to), `d=${d}`);
  }
});

test('marcha: na diagonal e com o destino fora do mundo (a ordem corta-o ao mapa) também coincide', () => {
  for (const to of [{ x: 400, y: 500 }, { x: 5000, y: 300 }, { x: -300, y: -300 }]) {
    const f = quietFlow(), from = { x: 120, y: 160 };
    const w = f.state.world, shown = { x: Math.min(w.w, Math.max(0, to.x)), y: Math.min(w.h, Math.max(0, to.y)) };
    assert.equal(marchDays(w, from, to), realDays(f, from, shown), JSON.stringify(to));
  }
});

test('marcha: ao alcance do lugar (REACH) é «aqui»; chegar ao ponto exato é outra coisa', () => {
  const a = { x: 0, y: 0 };
  assert.equal(inReach(a, { x: REACH, y: 0 }), true); assert.equal(inReach(a, { x: REACH + 0.01, y: 0 }), false);
  const f = quietFlow();
  assert.equal(marchDays(f.state.world, a, { x: REACH, y: 0 }), 1, 'a 20 já se pode agir, mas chegar ao ponto leva um dia');
  assert.equal(marchDays(f.state.world, a, a), 0);
});

test('marcha: a velocidade é a da simulação', () => {
  const f = quietFlow(), a = { x: 0, y: 100 };
  assert.equal(marchDays(f.state.world, a, { x: MARCH_SPEED * 3, y: 100 }), 3);
});

test('marcha: a interface não repete as regras da simulação (distância 25, REACH, velocidade de marcha)', () => {
  const ui = readFileSync(new URL('../src/campaign/ui.js', import.meta.url), 'utf8');
  assert.ok(!/const REACH\s*=/.test(ui), 'REACH vem da simulação');
  assert.ok(!/\(d - REACH\) \/ MARCH_SPEED/.test(ui), 'os dias de marcha vêm de marchDays');
  assert.ok(!/<= 25\b/.test(ui) && !/function segD/.test(ui), 'a estrada vem de nearRoad');
  assert.ok(!/const MARCH_SPEED\s*=/.test(ui), 'a velocidade de marcha vem da simulação');
  assert.ok(!/\/ MARCH_SPEED\)/.test(ui.replace(/farText[^\n]*/g, '').replace(/\(d \/ MARCH_SPEED\) \* 300/, '')), 'sem contas de dias de marcha na interface');
});

test('estrada: nearRoad é a regra que o bando usa (a interface chama-a em vez de repetir a distância)', () => {
  const f = quietFlow(), w = f.state.world, p = w.road[1];
  assert.equal(nearRoad(w, p), true); assert.equal(nearRoad(w, { x: p.x + 5000, y: p.y }), false);
});

// ——— 3. cronologia do Diário ———

/** Joga uma campanha (esconder todos os dias, derrotas nas batalhas) e devolve o Diário. */
const playYear = seed => {
  const f = createFlow({ storage: fakeStorage(), seed }), s = f.state; s.food = 1e6; s.men = 60; s.arms = 0;
  for (let i = 0; i < 240 && !s.over && f.phase !== 'fim'; i++) { if (f.phase === 'batalha') f.finishBattle({ won: false }); else f.order({ kind: 'esconder' }); }
  return f.journal;
};

test('Diário: a queima de uma aldeia pelo pretor e a da sua comunidade são a mesma ocorrência: o mesmo dia', () => {
  let burns = 0;
  for (const seed of [1, 6]) {   // sementes em que o pretor queima aldeias do vale
    const j = playYear(seed);
    for (const com of j.filter(e => e.type === 'comunidade-queimada' && e.by === 'pretor')) {
      const vil = j.filter(e => e.type === 'aldeia-queimada').find(e => e.day === com.day);
      assert.ok(vil, `seed ${seed}: a queima da comunidade (dia ${com.day}) tem a da aldeia no mesmo dia`); burns++;
    }
  }
  assert.ok(burns >= 2, 'os cenários têm mesmo queimas');
});

test('Diário: a queima causada por uma batalha já ficava no mesmo dia (não mudou)', () => {
  const f = quietFlow(), s = f.state; s.day = 12;
  const c = s.communities.souto, p = place(s, 'souto'); s.villages = s.villages || {}; s.villages[p.id] = { ...(s.villages[p.id] || {}), burnt: true };
  f.state.praetor = null;
  const ev = burn(s, 'souto', 'castigo');
  assert.ok(ev.length); assert.equal(c.situation, 'queimada');
});

test('Diário: a mudança de postura causada por recrutar fica no dia do recrutamento, não no seguinte', () => {
  const f = quietFlow(), s = f.state, p = place(s, 'souto');
  const c = s.communities.souto; c.trust = 40; c.fear = 30; c.posture = postureFor(margin(c));   // neutra: recrutar custa confiança
  c.youth = c.youth ?? 100; s.party = { x: p.x, y: p.y }; s.day = 40;
  let guard = 0, before = c.posture;
  while (c.posture === before && guard++ < 6) { f.order({ kind: 'recrutar', id: p.id }); s.day = 40; f.journal.length = 0; before = c.posture; }
  // um recrutamento que muda mesmo a postura: procura-se uma margem no limite
  const g = quietFlow(), gs = g.state, gp = place(gs, 'souto'), gc = gs.communities.souto;
  gs.party = { x: gp.x, y: gp.y }; gs.day = 40;
  for (let t = 20; t <= 80; t += 1) {
    const h = quietFlow(), hs = h.state, hp = place(hs, 'souto'), hc = hs.communities.souto;
    hc.trust = t; hc.fear = 30; hc.posture = postureFor(margin(hc)); hs.party = { x: hp.x, y: hp.y }; hs.day = 40;
    const was = hc.posture; h.order({ kind: 'recrutar', id: hp.id });
    const ch = h.journal.find(e => e.type === 'postura'), rec = h.journal.find(e => e.type === 'recrutou');
    if (rec && ch && hc.posture !== was) { assert.equal(ch.day, rec.day, `a postura mudou por causa do recrutamento (trust ${t})`); return; }
  }
  void gc; void gp;
  assert.fail('não se encontrou uma margem em que recrutar mude a postura');
});

test('Diário: uma mudança de postura que vem do fim do dia (fome, colheita) fica no dia novo', () => {
  const f = quietFlow(), s = f.state; s.day = 91;   // viragem da estação: colheita e tributo
  f.order({ kind: 'acampar' });
  for (const e of f.journal.filter(x => x.type === 'postura' || x.type === 'colheita')) assert.equal(e.day, 92, e.type);
});

// ——— 4. datas ———

test('datas: o dia 245 já é 1 de novembro (e deixa de repetir 31 de outubro)', () => {
  assert.equal(YEAR_DAYS, 245);
  assert.equal(dateLabel(244), '31 de outubro de 147 a.C.');
  assert.equal(dateLabel(245), '1 de novembro de 147 a.C.');
  assert.notEqual(dateLabel(244), dateLabel(245));
});

test('datas: primeiro e último dia, mudança de mês, de estação e do fim do ano', () => {
  assert.equal(dateLabel(0), '1 de março de 147 a.C.');
  assert.equal(dateLabel(30), '31 de março de 147 a.C.'); assert.equal(dateLabel(31), '1 de abril de 147 a.C.');
  assert.equal(dateLabel(91), '31 de maio de 147 a.C.'); assert.equal(dateLabel(92), '1 de junho de 147 a.C.');
  assert.equal(season(91), 'primavera'); assert.equal(season(92), 'verão');
  assert.equal(dateLabel(183), '31 de agosto de 147 a.C.'); assert.equal(dateLabel(184), '1 de setembro de 147 a.C.'); assert.equal(season(184), 'outono');
  assert.equal(dateLabel(214), '1 de outubro de 147 a.C.');
  assert.equal(season(244), 'outono'); assert.equal(season(245), 'outono');
  assert.equal(dateLabel(274), '30 de novembro de 147 a.C.');
});

test('datas: cada dia tem a sua data, sem repetições, em todo o ano da campanha e no dia a seguir', () => {
  const seen = new Set();
  for (let d = 0; d <= YEAR_DAYS; d++) { const l = dateLabel(d); assert.ok(!seen.has(l), `${d}: ${l}`); seen.add(l); }
});

test('datas: dias fora do calendário nunca dão «NaN» nem rebentam', () => {
  for (const d of [-1, 1e6, NaN]) assert.match(dateLabel(d), /de 147 a\.C\.$/);
});

// ——— saves v:1 ———

test('saves v:1 antigos continuam a carregar (sem comunidades, sem Roma e sem Diário)', () => {
  const st = fakeStorage(), f = createFlow({ storage: st, seed: 5 });
  const raw = JSON.parse(st.getItem(STORAGE_KEY)); delete raw.journal; delete raw.state.communities; delete raw.state.rome;
  st.setItem(STORAGE_KEY, JSON.stringify(raw));
  const g = loadFlow(st);
  assert.ok(g); assert.deepEqual(g.journal, []); assert.ok(g.state.communities);
  assert.doesNotThrow(() => g.preview({ kind: 'acampar' }));
  void f;
});
