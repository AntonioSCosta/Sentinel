# M2.1b — Câmara imersiva experimental

Sirva a raiz do repositório com `python -m http.server 8000` e abra `http://localhost:8000/tactical-proto.html?camera=experimental`. Use **Iniciar** para ver a coluna em marcha, dê o **Sinal** e alterne entre perspetivas enquanto a batalha corre. A página normal do M1.2 e a arena aberta pela campanha continuam com a vista estratégica original.

## Controlos

| Ação | Controlo |
| --- | --- |
| Alternar entre a vista estratégica e a vista ao nível dos soldados | `C` ou os botões **Estratégica** e **Imersiva** |
| Seguir uma formação lusitana ou romana | Escolher o grupo no seletor e usar **Seguir** ou `G`. A opção **Grupo selecionado** usa a seleção tática atual. |
| Retomar o comando no terreno | `Escape` ou **Estratégica**. A vista recupera o enquadramento anterior. |
| Olhar ou rodar em torno do grupo seguido | Arrastar com o botão esquerdo. `Q`/`E` ou setas esquerda/direita para rodar, setas cima/baixo para inclinar. |
| Deslocar a câmara imersiva | `WASD` ou arrastar com o botão direito ou do meio. |
| Aproximar ou afastar | Roda do rato. No seguimento, a roda ajusta a distância ao grupo. |
| Alterar a velocidade da batalha | `F` ou os botões de velocidade originais. |

Em modo próximo, os gestos sobre o terreno controlam a câmara. Os botões e atalhos explícitos de ordens continuam disponíveis. Durante a transição de regresso, o clique no terreno fica reservado até a projeção estratégica estar reposta. Quando a formação seguida sai de campo, a câmara regressa à vista estratégica. A preferência de movimento reduzido elimina as transições entre perspetivas e mantém o acompanhamento suave da formação.

## Integração e limites

A câmara reutiliza o `PerspectiveCamera`, a cena Three.js e os grupos que a vista já recebe. Usa a posição e a orientação da formação, a altura visual do terreno e o adversário visível quando há contacto. O módulo só lê esses dados. O código dos soldados, o ciclo da simulação, o M3.1 e o motor antigo mantêm os respetivos percursos. [Controlador da câmara](../../src/tactical/proto/camera-rig.js) · [Controlos experimentais](../../src/tactical/proto/camera-experiment.js)

O protótipo conserva o observador acima do terreno. Árvores, pedras e soldados podem ocultar temporariamente o combate. Pode rodar a câmara ou ajustar a distância nessa situação. As figuras e as animações atuais foram concebidas para leitura à distância e mostram as suas limitações de perto. Este protótipo usa as figuras M1.2 existentes.

## Validação

```sh
npm ci
npm test
npm run smoke
node tools/check-map-assets.mjs
CHROME_PATH=/usr/bin/chromium PLAYWRIGHT_DIR=/caminho/para/playwright \
  node tools/e2e-tactical-camera.mjs /tmp/sentinel-camera
```

O E2E repete a mesma semente e sequência de ordens com e sem o modo experimental. Compara o passo final, o desfecho, o registo de ordens e todo o estado final dos grupos. Exercita marcha romana, combate e retirada lusitana, recuperação das ordens no terreno, `F`, `Escape`, 1280 × 720, 640 × 480, inglês e PT-PT. [Teste Chromium](../../tools/e2e-tactical-camera.mjs)

## Capturas e desempenho

As três capturas mostram a mesma batalha no passo 340 (0:34), com a semente `83026358`. A simulação ficou pausada durante a comparação e a câmara continuou a atualizar-se. [Estratégica](../../production/qa/evidence/camara-m2-1b/01-strategic.jpg) · [Seguimento](../../production/qa/evidence/camara-m2-1b/02-following.jpg) · [Imersiva](../../production/qa/evidence/camara-m2-1b/03-immersive.jpg)

| Perspetiva | Mediana do intervalo entre fotogramas | P95 | Chamadas de desenho | Triângulos |
| --- | ---: | ---: | ---: | ---: |
| Estratégica | 250,0 ms | 283,4 ms | 27 | 107 872 |
| Seguimento | 283,4 ms | 350,1 ms | 26 | 107 776 |
| Imersiva | 316,6 ms | 383,3 ms | 28 | 108 102 |

O Chromium 156 em modo headless usou SwiftShader a 1280 × 720. São 30 intervalos de `requestAnimationFrame` por vista. O número de triângulos variou pouco e as vistas próximas apresentaram intervalos maiores nesta amostra. A amostra serve para comparar as três vistas neste ambiente. A avaliação em GPU física fica por fazer. [Dados brutos](../../production/qa/evidence/camara-m2-1b/measurement.json)
