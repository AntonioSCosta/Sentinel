// Task 12: o ecrã do mapa da campanha (estado 'map'), HUD, ordens, modal de batalha provisório e ecrã final.
export default async function ({ G, win, doc, check, renderer, st, setGod }) {
  const $ = id => doc.getElementById(id), shown = id => !!$(id) && !$(id).classList.contains('hidden');
  // espião do contexto 2D (o jsdom não traz canvas): conta as chamadas de desenho
  let fills = 0;
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { if (k === 'fillRect' || k === 'fillText') fills++; }), set: (t, k, v) => { t[k] = v; return true; } });
  win.HTMLCanvasElement.prototype.getContext = function (kind) { return kind === '2d' ? ctx : null; };

  check('menu has the campaign entry', !!$('camp-new') && $('camp-new').textContent.includes('CAMPANHA'));
  check('no «continuar» without a save', !shown('camp-cont'));
  G.campaignStorage.clear();
  G.startCampaign(1234);
  check('campaign opens the map state', G.state === 'map' && shown('map') && !shown('menu'));
  const f = G.campaign.flow, s = f.state;
  // 3D is not drawn under the map, and is drawn again after leaving
  { const rd = renderer, c0 = rd.calls || 0; G.step(1 / 60); G.render(); G.render();
    check('no 3D render while on the map', (rd.calls || 0) === c0); }
  // the status log is not rebuilt by resizes or clicks without news
  { const first = $('mlog').firstChild; win.dispatchEvent(new win.Event('resize')); G.campaign.render();
    check('resize leaves the log DOM untouched', first && $('mlog').firstChild === first); }
  check('the map canvas has a size and was drawn', $('mapcv').width > 0 && $('mapcv').height > 0 && fills > 0);
  const num = id => +$(id).textContent.replace(/\D/g, '');
  check('HUD shows men/food/arms/fame', num('m-men') === s.men && num('m-food') === s.food && num('m-arms') === s.arms && num('m-fame') === s.fame);
  check('HUD shows date and season', $('m-date').textContent.length > 3 && $('m-season').textContent.length > 2);
  check('log is a live status region', $('mlog').getAttribute('role') === 'status');
  check('action buttons are real buttons with text', ['m-acampar', 'm-esperar', 'm-esconder'].every(id => $(id).tagName === 'BUTTON' && $(id).textContent.trim()));
  // clicar no botão Acampar avança um dia
  const d0 = s.day; $('m-acampar').click();
  check('Acampar button advances one day', s.day === d0 + 1 && num('m-day') === s.day);
  // clicar numa aldeia mostra o painel contextual
  const vill = s.world.settlements.find(x => x.kind === 'aldeia'), view = G.campaign.view();
  const cv = $('mapcv'); cv.getBoundingClientRect = () => ({ left: 0, top: 0, width: view.width, height: view.height });
  const sx = view.ox + vill.x * view.scale, sy = view.oy + vill.y * view.scale;
  cv.dispatchEvent(new win.MouseEvent('click', { clientX: sx, clientY: sy, bubbles: true }));
  check('clicking a village shows its panel with Recrutar', shown('mctx') && $('mctx').textContent.includes(vill.name) && !!$('mctx').querySelector('[data-act="recrutar"]'));
  // clicar em terreno vazio marcha
  const x0 = s.party.x, y0 = s.party.y;
  cv.dispatchEvent(new win.MouseEvent('click', { clientX: view.ox + 2, clientY: view.oy + 2, bubbles: true }));
  check('clicking empty ground marches', s.party.x !== x0 || s.party.y !== y0);
  // acampar até haver batalha (máx. 300)
  let n = 0; while (f.phase === 'mapa' && n < 300) { G.campaign.order({ kind: 'acampar' }); n++; }
  check(`camping leads to a battle or the end (${n} orders)`, f.phase !== 'mapa');
  if (f.phase === 'batalha') {
    const fight = ['emboscada', 'campo-aberto', 'defesa-aldeia'].includes(f.battle.type);
    check('battle modal shows', shown('mbattle') && !/\(/.test($('mb-type').textContent) && doc.activeElement === $(fight ? 'mb-fight' : 'mb-win'));
    G.campaign.simulateBattle({ won: true, alliesLost: 1, enemiesKilled: 6 });
    check('a simulated victory returns to the map (or end)', !shown('mbattle') && f.phase !== 'batalha');
  }
  n = 0; while (f.phase !== 'fim' && n < 800) {
    G.campaign.order({ kind: 'acampar' }); n++;
    if (f.phase === 'batalha') G.campaign.simulateBattle({ won: false, retreated: true, alliesLost: 0, enemiesKilled: 0 });
  }
  check(`year ends with the end screen (${n} orders)`, f.phase === 'fim' && shown('mend') && ['vitoria', 'derrota'].includes(f.state.over) && $('mend').textContent.length > 20);
  $('mend-menu').click();
  check('«Voltar ao menu» leaves the map', G.state === 'menu' && shown('menu') && !shown('map'));
  G.campaignStorage.clear(); G.startCampaign(5); G.campaign.order({ kind: 'acampar' });
  G.campaign.close(); 
  check('with a save the menu offers «Continuar campanha»', shown('camp-cont'));
  $('camp-cont').click();
  check('continuing restores the day', G.state === 'map' && G.campaign.flow.state.day === 1);
  win.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'Escape' }));
  check('ESC on the map returns to the menu', G.state === 'menu' && !shown('map'));
  { const rd = renderer, c0 = rd.calls || 0; G.render(); check('3D renders again after leaving the map', (rd.calls || 0) > c0); }
  // the save vanishes behind the menu: «Continuar» must not strand the player
  G.campaignStorage.clear(); $('camp-cont').classList.remove('hidden'); $('camp-cont').click();
  check('failed continue stays on the menu', G.state === 'menu' && shown('menu') && !shown('map') && !shown('camp-cont'));
  // removeItem throwing must not break «Nova campanha»
  G.startCampaign(9); const rm = G.campaignStorage.removeItem; G.campaignStorage.removeItem = () => { throw new Error('quota'); };
  $('mend').classList.remove('hidden'); $('mend-new').click(); G.campaignStorage.removeItem = rm;
  check('new campaign survives a throwing removeItem', G.state === 'map' && G.campaign.flow.state.day === 0);
  G.campaign.close();

  battleBridge({ G, doc, win, check, st, setGod, $, shown });
  villageDefence({ G, doc, win, check, st, setGod, $, shown });
}

