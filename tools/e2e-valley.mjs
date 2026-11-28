// E2E (Chrome real, Playwright): o ecrã do vale (PR 5), como um jogador o usa.
//   1 selecionar uma aldeia · 2 ver postura e motivos · 3 executar uma ação disponível · 4 ver uma ação indisponível e o
//   motivo · 5 abrir um assunto e ir para o local · 6 pausar, acelerar e retomar o tempo · 7 abrir o Diário ·
//   8 a interface não revela forças romanas desconhecidas · 9 a figura de cada comunidade está no seu lugar funcional ·
//   10 um save v:1 antigo carrega · 11 a interface não muda o resultado da simulação.
//   node tools/e2e-valley.mjs [pasta-de-capturas]
import fs from 'node:fs';
import path from 'node:path';
import { startE2E } from './e2e-lib.mjs';

const OUT = process.argv[2] || '';
const { url, browser, check, finish } = await startE2E();
const shot = async (page, name) => { if (OUT) { fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); } };

async function openMap(page, seed = 3) {
  await page.goto(url + '&legacy-map-test=1');
  await page.waitForFunction(() => !!window.__game, null, { timeout: 60000 });
  await page.evaluate(seed => {
    const G = window.__game; G.campaignStorage.clear(); localStorage.removeItem('viriato.campaign.speed');
    G.startCampaign(seed); G.showCampaignMap();
    const s = G.campaign.flow.state; s.done.push('cativos'); s.food = 400; s.arms = 30;   // sem o capítulo agendado a meio do teste
    G.campaign.render();
  }, seed);
  await page.waitForSelector('#map:not(.hidden)');
}
/** Ponto de ecrã (página) da figura de uma comunidade, a partir da vista real do mapa. */
const placePoint = (page, cid) => page.evaluate(cid => {
  const c = window.__game.campaign, s = c.flow.state, v = c.view(), p = s.world.settlements.find(x => x.id === s.communities[cid].settlement);
  const r = document.getElementById('mapcv').getBoundingClientRect();
  return { x: r.left + v.ox + p.x * v.scale, y: r.top + v.oy + p.y * v.scale, id: p.id };
}, cid);
const NAMES = { ribeira: 'Aldeia da Ribeira', penedo: 'Castro do Penedo', souto: 'Aldeia do Souto', vau: 'Aldeia do Vau', fonte: 'Aldeia da Fonte' };

