# M2 — Linguagem visual das tropas

Estudo e demonstração isolada. Não altera a simulação, a reação romana, a campanha, as gravações nem o
protótipo jogável. Nada foi integrado no jogo e nada foi commitado.

Data: 2026-11-23 · Base: `main` (c975bc7) · Demonstração: `tactical-visual.html`

## Resumo

O problema das tropas não é custo — o protótipo desenha todos os soldados com quatro geometrias e ~240
triângulos por homem. É **leitura**: os escudos são planos verticais vistos quase de perfil pela câmara
tática, as quatro silhuetas têm a mesma altura e postura, a frente de um grupo não se vê, e a animação
mexe o corpo inteiro em vez de mostrar passada, guarda ou golpe.

Recomendo a **opção C (híbrida)**: um kit articulado simples, equipamento que identifica cada facção e
uma gramática de formação própria, tudo instanciado. Na demonstração, 36 soldados custam **38 draw calls
e 22,3 mil triângulos** em C, contra **283 draw calls** na opção B com a mesma animação e praticamente o
mesmo aspecto à distância tática.

A opção B (personagens low-poly com animações próprias) é a de maior qualidade de perto, mas no Three.js
padrão não se instanciam malhas com skinning: o custo cresce por soldado e, com dezenas de grupos, passa
a ser o limitador. Só a recomendo se houver orçamento de arte e um passo extra de batching por shader.

---

## 1. Auditoria da representação atual

Ficheiros: `src/tactical/proto/view.js` (desenho), `src/tactical/proto/main.js` (etiquetas), 
`src/tactical/combat.js` e `src/tactical/data.js` (raio e espaçamento). As etiquetas e os anéis são
interface: ficam de fora do julgamento das silhuetas, mas entram na legibilidade do conjunto.

### 1.1 Como está construído

- **Quatro modelos fundidos**, um por papel (`soldierGeometry`, `view.js:47`), feitos de 5–8 primitivas
  com cores assadas nos vértices e ~240 triângulos por homem. Cada papel é um `InstancedMesh` separado
  para vivos, mortos e silhueta «raio-X» (`view.js:239`).
- **Figuras ampliadas 1,45×** (`FIG`, `view.js:8`) e espaçadas 1,25 m (`SPACING`, `view.js:9`). A altura
  efetiva ronda 2,1 m — já é uma licença estilística, não uma escala realista.
- **Bloco único para todos**: `slots()` (`view.js:270`) distribui qualquer grupo num bloco centrado,
  `cols = ceil(sqrt(n · 1,6))`, sem filas, sem frente definida e sem lugares por papel. Com 4 homens dá
  3 + 1; com 5 dá 3 + 2.
- **Anel por grupo** (`view.js:255`), raio `radius(men) · 1,15 + 0,9` — ~2,7 m para 4 homens —, maior do
  que o próprio bloco.
- **Animação**: subida/descida do corpo inteiro ao andar (0,14 m), um avanço em combate (0,35 m) e a
  queda dos mortos (`view.js:424`). Carga acrescenta uma nuvem de pó e abanão de câmara.
- **Estandartes ausentes**, tal como o pelt de lobo dos vélites e a funda legível dos fundeiros.

### 1.2 O que se lê, papel a papel

