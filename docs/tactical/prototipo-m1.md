# Protótipo visual M1 — «A emboscada é divertida?»

Página isolada para avaliar sensação, legibilidade e feedback da emboscada antes de construir T2–T4.
Não faz parte do jogo: não toca na campanha, nas gravações v1 nem no combate antigo.

## Como abrir

- Local: servir a raiz do repositório (por exemplo `npx serve .`) e abrir `tactical-proto.html`.
- Teste automático em Chrome real: `node tools/e2e-tactical-proto.mjs` (capturas em `production/qa/evidence/tactical-proto-m1/`).

## O que usa

- A simulação do T1 (`src/tactical/sim.js`, `combat.js`, `data.js`), sem alterações de regras, mais duas primitivas novas e testadas: `reveal` (um grupo escondido é descoberto) e `alert` (alerta sem desordem).
- `src/tactical/proto/`, tudo provisório:
  - `field.js` — campo desenhado à mão: estrada com curva, seis bosques, um outeiro, ribeiro decorativo, zona de colocação.
  - `roman-stub.js` — reação romana **provisória** (não é a IA do T3): descobre quem está à vista ou mal escondido, alerta a coluna, contra-ataca, avança sobre fundeiros, os vélites escaramuçam, retoma a marcha se ninguém estiver à vista. Determinista; dá ordens pela mesma `command()` dos lusitanos.
  - `session.js` — preparação → batalha → relatório de playtest (texto + JSON, botão «Copy results»).
  - `view.js`, `sfx.js`, `main.js` — Three.js, sons sintetizados, interface (inglês por omissão, português de Portugal disponível).

## Afinação feita no protótipo

Robôs de estratégia em 20 sementes, depois de afinar `data.js` e a coluna (5 legionários + 3 vélites + 5 legionários contra 15 lusitanos):

| Estratégia | Resultado | Baixas lusitanas (média) | Combate |
| --- | --- | --- | --- |
| Tenaz (guerreiros dos dois lados, sinal a meio da coluna) | 20/20 vitórias | 2,1 | ~42 s |
| Ataque à retaguarda | 20/20 vitórias | 3,5 | ~73 s |
| Isca com fundeiros | 20/20 vitórias | 7,6 | ~98 s |
| Fundeiros primeiro | 13/20 vitórias | 8,8 | ~123 s |
| Carga frontal imediata | 0/20 | 12 | — |
| Grupos à vista junto à estrada | 0/20 | 12 | — |
| Não fazer nada | a coluna escapa | 0 | — |

Os humanos não jogam como os robôs; estes números só garantem que há várias formas de ganhar e de perder.

## Limitações conhecidas

- Campo único e fixo; a semente só muda a variação dos golpes. Terreno por semente é o T2.
- Sem linha de vista real (as árvores não bloqueiam a vista); a cobertura reduz projéteis e esconde.
- Arte, sons e animação provisórios.
- Sem tutorial; as dicas no ecrã fazem esse papel.

## Hipótese de design H1 (não implementada)

**Retirada fingida e segunda emboscada.** Um grupo isca ataca a coluna e foge de propósito; os romanos perseguem, perdem a forma e entram numa segunda posição onde o resto do bando espera (Tríbola, 147 a.C.). Candidata a mecânica distintiva. No M1 observamos se os jogadores tentam isto sozinhos com «Retirar» + «Atacar». Decisão depois do M1, com o desenho do T3.

## M1.1 — decisões durante o combate

Avaliação do M1 pelo maintainer: legibilidade 4/5, impacto 3/5, **decisões táticas 2/5**, vontade de repetir «talvez».

### Diagnóstico (mesmas 20 sementes)

- Nenhuma das estratégias vencedoras dava ordens depois do sinal; na tenaz, 3,9 romanos caíam nos primeiros 10 s e o resto era consequência.
- Recuar não servia de nada: uma carga frontal que recuava para o bosque perdia 20/20 na mesma (o mato só protegia de projéteis).
- Números: carga × surpresa × costas chegava a ~7,7× durante 10 s de surpresa.
- Design: os romanos só atacavam o mais perto; nunca apoiavam um aliado nem protegiam um flanco.

### O que mudou

- **O mato desfaz a formação**: legionários a combater em terreno difícil perdem o escudo da frente (`ROLES.legionario.formation`, `TUNING.roughCover`).
- **Recuar para um ponto**: `retirar` com `x,y` larga o combate (de costas, sem carga) e fica no campo a manter. Na página: **B** recua para o bosque mais perto; **Shift + botão direito** recua para um ponto. **R** continua a sair do campo.
- **Reação romana provisória com respostas legíveis** (determinista por semente):
  - temperamento por grupo de legionários — *impetuosos* perseguem quem recua ou enfraquece, mesmo para o mato; *disciplinados* seguram a estrada e não entram no mato;
  - ninguém entra no mato atrás de quem lá espera sem recuar; esperar escondido não ganha (a coluna segue caminho);
  - um grupo livre vai **apoiar** o aliado atacado, sobre quem o está a flanquear;
  - a coluna pode **cerrar fileiras** (vélites abrigam-se atrás dos legionários);
  - três ordens de marcha possíveis, por semente.
