// Task 12: o ecrã do mapa da campanha (estado 'map'), HUD, ordens, modal de batalha provisório e ecrã final.
export default async function ({ G, win, doc, check, renderer }) {
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
    check('battle modal shows', shown('mbattle') && !/\(/.test($('mb-type').textContent) && doc.activeElement === $('mb-win'));
    $('mb-win').click();
    check('placeholder victory returns to the map (or end)', !shown('mbattle') && f.phase !== 'batalha');
  }
  n = 0; while (f.phase !== 'fim' && n < 800) {
    G.campaign.order({ kind: 'acampar' }); n++;
    if (f.phase === 'batalha') $('mb-retreat').click();
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
}