// Task 13: a ponte para as batalhas 3D (emboscada e campo aberto) e o regresso ao mapa.
function battleBridge({ G, doc, win, check, st, setGod, $, shown }) {
  const spec = (type, o = {}) => ({ type, seed: 4242, site: type === 'emboscada' ? 'estrada' : 'campo', allies: 8, realMen: 8,
    enemies: { legio: 6, velites: 2, centurion: false }, bonus: { allies: 0, enemies: 0 }, ...o });
  const wire = (sp, seed = 77) => {
    G.campaignStorage.clear(); G.startCampaign(seed);
    const f = G.campaign.flow; f.state.men = sp.realMen; f.state.fame = 20;
    let calls = 0; const fb = f.finishBattle; f.finishBattle = r => { calls++; return fb(r); };
    G.campaignTest.forceBattle(sp);
    return { f, calls: () => calls };
  };
  const alive = list => list.filter(x => !x.dead).length;
  const backOnMap = () => G.state === 'map' && shown('map') && !shown('hud') && !shown('end') && !shown('pause') && !shown('mbattle');
  for (const type of ['emboscada', 'campo-aberto']) {
    const w = wire(spec(type));
    check(`${type}: the modal offers «Lutar», not the placeholder`, shown('mbattle') && shown('mb-fight') && !shown('mb-win') && doc.activeElement === $('mb-fight'));
    $('mb-fight').click();
    check(`${type}: «Lutar» leaves the map for the 3D battle`, G.state === 'play' && !shown('map') && shown('hud') && G.chapter === 'emboscada');
    check(`${type}: exactly 8 allies and 8 Romans (${G.allies.length}/${G.enemies.length})`, G.allies.length === 8 && alive(G.allies) === 8 && G.enemies.length === 8 && alive(G.enemies) === 8);
    check(`${type}: 6 legionaries and 2 velites`, G.enemies.filter(e => e.kind === 'legio').length === 6 && G.enemies.filter(e => e.kind === 'velite').length === 2);
    const near = Math.min(...G.enemies.map(e => Math.hypot(e.pos.x - G.P.pos.x, e.pos.z - G.P.pos.z)));
    if (type === 'emboscada') check(`emboscada: the patrol marches on the road, unaware (${near.toFixed(0)} m)`, G.enemies.every(e => e.state === 'march') && near > 25);
    else check(`campo-aberto: the Romans face Viriato 40–60 m away and come on (${near.toFixed(1)} m)`, near >= 38 && near <= 60 && G.enemies.every(e => e.state === 'chase' || e.state === 'skirmish'));
    check(`${type}: nobody spawned inside the ground`, [...G.allies, ...G.enemies].every(x => Math.abs(x.pos.y - G.heightAt(x.pos.x, x.pos.z)) < .05));
    setGod(true); st(30);
    for (const e of G.enemies) G.damageEnemyForTest(e, 9999);
    st(200); setGod(false);
    const lost = G.allies.filter(a => a.dead).length;
    check(`${type}: killing every Roman goes back to the map`, backOnMap() && w.f.phase === 'mapa' && w.calls() === 1);
    check(`${type}: the victory is applied (${w.f.state.men} men)`, w.f.state.men === 8 - lost && w.f.state.fame === 25 && /Vitória/.test($('mlog').textContent));
    st(120); G.campaign.render();
    check(`${type}: finishBattle is called once only`, w.calls() === 1 && G.state === 'map');
  }
  { // Viriato falls: a defeat, not the end of the campaign, and no old 'dead' end screen
    const w = wire(spec('emboscada'));
    $('mb-fight').click(); st(5);
    G.hurtAllyForTest(G.allies[0], 999);
    G.damagePlayer(999, G.P.pos.clone().add(new G.V3(1, 0, 0)), false);
    check('the player\'s death is noticed', G.state === 'dead');
    st(400);
    check('his death is a defeat: back on the map, campaign goes on', backOnMap() && w.calls() === 1 && w.f.phase === 'mapa' && w.f.state.over === null);
    check(`one man plus Viriato counted as lost (${w.f.state.men})`, w.f.state.men === 6 && /Derrota/.test($('mlog').textContent));
    check('the old «Viriato tombou» end screen is not shown', !shown('end'));
  }
  { // ESC → pause → «Abandonar (derrota)»
    const w = wire(spec('campo-aberto'));
    $('mb-fight').click(); st(5);
    doc.dispatchEvent(new win.Event('pointerlockchange'));
    check('the pause in a campaign battle offers «Abandonar (derrota)» and no restart', G.state === 'pause' && shown('abandon') && !shown('restart'));
    $('abandon').click();
    check('abandoning is a defeat and goes back to the map', backOnMap() && w.calls() === 1 && w.f.phase === 'mapa' && w.f.state.men === 7 && /Derrota/.test($('mlog').textContent));
    st(60); check('… once only', w.calls() === 1);
  }
  { // types without a 3D scene yet keep the placeholder
    const w = wire(spec('decisiva', { enemies: { legio: 20, velites: 6, centurion: true } }));
    check('decisiva keeps the placeholder buttons', shown('mb-win') && !shown('mb-fight'));
    check('startCampaignBattle refuses it and stays on the map', G.startCampaignBattle(w.f.battle) === false && G.state === 'map');
    G.campaign.simulateBattle({ won: false, retreated: true, alliesLost: 0, enemiesKilled: 0 });
    check('simulateBattle finishes any battle', w.f.phase !== 'batalha' && w.calls() === 1);
  }
  { // the biggest battle the caps allow stays inside the envelope of the story chapters (the prologue: 36 Romans + 25 villagers)
    const tris = obj => { let n = 0; obj.traverse(o => { if (!o.isMesh || !o.geometry) return; const g = o.geometry; n += (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); }); return n; };
    G.setQuality('high'); G.campaign.close(); G.start(1, 'prologo'); const prologue = tris(G.scene);
    wire(spec('campo-aberto', { allies: 25, realMen: 40, enemies: { legio: 23, velites: 7, centurion: true } }));
    $('mb-fight').click(); st(5);
    const total = tris(G.scene);
    check(`a capped battle shows 25 allies and 30 Romans (${G.allies.length}/${G.enemies.length})`, G.allies.length === 25 && G.enemies.length === 30);
    check(`a capped battle has no more triangles on Alta than the prologue (${Math.round(total)} ≤ ${Math.round(prologue)})`, total <= prologue);
    G.setQuality('medium');
    $('abandon').click?.(); // not paused: does nothing
    check('«Abandonar» only acts from the pause', G.state === 'play');
    doc.dispatchEvent(new win.Event('pointerlockchange')); $('abandon').click();
  }
  { // the story chapters are untouched after a campaign battle
    G.campaign.close();
    G.start(1); if (G.state === 'pause') G.resume();
    check('after a campaign battle the story ambush is the old one again', G.chapter === 'emboscada' && G.enemies.filter(e => e.group === 'patrol').length === 16);
    doc.dispatchEvent(new win.Event('pointerlockchange'));
    check('and its pause has «Recomeçar» and no «Abandonar»', G.state === 'pause' && !shown('abandon') && shown('restart'));
    G.resume();
  }
}