- Números: surpresa 10 → 6 s, carga 2,2 → 1,8, bónus juntos limitados a 3× (`TUNING.maxMult`). Vida e dano romanos inalterados.
- Feedback: confirmação de cada ordem (texto e som), grupos ameaçados a vermelho (anel, cartão e linha da ameaça romana), «Flank!/Rear!» com som próprio, «Formation broken!» quando os romanos entram no mato, faixas de apoio e de fileiras cerradas, estado e temperamento romano na etiqueta, carga mais forte, vinheta vermelha nas baixas próprias, e uma secção **Why** no resultado (também no texto copiado).

### Antes e depois (robôs, sementes 1–20)

| Estratégia | M1 | M1.1 |
| --- | --- | --- |
| Tenaz, sem ordens depois do sinal | 20 vitórias | 17 vitórias, 3 derrotas |
| Tenaz, a reagir (recuar quem é apanhado por dois; atacar quem entra no mato) | 20 retiradas* | 19 vitórias |
| Carga frontal, sem ordens | 20 derrotas | 19 derrotas |
| Carga frontal, aos 10 s todos recuam para o bosque | 20 retiradas* | 14 vitórias, 5 escapam, 1 derrota |
| Grupos à vista, sem ordens | 20 derrotas | 8 derrotas, 8 escapam, 4 vitórias |
| Todos no mato à espera depois do sinal | — | 19 escapam, 1 vitória |

\* No M1 não havia recuar para um ponto: «retirar» saía do campo.

Os robôs são simples e jogam pior do que uma pessoa; servem para confirmar que a mesma situação tem resultados diferentes conforme a decisão a meio do combate.

## M1.2 — legibilidade

Origem: auditoria da gravação da Batalha 2 (semente 2, M1.1). A partida acabou em vitória mas sem emboscada: os Wolves ficaram em campo aberto e a coluna viu-os aos 0:16; nada avisou o jogador. Seguiram-se cerca de 55 s de jogo sem decisões, um corpo a corpo ilegível e um «Why» com frases soltas. Aprovadas as melhorias 1 a 6; a 7 (voltar a esconder-se) fica adiada.

### O que mudou

1. **Exposto / Escondido / Visto.** Os cartões e as etiquetas mostram o estado também durante a batalha (antes, um grupo à vista não dizia nada). Anéis tracejados no chão mostram o alcance de deteção romana, com as mesmas contas da descoberta (`spotRange` em `roman-stub.js`): na preparação, à volta de todos os grupos (30 m a descoberto, a vermelho; curtos e claros no mato); na espera, só os grupos à vista e o selecionado, e só enquanto a coluna não viu ninguém. O painel da preparação e o aviso da espera nomeiam quem está à vista — o aviso da espera também aparece quando se chega à batalha por «Jogar outra vez», que não passa pela preparação.
2. **Vélites.** Ao cerrar fileiras, os vélites alternavam a cada 0,5 s entre abrigar-se e atacar (25 alternâncias em 52 ordens na Batalha 2) e nunca lançavam dardos antes do sinal; o «Threatened» que isto gerava nos Wolves era falso. Agora abrigam-se e saem em **surtidas** que vão até ao fim (disparar ou 8 s), com 5 s de abrigo entre surtidas e histerese à saída do abrigo (`STUB.sortieFor`, `sortieRest`, `coverHysteresis`). Na Batalha 2: 0 alternâncias e 3 salvas antes do sinal.
3. **Descoberta com grupo e causa; sinal com ou sem surpresa.** A faixa nomeia o grupo («The column has seen the Wolves») e o registo diz porquê: a descoberto (e a que distância), a coluna passou perto do esconderijo, ou um inimigo deu com eles. Com a coluna já de sobreaviso, o botão do sinal deixa de pulsar e explica porquê; o sinal dado assim tem faixa, som e efeitos próprios, sem clarão nem câmara lenta («Signal — but Rome is ready»). Com surpresa, mantém a festa e diz quantas unidades apanhou.
4. **Marcha romana.** Uma pastilha junto à barra da coluna: em marcha, parada (com os segundos até retomar a marcha — o único número), em movimento, em combate.
5. **Corpo a corpo.** Etiquetas compactas (nome e homens na mesma linha), afastadas em 2D e ligadas ao grupo por um traço quando deslocadas; cada grupo em combate diz contra quem luta («vs Rearguard +1»). Perigo explícito e por ordem de gravidade: *About to break* (mais uma baixa e quebra, pela regra da simulação), *Outnumbered* (dois romanos ou mais em corpo a corpo), *Flanked!*, *Threatened*. Mensagens: uma por grupo, por cima da etiqueta, e uma menos importante não tapa uma mais importante. Anéis romanos discretos durante o corpo a corpo.
6. **Porquê.** Até cinco acontecimentos, escolhidos pela importância e mostrados por ordem cronológica com o tempo: quem foi visto e porquê, o sinal (com ou sem surpresa), quem quebrou e contra quantos lutava, quem entrou no mato, o primeiro recuo, uma só reação romana. Tudo vem do registo da simulação. Os ataques pelo flanco passaram para os números do resultado.

