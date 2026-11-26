# Plano técnico — B3 (ritmo da campanha) + M2 (movimento contínuo)

Repositório: AntonioSCosta/Sentinel · Branch: `docs/b3-m2-continuous-campaign-plan` (a partir de `main`)

Documento de diagnóstico e plano. **Não altera código de produção.**

---

## 1. Diagnóstico da implementação atual

### 1.1 Onde o tempo avança

| Função | Ficheiro | Comportamento |
|---|---|---|
| `stepDay` | `src/campaign/simulation.js` | Avança `state.day += 1` após a ordem e os passos do dia (patrulhas, pretor, doutrina, fome). |
| `flow.order` | `src/campaign/flow.js` | Chama `stepDay`; se houver encontro, entra em batalha; senão `yearEnd`. |
| `play` / `pause` / `schedule` | `src/campaign/ui.js` | O relógio do UI corre por `setTimeout` (`DAY_MS / speed`); cada tick chama `step()`, que chama `flow.order(standingOrder)`. |
| `detectInterruptions` | `src/campaign/issues.js` | Devolve motivos que param o relógio (`running = false`). |

### 1.2 Comportamento atual do ritmo
- **Viriato parado**: o tempo **não** avança por si (o robô dá ordem `esperar`/`acampar`; o jogador pode dar `esperar`).
- **Viriato em marcha**: o tempo avança automaticamente (cada dia = uma ordem `marchar`).
- **Esperar**: avança o dia mesmo parado.
- **Interrupções**: param o relógio (`running = false`) e mostram a faixa `m-int`.

### 1.3 Movimento visual atual
- `MARCH_SPEED = 45` unidades/dia; `moveToward` move o bando num salto de 45 por dia.
- A animação de marcha dura ~300 ms (`DAY_MS`), mas o deslocamento lógico é instantâneo no início do dia.
- Resultado: **salto visual** de 45 unidades em 300 ms.
- O mapa 3D (`campaign-map-3d`) usa `setPartyPose` para atualizar a posição do peão sem reconstrução de geometria (M0).

### 1.4 Interrupções atuais
- `detectInterruptions` retorna motivos: `pedido` (tributo), `postura`, `colheita`, `comida`, `forca`, `batalha`.
- `memory` evita repetir o mesmo aviso.
- A faixa `m-int` mostra os motivos e o botão "Continuar".
- `play()` limpa `interrupt` e `tributeNotice`.

---

## 2. Mapa dos módulos e funções afetados

| Módulo | Função | Impacto |
|---|---|---|
| `src/campaign/simulation.js` | `stepDay`, `applyOrder`, `moveToward`, `marchDays` | Avanço lógico do dia e da posição. |
| `src/campaign/flow.js` | `order`, `finishBattle`, `finishTactical`, `withdraw` | Orquestração do dia e das batalhas. |
| `src/campaign/ui.js` | `play`, `pause`, `schedule`, `step`, `detectInterruptions`, `renderStateStrip` | Relógio do UI e interrupções. |
| `src/campaign/issues.js` | `detectInterruptions`, `interruptionText`, `buildIssues` | Motivos de pausa e faixa de estado. |
| `src/campaign/pace.js` | `SPEEDS`, `DAY_MS`, `loadSpeed`, `saveSpeed`, `standingOrder` | Velocidade do relógio. |
| `src/campaign/map-view.js` | `makeView`, `toWorld`, `toScreen` | Conversão de coordenadas. |
| `src/campaign-map-3d/scene.js` | `present`, `setPartyPose`, `layoutLabels` | Renderização 3D e posição do peão. |
| `src/campaign-map-3d/overlays.js` | `makeParty`, `makePlanning`, `mutableStroke` | Peão, anel, rota, rasto. |
| `src/campaign-map-3d/interaction.js` | `positionLabels`, `labelLeader` | Etiquetas. |
| `src/campaign/state.js` | `serialize`, `deserialize` | Gravação da posição. |
| `src/campaign/intel.js` | `updateIntel` | Informação e visibilidade. |

---

## 3. Proposta de arquitetura

### 3.1 B3 — Ritmo da campanha

**Princípio**: o tempo avança apenas quando o jogador dá uma ordem de movimento ou "Esperar". Decisões obrigatórias podem interromper. Informações normais não interrompem.

**Mudanças propostas**:
1. **Viriato parado**: o relógio não avança. A ordem `acampar`/`esconder` já não avança o dia (já é o caso para `acampar`/`esperar`/`esconder` em `applyOrder`). **Verificar**: `esperar` avança o dia em `stepDay` (sim, porque não é recusado). **Ação**: tornar `esperar` uma ordem que avança o dia (como hoje) mas sem marcha.
2. **Viriato em marcha**: o tempo avança automaticamente (como hoje).
3. **Jogador interrompe a marcha**: o tempo para (já é o caso quando `dest` é cancelado).
4. **Decisões obrigatórias**: `detectInterruptions` continua a retornar motivos, mas apenas `pedido` (tributo) e `batalha` param o relógio. Os outros (`postura`, `colheita`, `comida`, `forca`) vão para o log/faixa sem parar.
5. **Informações normais**: vão para o log e para a faixa de estado, sem parar o relógio.