// Task 14: defesa de aldeia, no castro: atacantes pela estrada, aldeões no centro; o centro tomado queima a aldeia.
function villageDefence({ G, doc, win, check, st, setGod, $, shown }) {
  const C = G.CASTRO;
  const begin = (seed = 99) => {
    G.campaignStorage.clear(); G.startCampaign(seed);
    const f = G.campaign.flow, vid = Object.keys(f.state.villages)[0]; f.state.men = 8; f.state.fame = 20;
    let calls = 0; const fb = f.finishBattle; f.finishBattle = r => { calls++; return fb(r); };
    G.campaignTest.forceBattle({ type: 'defesa-aldeia', seed: 4242, site: 'castro', villageId: vid, allies: 8, realMen: 8,
      enemies: { legio: 6, velites: 2, centurion: false }, bonus: { allies: 0, enemies: 0 } });
    return { f, vid, calls: () => calls };
  };
  const dC = p => Math.hypot(p.x - C.x, p.z - C.z);
  const backOnMap = () => G.state === 'map' && shown('map') && !shown('hud') && !shown('mbattle');
  let w = begin();
  check('defesa: the modal offers «Lutar»', shown('mbattle') && shown('mb-fight') && !shown('mb-win') && doc.activeElement === $('mb-fight'));
  $('mb-fight').click();
  check('defesa: «Lutar» starts the 3D battle', G.state === 'play' && !shown('map') && shown('hud'));
  check(`defesa: 8 allies and 8 Romans (${G.allies.length}/${G.enemies.length})`, G.allies.length === 8 && G.enemies.length === 8);
  const civ = G.civs.filter(c => !c.dead && dC(c.pos) < 8);
  check(`defesa: villagers stand in the centre of the castro (${civ.length})`, civ.length >= 4);
  check(`defesa: Viriato starts inside the walls (${dC(G.P.pos).toFixed(1)} m)`, dC(G.P.pos) < 13);
  const onRoad = G.enemies.every(e => Math.abs(e.pos.x - G.roadX(e.pos.z)) < 3.5 && dC(e.pos) > 35);
  check('defesa: the attackers arrive along the road, outside the village', onRoad && G.enemies.every(e => e.state === 'march'));
  check('defesa: objective «Defende a aldeia»', /Defende a aldeia — 8 romanos/.test($('objt').textContent));
  const d0 = Math.min(...G.enemies.map(e => dC(e.pos)));
  st(600);
  const d1 = Math.min(...G.enemies.filter(e => !e.dead).map(e => dC(e.pos)));
  check(`defesa: the column marches on the village (${d0.toFixed(0)} → ${d1.toFixed(0)} m)`, d1 < d0 - 8);
  // all the Romans dead: the village stands
  setGod(true);
  for (const e of G.enemies) G.damageEnemyForTest(e, 9999);
  st(200); setGod(false);
  const lost = G.allies.filter(a => a.dead).length;
  check('defesa: killing every Roman goes back to the map once', backOnMap() && w.f.phase === 'mapa' && w.calls() === 1);
  check(`defesa won: the village stands and fame +8 (${w.f.state.fame}); villagers are not your men (${w.f.state.men})`,
    w.f.state.villages[w.vid].burnt === false && w.f.state.fame === 28 && w.f.state.men === 8 - lost && /Vitória/.test($('mlog').textContent));
  // a Roman takes the centre and holds it: the village burns
  w = begin(); $('mb-fight').click(); st(5);
  setGod(true);
  for (const a of G.allies) G.hurtAllyForTest(a, 9999);
  G.P.pos.set(C.x - 90, G.heightAt(C.x - 90, C.z + 40), C.z + 40);
  const r = G.enemies[0]; r.pos.set(C.x + 1, G.heightAt(C.x + 1, C.z), C.z + 1);
  st(90);
  check('defesa: a Roman in the centre does not end it at once', G.state === 'play' && w.calls() === 0);
  st(600); setGod(false);
  check('defesa: the centre held → defeat, back on the map', backOnMap() && w.calls() === 1 && w.f.phase !== 'batalha');
  check('defesa lost: the village is burnt on the map', w.f.state.villages[w.vid].burnt === true && /queimada/.test($('mlog').textContent));
  G.campaign.close();
  cappedTris({ G, doc, win, check, st, $, type: 'defesa-aldeia', extra: { site: 'castro', villageId: 'x' } });
}

