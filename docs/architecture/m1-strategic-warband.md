# M1 — Viriato e o bando no mapa estratégico

Base: `main` em `156f2d007bb00f6add12c61e15bd534ec6b99aac` (M0 integrado). A alteração é visual e local ao mapa 3D. A simulação, a duração da marcha, as gravações v1, a economia, os dois combates e o mapa 2D de teste não mudaram.

## Construção

`src/campaign-map-3d/party.js` constrói quatro silhuetas de baixo polígono. Viriato fica à frente, com manto de lã em tom neutro; três companheiros seguem numa formação curta com túnicas terrosas, dois escudos e três lanças. Cada corpo reúne várias peças coloridas numa geometria. Os oito membros inferiores usam geometrias partilhadas por figura e giram discretamente durante a interpolação de marcha já existente. Todas as figuras partilham um material de superfície fosca. Não há sombras, texturas, efeitos, modelos de combate ou aleatoriedade de simulação.

O M0 continua a gerir a vida do grupo e do anel. A posição do bando é uma transformação; a orientação deriva do deslocamento **apresentado**, não da próxima ordem. A fase `step` que `ui.js` já calculava chega agora ao caminho de pose. A altura de cada figura é amostrada no terreno da sua posição para que os pés acompanhem as encostas. A troca de mundo liberta as geometrias e materiais do grupo anterior. A seleção por etiqueta ou pelo grupo 3D realça a etiqueta e não emite uma ordem.

Mantive a etiqueta «Bando/Warband». Em 844×390, as quatro figuras ocupam poucos pixels à escala normal; retirar a etiqueta prejudicaria a descoberta. O anel de identificação mantém a sua forma e cor. Não foi necessário um LOD adicional: a geometria fica muito abaixo do orçamento e uma troca de modelos à distância introduziria outra transição visual.

## Custos medidos

O ensaio usa Chromium headless com **SwiftShader (GPU por software)**, seed 1234 e a mesma gravação v1 nos dois checkouts. Para verificar a leitura junto de romanos, adiciona apenas à fixture visual um avistamento de patrulha próximo; não altera a simulação do jogo. As capturas de marcha seguem ordens reais para leste e oeste.

| Métrica na vista inicial | M0 | M1 |
| --- | ---: | ---: |
| Figuras | peão único | Viriato + 3 companheiros |
| Meshes do bando, incluindo anel | 2 | 13 (limite inicial: 16) |
| Triângulos do bando, incluindo anel | — | 1061 (limite inicial: 3000) |
| Geometrias do bando | 2 | 6 |
| Materiais do bando | 2 | 2 |
| Geometrias vivas na cena | 16 | 20 |
| Draw calls na vista inicial | 51 | 62 |

Durante as marchas, `partyBuilds` permaneceu em **1** em todas as resoluções. O E2E do M0 mediu 61→67 buffers criados e 0→5 libertados ao longo de três dias; dentro de cada bloco de quadros só de pose, ambas as variações foram **zero**. Depois de trocar o mundo, `partyBuilds` passou para 2, o modelo anterior foi libertado e as geometrias vivas ficaram em **19**, o mesmo valor anterior à troca nessa fixture. A [medição estruturada](../../production/qa/evidence/m1-warband/metrics.json) inclui a orientação e a comparação de estado/gravação por resolução. Draw calls e FPS em SwiftShader não são projeções para uma GPU de PC.

## Capturas para revisão visual