| Alvo | O que o modelo faz | O que se vê a 65–110 m |
| --- | --- | --- |
| **Guerreiro lusitano** | Túnica clara, cabelo escuro, disco de 0,58 m ao peito, espada curta | Uma figura clara; o disco desaparece de perfil. Não se distingue de um vélite pela silhueta |
| **Fundeiro** | Túnica castanha, cajado de 0,5 m e pedra de 0,07 m | Nada: a funda é mais fina do que um pixel. Só a etiqueta «Slingers» o identifica |
| **Legionário** | Túnica vermelha, elmo bronze, placa de escudo vertical de 0,07 m de espessura | Uma figura vermelha; o escudo é uma linha de 1–2 px. Vermelho é o único sinal fiável |
| **Vélite** | Túnica vermelho-tijolo, elmo bronze, disco de 0,6 m | Quase igual ao legionário: mesma altura, mesma cor, sem pelt nem dardos visíveis |
| **Formação** | Bloco centrado de 1,25 m, igual para todos os papéis | Uma mancha; não se vê frente, filas, profundidade nem estandarte |
| **Orientação** | Cada homem roda para onde anda; em combate roda para o alvo | A frente desaparece: corpos simétricos, escudos de perfil, sem sinal no chão |
| **Marcha** | Balanço vertical + translação | Passada não se vê a 65 m; o grupo parece deslizar |
| **Carga** | O mesmo balanço, mais pó | Lê-se pelo pó e pelo som, não pelos corpos |
| **Combate** | Avanço de 0,35 m com seno, por homem | Um enxame que se comprime; não se vê guarda, golpe nem choque de escudos |
| **Recuo** | A mesma marcha, ao contrário | Não se distingue de marcha |
| **Debandada** | O mesmo balanço, mais depressa | Lê-se pela velocidade e pelo anel, não pela postura |
| **Vários grupos juntos** | Anéis de 2,7 m por grupo, soldados sem colisão | Os anéis sobrepõem-se, os soldados interpenetram-se, as etiquetas fazem o trabalho todo |

### 1.3 As duas causas principais

**1. Os escudos estão de perfil para a câmara.** O escudo do legionário é uma caixa de 0,07 m de
espessura (`view.js:52`); o do guerreiro e o do vélite são discos verticais virados para +X
(`view.js:56`). A câmara tática olha de cima com `pitch 0.95` (~54°). A área projetada de um plano
vertical virado para a frente, vista desta altura, é uma faixa de poucos centímetros: o equipamento que
mais deveria identificar a facção é o que menos se vê. O mesmo vale para a placa do elmo e para a funda.

**2. Todos os grupos são o mesmo bloco, virados para o mesmo tipo de frente invisível.** Não há filas,
intervalos, lugares de especialista, estandarte, nem desordem própria de quem embosca. O anel —
interface — é o único objecto com forma estável por facção. Isto explica porque as etiquetas parecem
necessárias: estão a substituir uma representação que não carrega a informação.

### 1.4 Números da representação atual

| Medida | Valor |
| --- | --- |
| Triângulos por soldado | ~241 (mistura de papéis da demonstração) |
| Draw calls de tropa | 5 (4 papéis instanciados + 1 anel instanciado) |
| Altura efetiva da figura | ~2,1 m (1,45 × modelo de ~1,45 m) |
| Altura no ecrã a 110 m / 900 px | ~25 px |
| Altura no ecrã a 65 m / 900 px | ~42 px |
| Raio do anel, 4 homens | ~2,7 m |
| Bloco de 5 homens | 3 filas × 2, ~3,75 × 2,5 m |

A 25 px só se lê a massa de cor e o anel. A 42 px já se distingue vermelho de claro, mas não um vélite
um legionário, nem um fundeiro de um guerreiro.

### 1.5 Recursos disponíveis

- **`assets/chars/`** — corpo CC0 Quaternius (`body.glb.js`, 14 318 triângulos, 3 primitivas) e 20
  clipes CC0 (`anim_ual1` e `anim_ual2`: andar, correr, esgrima, escudo, arremesso, morte). O jogo
  antigo já os usa. São a opção mais barata para B, mas são corpos de close-up, sem LOD e sem o
  equipamento desta época.
- **Texturas repintadas** `body_roman_red/white/mail`, `body_velite`, `body_lusitano_*` — reutilizáveis
  em B, não necessárias em C.
- **Três.js 0.160 vendorizado**, `InstancedMesh`, sombras e tone mapping já usados no protótipo.
- **Licenças**: Quaternius e KayKit CC0; Poly Haven CC0. Nada proprietário foi copiado. A demonstração
  não usa nenhum destes assets: é toda processual.

---

## 2. Três abordagens

### A — Melhorar o que existe, com geometria simples e animação processual