for (const vp of [{ width: 1366, height: 768 }, { width: 844, height: 390 }]) {
  const tag = `${vp.width}x${vp.height}`, narrow = vp.width <= 900;
  const page = await browser.newPage({ locale: 'pt-PT', viewport: vp });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await openMap(page);

  // 9 + 1: clicar na figura de cada comunidade seleciona esse lugar (o nome é o da comunidade)
  for (const cid of Object.keys(NAMES)) {
    const p = await placePoint(page, cid);
    await page.mouse.click(p.x, p.y);
    const h = await page.locator('#mctx h3').textContent().catch(() => null);
    check(`${tag}: 9 · clicar na figura de ${NAMES[cid]} seleciona-a`, h === NAMES[cid] && await page.locator('#mctx').isVisible(), `painel «${h}»`);
    await page.keyboard.press('Escape');
    if (narrow && await page.locator('#mside').isVisible()) await page.keyboard.press('Escape');   // a gaveta tapa o mapa: fecha-se
  }

  // 2 + 3: recrutar no Souto (amiga): o bando cresce, a aldeia lembra-se, a confirmação aparece e fica no Diário
  await page.evaluate(() => { const c = window.__game.campaign, s = c.flow.state, p = s.world.settlements.find(x => x.id === s.communities.souto.settlement); s.party = { x: p.x, y: p.y }; c.render(); });
  const souto = await placePoint(page, 'souto');
  await page.mouse.click(souto.x, souto.y);
  const chips = await page.locator('#mctx .chips').textContent();
  check(`${tag}: 2 · o painel mostra a postura e a situação por extenso`, /Amiga/.test(chips) && /Livre/.test(chips), chips);
  const before = await page.evaluate(() => ({ men: window.__game.campaign.flow.state.men, day: window.__game.campaign.flow.state.day }));
  const info = await page.locator('#mctx [data-act="recrutar"] + small').textContent();
  check(`${tag}: 3 · «Recrutar» diz o que dá e o que custa antes de se carregar`, /\+\d+ homens/.test(info) && /Gasta o dia/.test(info), info);
  await page.click('#mctx [data-act="recrutar"]');
  const after = await page.evaluate(() => { const f = window.__game.campaign.flow; return { men: f.state.men, day: f.state.day, j: f.journal.some(e => e.type === 'recrutou') }; });
  const log = await page.locator('#mlog').textContent();
  check(`${tag}: 3 · recrutar dá homens, gasta um dia, confirma e regista no Diário`, after.men > before.men && after.day === before.day + 1 && after.j && /juntam-se a ti/.test(log), `${before.men}→${after.men}`);
  const why0 = await page.locator('#mctx').textContent();
  check(`${tag}: 2 · o painel tem a secção «Porquê» (−2 de confiança ainda não chega a um motivo: o mínimo é 5)`, /Porquê/i.test(why0) && /Ainda nada de marcante/.test(why0));
  await shot(page, `vale-recrutar-${tag}`);

  // 4: na Ribeira (receosa), «Recrutar» está desligado e diz porquê
  await page.evaluate(() => { const c = window.__game.campaign, s = c.flow.state, p = s.world.settlements.find(x => x.id === s.communities.ribeira.settlement); s.party = { x: p.x, y: p.y }; c.select(p.id); });
  const rb = page.locator('#mctx [data-act="recrutar"]');
  const why = await page.locator('#mctx [data-act="recrutar"] + small').textContent();
  check(`${tag}: 4 · ação indisponível com o motivo real`, await rb.isDisabled() && /receosa: não dá homens/.test(why), why);
  await page.keyboard.press('Escape');

  // 5: um tributo abre no centro; adiar deixa o assunto disponível; pagar usa rome.payTribute e vai ao Diário
  await page.evaluate(() => { const c = window.__game.campaign, s = c.flow.state, v = s.communities.vau; v.situation = 'tributada'; v.due = { food: 6, day: s.day + 5 }; v.food = 30; c.render(); });
  const decision = page.locator('#mtribute');
  await decision.waitFor();
  const ct = await decision.textContent();
  check(`${tag}: 5 · a decisão diz origem, prazo e consequência`, /Roma exige tributo a Aldeia do Vau/.test(ct) && /prazo: 5 dias/.test(ct) && /castigada/.test(ct), ct.slice(0, 140));
  await page.keyboard.press('Escape');
  if (narrow && !(await page.locator('#mside').isVisible())) await page.click('#m-side-toggle');
  const card = page.locator('#missues-list .issue.t-tributo');
  await card.locator('.head').click();
  check(`${tag}: 5 · abrir o assunto seleciona o lugar`, (await page.locator('#mctx h3').textContent()) === 'Aldeia do Vau');
  await page.click('#mctx [data-act="ver-decisao"]');
  await decision.locator('[data-act="pagar"]').click();
  const paid = await page.evaluate(() => { const f = window.__game.campaign.flow, v = f.state.communities.vau; return { sit: v.situation, food: v.food, j: f.journal.some(e => e.type === 'tributo-pago' && e.auto === false), day: f.state.day }; });
  check(`${tag}: 5 · pagar tira a comida devida, a aldeia fica livre, não gasta o dia, fica no Diário`, paid.sit === 'livre' && paid.food === 24 && paid.j && paid.day === after.day, JSON.stringify(paid));
  const mv = await page.locator('#mctx .motives').textContent().catch(() => '');
  check(`${tag}: 2 · os motivos dizem porquê (pagar o tributo custou confiança)`, /Pagaram o tributo por tua ordem/.test(mv) && /▼/.test(mv), mv);
  await page.keyboard.press('Escape');
  if (narrow && await page.locator('#mside').isVisible()) await page.keyboard.press('Escape');

  // 6: parado o tempo não passa (nem a 4×); Acampar faz passar; pausa e retoma com Espaço; a velocidade fica guardada
  check(`${tag}: 6 · o tempo começa parado`, await page.evaluate(() => !window.__game.campaign.running));
  const d0 = await page.evaluate(() => window.__game.campaign.flow.state.day);
  await page.click('[data-speed="4"]');
  await page.waitForTimeout(1300);
  check(`${tag}: 6 · parado, escolher 4× não faz passar dias`, await page.evaluate(d => window.__game.campaign.flow.state.day === d && !window.__game.campaign.running, d0));
  await page.click('#m-camp');
  await page.waitForTimeout(1300);
  const d1 = await page.evaluate(() => window.__game.campaign.flow.state.day);
  check(`${tag}: 6 · a acampar, a 4× passam dias`, d1 >= d0 + 2, `${d0}→${d1}`);
  await page.click('#m-pause');
  const d2 = await page.evaluate(() => window.__game.campaign.flow.state.day);
  await page.waitForTimeout(800);
  check(`${tag}: 6 · em pausa não passa nenhum dia`, await page.evaluate(d => window.__game.campaign.flow.state.day === d && !window.__game.campaign.running, d2));
  await page.locator('#mapcv').focus();
  await page.keyboard.press('Space');
  check(`${tag}: 6 · Espaço retoma à velocidade escolhida`, await page.evaluate(() => window.__game.campaign.running && window.__game.campaign.speed === 4));
  await page.keyboard.press('Space');
  check(`${tag}: 6 · Espaço volta a pausar; a velocidade está guardada à parte do save`, await page.evaluate(() => !window.__game.campaign.running && localStorage.getItem('viriato.campaign.speed') === '4' && JSON.parse(localStorage.getItem('viriato.campaign')).v === 1));
  await page.click('#m-camp');
  check(`${tag}: 6 · desligar Acampar deixa o bando parado`, await page.evaluate(() => window.__game.campaign.stance === null && !window.__game.campaign.running));

  // 7: o Diário
  await page.click('#m-diary');
  const tabs = await page.evaluate(() => [...document.querySelectorAll('#mdiary-tabs [role="tab"]')].map(t => t.textContent));
  check(`${tag}: 7 · o Diário abre com os cinco separadores`, tabs.join('|') === 'Campanha|Comunidades|História|Relatos|Lugares', tabs.join('|'));
  await page.click('#mdiary-tab-historia');
  const hist = await page.locator('#mdiary-body').textContent();
  check(`${tag}: 7 · a História tem as decisões tomadas (recrutar, pagar o tributo)`, /juntam-se a ti/.test(hist) && /entrega o tributo/.test(hist), hist.slice(0, 160));
  await page.keyboard.press('ArrowRight');
  check(`${tag}: 7 · as setas mudam de separador`, await page.evaluate(() => document.querySelector('#mdiary-tabs [aria-selected="true"]').dataset.tab === 'relatos'));
  await shot(page, `vale-diario-${tag}`);
  await page.keyboard.press('Escape');

  // 8: uma patrulha que o bando não viu não se desenha, não se seleciona e não aparece nos assuntos
  const unseen = await page.evaluate(async () => {
    const c = window.__game.campaign, s = c.flow.state, cv = document.getElementById('mapcv'), mv = await import('/src/campaign/map-view.js');
    s.praetor && (s.praetor.x = -999);
    c.select(null); c.render(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const a = cv.toDataURL();
    const p = { x: s.party.x + 30, y: s.party.y + 10 };
    s.patrols.push({ id: 'oculta', kind: 'patrulha', x: p.x, y: p.y, i: 1, dir: 1, men: 6 });
    c.render(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const b = cv.toDataURL(), v = c.view(), hitUnseen = mv.hitTest(v, s, v.ox + p.x * v.scale, v.oy + p.y * v.scale);
    const iss = await import('/src/campaign/issues.js'), listed = () => iss.buildIssues(s, c.flow.journal).some(i => i.force === 'oculta');
    const side = listed();
    s.intel.known.oculta = { kind: 'patrulha', x: p.x, y: p.y, day: s.day, men: 6 };   // controlo: vista, aparece
    c.render(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const d = cv.toDataURL(), hitSeen = mv.hitTest(v, s, v.ox + p.x * v.scale, v.oy + p.y * v.scale);
    return { same: a === b, hitUnseen, side, changed: d !== b, hitSeen, side2: listed() };
  });
  check(`${tag}: 8 · uma patrulha desconhecida não muda um píxel do mapa`, unseen.same);
  check(`${tag}: 8 · nem se seleciona nem aparece nos assuntos`, unseen.hitUnseen?.type !== 'patrol' && !unseen.side, JSON.stringify(unseen.hitUnseen));
  check(`${tag}: 8 · controlo: vista hoje, desenha-se e aparece`, unseen.changed && unseen.hitSeen?.type === 'patrol' && unseen.side2);

  // 10: um save v:1 de antes das comunidades, de Roma e do Diário continua a carregar
  const old = await page.evaluate(() => {
    const G = window.__game, env = JSON.parse(localStorage.getItem('viriato.campaign'));
    delete env.state.communities; delete env.state.rome; delete env.state.intel; delete env.journal; env.phase = 'mapa'; env.battle = null; env.state.over = null;
    localStorage.setItem('viriato.campaign', JSON.stringify(env));
    G.campaign.close(); const ok = G.campaign.resume();
    const f = G.campaign.flow;
    return { ok, map: !document.getElementById('map').classList.contains('hidden'), c: !!f.state.communities?.ribeira, j: Array.isArray(f.journal), v: env.v };
  });
  check(`${tag}: 10 · um save v:1 antigo (sem comunidades, Roma nem Diário) carrega no mapa`, old.ok && old.map && old.c && old.j && old.v === 1, JSON.stringify(old));

  // 11: os mesmos dias pela interface (com painel, Diário, assuntos e pré-visualizações) e pelo fluxo puro dão o mesmo estado
  const same = await page.evaluate(async () => {
    const { createFlow } = await import('/src/campaign/flow.js'), { serialize } = await import('/src/campaign/state.js');
    const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) }; };
    const G = window.__game, c = G.campaign;
    c.fresh(77); const a = c.flow; a.state.done.push('cativos'); a.state.food = 1000;
    const b = createFlow({ storage: mem(), seed: 77 }); b.state.done.push('cativos'); b.state.food = 1000;
    for (let i = 0; i < 40 && a.phase === 'mapa' && b.phase === 'mapa'; i++) {
      if (i === 5) c.select(a.state.communities.souto.settlement);
      if (i === 12) c.openDiary('historia');
      if (i === 20) { c.closeDiary(); c.select(a.state.communities.ribeira.settlement); }
      c.step(); b.order({ kind: 'acampar' });
    }
    return { eq: serialize(a.state) === serialize(b.state), day: a.state.day };
  });
  check(`${tag}: 11 · a interface não muda a simulação (${same.day} dias iguais)`, same.eq && same.day > 0);

  check(`${tag}: sem erros de página`, errors.length === 0, errors.join(' | '));
  await page.close();
}