| Resolução | Vista normal | Zoom aproximado | Seleção, marcha e direção inversa |
| --- | --- | --- | --- |
| 1440×900 | [M0](../../production/qa/evidence/m1-warband/before-1440x900-normal.jpg) · [M1](../../production/qa/evidence/m1-warband/after-1440x900-normal.jpg) | [M0](../../production/qa/evidence/m1-warband/before-1440x900-zoom.jpg) · [M1](../../production/qa/evidence/m1-warband/after-1440x900-zoom.jpg) | [selecionado](../../production/qa/evidence/m1-warband/after-1440x900-selected.jpg) · [marcha](../../production/qa/evidence/m1-warband/after-1440x900-march-east.jpg) · [oeste](../../production/qa/evidence/m1-warband/after-1440x900-west.jpg) |
| 1280×800 | [M0](../../production/qa/evidence/m1-warband/before-1280x800-normal.jpg) · [M1](../../production/qa/evidence/m1-warband/after-1280x800-normal.jpg) | [M0](../../production/qa/evidence/m1-warband/before-1280x800-zoom.jpg) · [M1](../../production/qa/evidence/m1-warband/after-1280x800-zoom.jpg) | [selecionado](../../production/qa/evidence/m1-warband/after-1280x800-selected.jpg) · [marcha](../../production/qa/evidence/m1-warband/after-1280x800-march-east.jpg) · [oeste](../../production/qa/evidence/m1-warband/after-1280x800-west.jpg) |
| 1024×600 | [M0](../../production/qa/evidence/m1-warband/before-1024x600-normal.jpg) · [M1](../../production/qa/evidence/m1-warband/after-1024x600-normal.jpg) | [M0](../../production/qa/evidence/m1-warband/before-1024x600-zoom.jpg) · [M1](../../production/qa/evidence/m1-warband/after-1024x600-zoom.jpg) | [selecionado](../../production/qa/evidence/m1-warband/after-1024x600-selected.jpg) · [marcha](../../production/qa/evidence/m1-warband/after-1024x600-march-east.jpg) · [oeste](../../production/qa/evidence/m1-warband/after-1024x600-west.jpg) |
| 844×390 | [M0](../../production/qa/evidence/m1-warband/before-844x390-normal.jpg) · [M1](../../production/qa/evidence/m1-warband/after-844x390-normal.jpg) | [M0](../../production/qa/evidence/m1-warband/before-844x390-zoom.jpg) · [M1](../../production/qa/evidence/m1-warband/after-844x390-zoom.jpg) | [selecionado](../../production/qa/evidence/m1-warband/after-844x390-selected.jpg) · [marcha](../../production/qa/evidence/m1-warband/after-844x390-march-east.jpg) · [oeste](../../production/qa/evidence/m1-warband/after-844x390-west.jpg) |

A fixture visual contém uma força romana conhecida e comunidades próximas. O teste de clareza B2, com outra fixture e faixa B1 aberta, manteve **5/5 comunidades**, duas forças conhecidas e **zero** sobreposições ou cortes em 844×390. A 432×390 também manteve 5/5 comunidades e zero colisões. Save e estado após as duas ordens coincidiram exatamente com M0 nas quatro resoluções. A [captura PT-PT](../../production/qa/evidence/m1-warband/after-1280x800-pt-PT.jpg) confirma a etiqueta localizada.

## Reproduzir

```sh
npm ci
npm test
npm run smoke
node tools/check-map-assets.mjs
CHROME_PATH=/usr/bin/chromium PLAYWRIGHT_DIR=/caminho/para/playwright node tools/e2e-campaign-warband.mjs /tmp/m1-after
CHROME_PATH=/usr/bin/chromium PLAYWRIGHT_DIR=/caminho/para/playwright node tools/e2e-campaign-map-clarity.mjs
CHROME_PATH=/usr/bin/chromium PLAYWRIGHT_DIR=/caminho/para/playwright node tools/e2e-campaign-map-3d.mjs
CHROME_PATH=/usr/bin/chromium PLAYWRIGHT_DIR=/caminho/para/playwright node tools/e2e-campaign-playtest.mjs
```

Para repetir o comparativo, defina `SENTINEL_M1_BASELINE` com o caminho de um checkout em `156f2d0` e volte a executar `e2e-campaign-warband.mjs` para outro diretório de saída. A análise de movimento conserva os quadros reais do browser; capturas em movimento podem diferir no instante exato da interpolação.

## Validação visual independente pendente

Peço ao FreeBuff que avalie sobretudo a distinção do manto de Viriato na vista normal, o peso visual do anel/etiqueta em 844×390, a formação sobre encostas e a leitura dos escudos e lanças no zoom. A escala normal estreita permite identificar o **bando**, mas não os quatro indivíduos separadamente. Os testes de desempenho correram apenas em GPU por software; falta confirmação visual e de fluidez num PC com GPU real. Não foi feito vídeo nesta entrega.