Manter o corpo fundido por papel, mas: escudos maiores e **inclinados 15–25° para cima** para a câmara
os ver, silhuetas com elmo/crista e manto, armas compridas, cores por facção mais separadas, um
estandarte e formação com filas. A animação continua a ser de corpo inteiro (inclinação, balanço,
investida).

- **A favor**: barato, zero pipeline de arte, cabe no orçamento actual (5 draw calls), determinístico.
- **Contra**: sem articulação não há passada, guarda nem golpe; a 26 px a diferença entre papéis
  continua a ser sobretudo a cor. É um bom plano B se não houver tempo.

### B — Personagens low-poly estilizadas, com animações próprias

Modelos autorais (ou os CC0 Quaternius) com esqueleto, 5–7 clipes por papel, LOD e textura atlas.

- **B1 — reutilizar os CC0 Quaternius**: 14 318 triângulos e 3 draw calls por soldado. 36 homens =
  108 chamadas e 515 mil triângulos; 200 homens = 600 chamadas e 2,9 milhões de triângulos. Produção
  mais barata, direcção de arte difícil de unificar (é um corpo de close-up, não uma silhueta tática).
- **B2 — modelos feitos para o jogo**: 1–2 mil triângulos, 8–10 peças, uma material. No Three.js
  padrão, um `SkinnedMesh` não se instancia: cada soldado é um conjunto de malhas. A demonstração usa
  esta via (990 triângulos e 7,9 peças por homem) e mede **283 draw calls para 36 soldados**.

- **A favor**: a melhor leitura de perto, animações autorais (carga, golpe, queda), caminho natural
  para o combate corpo a corpo e para o marketing.
- **Contra**: 4–6 semanas de arte e animação; sem GPU skinning/batching próprio, o custo por soldado
  não escala para dezenas de grupos; exige LODs e testes de browser.

### C — Híbrido: personagens simples, equipamento reconhecível, formações expressivas

O mesmo esqueleto articulado de B, mas com peças geométricas baratas e **equipamento que se lê de
cima**: escudo oval grande e claro para Roma, caetra redonda escura para a Lusitânia, crista vermelha,
pelt de lobo no signífero, signum, manto, lança e cajado de funda. As formações têm gramática própria
(filas romanas, meia-lua lusitana, fundeiros atrás, vélites à frente). A animação é processual, com
estados e fase por papel.

- **A favor**: 38 draw calls e 22,3 mil triângulos para os mesmos 36 soldados; draw calls fixos por
  tipo (não por soldado); aspecto a 40–65 m muito próximo de B; zero assets externos; tudo o que o
  Three.js já garante (InstancedMesh + materiais standard + sombras).
- **Contra**: exige trabalho de direcção de arte nas proporções e na paleta; a animação processual
  tem de ser bem afinada para não parecer «bonecos a marchar»; os clipes autorais de B continuam a ser
  necessários se se quiser combate corpo a corpo de close-up no futuro.

### Comparação

| Critério | A | B | C |
| --- | --- | --- | --- |
| Legibilidade a 65–110 m | 3/5 — escudos e cor, sem papéis | 4/5 | **5/5** — silhueta + equipamento + formação |
| Qualidade visual de perto | 2/5 | **5/5** | 4/5 |
| Trabalho de produção | 3–5 dias | 25–35 dias (B2) | **10–15 dias** |
| Animações necessárias | 5 curvas de corpo inteiro | ~8 fatos × 6 clipes ≈ 48 + transições | 5 estados × 5 papéis, processual |
| Custo de renderização (36 homens) | 5 chamadas · 11,8k tris | 283 chamadas · 35,7k tris | **38 chamadas · 22,3k tris** |
| Custo a 200 homens | 5 chamadas · 66k tris | ~1 570 chamadas · 198k tris | **38 chamadas · 124k tris** |
| Compatibilidade Three.js | total | exige clones ou GPU skinning próprio | **total, sem shaders novos** |
| Escalabilidade para dezenas de grupos | alta, mas visual pobre | baixa no Three.js padrão | **alta** |
| Dependência de arte externa | nenhuma | alta | nenhuma (processual) |
| Risco | baixo | alto | médio-baixo |

