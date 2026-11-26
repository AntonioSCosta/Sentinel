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

---

# M1.1 — Correção da legibilidade do bando

A autoavaliação visual do M1 deu NO-GO: na vista normal, as quatro figuras fundiam-se numa mancha escura, Viriato não se distinguia, o grupo dependia do anel e da etiqueta, as pernas quase não se viam e a rotação mudava num quadro. Esta revisão corrige o mesmo PR. A simulação, a duração da marcha, a cadência dos dias, as interrupções e as gravações não mudam.

## Diagnóstico medido

A câmara do mapa é ortográfica e olha de cima, quase a pique. O bando lê-se sobretudo **de cima**: ombros, cabeças, mantos, escudos. Antes de mexer no modelo, medi a caixa do bando no ecrã, sem anel nem etiqueta ([métricas](../../production/qa/evidence/m1-warband/m1.1/metrics.json)):

| Zoom | 1440×900 | 1280×800 | 1024×600 | 844×390 |
| --- | ---: | ---: | ---: | ---: |
| M0, peão | 9×13 px | 8×11 px | 6×8 px | 3×5 px |
| M1 original | 18×20 px | 16×17 px | 12×13 px | **7×8 px** |
| M1.1, normal | 25×27 px | 25×27 px | 23×25 px | 13×14 px |
| M1.1, afastado (0,8) | 25×27 px | 24×26 px | 19×20 px | 11×12 px |
| M1.1, aproximado (4) | 79×85 px | 67×73 px | 52×56 px | 30×32 px |

O peão do M0 era **mais pequeno** que o bando. Lia-se a 4/5 porque era um losango amarelo-claro, sem sombreamento, sobre um terreno caqui médio (luminância ≈ 0,53): era um farol, não uma silhueta. A 844×390, o bando original cabia em 7×8 px, ou seja, menos de 2×4 px por homem. A essa escala, nenhuma combinação de cor, formação ou detalhe produz quatro silhuetas humanas.

## Correções

