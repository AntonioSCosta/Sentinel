# Relatório de Melhorias Estruturais do Mapa — Branch `antigravity`

## 1. Contexto & Objetivos
Atendendo ao pedido de evolução séria e fundamentada do mapa de *"Viriato — A Guerra dos Montes Hermínios"*, sem recorrer a elementos aleatórios ou soluções artificiais (*vibe coded*), foi criada e ativada a branch **`antigravity`** a partir da `main`.

---

## 2. Implementações Realizadas

### A. Geometria Fluvial e Fisiografia Tática (`src/terrain.js`)
* **Adição da Ribeira dos Montes Hermínios (`streamX` & `inStream`)**:
  - Modelou-se uma linha de água montanhosa que serpenteia pelo fundo do vale, paralela à estrada romana de terra batida.
  - O perfil do terreno (`rawH`) agora escava organicamente o leito de cascalho/leito rochoso da ribeira sem quebras abruptas na malha de alturas.
  - **Impacto Tático**: A zona ribeirinha é húmida e de cascalho, quebrando a monotonia visual e fornecendo pontos de referência geográficos claros.

### B. Física e Dinâmica de Marcha no Terreno (`src/locomotion.js`)
* **Resistência Mecânica do Leito de Água (`inWater`)**:
  - Quando o jogador ou combatentes atravessam a água ou as margens enlameadas da ribeira, a velocidade de corrida sofre uma penalização natural (fator 0.72x).
  - Legionários e perseguições tornam-se vulneráveis ao cruzamento de água, dando vantagem à infantaria ligeira e guerrilha das montanhas.

### C. Fortificação Histórica do Castro Lusitano (`src/game.js`)
* **Paliçadas de Entrada do Castro**:
  - Dois esteios maciços de carvalho cravados a ladear a porta da muralha de pedra seca, com colisores físicos integrados (`addCol`) para impedir passagens impossíveis e conferir escala humana à entrada.
* **Atalaia / Fogo de Vigia**:
  - Erigido um facho de sinalização militar no cume do Castro, com brazeiro de ferro forjado e iluminação dinâmica suave, refletindo as fogueiras de alarme usadas pelos lusitanos para vigiar a aproximação romana no vale.

### D. Logística Militar e Engenharia Romana (`src/game.js`)
* **Marcos Miliários da Via Romana (*Milliaria*)**:
  - Colocados marcos de pedra cilíndricos a intervalos calculados ao longo da estrada do vale, demonstrando a presença invasora e o avanço da engenharia viária romana.
* **Vala Defensiva e Estacas de Proteção Exterior (*Chevaux-de-frise / Valla*)**:
  - O perímetro exterior do acampamento romano agora possui uma fiada inclinada de estacas aguçadas de madeira com colisão ativa, deixando apenas o portão sul livre para marcha.

### E. Rigor e Cobertura de Testes
* Adicionados testes automatizados em `tests/terrain.test.mjs` e `tests/locomotion.test.mjs` garantindo:
  - Continuidade matemática e curvatura da ribeira.
  - Escavação do leito sem distorções no `rawH`.
  - Resistência e abrandamento realistas na travessia de água.