---

## 3. Recomendação

**C, com o equipamento e a formação a fazerem o trabalho que hoje está nas etiquetas.** A e B ficam
como alternativas de orçamento e de qualidade, respectivamente. A recomendação tem seis regras de
direcção de arte:

1. **Duas silhuetas, não duas cores.** Roma: massa horizontal de escudos ovais claros, cristas
   vermelhas alinhadas, signum alto. Lusitânia: meia-lua irregular de escudos redondos escuros, mantos,
   lanças em ângulos vários, fundeiros sem escudo atrás. A cor reforça; a forma decide.
2. **Inclinar os escudos 15–25° para cima.** É a correcção de leitura mais barata do estudo: o mesmo
   escudo passa de uma linha de 1–2 px a uma oval legível, sem custo de geometria.
3. **Ampliar o que identifica, não o corpo.** Altura ~2,1 m (como o protótipo), escudos 10–15% maiores
   do que a história, cristas e signum exagerados. O realismo de proporções não é o objectivo.
4. **Formação com gramática.** Romanos: 3 filas × 5, 0,95 m entre homens, 1,15 m entre filas, escudos
   alinhados, signífero atrás, vélites à frente. Lusitanos: meia-lua de 8, segunda fila de 6, fundeiros
   atrás; offsets por homem para parecer um bando e não um bloco.
5. **Animação com dois regimes.** Roma: fase travada entre homens (coesão), passada curta, escudo
   erguido, pilum ombro-a-ombro. Lusitânia: fases diferentes por homem (enxame), passada mais larga,
   lança em ângulos vários, fundeiros a girar a funda. Em combate, a formação romana mantém a linha e a
   lusitana envolve.
6. **A interface não é a tropa.** Anéis, etiquetas, cartões e linhas de ordem continuam a ser HUD.
   Devem servir selecção, perigo e planos — não identificação de facção. Se a facção só se lê pelo
   anel, a representação falhou.

**Inspiração histórica, não reconstituição.** Para 147 a.C.: escudo oval (não o retangular imperial),
elmo Montefortino, cota de malha, pilum e gladius; Políbio descreve cristas que faziam o soldado
parecer mais alto — é a licença que sustenta a crista em todos os legionários. Do lado lusitano: caetra
redonda, túnica de lã, manto, lança, falcata para o chefe, funda para os fundeiros. Tudo estilizado.

**Paleta.** Roma: vermelho de garança `#9c2c26`, malha `#8f938d`, escudo osso `#d8cdad`, bronze
`#b28a48`. Lusitânia: oliva `#6f6b44`, manto `#46543a`, madeira `#5c3d22`, bronze `#a8793f`. O
contraste de valor (escudo claro vs escuro) é o sinal principal; o par vermelho/verde é secundário, para
não depender de percepção de cor.

**O que evitar.** Realismo fotográfico; misturar os corpos CC0 de close-up com a geometria tática sem
uma passagem de arte; modelos ou animações de outros jogos; identificar facções com etiquetas ou com
anéis de equipa.

---

## 4. Prova visual

### 4.1 Como abrir

```sh
python -m http.server 8000     # na raiz do repositório
# http://localhost:8000/tactical-visual.html
```

A página é isolada: não importa a simulação, não lê o estado da campanha, não altera o protótipo.
Contém duas formações fixas com 36 soldados (18 romanos: 15 legionários, 1 signífero, 2 vélites;
18 lusitanos: 14 guerreiros, 4 fundeiros), o mesmo espaço e as mesmas posições nas quatro
representações.

Controlos: **1–4** representações (M1.2, A, B, C) · **Q/W/E** distâncias (40 / 65 / 110 m) · **Space**
pausa · arrastar orbita · roda aproxima. Os botões de estado (March, Charge, Melee, Withdraw, Rout)
mudam a animação e a distância entre os grupos.

