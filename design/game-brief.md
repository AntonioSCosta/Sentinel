# Game Brief: Sentinel — Viriato, A Guerra dos Montes Hermínios

> Visão de produto aprovada pelo maintainer; estado do código em `30b790d`, 2026-11-26.
> Três estados: **Implementado** (existe e é testado), **Parcial** (existe, mas a ligação ou a jogabilidade completa não está verificada) e **Planeado** (visão, não construído).
> Não é um GDD. Se uma linha não estiver em *Implementado*, não está feita.

## In your words

Sentinel é um jogo de estratégia e combate histórico em que lideras Viriato e a resistência lusitana contra Roma. Exploras um território vivo, reúnes aliados, organizas emboscadas e enfrentas um inimigo militarmente superior. Cada decisão tem consequências para a sobrevivência do teu povo e para o desenrolar da guerra. A fantasia central é liderar uma resistência de guerrilha, não apenas controlar um guerreiro.

**Pitch:** Liderar a resistência lusitana: sobreviver à pressão romana através de informação, terreno e emboscadas.

**Genre:** Estratégia de campanha com batalhas táticas e, como ambição do produto completo, combate direto (histórico, 150–147 a.C.).

**Controls:** Planeado. Mapa com rato e teclado; combate direto só no legado, em primeira/terceira pessoa. Plataforma pretendida: Steam (Windows), com atenção ao Steam Deck. **Steam Deck ainda sem validação real.**

**Question:** A campanha de guerrilha é divertida e legível numa sessão de 20–40 minutos, com movimento fluido e decisões com consequências?

**Hooks:** Inferioridade militar compensada por inteligência, terreno e preparação; uma derrota numa batalha não termina a campanha por si.

**Intent:** objetivo de campanha em *Goal & fail state* · falha suave (derrota de batalha tem custo, não fim automático) — *you said*.

## Look and references

- Look: mapa 3D com terreno, floresta e bando de Viriato (modelo Quaternius, CC0). Figuras legíveis, sem emojis. *(inferred (strong) do código)*
- References: Mount & Blade: Warband (combate direto, ataques direcionais). *(you said)*
- View: 3D · Camera: estratégica, a definir na slice.

## First minute

*Planeado.* O jogador vê o mapa da região, recebe a primeira informação de batedores e escolhe uma marcha ou uma emboscada.

## Challenge

*Planeado.* Pressão romana: patrulhas e um pretor que avança. Perdas numa batalha podem ser recuperadas, até ao limite das regras de fim.

## Core loop

- Explorar → obter informações (batedores) → decidir (estratégia) → preparar operação
- Combater (tática) ou retirar → lidar com consequências (homens, provisões, aliados) → continuar.

## Goal & fail state

- **Objetivo global:** liderar a resistência, sobreviver, reunir aliados e enfraquecer Roma até enfrentar a ameaça decisiva. *(you said)*
- **Fim de campanha** (regras existentes, não alterar sem aprovação):
  - derrota imediata se os homens ou a fama chegam a zero (`src/campaign/state.js`);
  - vitória imediata se a batalha decisiva é ganha (`src/campaign/battles.js`);
  - no fim do ano (`YEAR_DAYS`), vitória só com pelo menos 10 homens e 30 de fama, senão derrota (`src/campaign/flow.js`, `WIN_MEN`/`WIN_FAME`).
- **Resultados de batalha** (`OUTCOMES` em `src/tactical/sim.js`: vitória, derrota, retirada, escapou, tempo) são desfechos de uma batalha, não fim de campanha. Traduzem-se em custos (homens, fama, provisões) pelo `src/campaign/battles.js`.
- Uma derrota numa batalha não termina a campanha por si. Pode terminá-la se levar os homens ou a fama a zero. *(you said: recuos, perdas e recuperação)*

## Features

**Implementado** (existe no código e tem testes):
- [x] Simulação da campanha por dias: marchas, patrulhas, pretor, fome, recrutamento, RNG semeado (`src/campaign/`)
- [x] Simulação tática determinista de batalha: grupos, ordens, desfechos (`src/tactical/sim.js`)
- [x] Combate legado em primeira/terceira pessoa, com capítulos prólogo, cativos, emboscada e acampamento (`src/game.js`)
- [x] Mapa 3D estratégico (`src/campaign-map-3d/`)
- [x] i18n EN e PT-PT (`src/i18n/`)
- [x] Testes com sementes fixas (`tests/`)

**Parcial** (existe, mas não verificado como jogável na demo):
- [~] Ligação campanha–tática: integrada em código só para a **emboscada de patrulha na estrada** (`src/campaign/flow.js`, `tactical-arena.js`, `tactical-patrol.js`). As restantes batalhas da campanha usam o combate legado (`src/campaign/bridge.js`). Não validada num jogo completo.
- [~] Batedores e informação (`src/campaign/intel.js`): lógica existe; apresentação no mapa não verificada.
- [~] Gestão de homens, provisões e aliados (`src/campaign/communities.js`, `harvest.js`): lógica existe; ligação de decisão ao jogador não verificada.
- [~] Patrulhas e consequências persistentes: resultados aplicados ao estado da campanha; comportamento na demo não verificado.
- [~] Mapa 3D: funcional, mas sem validação de coerência visual e fluidez.

**Planeado** (não concluído):
- [ ] Movimento contínuo e agradável do bando, validado
- [ ] Vertical slice de 20–40 minutos numa região
- [ ] Interface clara e fluida em PT-PT e EN, validada no jogo
- [ ] Gravações estáveis e simulação determinística validadas na demo
- [ ] Validação em Steam Deck
- [ ] Combate direto, só se estiver polido e integrado; senão, iteração posterior

## Your systems

- Campanha estratégica · in the slice *(núcleo do Sentinel)*
- Batedores e informação · in the slice
- Patrulhas e consequências · in the slice
- Emboscada tática · in the slice *(complementa a campanha)*
- Combate direto (Warband) · later *(ambição do produto completo; não obrigatório para a demo)*
- Exploração livre de aldeias em 3D · later
- Campanha geográfica maior · later
- Sistemas militares complexos · later

## Keep

- Inferioridade militar compensada por inteligência, terreno e preparação. *(you said)*
- Smoothness vende. *(you said)*

## Avoid

- Três jogos independentes: o sistema tem de ser integrado. *(you said)*
- Quantidade de funcionalidades acima de qualidade. *(you said)*

## Out of scope

- Exploração livre de aldeias em 3D (later)
- Campanha geográfica maior (later)
- Sistemas militares mais complexos (later)
- Empacotamento e publicação Steam (fora deste brief)
- Alterar regras de vitória/derrota já implementadas, sem aprovação

## Build order

1. Mapa 3D fluido e movimento do bando (prova de smoothness)
2. Batedores e decisões estratégicas numa região
3. Gestão de homens, provisões e aliados
4. Patrulhas com consequências persistentes
5. Emboscada tática integrada na campanha (além da patrulha na estrada)
6. Interface PT-PT/EN e gravações estáveis
7. Combate direto, se estiver polido

---
**Kill condition:** *(guessed)* se o movimento do bando não for fluido após duas iterações de ajuste, parar e rever o mapa 3D.

**Who it's for / what they feel:** *(guessed)* jogadores de estratégia histórica que querem sentir uma resistência de guerrilha, em sessões de 20–40 minutos.

**Games you love / don't:** Mount & Blade: Warband (combate direto). *(you said)*