**Silhueta e contraste** (`party.js`):
- **Formação:** cunha assimétrica e mais aberta. Viriato vai à frente, ligeiramente descentrado, e o último homem fica para trás. O terreno aparece entre os quatro. O raio da formação continua dentro do anel.
- **Corpos:** mais esguios.
- **Cores dos companheiros:** mantos de lã escura (#2b2420 a #3a2d24). Contrastam com o terreno sem brilho.
- **Viriato:** manto claro de lã crua (#ddd2bb), com ombros e mangas da mesma cor. Distingue-se pela posição e pelo manto.
- **Escudos:** caetras ocre com umbo claro, inclinadas para a câmara. No original ficavam de perfil.
- **Lanças:** haste escura mais grossa, com inclinação diferente em cada homem. A lança sai da silhueta do corpo.
- **Proibições respeitadas:** sem brilho, sem etiquetas novas, sem ornamentos, sem sombras e sem texturas. A paleta é a terrosa existente.

**LOD como compensação contínua de distância** (`scene.js`, `overlays.js`):
- Quando o mapa fica pequeno no ecrã, o bando e o anel crescem juntos. A regra é `escala = clamp(1,15 / píxeis por unidade, 1, 1,8)`.
- Fatores por vista: ×1,25 a 1440×900 normal, ×1,46 a 1280×800 e ×1,8 a 1024×600 e 844×390. Com zoom ≥ 2, a escala é a do mapa.
- **Porque não troquei de modelo:** é o mesmo modelo, com uma escala que varia continuamente com o zoom. Não há troca de modelo nem salto visual.
- **Um modelo simplificado não ajudava:** a 13 px não há detalhe para retirar. O que faltava era tamanho e separação.
- O anel tem orçamento de vértices para ×2. `setScreenScale` limita a escala a esse valor, para uma afinação futura não rebentar o buffer.
- A etiqueta sobe com a escala.

**Animação** (`party.js`, `overlays.js`):
- **Pernas e braços:** dois `InstancedMesh` (8 pernas e 8 braços) cujas matrizes se reescrevem no mesmo buffer.
- **Passada:** braço oposto à perna. O braço da lança balança menos. Há balanço vertical e inclinação para a frente.
- **Fase por distância:** a fase segue a distância apresentada, não o tempo. A amplitude segue a velocidade da interpolação, por isso as pernas assentam com a desaceleração final.
- **Diferenças entre homens:** fase, comprimento de passada e amplitude próprios.
- **Rotação progressiva:** 22 % do ângulo em falta por quadro, pelo caminho mais curto. No fim da marcha assenta na direção apresentada.

## Compromisso da marcha

Um dia de marcha desloca 45 unidades em **300 ms** (`MARCH_SPEED` 45 em `src/campaign/simulation.js`). A pausa entre dias é de cerca de 1,1 s a 1×. Uma passada ajustada ao comprimento das pernas (≈ 8 unidades) daria ≈ 17 Hz: cintilação, não passos. O M1 original fixava 2,5 ciclos por troço, ≈ 8 Hz, o que também é impercetível. O M1.1 estica a passada para cerca de 1,25 ciclos por dia, ≈ 4 Hz: os passos leem-se, mas os pés escorregam cerca de 4×.

Sem mudar a duração da marcha, não é possível ter passos visíveis e pés presos ao chão ao mesmo tempo. A solução real é a marcha contínua do M2/B3, que não implementei.

## Custos

| Métrica, incluindo o anel | M0 | M1 original | M1.1 |
| --- | ---: | ---: | ---: |
| Meshes do bando | 2 | 13 | **7** (4 corpos, 2 instanciados, anel) |
| Triângulos do bando | — | 1061 | 1188 |
| Geometrias do bando | 2 | 6 | 7 |
| Materiais do bando | 2 | 2 | 2 |
| Draw calls na vista inicial | 51 | 62 | **56** |
| Geometrias vivas na vista inicial | 16 | 20 | 21 |

**Sem geometria nova por quadro de pose:**
- `partyBuilds` fica em 1 depois de quatro marchas reais.
- Os conjuntos de geometrias e materiais e os buffers das instâncias são os mesmos antes e depois de 13 poses (teste unitário).
- O E2E do M0 (`e2e-campaign-party-render`) volta a medir zero buffers criados ou libertados nos quadros só de pose.
- Ao fim de quatro marchas, o estado e o save são idênticos aos do M0 em todas as resoluções.

## Legibilidade

**Escala:** 5 = pequeno bando de homens com chefe, lido de relance; 4 = grupo de figuras claramente identificável com um olhar curto; 3 = aglomerado de figuras, com esforço; 2 = mancha que depende do anel e da etiqueta; 1 = não se encontra.

Avaliação feita por mim, sem anel nem etiqueta, à escala 1:1. Não é um playtest.

| Vista normal | M0, peão | M1 original | M1.1 |
| --- | :---: | :---: | :---: |
| 1440×900 | 4 (marcador, não bando) | 2 | **4** |
| 1280×800 | 4 | 2 | **4** |
| 1024×600 | 3 | 2 | **4** |
| 844×390 | 2 | 1–2 | **2–3** |

Há duas leituras diferentes:
- **O que é:** desde 1024×600, o M1.1 lê-se como quatro homens separados, com o de manto claro à frente e escudos e lanças à vista.
- **Onde está:** sem anel, o bando continua menos fácil de **encontrar** de relance do que o losango amarelo do M0. É mais escuro e não brilha. Com o anel, encontra-se tão depressa como o peão.

**Capturas:**
- [1:1 a 1440×900](../../production/qa/evidence/m1-warband/m1.1/legibilidade-1440-1para1.jpg).
- Recortes sem anel nem etiqueta: [normal](../../production/qa/evidence/m1-warband/m1.1/legibilidade-bare-z1.png), [afastado](../../production/qa/evidence/m1-warband/m1.1/legibilidade-bare-z0.8.png), [aproximado](../../production/qa/evidence/m1-warband/m1.1/legibilidade-bare-z4.png).
- [Recortes com anel e etiqueta](../../production/qa/evidence/m1-warband/m1.1/legibilidade-crop-z1.png).
- Lado a lado M0 | M1 | M1.1 por resolução: `compare-<resolução>-{normal,normal-nolabel,far,zoom}.jpg` em `production/qa/evidence/m1-warband/m1.1/`.
- Capturas do M1.1 por resolução: normal, sem etiqueta, selecionado, afastado, aproximado, quatro marchas a meio e no fim, e PT-PT. Estão em `m1.1/after/`.

## Marcha

- [Vídeo: quatro direções, M1 original | M1.1, tempo real e câmara lenta ×4](../../production/qa/evidence/m1-warband/m1.1/marcha-4-direcoes.mp4).
- Tiras de quadros: [M1 original](../../production/qa/evidence/m1-warband/m1.1/marcha-quadros-m1-original.png) · [M1.1](../../production/qa/evidence/m1-warband/m1.1/marcha-quadros-m1.1.png).

**Como foram gerados:**
- O vídeo e as tiras repõem um dia de marcha (45 unidades, 300 ms, *ease in-out*) a 60 quadros por segundo, pelo caminho real de pose. A câmara fica em zoom 4, centrada no bando.
- São determinísticos porque, em SwiftShader, o browser só desenha 3 a 6 quadros por troço de 300 ms.
- O script que os gera é descartável e não foi incluído.
- **As subidas e descidas são reais:** nas encostas viradas para a câmara, o anel parece uma elipse e a formação estica, porque seguem o terreno.

## Compromisso e alternativa

A 844×390, a nota 4/5 **não é atingível com quatro modelos** sem os aumentar desproporcionadamente. Com escala ×2 e piso 1,6 testados, o bando chega a 15×16 px e continua 2–3/5. A 1440×900, a mesma afinação dá 34×37 px, maior do que uma aldeia.

| Opção | Efeito | Recomendação |
| --- | --- | --- |
| **A. Aceitar** que a 844×390 o bando se encontra pelo anel e pela etiqueta, como as aldeias. As figuras leem-se a partir do zoom 2,2 (25×27 px). | Nenhum custo novo. | **Recomendada.** |
| B. Compensação mais forte (piso 1,6, máximo 2) | 844×390 sobe só para 15×16 px; a 1440 o bando fica maior que as aldeias | Não recomendada |
| C. Disco de chão claro sob o bando | Recupera a capacidade de se encontrar de relance, como o peão | Proibido nesta tarefa (efeito luminoso) |

## Testes

- `npm test`: 742/742. O teste do grupo cobre instâncias, buffers reutilizados, oposição das pernas e dos braços, rotação progressiva, assentamento no fim da marcha, escala com o anel e o limite ×2.
- `npm run smoke`: 359 verificações sem erros.
- `node tools/check-map-assets.mjs`: OK.
- `tools/e2e-campaign-warband.mjs`, em quatro resoluções:
  - orçamento de 4 figuras, 7 meshes e 2 materiais;
  - seleção sem ordem;
  - quatro marchas reais com direção verificada (±0,1 rad);
  - `partyBuilds` em 1 e geometrias do bando constantes;
  - capturas sem etiqueta, afastada e aproximada;
  - PT-PT.
- Repetido com `SENTINEL_M1_BASELINE` para M0 e para o M1 original: estado e save iguais.
- Restantes E2E: ver o PR.

**Pendente:**
- Validação de fluidez numa GPU real.
- Um playtest de legibilidade com pessoas, porque as notas acima são minhas.

---

# M1.1 — Passagem artística: modelos suaves

O criador aprovou o compromisso A (a 844×390 o bando localiza-se pelo anel e pela etiqueta) e pediu modelos simples, limpos e suaves: "smoothness vende". Esta passagem mantém a paleta, a formação, a escala moderada, a compensação de distância, a simulação e a duração da marcha.

## Diagnóstico antes da passagem

**Renderização:** já estava correta e não mudou.
- `antialias: true` dá MSAA 4×, confirmado no contexto WebGL.
- `pixelRatio` = min(DPR, 2), com o buffer de desenho a seguir o DPR.
- Iluminação hemisférica mais direcional, materiais foscos.

Nota: as folhas de comparação anteriores ampliavam com vizinho mais próximo e exageravam o serrilhado. As desta secção estão à escala nativa ou foram ampliadas com filtro bicúbico, e isso vem indicado.

**Defeitos do modelo M1.1:**
- sombreamento plano em cilindros de 6 a 8 lados;
- túnica, manto, ombros e cinto empilhados como peças separadas;
- cabelo em cone, como um chapéu;
- figuras atarracadas, com pernas a cerca de 30 % da altura;
- escudos octogonais;
- lanças de secção quadrada;
- pés em caixa;
- membros rígidos sem joelho;
- figuras sem contacto com o chão.

## O que mudou (`party.js`)

- **Corpo contínuo.** Cada homem tem um único corpo torneado (`LatheGeometry`) da bainha ao pescoço. As regiões de túnica, manto (costas e ombros; em Viriato, também o peito) e cinto são cores por vértice no mesmo contorno, não peças empilhadas. A secção é ligeiramente elíptica, mais larga que funda.
- **Sombreamento suave.** `sculpt` transforma as normais de cada primitiva pela matriz de normais, em vez de as recalcular como facetas. O material deixou de usar `flatShading`.
- **Proporções.** Altura de cerca de 15 unidades, pernas com cerca de 45 % (anca a 6,9), cabeça com cerca de 1/6 e ombros arredondados. O cabelo é uma calote esférica.
- **Escudos, lanças e pés.**
  - A caetra é uma calote abaulada com umbo.
  - A lança tem haste de 6 lados e folha afilada.
  - O pé é um elipsoide.
  - Braços e canelas são cápsulas.
  - A coxa é um tronco de cone aberto; as pontas ficam escondidas pela anca e pelo joelho.
- **Articulações.** Coxa e canela são dois `InstancedMesh`. O joelho dobra-se (até 0,75 rad) só enquanto essa perna avança.
  - Os braços balançam contra as pernas. Os do escudo e da lança movem-se menos.
  - O corpo sobe ligeiramente a meio passo, inclina-se para a frente e balança um pouco de lado.
  - A fase segue a distância apresentada e a amplitude segue a velocidade da interpolação, como antes.
- **Sombra de contacto.** Um disco suave por homem, com alfa por vértice: centro a 0,7, borda transparente, opacidade 0,5. Não usa textura.
  - Fica deitado sobre a inclinação local do terreno, calculada pelo gradiente de `heightAt`.
  - Está deslocado 1,7 unidades na direção da luz principal da cena, `(-370, 620, -330)`. Assim aparece ao lado do homem em vez de ficar escondido sob o manto.
  - Não acompanha o balanço do passo.
  - Fica 0,6 unidades acima de `heightAt`, porque nas encostas a malha triangulada do terreno pode ficar ligeiramente acima da altura analítica.

## Custos

| Bando, incluindo o anel | M1.1 anterior | M1.1 polido |
| --- | ---: | ---: |
| Triângulos | 1188 | **2754** (corpos 1434, canelas e pés 592, braços 400, coxas 96, sombras 168, anel 64) |
| Meshes / draw calls do bando | 7 | 9 (4 corpos e 4 instanciados, mais o anel) |
| Geometrias / materiais | 7 / 2 | 9 / 3 (figuras, sombras, anel) |

Sem geometria nova por quadro de pose: as matrizes das instâncias reescrevem-se nos mesmos buffers (teste unitário e `e2e-campaign-party-render`). A troca de mundo continua a libertar tudo. As sombras não usam textura, por isso não há nada extra a libertar.

## Avaliação

**Evidência** em `production/qa/evidence/m1-warband/m1.1-polido/`:

| Folha | Conteúdo |
| --- | --- |
| `aproximado-dpr2.png` | zoom 4, DPR 2, escala nativa |
| `orientacoes-dpr2.png` | quatro orientações a 1280×800 e 844×390, zoom 2,2 |
| `normal-sem-anel.png` · `normal-com-anel.png` | vista normal nas quatro resoluções, ampliada 3× bicúbica |
| `afastado-sem-anel.png` | zoom 0,8 |
| `marcha-viriato.png` | quadros consecutivos de Viriato a marchar |
| `sombras-terreno.png` | sombras em erva, areia, encosta e crista |
| `marcha-polida.mp4` | quatro direções, M1.1 anterior ao lado do polido, tempo real e câmara lenta ×4 |

O vídeo usa quadros determinísticos a 60 fps, a DPR 2, sem ampliação.

**Já não parecem primitivas coladas.** No zoom aproximado, cada homem é uma silhueta única e arredondada, com cabeça, ombros, cintura, pernas com joelho e braços. Os escudos são discos limpos e as lanças finas.

**Vista normal:**
- A 1440, 1280 e 1024, os quatro homens continuam separados e Viriato continua claro à frente. As figuras têm um pouco menos de massa escura (22×26 px contra 25×27 a 1440×900), mas leem-se mais como pessoas.
- A 844×390 o bando tem 12×14 px. É o limite de resolução aceite no compromisso A.

**Sombras:**
- Seguem a inclinação: o teste unitário compara a normal do disco com a do terreno.
- Ficam ao lado de cada homem, do lado oposto à luz.
- Não são discos pretos: são manchas suaves que somem para a borda.
- Na areia clara notam-se mais do que na erva.

**Limitações conhecidas:**
- **A marcha continua a ser um salto de 300 ms por dia.** Fica para o M2/B3. A passada de cerca de 4 Hz ainda escorrega.
- **O marcador da serra-refúgio** (uma pirâmide cinzenta) fica por baixo do bando na posição inicial da fixture. Pertence ao mapa, não ao bando.
- **Validação pendente:** fluidez numa GPU real e revisão visual independente.

---

# M1.2 — Guerreiros do Blender a partir do corpo Quaternius

Os bonecos procedurais do M1.1 foram substituídos por personagens adaptadas no Blender. A base é a mesma das batalhas:
- o corpo masculino e os cabelos da **Universal Base Characters**;
- as animações **Idle_Loop** e **Walk_Loop** da **Universal Animation Library** (Quaternius, **CC0 1.0**; `assets/CREDITS.md`, secção 5 de `docs/3d-character-pipeline-audit.md`).

Nenhum humano foi criado de raiz e nenhuma peça é gerada no jogo. O procedural do M1.1 só aparece se o GLB não carregar.

Não mudam:
- a simulação, a duração da marcha, a cadência dos dias, as gravações;
- a formação em cunha, a escala proporcional às aldeias;
- a compensação de distância e o compromisso A;
- a seleção e o anel.

## Pipeline (Blender 5.3)

1. **`tools/blender/warband_source.mjs`** junta ao `body.bin` os canais Idle_Loop e Walk_Loop do `anim_ual1.bin`, pelo nome do osso. Só copia dados.
2. **`art/blender/src/guerreiros_build.py`** faz a modelação, com o módulo `bpy` 5.3.0, o mesmo Blender da casa redonda:
   - **corpo:** importa o corpo com os 65 ossos e as duas ações. Reduz o corpo (Decimate simétrico, 12 566 → ~1 100 triângulos) e corta-o nas fronteiras das regiões de cor, para as pintar por face com bordas direitas: pele, túnica, cinto, braçadeiras, faixas das pernas, sapatos;
   - **roupa:** veste uma casca de túnica suavizada (apaga a musculatura de super-herói), uma saia com pregas até meio da coxa, um cinto e um manto de lã. O manto vai por fora do corpo e da túnica (Shrinkwrap «Outside» e alisamento); nos ombros acaba antes do braço e a borda segue em parte o `upperarm`;
   - **cabelos:** os mesmos das batalhas, presos ao osso `Head`, com o mesmo ajuste da franja do `src/rig.js`. Olhos e sobrancelhas ficam;
   - **armas:** lança e caetra (calote com aro, anel pintado e umbo) são desenhadas na pose de repouso (Idle_Loop, fotograma 20) e levadas para a pose de ligação da mão direita e do antebraço esquerdo;
   - **variantes:** quatro malhas, uma por guerreiro, num só material com cores por vértice:
     - Viriato em lã crua clara (túnica e manto), cabelo comprido e barba, lança;
     - A com caetra e lança;
     - B com caetra e cabelo comprido;
     - C com lança.
3. **`tools/blender/export_warband.py`** exporta o esqueleto, as quatro malhas com pele e as duas ações.
4. **`tools/export-map-assets.mjs`** comprime (meshopt, quantização) e escreve o `.glb.js`. `tools/check-map-assets.mjs` verifica a nova secção `characters` de `assets/map/budgets.json`:
   - malhas, triângulos por malha e materiais;
   - pele de 65 ossos;
   - as duas animações, sem texturas.

**Ficheiros:**
- `art/blender/guerreiros.blend` (853 KB, Git LFS);
- `assets/map/models/guerreiros.glb` (325 KB) e `.glb.js` (433 KB), em Git normal.

**Reprodução:** `art/blender/README.md`. Duas corridas dão a mesma geometria e as mesmas animações; só os bytes do exportador podem variar.

## Integração (`party.js`, `overlays.js`, `scene.js`)

- **Carregamento:** `loadWarbandModel()` importa só o `GLTFLoader`, o descodificador meshopt, o `SkeletonUtils` e o `.glb.js`, não o motor de batalha.
  - É chamado quando o mapa é criado e fica em cache para a sessão.
  - As geometrias e o material ficam marcados como partilhados: `disposeGroup` não os liberta com um mundo, mas liberta os esqueletos.
- **Por mundo:** clonam-se quatro esqueletos (`SkeletonUtils.clone`), cada um com a sua malha e o seu `AnimationMixer`.
- **Se o modelo chegar depois do bando:** `useModel` troca as figuras uma vez, dentro do mesmo grupo. `partyBuilds` fica em 1, o anel mantém-se e as figuras simples são libertadas.
- **Marcha:**
  - a Walk_Loop mistura-se com a Idle_Loop pela amplitude que já existia (velocidade apresentada);
  - a fase segue a distância apresentada, cerca de 1,25 ciclos por dia de marcha, como no M1.1;
  - os braços da lança e da caetra mantêm a pega do Idle (fotograma 20). A lança não balança como um pêndulo; o braço livre balança;
  - em repouso cada homem tem um fotograma de Idle diferente.
- **Repouso estático:** o Idle não corre sozinho. O mapa só desenha quando há mudanças e não quero pô-lo a desenhar 60 vezes por segundo por causa da respiração.
- **Igual ao M1.1:** rotação progressiva, alturas pelo terreno, sombras de contacto, escala de distância e anel.

## Custos

| Bando, incluindo sombras e anel | M0 (peão) | M1.1 procedural | **M1.2 Blender** |
| --- | ---: | ---: | ---: |
| Triângulos | — | 2 754 | **14 792** (3 247–3 886 por guerreiro) |
| Draw calls do bando | 2 | 9 | **6** |
| Draw calls da vista inicial (fixture do E2E) | 51 | 58 | **55** |
| Triângulos da cena (a vegetação tem ~120 mil) | — | 123 mil | 135 mil (+10 %) |
| Materiais / geometrias por mundo | 2 / 2 | 3 / 9 | 3 / 6 (4 partilhadas na sessão) |
| Pose (CPU, SwiftShader) | — | 0,06 ms | 0,19–0,25 ms (4 misturadores, 65 ossos) |
| Memória | — | geometria por mundo | 425 KB de geometria e 47 KB de animação, uma vez por sessão; ~6 KB de textura de ossos por homem e por mundo |
| Ficheiros | — | — | GLB 325 KB (.glb.js 433 KB), .blend 853 KB (LFS) |

**Triângulos por peça (Viriato):** corpo 1 668, túnica 395, saia 176, cinto 40, manto 252, cabelos 248 + 639 + 258, olhos 92, sobrancelhas 78, lança 40. A caetra, nos outros, tem 296.

**Orçamento.** O antigo limite de 3 000 triângulos era para primitivas. Com personagens com pele, o novo teto é 4 500 por guerreiro (`budgets.json`). Justifica-se porque:
- a cena continua dominada pela vegetação;
- o bando desce de 9 para 6 draw calls;
- a geometria carrega-se uma vez por sessão.

**Sem LOD.** Um segundo conjunto de malhas com pele custaria memória e criaria uma troca visível, para poupar cerca de 10 % de triângulos numa cena barata. Não há ganho medível.

**Garantias:**
- Sem geometria nova por quadro de pose:
  - o teste unitário cobre recursos iguais depois das poses;
  - `e2e-campaign-party-render` cobre zero buffers criados ou libertados nos quadros só de pose, com o modelo já carregado.
- Um mundo novo constrói o bando diretamente do modelo.

## Avaliação visual

Evidência em `production/qa/evidence/m1-warband/m1.2-blender/`:

| Ficheiro | Conteúdo |
| --- | --- |
| `aproximado-dpr2.png` | zoom 4, DPR 2, escala nativa |
| `medio-sem-anel.png` | zoom 2,2 nas quatro resoluções |
| `normal-sem-anel.png` · `normal-com-anel.png` | vista normal, ampliada 3× bicúbica |
| `afastado-sem-anel.png` | zoom 0,8 |
| `orientacoes-dpr2.png` | quatro direções a 1280×800 e 844×390 |
| `viriato-de-perto.png` | Viriato com a iluminação do mapa, de frente e de costas |
| `marcha-de-perto.mp4` | Viriato e um companheiro a marchar pelo próprio `party.js` |
| `marcha-4-direcoes.mp4` | M1.1 e M1.2 lado a lado, quatro direções, tempo real e câmara lenta ×4 |
| `after/` | capturas do E2E nas quatro resoluções: normal, sem etiqueta, selecionado, afastado, aproximado, marchas e PT-PT |
| `metrics.json` | métricas |

**Zoom aproximado e médio:** a versão Blender é claramente superior. São pessoas com proporções naturais, túnica com volume, saia, cinto, braçadeiras, faixas nas pernas, manto, cabelos e barbas. A caetra tem aro, anel e umbo; a lança tem folha. O procedural lê-se como bonecos atarracados.

**Animação:** é a Walk_Loop da UAL, com joelhos, ancas e braço livre. As armas mantêm a pega e a rotação é progressiva. O salto de 300 ms por dia continua (M2/B3).

**Vista normal (1440, 1280, 1024):** legibilidade equivalente à do M1.1. Quatro homens separados e Viriato claro à frente, de qualquer lado. O grupo tem um pouco menos de massa escura: braços nus e caetras ocre clareiam figuras que o M1.1 tapava com o manto.

**844×390:** mantém-se o compromisso A (anel e etiqueta).

**Defeitos que ficam, à escala de retrato:**
- o rosto Quaternius reduzido é simples;
- as mãos são em bloco;
- os mantos são superfícies de uma face, com o material desenhado dos dois lados;
- a gola da túnica dos companheiros tem pequenas irregularidades.

Nada disto se vê à escala do mapa. O Idle fica parado, para não obrigar o mapa a desenhar continuamente.

**Veredito: GO visual.** Fica pendente a revisão visual independente e a confirmação de fluidez numa GPU real (as medições foram feitas em SwiftShader).
