/* ============================================================================
   SENTINEL · Protótipo de clareza da campanha — demonstração isolada
   ----------------------------------------------------------------------------
   Não é importado pelo jogo e não altera nenhum módulo de produção. Corre por
   cima de uma campanha aberta no browser e usa, sempre que possível, as regras
   reais (simulation.js, state.js, rome.js, issues.js, strings.js) para os
   números e os textos que mostra.

   Uso (consola ou Playwright):
     await __clareza.aplicar()
     __clareza.mapa('atual' | 'essencial' | 'forca' | 'povoado')
     __clareza.pedido()            // pedido de tributo real (levyTribute) + fixture de reservas
     __clareza.abrirModal()        // painel central da decisão
     __clareza.decidir('pagar'|'recusar')
     __clareza.notificacao()       // um dia real de espera, mostrado como aviso discreto
     __clareza.marcha()            // destino real + progresso real
     __clareza.interromper()       // um dia real com comida baixa: o tempo pára
     __clareza.metricas()          // sobreposições, cortes, contrastes, barras
     __clareza.reverter()
   ========================================================================== */
(() => {
  const CSS_PATH = '/artifacts/playtest-clarity/prototipo.css';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const camp = () => window.__game?.campaign;
  const flow = () => camp()?.flow;
  const state = () => flow()?.state;
  const lang = () => (document.documentElement.lang === 'en' ? 'en' : 'pt');
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cap = s => String(s ?? '').replace(/^./, c => c.toUpperCase());

  const TEXT = {
    pt: {
      decision: 'Decisão', paused: 'O tempo está parado', later: 'Adiar · decidir depois', pay: 'Pagar',
      escClose: 'Esc fecha · a decisão fica em Assuntos',
      note: 'As duas opções são as que existem no jogo. Pagar gasta a comida da aldeia; recusar castiga-a já.',
      payCost: '−{food} de comida da aldeia', payEffect: 'Confiança da aldeia {delta} ({from} → {to}). Roma não muda de atenção.',
      payNo: 'A aldeia não tem comida para pagar ({food} devidos, {have} nas reservas).',
      refuseCost: 'Castigo imediato', refuseEffect: 'Medo +{fear} na aldeia · metade da produção durante {days} dias · Roma presta-te mais atenção (+{attention}).',
      refused: 'Recusar',
      ignored: 'Se não decidires até ao prazo: {what}',
      decided: 'Decisão tomada', result: 'Resultado',
      essence: 'Essencial', essenceNote: 'só comunidades, forças e relatos',
      forceTag: 'Força romana', selected: 'selecionada', forceClose: '← Assuntos',
      confirmed: 'Confirmada hoje', estimated: 'Estimada · vista há {age} dias',
      strength: 'Efetivo estimado', distance: 'Distância', marchDays: '{days} de marcha', lessThanDay: 'a menos de um dia',
      ambush: 'Emboscar na estrada', ambushWhy: 'Só se estiveres na estrada e a menos de um dia desta força.',
      forceNote: 'A força não muda: esta seleção só reúne o que já se sabe dela.',
      marchTitle: 'Marcha', day: 'Dia {day} de {total}', duration: 'Duração', food: 'Comida', perDay: '{n}/dia',
      remaining: 'Falta', left: '{days} · {food} de comida', marching: 'A marchar. O tempo pára se algo acontecer.',
      interrupted: 'Interrompida', stopped: 'O tempo parou.', noDest: 'Sem destino.',
      toastTag: 'Sem decisão obrigatória', advance: 'Um dia de espera · o Diário guarda o resto.',
      essentialTag: 'Mapa essencial', forceShot: 'Força romana selecionada', placeShot: 'Povoação selecionada',
      communities: 'Comunidades', communitiesCount: '{visible} de {total} no mapa', communitiesPick: 'Ir a uma comunidade…',
      polTrust: 'confiança {trust} · medo {fear} · margem {margin}',
      polExample: 'Exemplo de alinhamento',
    },
    en: {
      decision: 'Decision', paused: 'Time is paused', later: 'Postpone · decide later', pay: 'Pay',
      escClose: 'Esc closes · the decision stays in Issues',
      note: 'These are the options the game already has. Paying spends the village food; refusing punishes it now.',
      payCost: '−{food} village food', payEffect: 'Village trust {delta} ({from} → {to}). Rome does not raise its attention.',
      payNo: 'The village has no food to pay ({food} due, {have} in reserve).',
      refuseCost: 'Immediate punishment', refuseEffect: 'Fear +{fear} in the village · half output for {days} days · Rome pays you more attention (+{attention}).',
      refused: 'Refuse',
      ignored: 'If you do not decide by the deadline: {what}',
      decided: 'Decision made', result: 'Result',
      essence: 'Essential', essenceNote: 'only communities, forces and reports',
      forceTag: 'Roman force', selected: 'selected', forceClose: '← Issues',
      confirmed: 'Confirmed today', estimated: 'Estimated · seen {age} days ago',
      strength: 'Estimated strength', distance: 'Distance', marchDays: "{days} of march", lessThanDay: 'less than a day',
      ambush: 'Ambush on the road', ambushWhy: 'Only if you are on the road and within a day of this force.',
      forceNote: 'The force does not change: this selection only gathers what you already know.',
      marchTitle: 'March', day: 'Day {day} of {total}', duration: 'Duration', food: 'Food', perDay: '{n}/day',
      remaining: 'Left', left: '{days} · {food} food', marching: 'Marching. Time stops if something happens.',
      interrupted: 'Interrupted', stopped: 'Time has stopped.', noDest: 'No destination.',
      toastTag: 'No decision required', advance: 'One day of waiting · the Diary keeps the rest.',
      essentialTag: 'Essential map', forceShot: 'Roman force selected', placeShot: 'Settlement selected',
      communities: 'Communities', communitiesCount: '{visible} of {total} on the map', communitiesPick: 'Go to a community…',
      polTrust: 'trust {trust} · fear {fear} · margin {margin}',
      polExample: 'Alignment example',
    },
  };
  const t = (key, params = {}) => {
    const raw = TEXT[lang()][key] ?? key;
    return raw.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? ''));
  };
  const POL_LABEL = {
    pt: { comprometida: 'Comprometida com Viriato', amiga: 'Apoia Viriato', neutra: 'Independente', receosa: 'Receosa de Roma', colabora: 'Colabora com Roma' },
    en: { comprometida: 'Committed to Viriatus', amiga: 'Supports Viriatus', neutra: 'Independent', receosa: 'Afraid of Rome', colabora: 'Collaborates with Rome' },
  };

  let mods = null;
  async function loadMods() {
    if (mods) return mods;
    const [sim, stateM, strings, intel, issues, rome, ui, communitiesMod] = await Promise.all([
      import('/src/campaign/simulation.js'),
      import('/src/campaign/state.js'),
      import('/src/campaign/strings.js'),
      import('/src/campaign/intel.js'),
      import('/src/campaign/issues.js'),
      import('/src/campaign/rome.js'),
      import('/src/campaign/ui.js'),
      import('/src/campaign/communities.js'),
    ]);
    mods = {
      marchDays: sim.marchDays, MARCH_SPEED: sim.MARCH_SPEED, nearRoad: sim.nearRoad, inReach: sim.inReach,
      foodPerDay: stateM.foodPerDay,
      strings, eventText: ui.eventText, intelView: intel.intelView, estimateMen: intel.estimateMen, SCOUTS: intel.SCOUTS,
      buildIssues: issues.buildIssues, NEAR: issues.NEAR,
      ensureRome: rome.ensureRome, levyTribute: rome.levyTribute, PUNISH: rome.PUNISH, ATTENTION_GAIN: rome.ATTENTION_GAIN,
      margin: communitiesMod.margin, postureFor: communitiesMod.postureFor,
    };
    return mods;
  }

  let applied = false;
  let timer = 0;
  let march = null;          // { dest, total, name, startDay }
  let lastDest = null;
  let pedidoId = 'souto';   // a comunidade do pedido de demonstração (aldeia, não paga sozinha)
  let opener = null;
  let modalKeydown = null;

  function injectCss() {
    if ($('#clareza-css')) return;
    const link = document.createElement('link');
    link.id = 'clareza-css';
    link.rel = 'stylesheet';
    link.href = `${CSS_PATH}?v=5`;   // o CSS muda com a proposta: não deixar o browser servir o antigo
    document.head.append(link);
  }

  function stage() { return $('#campaign-map-3d'); }
  function render() { try { camp()?.render(); } catch { /* campanha fechada */ } }
  /** Os nossos painéis vivem por baixo da barra de cima, seja qual for a altura que ela tem em cada ecrã. */
  function belowBar(el) {
    const bar = $('#mtop');
    if (el && bar) el.style.top = `${Math.round(bar.getBoundingClientRect().bottom + 8)}px`;
  }

  function labelFor(kind, id) {
    return $(`#campaign-map-3d .map-label[data-kind="${CSS.escape(kind)}"][data-id="${CSS.escape(String(id))}"]`);
  }
  function communityAt(id) {
    const s = state();
    return s?.communities ? Object.values(s.communities).find(c => c.settlement === id) : null;
  }
  function settlement(id) { return state()?.world?.settlements?.find(x => x.id === id); }
  function displayName(id) {
    const place = settlement(id);
    const label = labelFor('settlement', id);
    return label?.textContent?.trim() || mods.strings.placeName(state(), id) || place?.name || id;
  }

  /* ---------------------------------------------------------------- mapa -- */
  function resetMapModes() {
    const el = stage();
    if (!el) return;
    el.classList.remove('clareza-essencial', 'clareza-foco');
    for (const label of $$('.map-label', el)) label.classList.remove('cl-secondary');
    $('#clareza-mapnote')?.remove();
    $('#clareza-communities')?.remove();
    $('#clareza-force')?.remove();
    $('#missues')?.classList.remove('hidden');
    $('#mctx')?.classList.add('hidden');
    document.querySelector('#campaign-map-3d [data-camera="reset"]')?.click();
  }

  const visibleCommunities = () => $$('#campaign-map-3d .map-label.community')
    .filter(el => getComputedStyle(el).visibility === 'visible' && getComputedStyle(el).display !== 'none').length;

  /* --------------------------------------------------------- política ----- */
  // O estado político existente é `posture` (calculado de trust − fear). O lado vem da postura;
  // a intensidade, da margem. Não há um campo `apoio` e não se inventa um: ver PROTOTIPO.md.
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const blend = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * clamp01(k)));
  const POL_SIDE = { comprometida: 'viriato', amiga: 'viriato', neutra: 'independente', receosa: 'roma', colabora: 'roma' };
  function political(c) {
    const m = c.trust - c.fear, p = c.posture, side = POL_SIDE[p] ?? 'independente';
    let rgb;
    if (side === 'viriato') rgb = blend([58, 122, 69], [18, 53, 29], (m - 15) / 85);
    else if (side === 'roma') rgb = blend([125, 58, 49], [59, 18, 16], (-m - 15) / 85);
    else rgb = [30, 27, 24];
    return { margin: m, posture: p, side, label: POL_LABEL[lang()][p],
      bg: `rgb(${rgb.join(', ')})`, border: side === 'viriato' ? '#6f9a74' : side === 'roma' ? '#a06a61' : '#5c5852' };
  }
  function paintPolitical() {
    const el = stage();
    if (!el) return [];
    const out = [];
    for (const label of $$('.map-label.community', el)) {
      const c = communityAt(label.dataset.id);
      if (!c) continue;
      const p = political(c);
      label.classList.add('cl-political');
      label.dataset.clSide = p.side;
      label.dataset.clPosture = p.posture;
      label.style.backgroundColor = p.bg;
      label.style.color = '#fff';
      label.style.borderColor = p.border;
      label.title = `${p.label} · ${t('polTrust', { trust: c.trust, fear: c.fear, margin: p.margin })}`;
      out.push({ id: c.id, ...p, trust: c.trust, fear: c.fear });
    }
    return out;
  }
  /** Fixture de exemplo: uma comunidade em cada degrau, com valores plausíveis. */
  function politicalExamples() {
    const s = state();
    if (!s) return { erro: 'sem campanha' };
    const values = { ribeira: [18, 55], penedo: [40, 30], souto: [78, 8], vau: [50, 30], fonte: [10, 70] };
    for (const [id, [trust, fear]] of Object.entries(values)) {
      const c = s.communities?.[id];
      if (!c) continue;
      c.trust = trust; c.fear = fear;
      c.posture = mods.postureFor(mods.margin(c), c.posture);
    }
    const out = paintPolitical();
    return { exemplo: t('polExample'), comunidades: Object.fromEntries(out.map(p => [p.id, { posture: p.posture, side: p.side, margin: p.margin, bg: p.bg }])) };
  }

  /* Acesso alternativo quando o layout de etiquetas não deixa ver as cinco. */
  function updateCommunitiesAccess() {
    const el = stage();
    const essential = !!el?.classList.contains('clareza-essencial');
    let box = $('#clareza-communities');
    if (!essential) { box?.remove(); return null; }
    const visible = visibleCommunities(), total = 5;
    if (!box) {
      box = document.createElement('div');
      box.id = 'clareza-communities';
      box.innerHTML = `<label for="clareza-comm-select"><b>${esc(t('communities'))}</b> <span></span></label>
        <select id="clareza-comm-select"><option value="">${esc(t('communitiesPick'))}</option></select>`;
      $('#map')?.append(box);
      box.querySelector('select').addEventListener('change', event => {
        const c = state()?.communities?.[event.target.value];
        if (!c) return;
        labelFor('settlement', c.settlement)?.click();  // seleção real; a etiqueta pode estar escondida
        event.target.value = '';
        paintPolitical();
      });
    }
    const select = box.querySelector('select');
    for (const c of Object.values(state()?.communities ?? {})) {
      let option = [...select.options].find(o => o.value === c.id);
      if (!option) { option = document.createElement('option'); option.value = c.id; select.append(option); }
      option.textContent = `${displayName(c.settlement)} · ${POL_LABEL[lang()][c.posture]}`;
    }
    box.querySelector('span').textContent = t('communitiesCount', { visible, total });
    box.hidden = visible >= total;
    if (!box.hidden) {
      const noteEl = $('#clareza-mapnote');
      box.style.top = `${Math.round((noteEl?.getBoundingClientRect().bottom ?? 64) + 4)}px`;
    }
    return { visible, total, shown: !box.hidden };
  }

  function note(text) {
    let el = $('#clareza-mapnote');
    if (!el) { el = document.createElement('div'); el.id = 'clareza-mapnote'; $('#map')?.append(el); }
    el.innerHTML = `<b>${esc(text[0])}</b>${esc(text[1])}`;
    belowBar(el);
    return el;
  }

  function tierLabels() {
    const s = state();
    for (const label of $$('#campaign-map-3d .map-label[data-kind="settlement"]')) {
      const place = settlement(label.dataset.id);
      const community = communityAt(label.dataset.id);
      label.classList.toggle('cl-secondary', !!place && !community);
    }
  }

  function mapa(modo) {
    resetMapModes();
    const s = state();
    if (!s) return { erro: 'sem campanha' };
    camp().select(null);
    if (modo === 'essencial') {
      stage().classList.add('clareza-essencial');
      tierLabels();
      note([t('essentialTag'), ` · ${t('essenceNote')}`]);
      paintPolitical();
      updateCommunitiesAccess();
      return { modo, escondidas: $$('#campaign-map-3d .map-label.cl-secondary').length, comunidades: visibleCommunities() };
    }
    if (modo === 'forca') return selecionarForca();
    if (modo === 'povoado') return selecionarPovoado();
    return { modo: 'atual' };
  }

  function forces() {
    const s = state();
    return s ? mods.intelView(s).forces : [];
  }

  function pickForce() {
    const list = forces();
    return list.find(f => f.status === 'confirmada') ?? list[0] ?? null;
  }

  function selecionarForca() {
    const force = pickForce();
    if (!force) return { erro: 'sem força romana no mapa' };
    const label = labelFor('force', force.id);
    if (!label) return { erro: 'etiqueta da força ainda não desenhada' };
    label.click();                              // seleção real (fx.focus no mapa)
    stage().classList.add('clareza-foco');
    note([t('forceShot'), '']);
    $('#missues')?.classList.add('hidden');
    $('#mctx')?.classList.add('hidden');
    const card = forceCard(force);
    const side = $('#mside');
    if (side) side.prepend(card);
    if (side?.classList.contains('closed')) $('#m-side-toggle')?.click();
    return { modo: 'forca', id: force.id, nome: label.textContent.trim(), status: force.status, homens: force.men ?? null,
      dias: mods.marchDays(state().world, state().party, force) };
  }

  function forceCard(force) {
    const s = state(), card = document.createElement('section');
    card.id = 'clareza-force';
    const days = mods.marchDays(s.world, s.party, force);
    const label = labelFor('force', force.id);
    const fallback = force.kind === 'pretor' ? (force.name || 'O exército do pretor') : (mods.strings.FORCE_WHO[force.kind] || force.kind);
    const name = force.kind === 'pretor' ? fallback : (mods.strings.FORCE_WHO[force.kind] || label?.textContent?.trim() || force.kind);
    const near = Math.hypot(force.x - s.party.x, force.y - s.party.y) <= mods.MARCH_SPEED;
    const road = mods.nearRoad(s.world, s.party);
    const canAmbush = near && road && force.kind !== 'pretor';
    const ambushButton = $('#missues [data-act="emboscar"]');
    const chips = [
      force.status === 'confirmada'
        ? `<span class="cl-chip ok">${esc(t('confirmed'))}</span>`
        : `<span class="cl-chip est">${esc(t('estimated', { age: force.age }))}</span>`,
      force.kind === 'pretor' ? '<span class="cl-chip warn">Pretor</span>' : '',
    ].join('');
    const men = Number.isFinite(force.men) ? mods.estimateMen(force.men) : null;
    card.innerHTML = `
      <p class="cl-force-kicker">${esc(t('forceTag'))} · ${esc(t('selected'))}</p>
      <h3>${esc(name)}</h3>
      <div class="cl-chips">${chips}</div>
      <p class="cl-force-line">${force.status === 'confirmada'
        ? 'A força está à vista hoje; o que se sabe dela é o que os teus viram.'
        : 'A posição e o número são uma estimativa: o relato é de há dias.'}</p>
      <dl>
        ${men !== null ? `<dt>${esc(t('strength'))}</dt><dd>${esc(men)}</dd>` : ''}
        <dt>${esc(t('distance'))}</dt><dd>${days ? esc(t('marchDays', { days: `${days} ${days === 1 ? 'dia' : 'dias'}` })) : esc(t('lessThanDay'))}</dd>
      </dl>
      <div class="cl-force-actions">
        ${ambushButton ? `<button type="button" data-cl-ambush>${esc(t('ambush'))}</button>` : ''}
        <button type="button" data-cl-close>${esc(t('forceClose'))}</button>
      </div>
      ${ambushButton ? '' : `<p class="cl-force-why">${esc(t('ambushWhy'))}</p>`}
      <p class="cl-force-note">${esc(t('forceNote'))}</p>`;
    card.querySelector('[data-cl-close]')?.addEventListener('click', () => {
      card.remove(); $('#missues')?.classList.remove('hidden');
      stage()?.classList.remove('clareza-foco'); camp().select(null); render();
    });
    card.querySelector('[data-cl-ambush]')?.addEventListener('click', () => {
      ambushButton?.click(); card.remove(); $('#missues')?.classList.remove('hidden'); render();
    });
    return card;
  }

  function selecionarPovoado(id = 'ribeira') {
    const s = state();
    const c = s.communities?.[id] ?? Object.values(s.communities ?? {})[0];
    if (!c) return { erro: 'sem comunidades' };
    const label = labelFor('settlement', c.settlement);
    if (!label) return { erro: 'etiqueta da povoação ainda não desenhada' };
    label.click();                              // painel real (renderContext)
    stage().classList.add('clareza-foco');
    note([t('placeShot'), '']);
    return { modo: 'povoado', id, nome: label.textContent.trim() };
  }

  /* ------------------------------------------------------- A · decisão ---- */
  function criarPedido() {
    resetMapModes();
    const s = state();
    if (!s) return { erro: 'sem campanha' };
    const c = s.communities?.[pedidoId];
    if (!c) return { erro: 'sem comunidade ' + pedidoId };
    // FIXTURE: a campanha está no dia 0, sem excedente e sem Roma a desconfiar de
    // ninguém. Sobe-se a reserva, marca-se a aldeia como suspeita e chama-se a
    // regra real (levyTribute) em vez de esperar pela mudança de estação.
    c.food = Math.max(c.food, c.families + 50);
    mods.ensureRome(s).suspects[c.id] = s.day;
    const events = mods.levyTribute(s);
    render();
    if ($('#mside')?.classList.contains('closed')) $('#m-side-toggle')?.click();
    const ev = events.find(e => e.type === 'tributo-exigido' && e.id === c.settlement)
      ?? events.find(e => e.type === 'tributo-exigido');
    if (!ev) return { erro: 'nenhum tributo exigido', events };
    camp().pause();
    return { pedido: ev, comunidade: c.id, situation: c.situation, due: c.due };
  }

  function openModal() {
    const s = state(), c = s?.communities?.[pedidoId];
    if (!c || c.situation !== 'tributada' || !c.due) return { erro: 'sem pedido pendente' };
    closeModal();
    camp().pause();
    const issue = mods.buildIssues(s, flow().journal, {}).find(i => i.type === 'tributo' && i.community === c.id);
    const pay = flow().previewTribute('pagar', c.id);
    const refuse = flow().previewTribute('recusar', c.id);
    const payEv = pay.events[0];
    const after = pay.state.communities[c.id];
    const canPay = payEv?.type === 'tributo-pago';
    const fearGain = refuse.state.communities[c.id].fear - c.fear;
    const deadline = c.due.day - s.day;

    const wrap = document.createElement('div');
    wrap.id = 'clareza-modal';
    wrap.className = 'cl-backdrop';
    wrap.innerHTML = `
      <div class="cl-dialog" role="dialog" aria-modal="true" aria-labelledby="cl-modal-title" aria-describedby="cl-modal-context">
        <p class="cl-kicker">${esc(t('decision'))}${issue?.deadline != null ? ` · ${esc(mods.strings.UI.deadline(issue.deadline))}` : ''}
          <span class="cl-pause">${esc(t('paused'))}</span></p>
        <h2 id="cl-modal-title">${esc(mods.strings.ISSUE.tributeTitle(mods.strings.placeName(s, c.settlement)))}</h2>
        <p class="cl-context" id="cl-modal-context">${esc(mods.strings.ISSUE.tributeWhat(c.due.food, c.food))}
          ${esc(cap(mods.strings.UI.deadline(deadline)))}.</p>
        <ul class="cl-options">
          <li><button type="button" class="cl-option" data-opt="pagar" ${canPay ? '' : 'disabled'}>
            <span class="cl-opt-top"><b>${esc(t('pay'))}</b>
              <span class="cl-opt-cost">${esc(t('payCost', { food: c.due.food }))}</span></span>
            <span class="cl-effect">${canPay
              ? esc(t('payEffect', { delta: (after.trust - c.trust > 0 ? '+' : '') + (after.trust - c.trust), from: c.trust, to: after.trust }))
              : esc(t('payNo', { food: c.due.food, have: c.food }))}</span>
          </button></li>
          <li><button type="button" class="cl-option" data-opt="recusar">
            <span class="cl-opt-top"><b>${esc(t('refused'))}</b>
              <span class="cl-opt-cost">${esc(t('refuseCost'))}</span></span>
            <span class="cl-effect">${esc(t('refuseEffect', { fear: fearGain, days: mods.PUNISH.days, attention: mods.ATTENTION_GAIN.tributo }))}</span>
          </button></li>
        </ul>
        ${issue?.consequence ? `<p class="cl-note">${esc(issue.consequence)}</p>` : ''}
        <p class="cl-note">${esc(t('note'))}</p>
        <div class="cl-foot">
          <button type="button" class="cl-later">${esc(t('later'))}</button>
          <span class="cl-hint">${esc(t('escClose'))}</span>
        </div>
      </div>`;
    $('#map')?.append(wrap);

    wrap.querySelector('[data-opt="pagar"]')?.addEventListener('click', () => decidir('pagar'));
    wrap.querySelector('[data-opt="recusar"]')?.addEventListener('click', () => decidir('recusar'));
    wrap.querySelector('.cl-later')?.addEventListener('click', closeModal);
    wrap.addEventListener('pointerdown', event => { if (event.target === wrap) closeModal(); });

    opener = document.activeElement;
    modalKeydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); closeModal(); return; }
      if (event.key !== 'Tab') return;
      const items = $$('button:not([disabled]), [tabindex="0"]', wrap).filter(x => x.getClientRects().length);
      if (!items.length) return;
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', modalKeydown, true);
    wrap.querySelector('[data-opt="pagar"]')?.focus();
    return { titulo: $('#cl-modal-title').textContent, opcoes: $$('.cl-option').map(b => b.textContent.replace(/\s+/g, ' ').trim()) };
  }

  function closeModal() {
    const el = $('#clareza-modal');
    if (!el) return;
    el.remove();
    if (modalKeydown) document.removeEventListener('keydown', modalKeydown, true);
    modalKeydown = null;
    opener?.focus?.(); opener = null;
  }

  function decidir(opt) {
    const s = state(), c = s?.communities?.[pedidoId];
    if (!c) return { erro: 'sem comunidade' };
    const r = opt === 'pagar' ? flow().payTribute(c.id) : flow().refuseTribute(c.id);
    closeModal();
    render();
    const line = r.events.map(ev => mods.eventText(ev, state(), r.events)).filter(Boolean)[0];
    if (line) toast(line, t('decided'));
    return { opt, refused: !!r.refused, events: r.events, line, situation: c.situation };
  }

  /* --------------------------------------------------- A · notificação ----- */
  function toast(text, tag = t('toastTag'), ms = 7000) {
    $('#clareza-toast')?.remove();
    const el = document.createElement('div');
    el.id = 'clareza-toast';
    el.className = 'cl-toast';
    el.setAttribute('role', 'status');
    el.innerHTML = `<span class="cl-toast-mark" aria-hidden="true">◆</span>
      <span class="cl-toast-body"><span class="cl-toast-tag">${esc(tag)}</span><p>${esc(text)}</p></span>`;
    $('#map')?.append(el);
    belowBar(el);
    requestAnimationFrame(() => el.classList.add('cl-on'));
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.classList.remove('cl-on'); setTimeout(() => el.remove(), 260); }, ms);
    return el;
  }

  function notificacao() {
    const r = flow().order({ kind: 'esperar' });   // um dia real, sem combate forçado
    render();
    const events = r.events ?? [];
    const line = events.map(ev => mods.eventText(ev, state(), events)).find(Boolean);
    if (!line) return { erro: 'o dia não deu nenhum relato', events };
    const el = toast(line, t('toastTag'), 120000);
    return { linha: line, dia: state().day, evento: events.find(ev => mods.eventText(ev, state(), events))?.type };
  }

  /* ------------------------------------------------------- C · marcha ----- */
  function chooseDestination() {
    const s = state();
    const list = Object.values(s.communities ?? {})
      .map(c => ({ c, place: settlement(c.settlement), days: mods.marchDays(s.world, s.party, settlement(c.settlement)) }))
      .filter(x => x.place && x.days >= 3)
      .sort((a, b) => b.days - a.days);
    return list[0] ?? null;
  }

  function prepararMarcha() {
    resetMapModes();
    const s = state();
    if (!s) return { erro: 'sem campanha' };
    if (flow().phase !== 'mapa') return { erro: 'fase ' + flow().phase };
    const target = chooseDestination();
    if (!target) return { erro: 'sem destino a mais de um dia' };
    $('#clareza-toast')?.remove();
    camp().select(null);
    const label = labelFor('settlement', target.c.settlement);
    if (!label) return { erro: 'etiqueta ainda não desenhada' };
    label.click();
    const go = $('#mctx [data-act="ir"]');
    if (!go) return { erro: 'sem ação Ir' };
    go.click();                    // setDest + play (ordem real da interface)
    camp().pause();
    march = null; syncMarch();
    const total = march?.total ?? target.days;
    const steps = Math.max(1, Math.min(total - 2, Math.floor(total / 2)));
    // dias de marcha pela simulação real (flow.order), sem depender do relógio da interface
    for (let i = 0; i < steps && flow().phase === 'mapa'; i++) {
      const r = flow().order({ kind: 'marchar', to: { ...march.dest } });
      if (!r || r.battle) break;
    }
    camp().pause();
    render();
    syncMarch();
    return { destino: march?.name, total, feitos: march?.done, restam: march?.remaining,
      comidaTotal: march?.foodTotal, comidaDia: march?.perDay, dia: s.day, fase: flow().phase };
  }

  /** A faixa encolhe para a esquerda quando a coluna está aberta, em vez de ficar por baixo dela. */
  function fitMarch(el) {
    const side = $('#mside');
    if (!el || !side || side.classList.contains('closed')) { if (el) el.style.width = ''; return; }
    const left = side.getBoundingClientRect().left;
    const max = innerWidth <= 1100 ? 460 : 520;
    el.style.width = `${Math.max(240, Math.min(max, Math.round(left - 24)))}px`;
  }

  function syncMarch() {
    const s = state(), dest = camp()?.dest;
    if (!s) return;
    if (!dest) {
      $('#clareza-march')?.remove();
      lastDest = null; march = null;
      return;
    }
    if (!lastDest || Math.hypot(lastDest.x - dest.x, lastDest.y - dest.y) > .5) {
      lastDest = { x: dest.x, y: dest.y };
      const total = mods.marchDays(s.world, s.party, dest);
      const place = s.world.settlements.find(x => Math.hypot(x.x - dest.x, x.y - dest.y) < 1);
      march = { dest: { ...dest }, total: Math.max(1, total), startDay: s.day, done: 0, remaining: total,
        name: place ? displayName(place.id) : 'ponto marcado',
        perDay: mods.foodPerDay(s.men), foodTotal: Math.max(1, total) * mods.foodPerDay(s.men) };
    }
    const remaining = mods.marchDays(s.world, s.party, dest);
    march.remaining = remaining;
    march.done = Math.max(0, Math.min(march.total, march.total - remaining));
    march.perDay = mods.foodPerDay(s.men);
    march.foodTotal = march.total * march.perDay;
    march.leftFood = remaining * march.perDay;

    let el = $('#clareza-march');
    if (!el) {
      el = document.createElement('section');
      el.id = 'clareza-march';
      el.className = 'cl-march';
      el.setAttribute('role', 'status');
      $('#map')?.append(el);
    }
    const reasons = camp()?.interrupt ?? [];
    const stopped = reasons.length > 0 || !!(flow()?.phase !== 'mapa');
    belowBar(el);
    fitMarch(el);
    el.dataset.state = stopped ? 'interrompida' : 'marchando';
    const pct = Math.round(100 * march.done / march.total);
    const reasonText = stopped
      ? (reasons.map(x => x.text).filter(Boolean).join(' ') || t('stopped'))
      : '';
    el.innerHTML = `
      <div class="cl-march-head">
        <span class="cl-march-kicker">${esc(stopped ? t('interrupted') : t('marchTitle'))}</span>
        <span class="cl-march-dest">${esc(march.name)}</span>
        <span class="cl-march-day">${esc(t('day', { day: Math.min(march.total, march.done + 1), total: march.total }))}</span>
      </div>
      <div class="cl-bar" role="progressbar" aria-label="${esc(t('marchTitle'))}" aria-valuemin="0" aria-valuemax="${march.total}" aria-valuenow="${march.done}">
        <i style="width:${pct}%"></i>
      </div>
      <dl class="cl-march-facts">
        <div><dt>${esc(t('duration'))}</dt><dd>${march.total} ${esc(march.total === 1 ? 'dia' : 'dias')}</dd></div>
        <div><dt>${esc(t('food'))}</dt><dd>${march.foodTotal} · ${esc(t('perDay', { n: march.perDay }))}</dd></div>
        <div><dt>${esc(t('remaining'))}</dt><dd>${esc(t('left', { days: `${remaining} ${remaining === 1 ? 'dia' : 'dias'}`, food: march.leftFood }))}</dd></div>
      </dl>
      <p class="cl-march-status">${esc(stopped ? t('stopped') : t('marching'))}</p>
      ${reasonText ? `<p class="cl-march-reason">${esc(reasonText)}</p>` : ''}`;
  }

  /** Marcha curta numa campanha acabada de abrir: um dia com comida baixa interrompe-a sem
   *  dar tempo a encontros (o primeiro destacamento só sai a partir do dia 2). */
  function marchaCurta() {
    resetMapModes();
    const s = state();
    if (!s) return { erro: 'sem campanha' };
    const target = chooseDestination();
    if (!target) return { erro: 'sem destino' };
    march = null; lastDest = null;
    camp().select(null);
    const label = labelFor('settlement', target.c.settlement);
    if (!label) return { erro: 'etiqueta ainda não desenhada' };
    label.click();
    const go = $('#mctx [data-act="ir"]');
    if (!go) return { erro: 'sem ação Ir' };
    go.click();
    camp().pause();
    syncMarch();
    s.food = 2;                    // FIXTURE: comida baixa, para a interrupção ser a real de comida
    camp().step();
    camp().pause();
    render();
    syncMarch();
    return { dia: s.day, fase: flow().phase, motivos: (camp()?.interrupt ?? []).map(x => ({ type: x.type, text: x.text })),
      estado: $('#clareza-march')?.dataset.state, total: march?.total, done: march?.done };
  }

  function interromper() {
    const s = state();
    if (!s || !camp()?.dest) return { erro: 'sem marcha a decorrer' };
    // FIXTURE: comida baixa faz o dia real disparar a interrupção de comida
    // (detectInterruptions), sem tocar na regra nem no sorteio.
    s.food = 2;
    camp().step();                 // caminho real da interface (standingOrder + step)
    camp().pause();
    render();
    syncMarch();
    return { dia: s.day, fase: flow().phase, motivos: (camp()?.interrupt ?? []).map(x => ({ type: x.type, text: x.text })),
      estado: $('#clareza-march')?.dataset.state };
  }

  /** Cenário integrado: tributo pendente + povoação seleccionada + marcha interrompida.
   *  Mede a faixa com a coluna aberta e fechada (o painel da povoação continua seleccionado). */
  function testarInterrupcao() {
    const p = criarPedido();
    if (p.erro) return p;
    const m = marchaCurta();
    if (m.erro) return m;
    const side = $('#mside');
    const measure = () => {
      const strip = $('#clareza-march'), rect = strip?.getBoundingClientRect();
      const style = strip ? getComputedStyle(strip) : null;
      const sideOpen = !!side && !side.classList.contains('closed');
      const sbox = sideOpen ? side.getBoundingClientRect() : null;
      return {
        visible: !!strip && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1,
        box: rect ? { x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height), right: Math.round(rect.right) } : null,
        sideOpen, overlapsSide: !!sbox && !!rect && rect.left < sbox.right && sbox.left < rect.right && rect.top < sbox.bottom && sbox.top < rect.bottom,
        selected: !!$('#mctx') && !$('#mctx').classList.contains('hidden'),
        pending: $$('#missues-list .issue').length,
        mIntRects: $('#m-int')?.getClientRects().length ?? 0,
        mIssuesHidden: $('#missues')?.classList.contains('hidden'),
        state: strip?.dataset.state, text: strip?.innerText.replace(/\s+/g, ' ').trim(),
      };
    };
    if (side?.classList.contains('closed')) $('#m-side-toggle')?.click();
    syncMarch();
    const aberto = measure();
    if (!side?.classList.contains('closed')) $('#m-side-toggle')?.click();
    syncMarch();
    const fechado = measure();
    return { pedido: { situacao: p.situation, due: p.due }, marcha: m, aberto, fechado };
  }

  function iniciarRelogio() {
    clearInterval(timer);
    timer = setInterval(() => {
      if (!applied) return;
      syncMarch();
      paintPolitical();
      updateCommunitiesAccess();
    }, 250);
  }

  /* ------------------------------------------------------------ métricas -- */
  const lum = rgb => {
    const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const nums = value => (value.match(/[\d.]+/g) ?? []).map(Number);
  const contrast = (fg, bg, base = [27, 38, 34]) => {
    const f = nums(fg), b = nums(bg), a = b.length > 3 ? b[3] : 1;
    const mixed = [0, 1, 2].map(i => (b[i] ?? base[i]) * a + base[i] * (1 - a));
    const l1 = lum(f), l2 = lum(mixed);
    return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
  };
  const css = el => (el ? getComputedStyle(el) : null);
  const box = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
      right: Math.round(r.right), bottom: Math.round(r.bottom) };
  };
  const intersects = (a, b) => !!a && !!b && a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;

  function metricas() {
    const area = box(stage());
    const labels = $$('#campaign-map-3d .map-label').filter(el => getComputedStyle(el).visibility === 'visible' && getComputedStyle(el).display !== 'none')
      .map(el => ({ el, ...box(el), text: el.textContent.trim(), secondary: el.classList.contains('cl-secondary'),
        selected: el.classList.contains('selected'), cls: el.className }));
    const pairs = [];
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i], b = labels[j];
      if (a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom) pairs.push([a.text, b.text]);
    }
    const clipped = labels.filter(l => l.x < area.x - 1 || l.y < area.y - 1 || l.right > area.right + 1 || l.bottom > area.bottom + 1);
    const top = $('#mtop'), bot = $('#mbot'), res = $('#mtop .res'), side = $('#mside');
    const modal = $('#clareza-modal .cl-dialog'), toastEl = $('#clareza-toast'), marchEl = $('#clareza-march');
    const mapBox = box(stage()), sideBox = side && !side.classList.contains('closed') ? box(side) : null;
    const selected = labels.find(l => l.selected);
    const modalBox = box(modal), marchBox = box(marchEl);
    return {
      viewport: { w: innerWidth, h: innerHeight },
      labels: {
        visible: labels.length,
        hidden: $$('#campaign-map-3d .map-label').length - labels.length,
        secondaryHidden: $$('#campaign-map-3d .map-label.cl-secondary').filter(el => getComputedStyle(el).display === 'none').length,
        overlaps: pairs.length, pairs, clipped: clipped.map(l => l.text),
        byClass: labels.reduce((acc, l) => { const k = l.cls.match(/\b(community|place|confirmed|estimated|party-label|rumor-zone|scouted-zone)\b/)?.[0] ?? 'outro'; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {}),
        communitiesVisible: labels.filter(l => l.cls.includes('community')).length,
        political: labels.filter(l => l.cls.includes('community')).map(l => ({
          label: l.text, side: l.el.dataset.clSide ?? null, posture: l.el.dataset.clPosture ?? null,
          bg: css(l.el).backgroundColor, contrast: contrast('rgb(255, 255, 255)', css(l.el).backgroundColor),
        })),
      },
      panels: {
        modal: modalBox, modalInside: !!modalBox && modalBox.x >= 0 && modalBox.y >= 0 && modalBox.right <= innerWidth && modalBox.bottom <= innerHeight,
        modalScrolls: !!modal && modal.scrollHeight > modal.clientHeight + 1,
        modalOverlapsBar: intersects(modalBox, box(top)) || intersects(modalBox, box(bot)),
        toast: box(toastEl), toastOverlapsBar: intersects(box(toastEl), box(top)) || intersects(box(toastEl), box(bot)),
        march: marchBox, marchOverlapsTop: intersects(marchBox, box(top)), marchOverlapsBottom: intersects(marchBox, box(bot)),
        marchOverlapsSide: intersects(marchBox, sideBox), marchOverlapsMap: intersects(marchBox, mapBox),
        communities: box($('#clareza-communities')),
        communitiesShown: !!$('#clareza-communities') && !$('#clareza-communities').hidden,
      },
      bars: {
        topHeight: Math.round(top.getBoundingClientRect().height),
        bottomHeight: Math.round(bot.getBoundingClientRect().height),
        resWidth: res.scrollWidth, topWidth: top.clientWidth, barOverflow: res.scrollWidth > top.clientWidth,
        topOverflow: top.scrollWidth > top.clientWidth + 1,
      },
      contrast: {
        modalTitle: modal ? contrast(css($('#cl-modal-title')).color, css(modal).backgroundColor) : null,
        modalContext: modal ? contrast(css($('#clareza-modal .cl-context')).color, css(modal).backgroundColor) : null,
        modalEffect: modal ? contrast(css($('#clareza-modal .cl-effect')).color, css(modal).backgroundColor) : null,
        march: marchEl ? contrast(css(marchEl).color, css(marchEl).backgroundColor) : null,
        toast: toastEl ? contrast(css($('#clareza-toast p')).color, css(toastEl).backgroundColor) : null,
        label: selected ? contrast(css(selected.el).color, css(selected.el).backgroundColor) : null,
        forceLine: $('#clareza-force .cl-force-line') ? contrast(css($('#clareza-force .cl-force-line')).color, css(side).backgroundColor) : null,
      },
      state: { day: state()?.day, phase: flow()?.phase, dest: camp()?.dest ?? null, running: camp()?.running,
        march: march ? { total: march.total, done: march.done, remaining: march.remaining, foodTotal: march.foodTotal } : null },
    };
  }

  /* ------------------------------------------------------------- ciclo ---- */
  async function aplicar() {
    if (!flow()) return { erro: 'sem campanha aberta' };
    injectCss();
    await loadMods();
    await frame();
    applied = true;
    iniciarRelogio();
    syncMarch();
    paintPolitical();
    updateCommunitiesAccess();
    return { ok: true, dia: state().day, forcas: forces().length };
  }

  function reverter() {
    applied = false;
    clearInterval(timer); timer = 0;
    closeModal();
    $('#clareza-css')?.remove();
    $('#clareza-toast')?.remove();
    $('#clareza-march')?.remove();
    $('#clareza-communities')?.remove();
    for (const label of $$('.map-label.cl-political')) {
      label.classList.remove('cl-political');
      label.style.backgroundColor = ''; label.style.color = ''; label.style.borderColor = '';
      label.removeAttribute('title');
      delete label.dataset.clSide; delete label.dataset.clPosture;
    }
    resetMapModes();
    march = null; lastDest = null;
    render();
  }

  window.__clareza = {
    aplicar, reverter, mapa, forca: selecionarForca, povoado: selecionarPovoado,
    pedido: criarPedido, abrirModal: openModal, fecharModal: closeModal, decidir,
    notificacao, marcha: prepararMarcha, marchaCurta, interromper, syncMarch, metricas,
    politica: politicalExamples, comunidades: updateCommunitiesAccess, interrupcao: testarInterrupcao,
    estado: () => ({ dia: state()?.day, fase: flow()?.phase, dest: camp()?.dest ?? null,
      forcas: forces().map(f => ({ id: f.id, kind: f.kind, status: f.status, men: f.men ?? null, age: f.age })),
      comunidades: Object.fromEntries(Object.entries(state()?.communities ?? {}).map(([id, c]) => [id, { situation: c.situation, food: c.food, trust: c.trust, fear: c.fear }])) }),
  };
})();
