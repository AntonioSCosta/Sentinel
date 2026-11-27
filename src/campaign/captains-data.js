// Capitães do bando: arquétipos, traços (cartas de evolução), cicatrizes e regras. Só dados (sem DOM nem Three.js).
// Tabela de equilíbrio da fase A–D (2026-11). Cada vantagem é situacional e traz um custo noutro eixo (lealdade,
// confiança das aldeias, Roma ou comida). Os efeitos do mesmo tipo não somam: vale o mais forte (captains.fx),
// dentro dos tetos de RULES.caps, para que nenhuma combinação dispense gerir comida, reconhecimento, recrutamento
// ou a confiança das aldeias.

export const RULES = {
  max: 4,       // capitães no bando
  active: 3,    // só estes dão passivas; o 4.º fica na reserva (a escolha para a batalha é da fase E)
  loyalty: {
    start: 60, jitter: 5,                 // lealdade inicial (o arquétipo pode mudar `start`)
    crisis: 25, crisisDays: 3, calm: 30,   // a ≤ crisis abre-se um assunto com prazo; acima de calm fecha-se sozinho
    levelUp: 5,                            // cada subida de nível
    share: { food: 8, arms: 3, gain: 20 }, // «dar-lhe a sua parte»
    desert: { share: 0.2, max: 4 },         // quem deserta ou trai leva no máximo 20 % do bando (por excesso) e 4 homens, e nunca mais do que o seu nível
    reserve: { every: 10, loss: -1 },      // esquecido na reserva
  },
  xp: { win: 10, loss: 6, retreat: 3, hard: 5, levels: [20, 50, 90] },   // níveis 2, 3 e 4 (máximo)
  hard: { ratio: 1.5, loss: 0.25, cardGap: 20 },   // romanos ≥ 1,5× o bando ou perdas ≥ 25 %; uma escolha por 20 dias
  cards: { offer: 3, maxTraits: 3, maxScars: 2, scarChance: 0.25, weights: { comum: 3, incomum: 2, rara: 1 } },
  recruit: { food: 10, arms: 4, postures: ['amiga', 'comprometida'] },
  deserter: { from: 30, chance: 1 / 60, days: 3 },   // ≈ 1 em cada 6 acontecimentos (EVENT_CHANCE 0,1), uma vez
  caps: { ambushKeep: 0.5, loot: 0.5, lossKeep: 0.7, reconRange: 300, legacyBonus: 3 },
};

/**
 * Arquétipos. `fx`: passivas no mapa (captains.js aplica as condições). `loyal`: o que lhe sobe ou desce a lealdade.
 * `skill`: a habilidade na emboscada tática (fase E; aqui só fica registada). `origin`: a comunidade onde se recruta.
 */
export const ARCHETYPES = {
  batedor: { skill: 'retirada-coberta', origin: 'ribeira', start: true,
    fx: { reconRange: 300, reconRadius: 150, hiddenSight: 190, reconFood: 1 },
    loyal: { reconFound: 2, openBattle: -4 } },
  fundibulario: { skill: 'chuva-de-pedras', origin: 'souto', start: true,
    fx: { ambushKeep: 0.5, serraRange: 80, ambushFame: 2 },
    loyal: { ambushWin: 3, withdraw: -3, farFromSerra: { range: 150, after: 10, every: 5, loss: -2 } } },
  ferreiro: { skill: 'escudos-de-carvalho', origin: 'penedo', start: true,
    fx: { recruitFreeEvery: 3, seasonArms: 3 },
    loyal: { forge: 2, armsLost: -3, famine: -1 } },
  saqueador: { skill: 'cortar-a-bagagem', origin: 'vau', start: true,
    fx: { loot: 0.4, lootOn: ['emboscada', 'assalto-coluna'], lootTrust: -3 },
    loyal: { lootWin: 2, famine: -1, tribute: -4 } },
  incendiario: { skill: 'fumaca-e-fogo', origin: 'fonte', start: true,
    fx: { doctrineWeight: 0.5, postFame: 5, winAttention: 5, fearfulTrust: -2 },
    loyal: { postTaken: 4, win: 2, idle: { every: 10, loss: -1 } } },
  veterano: { skill: 'isco-vivo', origin: null, start: false, loyalty: 40, betrays: { attention: 15 },
    fx: { exactMen: true, legacyBonus: 2, legacyOn: ['campo-aberto', 'decisiva'] },
    loyal: { openWin: 3, flee: -3, burnt: -2 } },   // `flee` conta a recusa e a fuga, uma vez
};

/** Traços que se escolhem ao evoluir. `not`: arquétipos a quem não se oferecem (o mesmo efeito não acumula). */
export const TRAITS = {
  'duro-de-roer': { rarity: 'comum', fx: { lossKeep: 0.8 }, loyal: { withdraw: -2 } },
  'olho-no-ouro': { rarity: 'comum', not: ['saqueador'], fx: { loot: 0.2 }, loyal: { famine: -2 } },
  'ladrao-de-galinhas': { rarity: 'comum', fx: { famineSave: 1, famineDays: 3, famineTrust: -2 } },
  'emboscador-nato': { rarity: 'incomum', not: ['fundibulario'], fx: { ambushKeep: 0.75 }, loyal: { openBattle: -2 } },
  'conhecedor-dos-trilhos': { rarity: 'incomum', fx: { withdrawKeep: 0.5, withdrawFame: 1 } },
  vingativo: { rarity: 'incomum', fx: { vengeance: { days: 15, fame: 4, loss: -8 } } },
  'olhos-de-coruja': { rarity: 'rara', fx: { reportsFaster: 1, watchFood: { every: 7, food: 1 } } },
  'querido-do-povo': { rarity: 'rara', fx: { volunteer: 1 }, loyal: { villageDead: { each: -2, max: -8 } } },
};

/** Cicatrizes: não se escolhem, ficam (RULES.cards.scarChance depois de uma derrota difícil). */
export const SCARS = {
  'mao-ferida': { fx: { xpRate: 0.5 }, gain: 10 },
  'rancor-a-roma': { fx: { winFame: 1 }, loyal: { withdraw: -4 } },
};

/** Nomes lusitanos atestados em inscrições (sem os assassinos de Viriato). */
export const NAMES = ['Tautalo', 'Caturo', 'Boutio', 'Medugeno', 'Reburro', 'Amaeco', 'Pintamo', 'Celtio',
  'Tongio', 'Vironio', 'Talabaro', 'Malgeino', 'Cilio', 'Doquiro'];
