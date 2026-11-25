# M0 — representação persistente do bando

Base: `main` em `ca83148d9ef4a6e4456efdae8685a528fb623ce4`. M0 altera apenas a apresentação do mapa 3D; a campanha, o relógio, o formato v1 e os dois motores de batalha permanecem inalterados.

## Diagnóstico e política de atualização

Antes, cada quadro de `ui.frame()` chamava `paint()`. Isso recalculava `strategicView()` e fazia a chave de `scene.present()` variar com `shown`. Em cada quadro eram reconstruídos e libertados o peão, o seu anel, o alcance, o trilho e, quando presente, a rota/reconhecimento. O custo não se via pela contagem de geometrias vivas, porque a contagem podia ficar estável enquanto os buffers eram recriados.

Agora `ui.frame()` envia apenas a posição apresentada a `campaign-view.pose()`. A cena move o mesmo peão, atualiza os buffers já existentes dos anéis e traços que seguem o bando e reposiciona a mesma etiqueta. O `paint()` completo continua a ser usado por `render()` e por todas as decisões, ordens, mudanças de idioma, seleção, informação militar e dias estratégicos. **Não há cache por identidade do estado nem por dia.** `strategicView()` é recalculada em cada atualização completa; `setView()` compara o conteúdo de povoações e intel. A chave do planeamento usa a posição lógica, destino, trilho, alcance, foco e reconhecimento, pelo que mudanças reais continuam a reconstruir o grupo. Se uma pose chegar enquanto um `paint()` está pendente, só a posição apresentada é incorporada na atualização completa; os outros campos não se perdem.

Ao trocar o mundo, `load()` liberta o modelo anterior, incluindo peão, anel, planeamento, vegetação e marcadores, e constrói um novo grupo persistente para o novo mundo. O visualizador autónomo mantém o seu caminho original.

## Medição reproduzível

Chromium headless com **SwiftShader (GPU por software)**, viewport 1280×800, gravação v1 da semente 1234, `food=200`, capítulo `cativos` concluído, três ordens de marcha sucessivas para `x + 200`, oito amostras a intervalos de 40 ms por ordem. O script intercepta `createBuffer`, `deleteBuffer` e draws WebGL antes do arranque. A medição cobre a cena inteira; não atribui cada buffer individual a um objeto. Os contadores internos da versão M0 permitem verificar as causas.

| Métrica, início → dia 3 | Main anterior | M0 |
| --- | ---: | ---: |
| Buffers WebGL criados | 50 → 120 (+70) | 50 → 56 (+6) |
| Buffers WebGL libertados | 0 → 69 (+69) | 0 → 5 (+5) |
| Grupo do bando construído | — | 1 → 1 |
| Grupo de planeamento construído | — | 1 → 4 (um por mudança de trilho/dia) |
| Geometrias vivas | — | 14 → 15; 15 após trocar para a semente 4711 |
| Draw calls por renderização | — | 49 → 50 (trilho passa a existir) |

Entre a primeira e a última amostra de **cada** bloco de oito quadros da mesma marcha, M0 registou zero novos buffers, zero buffers descartados e zero reconstruções de planeamento, com atualizações de pose. Depois de alterar postura e intel sem avançar o dia, a troca para a semente 4711 aumentou `partyBuilds` para 2 e `releasedGroups` para 4; os buffers criados/libertados acumulados passaram para 115/64 e as geometrias vivas ficaram em 15. O estado, Diário e gravação final da sequência são idênticos nos dois checkouts. O número total de draws depende dos quadros efetivamente executados e não serve como comparação de desempenho entre estas corridas.

Para reproduzir, use dois checkouts com dependências instaladas e Playwright/Chromium disponíveis:

```sh
SENTINEL_M0_BASELINE=/caminho/para/main CHROME_PATH=/usr/bin/chromium PLAYWRIGHT_DIR=/caminho/para/playwright node tools/e2e-campaign-party-render.mjs /tmp/m0-before
CHROME_PATH=/usr/bin/chromium PLAYWRIGHT_DIR=/caminho/para/playwright node tools/e2e-campaign-party-render.mjs /tmp/m0-after
```