/** The biggest battle of this type stays inside the prologue's triangle envelope (on Alta). */
function cappedTris({ G, doc, win, check, st, $, type, extra = {} }) {
  const tris = obj => { let n = 0; obj.traverse(o => { if (!o.isMesh || !o.geometry) return; const g = o.geometry; n += (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); }); return n; };
  G.setQuality('high'); G.campaign.close(); G.start(1, 'prologo'); const prologue = tris(G.scene);
  G.campaignStorage.clear(); G.startCampaign(31);
  G.campaignTest.forceBattle({ type, seed: 4242, allies: 25, realMen: 40, enemies: { legio: 23, velites: 7, centurion: true }, bonus: { allies: 15, enemies: 0 }, ...extra });
  $('mb-fight').click(); st(5);
  const total = tris(G.scene);
  check(`${type}: a capped battle (${G.allies.length}/${G.enemies.length}) has no more triangles on Alta than the prologue (${Math.round(total)} ≤ ${Math.round(prologue)})`, G.allies.length === 25 && G.enemies.length === 30 && total <= prologue);
  G.setQuality('medium');
  doc.dispatchEvent(new win.Event('pointerlockchange')); $('abandon').click();   // out of the battle again
  check(`${type}: the capped battle is abandoned cleanly`, G.state === 'map');
  G.campaign.close();
}
