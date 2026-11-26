# Auditoria técnica — arquitetura da campanha estratégica

Repositório: AntonioSCosta/Sentinel · Branch: `docs/campaign-architecture-audit` (a partir de `main` `c975bc7`)

Avaliação exclusivamente técnica e independente. Sem alteração a código de produção.

---

## 1. Inventário de sistemas

### 1.1 Módulos da campanha (`src/campaign/`)

| Módulo | Responsabilidade | Estado |
|---|---|---|
| `state.js` | Recursos, ruína, serialização/deserialização, `newCampaign`, `spend`, `checkRuin` | Implementado e validado |
| `worldgen.js` | Geração determinística do mundo (estrada, povoações, postos, serras, início) | Implementado |
| `simulation.js` | `stepDay`, `applyOrder`, movimento de patrulhas, deteção de encontros, fome, spawn | Implementado |
| `praetor.js` | IA diária do pretor (perseguição, queima de aldeias, reagrupamento) | Implementado |
| `doctrine.js` | «Roma aprende»: memória, contramedidas, caçadores, spawn adaptativo | Implementado |
| `intel.js` | O que o jogador sabe (avistamentos, relatos, reconhecimento) | Implementado (PR #9) |
| `communities.js` | Cinco comunidades do vale: identidade, postura, recrutamento, baixas, queima/abandono | Implementado (PRs recentes) |
| `rome.js` | Atenção de Roma, tributo, castigo, ocupação, queima, denúncia | Implementado |
| `harvest.js` | Colheita por estação, fome, integração com `romeDay` | Implementado |
| `battles.js` | `battleSpec`, `applyResult`, `withdrawFrom`, loot | Implementado |
| `bridge.js` | Ponte mapa ↔ batalha 3D, `spawnPlan`, `tallyResult` | Implementado |
| `flow.js` | Fases (mapa/batalha/fim), ordens, gravação, preview, diário | Implementado |
| `events.js` | Capítulos agendados, baralho de acontecimentos | Implementado |
| `clock.js` | Data, estação, dias restantes | Implementado |
| `map-view.js` | Vista 2D do mapa, conversão, desenho | Implementado |
| `ui.js` | HUD, painéis, ordens, log | Implementado |
| `chronicle.js` | Crónica (fontes, invenção) | Implementado |
| `journal.js` | Diário da campanha | Implementado |
| `bridge.js` | (acima) | — |

### 1.2 Funcionalidades planeadas ou parciais

- **Terreno determinado pelo local do confronto**: `battles.js` usa `site` genérico; o terreno 3D é fixo por tipo, não por local do mapa.
- **Consequências estratégicas variadas**: `applyResult` cobre vitória/derrota/retirada/escape, mas as consequências são do mesmo molde (saque, fama, perda de homens).
- **Diferentes mapas táticos**: o protótipo M1.2 usa um campo fixo (`field.js`); a geração por semente é T2 (não implementada).
- **Respostas romanas adaptativas**: `doctrine.js` implementa contramedidas, mas limitadas a 5 padrões e 4 sectores.
- **Novas condições de vitória**: `yearEnd` fixa `men >= 10 && fame >= 30` aos 365 dias.

### 1.3 Coexistência dos dois sistemas de combate

- **Combate antigo (3D first/third person)**: `src/game.js`, `combat.js`, `swing.js`, `moves.js`, `rig.js`. Usado nas missões (capítulos).
- **Combate tático M1.2**: `src/tactical/*`, `src/tactical/proto/view.js`. Usado na campanha estratégica.
- **Ponte**: `bridge.js` (`isBridged`, `spawnPlan`, `tallyResult`, `storyTally`, `forceMultipliers`). A campanha gera um `battleSpec` e o fluxo decide se há cena 3D (`flow.order`) ou se a batalha é resolvida diretamente.
- **Risco de divergência**: `battles.applyResult` e `bridge.tallyResult` são duas vias de resultado; devem produzir o mesmo efeito no estado. A validação é parcial (testes de `tallyResult` e `applyResult` separados).

---

## 2. Integridade de estado — riscos confirmados

### 2.1 Aplicação repetida de resultados
- **Ficheiro**: `src/campaign/flow.js`, `finishBattle`.
- **Evidência**: `flow.phase !== 'batalha'` bloqueia chamadas repetidas. **Mitigação presente.**
- **Risco residual**: se o estado for carregado a meio de uma batalha (`phase === 'batalha'`) com um `battle` malformado, `applyResult` pode falhar ou produzir resultados inconsistentes. `loadFlow` valida apenas campos básicos do battle.

### 2.2 Perda de homens ou recursos
- **Ficheiro**: `src/campaign/state.js`, `spend`; `src/campaign/communities.js`, `loseMen`.
- **Evidência**: `spend` satura recursos em 0, mas `loseMen` reduz `state.men` e `away` das comunidades. Se `n > total` (homens sem origem), `loseMen` limita a `total` (`Math.min`). **Risco**: se `state.men` for maior do que a soma de `away` + `sem`, a diferença não é descontada nas comunidades (fica em `sem`), o que é aceitável, mas pode mascarar inconsistências.
- **Risco**: `spend({ men })` chama `loseMen` com `grieve: true`, que aplica `DEATH_TRUST` a cada comunidade. Se chamado duas vezes para o mesmo combate (ex.: derrota + retirada), as baixas contam duas vezes. **Mitigação**: `finishBattle` chama `applyResult` uma vez; `withdraw` chama `withdrawFrom` uma vez. Mas `ownEffect`/`preview` correm em cópias, não no estado real.

### 2.3 Persistência de forças sobreviventes
- **Ficheiro**: `src/campaign/flow.js`, `finishBattle`; `src/campaign/intel.js`, `forgetForce`/`rememberForce`.
- **Evidência**: a lógica distingue pretor sobrevivente (defesa de aldeia) de pretor eliminado (decisiva). Testes existem para os dois casos.
- **Risco residual**: `rememberForce` chama `see` com `state.day`, mas se a batalha ocorreu no dia anterior (viragem de dia), o avistamento pode ter idade 0 num dia em que a posição já mudou. **Hipótese a testar.**

### 2.4 Estados impossíveis após batalha
- **Ficheiro**: `src/campaign/battles.js`, `applyResult`.
- **Evidência**: `state.men` pode ficar negativo? `spend` usa `Math.min(state.men, scaled)` para `lost`, e `state.men = Math.max(0, ...)`. **Mitigação presente.**
- **Risco**: `state.food += loot.food` pode overflow? Não há limite superior; não é um bug, mas pode distorcer o balance.
- **Risco**: `state.praetor.men` pode ficar abaixo de `PRAETOR_MIN_MEN`? `Math.max(PRAETOR_MIN_MEN, ...)` garante mínimo. **Mitigação presente.**

### 2.5 Compatibilidade de gravações v1
- **Ficheiro**: `src/campaign/state.js`, `deserialize`; `flow.js`, `loadFlow`.
- **Evidência**: campos opcionais (`doctrine`, `intel`, `communities`, `rome`, `posts`, `seen`, `decisivaWon`, `kills`, `battles`) são validados com `in`. Gravações antigas ganham comunidades/intel/doctrina na carga.
- **Risco**: `ensureCommunities` cria comunidades novas se faltarem, mas não valida que as `settlements` do mundo correspondem às comunidades. `validCommunities` com `world` valida isso; sem `world` (gravação parcial) não. **Mitigação presente para saves completos.**
- **Risco**: `state.world` é validado minimamente (start, settlements). Se o mundo for corrompido (ex.: estrada ausente), `stepPatrols` pode falhar. **Hipótese a testar.**

### 2.6 Recuperação de falhas
- **Ficheiro**: `src/campaign/flow.js`, `save()`.
- **Evidência**: `save()` é best-effort (try/catch). Se a gravação falhar (quota, modo privado), o jogo continua sem guardar. **Risco aceitável, mas sem aviso ao jogador.**
- **Risco**: se o jogo fechar durante `finishBattle` (entre `applyResult` e `save`), a campanha pode ficar num estado inconsistente (batalha concluída mas não gravada). **Hipótese a testar.**

### 2.7 Passagem de dias
- **Ficheiro**: `src/campaign/simulation.js`, `stepDay`.
- **Evidência**: `state.day += 1` após feed/checkRuin. `closeDay` usa `prevDay = state.day - 1` para detetar mudança de estação. **Correto.**
- **Risco**: se `state.day` for manipulado (ex.: carga de save com dia inválido), `deserialize` valida `num(o.day)` mas não limita a `YEAR_DAYS`. Um dia > 365 pode causar comportamento indefinido. **Hipótese a testar.**

### 2.8 Identidades de forças romanas
- **Ficheiro**: `src/campaign/simulation.js`, `spawnPatrol`.
- **Evidência**: id = `${kind}-${state.day}`. Caçadores: `cacadores-${state.day}`. Pretor: `vetilio` (fixo). Patrulhas podem ter o mesmo id se o mesmo tipo spawnar no mesmo dia? `spawnPatrol` é chamado uma vez por `stepDay`. **Sem colisão.**
- **Risco**: se duas campanhas usarem a mesma semente e dia, os ids colidem, mas isso não afeta uma única campanha. **Aceitável.**

### 2.9 Recarregamento durante confrontos
- **Ficheiro**: `src/campaign/flow.js`, `loadFlow`.
- **Evidência**: se `phase === 'batalha'`, o `battle` é carregado e validado minimamente. A batalha 3D não é recriada automaticamente (depende da UI). **Risco**: recarregar durante uma batalha pode deixar o fluxo num estado inconsistente (batalha pendente sem cena 3D). **Hipótese a testar.**

### 2.10 Dependências entre regras de campanha e os dois motores
- **Ficheiro**: `src/campaign/bridge.js`.
- **Evidência**: `isBridged` decide se há cena 3D. `tallyResult` e `applyResult` são duas vias. **Risco**: se os dois motores divergirem (ex.: `tallyResult` calcula `alliesLost` de forma diferente de `applyResult`), o estado pode ficar inconsistente. **Hipótese a testar.**

---

## 3. Escalabilidade da campanha

| Funcionalidade futura | Limitação atual | Ficheiro |
|---|---|---|
| Novos tipos de força romana | `PATROL_MEN`, `stepPatrols`, `detect`, `FOE_MEN`, `realForces` (intel) precisam de atualização manual | `simulation.js`, `battles.js`, `intel.js` |
| Objetivos de campanha | `WIN_MEN`/`WIN_FAME` fixos; `yearEnd` hardcoded | `flow.js` |
| Diferentes mapas táticos | `site` genérico; terreno fixo por tipo | `battles.js`, `bridge.js` |
| Terreno determinado pelo local | Não implementado; `battleSpec` não passa coordenadas do mapa | `battles.js` |
| Respostas romanas adaptativas | 5 padrões, 4 sectores; `COUNTERS` fixo | `doctrine.js` |
| Novas condições de vitória | `yearEnd` e `checkRuin` fixos | `flow.js`, `state.js` |
| Consequências estratégicas variadas | `applyResult` cobre 7 tipos; novos tipos exigem novo código | `battles.js` |

**Conclusão**: a campanha é extensível, mas exige alterações em vários módulos. Não há abstrações prematuras (bom), mas a adição de tipos exige tocar em 4-5 ficheiros.

---

## 4. Auditoria de progressão

### 4.1 Soft-locks
- **Men < SCOUTS + 1 (3)**: reconhecimento recusado, mas marchar/atacar continuam. **Não é soft-lock.**
- **Sem armas**: recrutamento recusado, mas pode-se pedir ajuda, marchar, atacar. **Não é soft-lock.**
- **Sem comida**: fome mata homens; se men → 0, derrota. **Não é soft-lock (é consequência).**
- **Patrulhas inalcançáveis**: patrulhas movem-se pela estrada; o bando pode marchar para a estrada. **Não é soft-lock.**
- **Caçadores**: vêm atrás do bando; podem ser evitados. **Não é soft-lock.**

### 4.2 Campanhas impossíveis de vencer
- **Hipótese**: se o pretor queima todas as aldeias cedo, a comida pode acabar. **A testar com balance (60 sementes).** O balance mostra 19/60 vitórias, o que sugere que não é impossível, mas é difícil.

### 4.3 Recursos negativos ou inconsistentes
- **Ficheiro**: `state.js`, `spend`; `communities.js`, `loseMen`.
- **Evidência**: `spend` satura em 0; `loseMen` limita a `total`. **Mitigação presente.**
- **Risco residual**: `food += loot.food` em `applyResult` pode inflar comida sem limite. **Não é bug, mas pode distorcer o balance.**

### 4.4 Patrulhas impossíveis de alcançar
- **Ficheiro**: `simulation.js`, `stepPatrols`.
- **Evidência**: patrulhas saem da estrada e movem-se para os extremos. Se o bando estiver no interior, pode não as encontrar. **Hipótese a testar com simulação determinista.**

### 4.5 Repetição excessiva
- **Ficheiro**: `events.js`, `rollEvent`.
- **Evidência**: `EVENT_CHANCE = 0.1`; pool de 4 eventos. **Pode ser repetitivo.** **Hipótese a testar.**

### 4.6 Confrontos que não podem ser concluídos
- **Ficheiro**: `battles.js`, `withdrawFrom`.
- **Evidência**: retirada só possível com `RETREAT_TYPES` e serra a <= 80 m. Se não houver serra, o bando não pode recusar. **Pode forçar combate em situações desfavoráveis.** **Hipótese a testar.**

### 4.7 Estados sem decisões úteis
- **Ficheiro**: `flow.js`, `yearEnd`.
- **Evidência**: se `state.over` for definido, a fase muda para 'fim'. **Não há decisões.** **Esperado.**

---

## 5. Revisão de testes

### 5.1 Cobertura atual

| Área | Testes | Ficheiro |
|---|---|---|
| Estado e serialização | 7-8 | `campaign-state.test.mjs` |
| Simulação | ~10 | `campaign-simulation.test.mjs` |
| Intel/visibilidade | 22 | `campaign-intel.test.mjs` |
| Mapa | ~10 | `campaign-map-view.test.mjs` |
| Flow/batalha | ~15 | `campaign-flow.test.mjs`, `campaign-battles.test.mjs` |
| Doutrina | ~8 | `campaign-doctrine.test.mjs` |
| Comunidades | ~12 | `campaign-communities.test.mjs` |
| Roma | ~15 | `campaign-rome.test.mjs` |
| Refused orders | ~5 | `campaign-refused-orders.test.mjs` |
| Clock | ~3 | `campaign-clock.test.mjs` |
| Events | ~4 | `campaign-events.test.mjs` |
| Praetor | ~5 | `campaign-praetor.test.mjs` |
| Intel (additional) | ~10 | `campaign-pr10.test.mjs`, `campaign-pr17-review.test.mjs` |
| Recrutamento | ~8 | `campaign-recruitment.test.mjs` |
| Valley | ~10 | `campaign-valley.test.mjs` |

**Total**: ~150 testes de campanha.

### 5.2 Casos não cobertos (prioridade)

**Necessários (regressões críticas):**
1. **Recarregamento durante batalha**: carregar um save com `phase === 'batalha'` e verificar que o fluxo se recupera.
2. **Aplicação dupla de `finishBattle`**: verificar que a segunda chamada é recusada.
3. **`state.day` inválido**: verificar que `deserialize` rejeita dias > 365.
4. **Patrulhas inalcançáveis**: simular 1000 sementes e verificar que o bando encontra pelo menos uma patrulha em 90 % dos casos.
5. **`sumAway <= state.men`**: verificar que `loseMen` mantém o invariante.
6. **`withdrawFrom` sem serra**: verificar que devolve `null` e não muda o estado.
7. **`applyResult` com `foeId` inexistente**: verificar que não crasha.
8. **Gravações v1**: carregar uma gravação sem `intel`/`doctrine`/`communities`/`rome` e verificar que ganham os campos.

**Opcionais (melhorias):**
1. **Repetição de eventos**: verificar que o pool de 4 eventos não repete o mesmo id consecutivamente.
2. **Food overflow**: verificar que `state.food` não cresce sem limite em 100 sementes.
3. **Pretor rest**: verificar que `rest` nunca excede 365.

---

## 6. Cinco problemas mais importantes (por impacto)

1. **Recarregamento durante batalha pode deixar o fluxo inconsistente** (`flow.js`, `loadFlow`): se o jogador fechar o jogo durante uma batalha, o save pode ter `phase === 'batalha'` com um `battle` parcial. A validação é mínima. **Impacto alto.**
2. **`applyResult` e `tallyResult` são duas vias de resultado** (`battles.js`, `bridge.js`): se divergirem, o estado fica inconsistente. **Impacto alto.**
3. **`state.day` não é limitado a `YEAR_DAYS` na deserialização** (`state.js`): um dia > 365 pode causar comportamento indefinido. **Impacto médio.**
4. **`loseMen` pode mascarar inconsistências** (`communities.js`): se `state.men` for maior do que a soma de `away` + `sem`, a diferença não é descontada. **Impacto médio.**
5. **Patrulhas podem ser inalcançáveis** (`simulation.js`): se o bando estiver no interior, pode não encontrar patrulhas. **Impacto médio.**

---

## 7. Recomendações mínimas de correção

1. **Validação mais rigorosa de `battle` em `loadFlow`**: verificar `foeId`, `villageId`, `context`, etc.
2. **Testes para recarregamento durante batalha**: criar um save com `phase === 'batalha'` e verificar que o fluxo se recupera.
3. **Limitar `state.day` a `YEAR_DAYS` em `deserialize`**: `if (o.day > YEAR_DAYS) return null;`.
4. **Testes para `applyResult` com `foeId` inexistente**: verificar que não crasha.
5. **Documentar a divergência entre `applyResult` e `tallyResult`**: garantir que ambos produzem o mesmo efeito.

---

## 8. Riscos de continuar a desenvolver sobre a arquitetura atual

1. **Acoplamento entre módulos**: adicionar um novo tipo de força romana exige alterações em 4-5 ficheiros.
2. **Gravações v1**: a compatibilidade é mantida, mas cada novo campo aumenta a complexidade de validação.
3. **Dois sistemas de combate**: a ponte (`bridge.js`) é frágil; mudanças num motor podem quebrar o outro.
4. **Estado global mutável**: `state` é mutado por muitas funções; é difícil rastrear mudanças.
5. **Testes não cobrem todos os cenários**: recarregamento, aplicação dupla, dias inválidos, patrulhas inalcançáveis.

---

## 9. Conclusão

A campanha estratégica é **funcional e bem testada** (150+ testes), mas tem **riscos de integridade de estado** que devem ser abordados antes de adicionar novas funcionalidades. As recomendações mínimas são de **baixo esforço** e **alto impacto**. A arquitetura atual é **extensível**, mas exige cuidado ao adicionar novos tipos de força ou condições de vitória.

## 9. Demonstrado vs. hipótese

Dos cinco riscos da secção 6, a distinção é a seguinte (com base no código e nos testes existentes, sem alterar produção):

| # | Risco | Natureza | Evidência |
|---|---|---|---|
| 1 | Recarregamento durante batalha inconsistente | **Hipótese** — mitigação parcial em `loadFlow` (validação básica do `battle`), mas sem teste de recuperação completa | `flow.js`, `loadFlow` |
| 2 | Divergência entre `applyResult` e `tallyResult` | **Hipótese** — duas vias de resultado; testes cobrem cada uma separadamente, não a equivalência | `battles.js`, `bridge.js` |
| 3 | `state.day` sem limite a `YEAR_DAYS` | **Demonstrado como lacuna** — `deserialize` aceita qualquer dia finito; teste `campaign-architecture-audit.test.mjs` documenta o comportamento atual | `state.js`, `deserialize` |
| 4 | `loseMen` mascarando inconsistências | **Hipótese** — o invariante `sumAway <= state.men` é validado ao carregar, mas não há teste de stress sob batalhas sucessivas | `communities.js`, `loseMen` |
| 5 | Patrulhas inalcançáveis | **Hipótese** — depende da posição do bando e do movimento das patrulhas; sem teste determinista em muitas sementes | `simulation.js`, `stepPatrols` |

Nenhum dos cinco é um bug demonstrado por falha de teste atual. Três deles (2, 4, 5) são hipóteses que precisam de testes deterministas; um (3) é uma lacuna de validação confirmada; um (1) é uma mitigação parcial.

## 10. Avaliação face ao playtest do PR #34

O playtest do PR #34 (semente 20, gravação v1 no Castro do Penedo no dia 4, emboscada M1.2, batalha dos Cativos no motor legado, abandono, recarregamento com confirmação de resultados no diário) **não é bloqueado** por nenhum dos cinco riscos, com as seguintes ressalvas:

| Risco | Bloqueia o playtest? | Justificação |
|---|---|---|
| 1. Recarregamento durante batalha | **Não** (com ressalva) | O playtest já exerce recarregamento e confirma resultados uma única vez no diário. O risco só se manifesta em cenários não cobertos (batalha a meio, save corrompido). |
| 2. Divergência `applyResult`/`tallyResult` | **Não** (com ressalva) | O playtest usa ambos os motores (M1.2 e legado). Se divergirem, o diário pode duplicar ou omitir resultados. O teste atual não cobre equivalência, mas o playtest não reportou divergência. |
| 3. `state.day` sem limite | **Não** | O playtest dura 11 dias; muito abaixo de `YEAR_DAYS` (245). |
| 4. `loseMen` inconsistente | **Não** (com ressalva) | Pode afetar a contagem de homens em batalhas sucessivas, mas o playtest tem apenas 2 batalhas e não reportou inconsistência. |
| 5. Patrulhas inalcançáveis | **Parcialmente** | Se uma patrulha não for encontrada, o playtest perde um encontro. O playtest reportou movimento de patrulhas, mas não testou todos os cenários. |

**Conclusão**: nenhum dos cinco riscos bloqueia o playtest do PR #34, mas os riscos 1 e 2 merecem atenção se o playtest for expandido (mais sementes, mais batalhas, recarregamento em mais pontos). As correções propostas na secção 7 **não devem ser implementadas** até confirmar quais são necessárias com base nos resultados do playtest.