O ensaio principal escreve `metrics.json` com amostras e estado final, e capturas de repouso, marcha e seleção. O teste M0 falha se quadros só de pose alocarem ou libertarem buffers, reconstruírem planeamento, ou se o bando não persistir; verifica ainda uma mutação de postura no mesmo dia e a limpeza após troca de mundo. Não se extrapola FPS de SwiftShader para um PC com GPU real.

## Equivalência visual

As quatro capturas de repouso antes/depois são idênticas pixel a pixel. As capturas selecionadas e durante a marcha têm pequenas diferenças na área do peão/trilho por causa do instante de amostragem da interpolação; a forma, cor e restantes elementos coincidem. O ensaio de clareza B2 confirmou 5/5 comunidades, duas forças conhecidas e zero colisões/cortes em 1440×900, 1280×800, 1024×600 e 844×390, incluindo a faixa B1 a 844×390. A faixa foi capturada com a gaveta fechada.

| Resolução | Repouso | Bando selecionado |
| --- | --- | --- |
| 1440×900 | [antes](../../production/qa/evidence/m0-party/before-rest-1440x900.jpg) · [depois](../../production/qa/evidence/m0-party/after-rest-1440x900.jpg) | [antes](../../production/qa/evidence/m0-party/before-selected-1440x900.jpg) · [depois](../../production/qa/evidence/m0-party/after-selected-1440x900.jpg) |
| 1280×800 | [antes](../../production/qa/evidence/m0-party/before-rest-1280x800.jpg) · [depois](../../production/qa/evidence/m0-party/after-rest-1280x800.jpg) | [antes](../../production/qa/evidence/m0-party/before-selected-1280x800.jpg) · [depois](../../production/qa/evidence/m0-party/after-selected-1280x800.jpg) |
| 1024×600 | [antes](../../production/qa/evidence/m0-party/before-rest-1024x600.jpg) · [depois](../../production/qa/evidence/m0-party/after-rest-1024x600.jpg) | [antes](../../production/qa/evidence/m0-party/before-selected-1024x600.jpg) · [depois](../../production/qa/evidence/m0-party/after-selected-1024x600.jpg) |
| 844×390 | [antes](../../production/qa/evidence/m0-party/before-rest-844x390.jpg) · [depois](../../production/qa/evidence/m0-party/after-rest-844x390.jpg) | [antes](../../production/qa/evidence/m0-party/before-selected-844x390.jpg) · [depois](../../production/qa/evidence/m0-party/after-selected-844x390.jpg) |

[Marcha antes](../../production/qa/evidence/m0-party/before-march-1280x800.jpg) · [Marcha depois](../../production/qa/evidence/m0-party/after-march-1280x800.jpg) · [Faixa B1 antes](../../production/qa/evidence/m0-party/before-844x390-interruption.jpg) · [Faixa B1 depois](../../production/qa/evidence/m0-party/after-844x390-interruption.jpg)

## Verificação e limites

Executados: `npm test` (742/742), `npm run smoke` (359 verificações), `node tools/check-map-assets.mjs`, E2E do mapa 3D, decisões B1, clareza B2, playtest completo pelos dois motores, arena M3.1 e E2E M0. O playtest percorreu os dias 4–11, vitória tática, derrota legada, gravação e recarregamento. O E2E M0 não altera saves de produção: usa um contexto isolado do browser.

As mudanças de trilho, rota, foco ou intel ainda podem reconstruir geometria em atualizações estratégicas. Essa reconstrução preserva o conteúdo existente e não decorre de quadros só de pose. A capacidade dos buffers dinâmicos é calculada a partir das dimensões do terreno e dos raios existentes; um traço acima dessa capacidade lança um erro explícito em vez de apresentar geometria incompleta. A avaliação de desempenho em GPU real fica para testes num PC representativo.