**Riscos**:
- Acontecimentos aleatórios (`rollEvent`) podem alterar o estado (comida, homens) sem pausa. **Mitigação**: mostrar no log, não parar.
- Patrulhas podem aparecer sem pausa. **Mitigação**: mostrar no log, não parar.
- Gravações: a posição do bando é gravada no fim do dia. Se o jogador parar a meio, a posição não é gravada até ao fim do dia. **Mitigação**: gravar a posição visual separadamente (ver M2).
- Decisões: se um tributo expirar enquanto o tempo corre, a interrupção deve parar o relógio. **Mitigação**: `detectInterruptions` já retorna `pedido`.

### 3.2 M2 — Movimento contínuo

**Princípio**: a simulação é autoridade (posição lógica por dia). O renderer interpola visualmente entre a posição do dia anterior e a do dia atual, sem alterar o estado.

**Proposta: interpolação com previsão do próximo passo lógico**:
1. **Posição lógica**: `state.party` é a posição no fim do dia anterior (ou no início do dia atual).
2. **Posição visual**: `visualParty` interpola de `prevParty` para `state.party` durante o dia (300 ms a 1×).
3. **Previsão do próximo passo**: quando o dia avança, calcular a posição do próximo dia (`nextParty`) sem modificar `state.party`. Usar `marchDays`/`moveToward` em cópia.
4. **Interpolação**: `visualParty = lerp(prevParty, nextParty, t)` onde `t = elapsed / DAY_MS`.
5. **Gravação**: gravar `state.party` (posição lógica), não `visualParty`. Ao carregar, `visualParty = state.party`.
6. **Interrupções**: se o dia for interrompido, `visualParty` salta para `state.party` (sem teleporte visível, porque o dia não avançou).
7. **Mudança de destino**: `visualParty` salta para `state.party` (o bando já estava lá logicamente).
8. **Encontros**: a batalha começa na posição lógica; `visualParty` salta para `state.party`.

**Riscos**:
- Dessincronização se o FPS for baixo (40 FPS no Steam Deck). **Mitigação**: usar `deltaTime` acumulado, não frames.
- Teleportes em interrupções: se `visualParty` não for resetado, pode haver um salto. **Mitigação**: resetar `visualParty = state.party` em interrupções.
- Reconstrução de geometria: o peão já é persistente (M0). Apenas a posição muda. **Mitigação**: usar `setPartyPose` (já existe).

### 3.3 Informação e interrupções

**Princípio**: relatórios discretos em vez de notificações intrusivas.

**Proposta**:
1. **Patrulha avistada**: relatório no log (já é o caso via `intelView`).
2. **Informação sobre aldeias**: relatório no log (já é o caso via `buildIssues`).
3. **Provisões a diminuir**: aviso no log (já é o caso via `foodDays < LOW_FOOD_DAYS`).
4. **Falta de comida**: aviso vermelho no log, sem pausa automática (remover `detectInterruptions` para `comida`).
5. **Emboscada inevitável**: interrupção com decisão (manter).

**Riscos**:
- O jogador pode não ver avisos no log se estiver focado no mapa. **Mitigação**: faixa de estado (state strip) mostra os avisos.
- Informação não deve revelar automaticamente toda a informação. **Mitigação**: `intelView` já filtra por conhecimento.

### 3.4 Qualidade e desempenho

**Proposta**:
1. **Atualização por frame**: usar `requestAnimationFrame` com `deltaTime` acumulado. A posição visual é calculada a cada frame, não a cada dia.
2. **Custo de animação e câmara**: a câmera segue `visualParty` com suavização (`lerp`). O custo é mínimo (já existe `placeCamera`).
3. **FPS variável**: usar `deltaTime` acumulado, não frames. Se o FPS for baixo, a interpolação pode saltar, mas a posição lógica é preservada.
4. **Separação simulação/renderização**: a simulação corre em `stepDay` (por dia); a renderização corre em `requestAnimationFrame` (por frame). A posição visual é calculada no render, não na simulação.
5. **Separador em segundo plano**: `visibilitychange` já pausa o relógio. A posição visual não é atualizada em segundo plano.
6. **Velocidades 1×, 2×, 4×**: `DAY_MS / speed` ajusta a duração do dia. A interpolação usa `elapsed / (DAY_MS / speed)`.
7. **Dessincronização**: o estado lógico é sempre a verdade. A posição visual é descartável. Ao carregar, `visualParty = state.party`.

---

## 4. Sequência de pequenos PRs independentes