// revisão do PR 5: no dia 10, com «Os Cativos» por viver, recrutar não promete homens: diz que não se cumpre
{
  const page = await browser.newPage({ locale: 'pt-PT', viewport: { width: 1366, height: 768 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await openMap(page);
  const r = await page.evaluate(() => {
    const c = window.__game.campaign, s = c.flow.state, p = s.world.settlements.find(x => x.id === s.communities.souto.settlement);
    s.done = s.done.filter(x => x !== 'cativos'); s.day = 10; s.party = { x: p.x, y: p.y }; c.select(p.id);
    const info = document.querySelector('#mctx [data-act="recrutar"] + small')?.textContent ?? '', men = s.men;
    document.querySelector('#mctx [data-act="recrutar"]').click();
    return { info, phase: c.flow.phase, chapter: c.flow.battle?.chapter, same: s.men === men && s.day === 10 };
  });
  check('pré-visualização no dia 10: «Recrutar» diz que não se cumpre e não mostra ganhos', /não se cumpre/.test(r.info) && /Os Cativos/.test(r.info) && !/\+\d+ homens/.test(r.info), r.info);
  check('… e carregar lança «Os Cativos» sem recrutar nem passar o dia', r.phase === 'batalha' && r.chapter === 'cativos' && r.same, JSON.stringify(r));
  check('sem erros de página (dia 10)', errors.length === 0, errors.join(' | '));
  await page.close();
}

// 6: a velocidade escolhida sobrevive a recarregar a página
{
  const page = await browser.newPage({ locale: 'pt-PT', viewport: { width: 1280, height: 800 } });
  await openMap(page);
  await page.click('[data-speed="2"]'); await page.click('#m-pause');
  await page.reload(); await page.waitForFunction(() => !!window.__game, null, { timeout: 60000 });
  const r = await page.evaluate(() => { window.__game.campaign.resume(); return { speed: window.__game.campaign.speed, running: window.__game.campaign.running }; });
  check('6 · depois de recarregar: a velocidade 2× está guardada e o tempo começa em pausa', r.speed === 2 && !r.running, JSON.stringify(r));
  await page.close();
}
await finish();