A representação C está activa por omissão. O painel inferior mostra, em tempo real: draw calls e
triângulos da tropa, triângulos por homem, altura do soldado no ecrã e o total do renderer. A tabela
compara as quatro representações para os mesmos 36 homens.

### 4.2 O que comparar

1. **A 110 m (tecla E)**: só devem restar a massa de escudos, a crista e o signum de um lado; a
   meia-lua escura e as lanças do outro. Se for preciso ler a etiqueta, a representação falha.
2. **A 65 m (W)**: vélites à frente dos legionários, fundeiros atrás dos guerreiros, signífero com pelt
   e signum. Comparar com B (3) e A (2).
3. **A 40 m (Q) e a 28 m (roda)**: equipamento e articulação; a 28 m vê-se a crista, o pelt, a caetra e
   o cajado de funda.
4. **Melee**: a linha romana mantém-se; a lusitana envolve. Comparar a leitura do choque com a
   representação M1.2, onde só o pó e os anéis contam.
5. **M1.2** (tecla 1): os dez anéis de squad sobrepõem-se e tapam os próprios soldados — é o
   diagnóstico, não uma proposta.

### 4.3 Medições

36 soldados, 1440×900, sombras ligadas, GPU cloud (não representativa de hardware real):

| Representação | Draw calls (tropa) | Triângulos (tropa) | Tris/homem | Total do renderer | Altura a 65 m |
| --- | ---: | ---: | ---: | ---: | ---: |
| M1.2 actual | 5 | 8 688 | 241 | 10 chamadas · 51,9k | 42 px |
| A — geometria simples | 5 | 11 840 | 329 | 9 · 53,5k | 41 px |
| B — low-poly articulado | 283 | 35 655 | 990 | 287 · 77,3k | 44 px |
| **C — híbrido** | **38** | **22 347** | **621** | **42 · 64,0k** | **44 px** |

O total do renderer inclui o chão (≈45 mil triângulos), relva, pedras e pó. A altura no ecrã é a de um
soldado de 2,18 m: ~102 px a 28 m, 71 px a 40 m, 44 px a 65 m, 26 px a 110 m (900 px de altura de
ecrã). A 110 m, a diferença entre papéis tem de vir da silhueta e do equipamento, não do detalhe.

Capturas em `production/qa/evidence/tactical-proto-m2/`:

| Ficheiro | O que mostra |
| --- | --- |
| `01-m1-65m.png` | Actual: anéis de squad a sobrepor-se, soldados quase invisíveis |
| `02-a-65m.png` | A: massa de escudos, mas corpos sem articulação |
| `03-b-65m.png` | B: articulado, 283 draw calls |
| `04-c-65m.png` | C: a proposta, mesma distância |
| `05-c-40m.png` | C a 40 m: vélites, signífero, fundeiros |
| `06-c-110m.png` | C a 110 m: só massa, crista e signum |
| `07-c-melee-40m.png` | C em combate |
| `08-b-melee-40m.png` | B em combate, para comparar |
| `09-c-detail-28m.png` | C de perto: equipamento e silhuetas |
| `10-c-charge-40m.png` | C em carga |

### 4.4 Limitações da demonstração

- **Locomoção no sítio**: os grupos avançam/recuam apenas alguns metros por estado, para manter o
  enquadramento comparável; não há caminhos nem colisões.
- **B não é um teste de skinning**: usa o mesmo esqueleto processual de C, com uma malha por peça, para
  isolar o custo de draw calls. Um B real com `SkinnedMesh`/`AnimationMixer` teria de ser medido à parte.
- **Terreno plano e sem floresta**: não reproduz a oclusão das copas que o `view.js` compensa com a
  silhueta «raio-X».
- **Sem LOD**: todas as distâncias desenham a mesma geometria; o ganho de LOD é estimado, não medido.
- **Sem interface de jogo**: sem etiquetas, cartões, linhas de ordem, seleção ou resultados. É
  deliberado: o objectivo é julgar os soldados.