### PR 1 — B3.1: Ritmo da campanha (pausas)
- **Objetivo**: tornar `comida` um aviso, não uma interrupção.
- **Ficheiros**: `src/campaign/issues.js` (`detectInterruptions`), `src/campaign/ui.js` (`play`, `renderStateStrip`).
- **Risco**: baixo.
- **Testes**: smoke + E2E.

### PR 2 — B3.2: Decisões obrigatórias
- **Objetivo**: garantir que `pedido` e `batalha` param o relógio; os outros não.
- **Ficheiros**: `src/campaign/issues.js`, `src/campaign/ui.js`.
- **Risco**: baixo.
- **Testes**: smoke + E2E.

### PR 3 — M2.1: Posição visual (interpolação)
- **Objetivo**: adicionar `visualParty` e interpolação, sem alterar `state.party`.
- **Ficheiros**: `src/campaign/ui.js`, `src/campaign-map-3d/scene.js` (`setPartyPose`).
- **Risco**: médio (dessincronização).
- **Testes**: E2E de movimento contínuo.

### PR 4 — M2.2: Previsão do próximo passo
- **Objetivo**: calcular `nextParty` sem modificar `state.party`.
- **Ficheiros**: `src/campaign/simulation.js` (`marchDays`), `src/campaign/ui.js`.
- **Risco**: médio.
- **Testes**: testes deterministas de previsão.

### PR 5 — M2.3: Câmara suave
- **Objetivo**: suavizar a câmara durante a marcha (`lerp`).
- **Ficheiros**: `src/campaign-map-3d/scene.js` (`placeCamera`).
- **Risco**: baixo.
- **Testes**: E2E visual.

### PR 6 — B3.3: Relatórios discretos
- **Objetivo**: mover avisos de `detectInterruptions` para o log/faixa.
- **Ficheiros**: `src/campaign/issues.js`, `src/campaign/ui.js`.
- **Risco**: baixo.
- **Testes**: smoke + E2E.

---

## 5. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Dessincronização entre posição visual e lógica | `visualParty` é descartável; ao carregar, `visualParty = state.party`. |
| Teleportes em interrupções | Resetar `visualParty = state.party` em interrupções. |
| Baixo FPS no Steam Deck | Usar `deltaTime` acumulado, não frames. |
| Reconstrução de geometria por frame | O peão já é persistente (M0); apenas a posição muda. |
| Gravações v1 | Gravar `state.party` (posição lógica), não `visualParty`. |
| Mudança de destino | `visualParty` salta para `state.party`. |
| Encontros | A batalha começa na posição lógica; `visualParty` salta. |

---

## 6. Critérios de aceitação testáveis

1. **B3.1**: com comida para < 5 dias, o relógio não para; o aviso aparece no log e na faixa.
2. **B3.2**: um tributo pendente para o relógio; um aviso de comida não.
3. **M2.1**: durante a marcha, o peão move-se suavemente (sem saltos de 45 unidades).
4. **M2.2**: a posição visual no fim do dia coincide com `state.party`.
5. **M2.3**: a câmara segue o peão com suavização (sem saltos).
6. **Gravações**: ao carregar, `visualParty = state.party`.
7. **Interrupções**: ao interromper, `visualParty = state.party` (sem teleporte visível).
8. **FPS**: a interpolação funciona a 40 FPS e 60 FPS.

---

## 7. Testes necessários

- **Testes deterministas**: previsão de `nextParty` sem modificar `state.party`.
- **Testes de gravação**: `visualParty` não é gravado; ao carregar, `visualParty = state.party`.
- **Testes E2E**: movimento contínuo, câmara suave, interrupções.
- **Testes de desempenho**: 40 FPS e 60 FPS no Steam Deck.

---

---

## 9. Correções ao plano M2 (sem implementação)

Registadas a pedido, sem alterar o código:

1. **A marcha visual deve ocupar continuamente o intervalo de tempo de cada dia**, não apenas 300 ms. A interpolação deve cobrir todo o `DAY_MS / speed`, não um sub-intervalo fixo.
2. **A previsão determinística da posição seguinte deve preceder a interpolação definitiva.** Calcular `nextParty` em cópia antes de animar.
3. **Mudanças de destino, pausas, carregamentos e interrupções não podem provocar teletransportes visíveis desnecessários.** Resetar `visualParty = state.party` nestes casos.
4. **A posição visual não pode antecipar consequências lógicas da simulação.** Apenas interpola entre posições já decididas.
5. **A solução deve funcionar com velocidades 1×, 2× e 4× e diferentes frequências de renderização.** Usar `deltaTime` acumulado.<|end|><|start|>write to=assistant<|channel|>analysis<|message|>Created file successfully: C:/Users/joseb/OneDrive/Desktop/viriato-fps/docs/b3-m2-continuous-campaign-plan.md