A regra mantém-se: um grupo descoberto não volta a ficar escondido quando entra no bosque (testado).

### Antes e depois (robôs, sementes 1–20; `node tools/tactical-bots.mjs [--root <checkout>]`)

| Estratégia | M1.1 | M1.2 |
| --- | --- | --- |
| Tenaz, sem ordens depois do sinal | 17 vitórias, 3 derrotas · 5,4 baixas | 19 vitórias, 1 derrota · 5,1 |
| Tenaz, a reagir | 20 vitórias · 4,1 | 20 vitórias · 3,4 |
| Ataque à retaguarda | 20 vitórias · 4,7 | 20 vitórias · 4,8 |
| Carga frontal, sem ordens | 19 derrotas, 1 escapa · 11,9 | 20 derrotas · 12 |
| Carga frontal, recuo para o bosque aos 10 s | 14 vitórias, 5 escapam, 1 derrota · 2,9 | 14 vitórias, 5 escapam, 1 derrota · 1,9 |
| Grupos à vista, sem ordens | 4 vitórias, 8 escapam, 8 derrotas · 10,4 | **11 vitórias**, 2 escapam, 7 derrotas · 10,2 |
| Todos no mato à espera depois do sinal | 19 escapam, 1 vitória | 19 escapam, 1 vitória |
| Wolves expostos, sinal a 68 % (Batalha 2) | 20 vitórias · 6,0 | 20 vitórias · 6,5 |

Todas as diferenças vêm da correção dos vélites; as mudanças de ecrã não tocam na simulação (resultados idênticos com e sem elas). A relevante é **«Grupos à vista»**: no M1.1, os vélites a oscilar acabavam por seguir a estrada e escapar a meio da luta, o que dava à coluna desfechos «escapou» sem combate. Agora ficam abrigados atrás dos legionários; quando estes caem, retiram. Jogar à vista continua muito pior do que esconder-se (o dobro das baixas e menos vitórias do que a tenaz — é isso que o teste passou a exigir), mas deixou de perder pelo desfecho. Se se quiser que volte a perder, é uma decisão de equilíbrio à parte (por exemplo, vélites sem dardos marcharem para fora do campo).

### Evidência

`production/qa/evidence/tactical-proto-m12/` — Batalha 2 reproduzida no Chrome pelo `tools/e2e-tactical-m12.mjs`, que também verifica o que cada ecrã diz: preparação, Wolves expostos na espera, descoberta, reação romana, sinal sem surpresa, corpo a corpo com cinco grupos, resultado (inglês e português).

### Hipótese H2 (não implementada): recuperar a ocultação

Um grupo visto voltaria a ficar escondido depois de **perder o contacto visual** com todos os romanos (nenhum a menos de `spotRange` × 1,5, por exemplo) e de **permanecer em cobertura** (ocultação > 0,5) durante um tempo mínimo (por exemplo 15 s), sem combater nem disparar. A coluna continuaria de sobreaviso (sem surpresa). Precisa de condições explícitas no ecrã (contagem no cartão), de testes de determinismo e de comparação de equilíbrio com os robôs — esperar escondido não pode voltar a ganhar sozinho. Decisão depois do playtest do M1.2.

## M1.2 — correções de usabilidade antes do primeiro playtest externo

Só ecrã e textos; simulação, equilíbrio, reação romana, relatório e `PROTO_VERSION` (`m1.2-proto-1`) inalterados. Guardar o SHA da build com as notas das sessões.

- **Câmara inicial** (`view.js`): os quatro grupos começavam por baixo da barra do topo; a 1366×768 não se conseguiam agarrar sem mexer na câmara. Novo enquadramento (`tx 80, ty 44, dist 110`): grupos e etiquetas abaixo da barra e à direita do painel de preparação de 1280×720 a 1920×1080. Posições táticas iguais.
- **Objetivo** no painel de preparação (`prep.goal`, inglês e português): a coluna vem da esquerda e tem de ser desbaratada antes de sair do vale. Não diz onde esconder nem quando dar o sinal.
- **B vs R**: botões «Fall back (stay)» / «Leave battle» («Recuar (fica)» / «Abandonar batalha»), dica de cada botão, dica da batalha e lista de controlos explicam que B fica no campo e R sai de vez.
- **Layout**: a dica e o registo acompanham a altura da barra de baixo (a 1366×768 passa a duas linhas e tapava a dica).
- Verificação: `node tools/e2e-tactical-first-screen.mjs` (falha 20 verificações sem as correções); capturas `production/qa/evidence/tactical-proto-m12/primeiro-ecra-*.jpg`.
