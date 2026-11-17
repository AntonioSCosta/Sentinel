// As cinco comunidades do primeiro vale: identidade, estado, postura e motivos (GDD v2, «As cinco aldeias»).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newCampaign, serialize, deserialize } from '../src/campaign/state.js';
import { createFlow, loadFlow, STORAGE_KEY } from '../src/campaign/flow.js';
import {
  COMMUNITY_IDS, IDENTITY, OFFICES, TRAITS, POSTURES, MOTIVE_MIN, MAX_MOTIVES,
  postureFor, margin, youth, production, shift, topMotives, ensureCommunities, validCommunities, makeCommunity,
} from '../src/campaign/communities.js';

const memStorage = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const fresh = id => makeCommunity(id, 'aldeia-1');

test('as cinco comunidades existem com identidade completa', () => {
  assert.deepEqual(COMMUNITY_IDS, ['ribeira', 'penedo', 'souto', 'vau', 'fonte']);
  for (const id of COMMUNITY_IDS) {
    const c = IDENTITY[id];
    for (const k of ['name', 'kind', 'place', 'office', 'role']) assert.ok(typeof c[k] === 'string' && c[k].length > 3, `${id}.${k}`);
    assert.ok(OFFICES[c.office], `${id}: ofício conhecido`);
    assert.ok(c.chief && c.chief.name && TRAITS[c.chief.trait], `${id}: chefe com inclinação conhecida`);
  }
  assert.equal(IDENTITY.penedo.kind, 'castro');
  assert.equal(IDENTITY.penedo.name, 'Castro do Penedo');
});

test('cada comunidade começa com a postura do GDD', () => {
  const want = { ribeira: 'receosa', penedo: 'neutra', souto: 'amiga', vau: 'amiga', fonte: 'colabora' };
  for (const id of COMMUNITY_IDS) assert.equal(fresh(id).posture, want[id], id);
});

test('o estado inicial tem famílias, jovens, reservas e o resto dos campos', () => {
  const r = fresh('ribeira');
  assert.equal(r.families, 70); assert.equal(r.away, 0); assert.equal(r.food, 42);   // 0,6 por família
  assert.equal(r.trust, 30); assert.equal(r.fear, 55);
  assert.deepEqual(r.motives, []); assert.equal(r.situation, 'livre'); assert.equal(r.until, null); assert.equal(r.due, null);
  assert.equal(youth(r), 35);
  assert.equal(youth(fresh('penedo')), 28);   // 40 famílias × 0,7: o castro tem mais jovens
  assert.equal(youth({ ...r, away: 40 }), 0);
});

test('newCampaign liga cada comunidade a um lugar distinto do mundo, do tipo certo, em várias sementes', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const s = newCampaign(seed), used = new Set();
    assert.deepEqual(Object.keys(s.communities), COMMUNITY_IDS);
    for (const id of COMMUNITY_IDS) {
      const c = s.communities[id], place = s.world.settlements.find(p => p.id === c.settlement);
      assert.ok(place, `${seed}/${id}: lugar existe`);
      assert.equal(place.kind, IDENTITY[id].kind, `${seed}/${id}: tipo`);
      assert.ok(!used.has(place.id), `${seed}/${id}: lugar repetido`); used.add(place.id);
    }
    assert.deepEqual(newCampaign(seed).communities, s.communities, 'determinístico');
  }
});

test('postura pela margem confiança − medo, com histerese de 5', () => {
  assert.equal(postureFor(40), 'comprometida'); assert.equal(postureFor(39), 'amiga');
  assert.equal(postureFor(15), 'amiga'); assert.equal(postureFor(14), 'neutra');
  assert.equal(postureFor(-14), 'neutra'); assert.equal(postureFor(-15), 'receosa');
  assert.equal(postureFor(-39), 'receosa'); assert.equal(postureFor(-40), 'colabora');
  assert.equal(postureFor(37, 'comprometida'), 'comprometida', 'não desce logo abaixo do limiar');
  assert.equal(postureFor(34, 'comprometida'), 'amiga');
  assert.equal(postureFor(18, 'neutra'), 'neutra', 'não sobe logo acima do limiar');
  assert.equal(postureFor(20, 'neutra'), 'amiga');
  assert.equal(postureFor(-60, 'comprometida'), 'colabora', 'um salto grande vai direito ao degrau certo');
  assert.deepEqual(POSTURES.map(p => p.id), ['colabora', 'receosa', 'neutra', 'amiga', 'comprometida']);
});

test('shift muda confiança e medo, guarda um motivo legível e devolve a mudança de postura', () => {
  const c = fresh('souto');
  const r = shift(c, { trust: 20, fear: -10 }, { key: 'defendida', text: 'Defendeste-nos dos cobradores' }, 40);
  assert.equal(c.trust, 75); assert.equal(c.fear, 15); assert.equal(margin(c), 60);
  assert.deepEqual(c.motives, [{ key: 'defendida', text: 'Defendeste-nos dos cobradores', v: 30, day: 40 }]);
  assert.deepEqual(r, { from: 'amiga', to: 'comprometida' });
  assert.equal(c.posture, 'comprometida');
  assert.equal(shift(c, { trust: 1 }, { key: 'x', text: 'Pouca coisa' }, 41), null, 'sem mudança de postura');
  assert.equal(c.motives.length, 1, `menos de ${MOTIVE_MIN} não cria motivo`);
});