- **Tempos de frame** (0,7–8 ms no browser cloud) não servem como medição de desempenho; a comparação
  válida é draw calls e triângulos. Uma medição em PC/browser real é o passo M2.7.
- **Escala da demonstração**: 36 soldados em duas formações grandes; o jogo usa grupos de 3–5 homens.
  A 36 homens a demonstração é, na prática, o caso de quatro a cinco grupos do protótipo juntos, e é
  também o caso em que a falta de linguagem mais se nota.

---

## 5. Orçamento técnico aproximado

### 5.1 Por representação (36 soldados)

| | M1.2 | A | B (B2) | C |
| --- | ---: | ---: | ---: | ---: |
| Draw calls de tropa | 5 | 5 | 283 | 38 |
| Triângulos de tropa | 8,7k | 11,8k | 35,7k | 22,3k |
| Triângulos/homem | 241 | 329 | 990 | 621 |
| Geometria em GPU | <0,2 MB | <0,3 MB | <0,4 MB | <0,3 MB |
| Matrizes/instâncias | 36 | 36 | 0 | ~360 |
| Texturas de tropa | 0 | 0 | 0 (vertex colour) | 0 |
| Clipes de animação | 0 | 0 | ~48 (produção) | 0 |
| Custo de CPU por frame | trivial | trivial | 36 × ~8 matrizes + draw setup | 36 × ~10 matrizes |

A geometria é partilhada por kit: aumentar o número de soldados não aumenta a memória de geometria em C,
só as matrizes de instância.

### 5.2 Projecção para dezenas de grupos

Cenário: 40 grupos × 5 homens = 200 soldados, os mesmos cinco papéis.

| | A | B (B2) | C |
| --- | ---: | ---: | ---: |
| Draw calls | 5 | ~1 570 | **38** |
| Triângulos | 66k | 198k | 124k |
| VRAM de geometria | <0,3 MB | <0,4 MB | <0,3 MB |
| Limite prático | GPU | CPU/driver | GPU |

B acrescenta ~7,9 draw calls por soldado (medido); C mantém as chamadas por *tipo* de fato e peça, não
por soldado. A partir de ~150 soldados, B no Three.js padrão deixa de caber confortavelmente num frame
de browser; C continua dentro do orçamento.

**Orçamento proposto para a representação final (200 soldados, 1080p, 60 fps):**

- ≤ 60 draw calls de tropa e ≤ 150 mil triângulos de tropa.
- ≤ 2 MB de geometria de tropa e nenhuma textura dedicada (vertex colour).
- LOD1 a partir de ~90 m: corpo + escudo + cabeça (4 peças), ~35% dos triângulos; LOD2 a partir de
  ~150 m: silhueta de duas peças ou impostor. Com LOD, 200 soldados a 110 m ficam abaixo de 50 mil
  triângulos.
- Sombras: manter o mapa de 2048 do protótipo e limitar os casters ao LOD0; medir o passe em M2.7.
- Browser: WebGL2, sem shaders personalizados, sem texturas de tropa — o mesmo caminho do protótipo.
- PC: margem para 300–400 soldados antes de precisar de LOD2.

### 5.3 Trabalho de produção estimado

| | A | B (B1 CC0) | B (B2 autoral) | C |
| --- | ---: | ---: | ---: | ---: |
| Dias de trabalho | 3–5 | 12–18 | 25–35 | **10–15** |
| Arte externa | 0 | 0 (reutiliza CC0) | modelação + rig + animação | 0 (processual) |
| Risco de incoerência | baixo | alto | médio | baixo |

C não precisa de assets: os kits são geometria processual e a animação é código. É a razão principal
para o recomendar nesta fase — permite decidir a direcção de arte antes de gastar em modelação.

---

## 6. Plano incremental para a representação final

Cada passo é independente da simulação e do equilíbrio. Nenhum altera `sim.js`, `combat.js`, `data.js`,
`roman-stub.js`, a campanha ou as gravações.

### M2.1 — Fundação (2–3 dias)

- Adaptar de `src/tactical/visual/` para o protótipo: `troops.js` (kits, esqueleto, pose), `palette.js`,
  `formation.js` (descritor de formação: filas, ficheiros, frente, lugares por papel).
- `view.js` passa a usar o descritor em vez de `slots()`; o comportamento de jogo não muda.
- Instanciar por (papel, peça) com o mesmo esquema de C.
- **Aceitação**: mesmos resultados de simulação (robôs, 20 sementes); ~5 draw calls por papel;
  `window.__proto.info()` expõe chamadas/triângulos.

### M2.2 — Identidade romana (2–3 dias)

- Escudo oval inclinado, crista, malha, pilum, signífero com pelt e signum, vélites à frente com parma.
- Filas alinhadas e signum como âncora de leitura.
- **Aceitação**: a 110 m, um grupo romano é identificável sem etiqueta; captura em três distâncias.

### M2.3 — Identidade lusitana (2–3 dias)

- Caetra escura, manto, lança, fundeiros sem escudo com cajado, meia-lua e segunda fila.
- Chefe com falcata e manto mais escuro (opcional, decidir no playtest).
- **Aceitação**: a 110 m, romanos e lusitanos distinguem-se por silhueta e valor, não por cor.

### M2.4 — Animação (3–4 dias)

- Cinco estados (marcha, carga, combate, recuo, debandada) com fase travada nos romanos e livre nos
  lusitanos; variantes por papel; transições de 0,2–0,3 s.
- Pó apenas em carga/combate/debandada; sem partículas novas por soldado.
- **Aceitação**: cada estado reconhecível numa captura parada; sem picos de CPU acima de 0,5 ms para 60
  soldados.

### M2.5 — Distância e LOD (2 dias)

- LOD1/LOD2 por distância de câmara; material e cores iguais; nada de texturas.
- Teste de daltonismo (protanopia/deuteranopia) sobre as capturas.
- **Aceitação**: 200 soldados ≤ 60 draw calls e ≤ 150 mil triângulos; 110 m com LOD abaixo de 50 mil.

### M2.6 — Concentração de grupos (2 dias)

- Separação mínima entre grupos em combate (ou offsets de apresentação) para os soldados não se
  interpenetrarem.
- Política de HUD: anéis só para seleção/perigo; etiquetas compactas; sem anel de equipa.
- **Aceitação**: cinco grupos em contacto continuam legíveis numa captura e em movimento.

### M2.7 — Integração e QA (2–3 dias)

- Ligar ao protótipo por trás de uma flag (`?troops=c`), mantendo A e M1 para comparação.
- `tools/e2e-tactical-visual.mjs`: abre a página, mede as três distâncias, verifica orçamentos e guarda
  capturas; baseline de desempenho em PC e browser.
- Playtest focado: «distingues as facções sem ler?» e «vês a formação e o estado?».
- **Aceitação**: revisão do maintainer; só depois integrar e abrir PR.

Total estimado para C: **15–20 dias** de trabalho, com decisão de direcção de arte em M2.1.

---

## 7. Decisões pedidas

1. **Aprovar C como direcção** (ou escolher A por orçamento / B por qualidade).
2. Confirmar a escala estilizada (~2,1 m efetivos, escudos 10–15% maiores) e a crista em todos os
   legionários.
3. Confirmar a paleta e o par de silhuetas (escudo oval claro vs caetra redonda escura).
4. Dizer se o chefe lusitano com falcata entra na primeira passagem ou fica para depois.
5. Só depois disto: integrar no protótipo e medir em hardware real.

## 8. O que não mudou

`src/tactical/sim.js`, `combat.js`, `data.js`, `scenarios.js`, `proto/session.js`, `proto/roman-stub.js`,
`proto/main.js`, `proto/view.js`, `index.html`, a campanha, as gravações e os testes existentes ficaram
intactos. A demonstração vive em ficheiros novos:

- `tactical-visual.html`
- `src/tactical/visual/main.js`, `styles.js`, `models.js`
- `production/qa/evidence/tactical-proto-m2/*.png`