test('confiança e medo ficam entre 0 e 100; o motivo regista o que mudou de facto', () => {
  const c = fresh('vau');
  shift(c, { trust: 500 }, { key: 'a', text: 'Muito' }, 1);
  assert.equal(c.trust, 100); assert.equal(c.motives[0].v, 50);
  shift(c, { fear: -500 }, { key: 'b', text: 'Sem medo' }, 2);
  assert.equal(c.fear, 0); assert.equal(c.motives[1].v, 30);
});

test('inclinações dos chefes: prudente teme mais, desconfiado confia mais devagar', () => {
  const r = fresh('ribeira');   // Camalo, prudente
  shift(r, { fear: 10 }, { key: 'patrulha', text: 'Os romanos passaram aqui' }, 3);
  assert.equal(r.fear, 70);
  shift(r, { fear: -10 }, { key: 'fuga', text: 'Vimo-los fugir' }, 4);
  assert.equal(r.fear, 60, 'o medo desce ao ritmo normal');
  const v = fresh('vau');       // Arco, desconfiado
  shift(v, { trust: 10 }, { key: 'ajuda', text: 'Ajudaste-nos' }, 3);
  assert.equal(v.trust, 55);
  shift(v, { trust: -10 }, { key: 'recusa', text: 'Recusaste' }, 4);
  assert.equal(v.trust, 45, 'a confiança desce ao ritmo normal');
  assert.equal(TRAITS.orgulhoso.refusal, 2); assert.equal(TRAITS.generoso.foodGive, 1.5);
});

test(`no máximo ${MAX_MOTIVES} motivos; topMotives dá os mais pesados, os recentes primeiro em empate`, () => {
  const c = fresh('penedo');
  for (let d = 0; d < MAX_MOTIVES + 3; d++) shift(c, { trust: d % 2 ? 6 : -6 }, { key: `m${d}`, text: `Motivo ${d}` }, d);
  assert.equal(c.motives.length, MAX_MOTIVES);
  assert.equal(c.motives[0].key, 'm3', 'saem os mais antigos');
  shift(c, { fear: 25 }, { key: 'castigo', text: 'Castigaram-nos por tua causa' }, 20);
  const top = topMotives(c, 3);
  assert.equal(top.length, 3); assert.equal(top[0].key, 'castigo'); assert.equal(top[1].day, 10);
});

test('produção por ofício e estação; a Fonte faz armas', () => {
  assert.deepEqual(production(fresh('ribeira'), 'verão'), { food: 140, arms: 0 });
  assert.deepEqual(production(fresh('ribeira'), 'primavera'), { food: 56, arms: 0 });
  assert.deepEqual(production(fresh('souto'), 'outono'), { food: 48, arms: 0 });
  assert.deepEqual(production(fresh('fonte'), 'primavera'), { food: 18, arms: 4 });
  const vale = s => COMMUNITY_IDS.reduce((n, id) => n + production(fresh(id), s).food, 0);
  assert.deepEqual([vale('primavera'), vale('verão'), vale('outono')], [152, 228, 196]);
});

test('gravação: as comunidades fazem ida e volta; corrompidas são recusadas', () => {
  const s = newCampaign(9);
  shift(s.communities.ribeira, { trust: 10 }, { key: 'k', text: 'Texto' }, 5);
  assert.deepEqual(deserialize(serialize(s)).communities, s.communities);
  const bad = [
    o => { o.communities.ribeira.trust = 101; },
    o => { o.communities.ribeira.posture = 'zangada'; },
    o => { o.communities.ribeira.situation = 'feliz'; },
    o => { o.communities.ribeira.motives = [{ key: 'k', v: 5, day: 1 }]; },
    o => { delete o.communities.vau; },
    o => { o.communities.fonte.due = { food: -1, day: 3 }; },
    o => { o.communities.souto.away = -2; },
  ];
  for (const f of bad) { const o = JSON.parse(serialize(s)); f(o); assert.equal(deserialize(JSON.stringify(o)), null, String(f)); }
  assert.equal(validCommunities(s.communities), true);
});

test('gravação v1 antiga, sem comunidades, continua a carregar e ganha as cinco', () => {
  const st = memStorage();
  const flow = createFlow({ storage: st, seed: 21 });
  const env = JSON.parse(st.getItem(STORAGE_KEY));
  delete env.state.communities;   // como gravava o jogo antes deste PR
  st.setItem(STORAGE_KEY, JSON.stringify(env));
  const back = loadFlow(st);
  assert.ok(back, 'carrega');
  assert.equal(back.state.v, 1);
  assert.deepEqual(Object.keys(back.state.communities), COMMUNITY_IDS);
  assert.deepEqual(back.state.communities, flow.state.communities, 'as mesmas que uma campanha nova com a mesma semente');
  const again = {}; ensureCommunities(again.state = back.state);
  assert.equal(again.state.communities, back.state.communities, 'ensureCommunities não refaz o que já existe');
});
